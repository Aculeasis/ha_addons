import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import server
from configuration import validate_config
from monitoring import CheckProgress, proxy_health, stale_after
from storage import Storage


class HealthTests(unittest.TestCase):
    def test_statuses_and_freshness_boundary(self):
        proxy = {"tcp_check": True, "udp_check": True}
        good = {"success": True, "timestamp": 100}
        bad = {"success": False, "timestamp": 100}
        cases = [
            ({}, "unknown"),
            ({"tcp": bad}, "unknown"),
            ({"tcp": good, "udp": good}, "alive"),
            ({"tcp": good, "udp": bad}, "partial"),
            ({"tcp": bad, "udp": bad}, "dead"),
            ({"tcp": good, "udp": {**good, "timestamp": 99}}, "stale"),
        ]
        for checks, expected in cases:
            with self.subTest(expected=expected, checks=checks):
                self.assertEqual(proxy_health(proxy, checks, 160, 60), expected)
        self.assertEqual(proxy_health({"tcp_check": False}, {}, 1000, 60), "disabled")
        self.assertEqual(proxy_health({}, {"tcp": good}, 160, 60), "alive")
        self.assertEqual(proxy_health({}, {"tcp": good}, 161, 60), "stale")

    def test_large_queue_is_allowed_to_finish_before_results_expire(self):
        mon = {"check_interval_seconds": 60, "check_timeout_seconds": 10, "concurrent_checks": 2}
        self.assertEqual(stale_after(mon, 100), 665)
        self.assertEqual(stale_after(mon, 1), 120)

    def test_worker_progress_and_stall_detection(self):
        mon = {"check_interval_seconds": 60, "check_timeout_seconds": 10}
        with patch("monitoring.time.time", return_value=1000), patch("monitoring.time.monotonic", return_value=10):
            progress = CheckProgress()
            self.assertEqual(progress.snapshot(True, mon, 1)["state"], "starting")
            progress.begin(mon, 1)
            progress.active.add("test")
            self.assertEqual(progress.snapshot(True, mon, 1)["active_checks"], 1)
            self.assertEqual(progress.snapshot(True, mon, 1)["state"], "checking")
        with patch("monitoring.time.monotonic", return_value=28):
            self.assertEqual(progress.snapshot(True, mon, 1)["state"], "stalled")
            progress.finish()
            self.assertEqual(progress.snapshot(True, mon, 1)["state"], "waiting")
            self.assertEqual(progress.snapshot(True, mon, 0)["state"], "idle")
            self.assertEqual(progress.snapshot(False, mon, 1)["state"], "stopped")
        with patch("monitoring.time.monotonic", return_value=76):
            self.assertEqual(progress.snapshot(True, mon, 1)["state"], "stalled")


class StorageAndStatsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.storage = Storage(":memory:")
        await self.storage.init()

    async def asyncTearDown(self):
        await self.storage.close()

    async def test_polling_never_refreshes_check_timestamp(self):
        await self.storage.save_check("old:1080", "tcp", 100, True, 20)
        await self.storage.save_check("fresh:1080", "tcp", 190, False)
        await self.storage.commit()
        config = {"monitoring": {"check_interval_seconds": 10}, "proxies": [
            {"host": host, "port": 1080} for host in ("old", "fresh", "new")
        ]}
        progress = CheckProgress()
        progress.active.add("old:1080")
        with patch.multiple(server, storage=self.storage, config=config, check_progress=progress, check_task=None):
            with patch("server.time.time", return_value=200):
                first = await server._all_stats()
            with patch("server.time.time", return_value=201):
                second = await server._all_stats()
        self.assertEqual(first["last_updated"], 190)
        self.assertEqual(second["last_updated"], 190)
        self.assertNotEqual(first["generated_at"], second["generated_at"])
        self.assertEqual([p["status"] for p in first["proxies"]], ["stale", "dead", "unknown"])
        self.assertEqual(first["summary"]["dead"], 1)
        self.assertEqual(first["summary"]["unknown"], 1)
        self.assertTrue(first["proxies"][0]["checking"])
        self.assertFalse(first["proxies"][0]["is_alive"])
        self.assertEqual(first["monitor"]["state"], "stopped")

    async def test_empty_and_disabled_have_no_latest_check(self):
        with patch.multiple(server, storage=self.storage, config={"proxies": []}):
            self.assertIsNone((await server._all_stats())["last_updated"])
        await self.storage.save_check("disabled:1080", "tcp", 100, True)
        with patch.multiple(server, storage=self.storage, config={"proxies": [
            {"host": "disabled", "port": 1080, "tcp_check": False}
        ]}):
            stats = await server._all_stats()
        self.assertEqual(stats["summary"]["disabled"], 1)
        self.assertIsNone(stats["last_updated"])

    async def test_unknown_chart_does_not_write_to_database(self):
        self.assertEqual(await self.storage.get_chart_data("missing:1080"), {})
        async with self.storage._db.execute("SELECT COUNT(*) FROM proxies") as cursor:
            self.assertEqual((await cursor.fetchone())[0], 0)
        self.assertEqual(self.storage._proxy_cache, {})

    async def test_vacuum_with_uncommitted_check_preserves_history(self):
        await self.storage.save_check("test:1080", "tcp", 100, True, 15)
        await self.storage.vacuum()
        chart = await self.storage.get_chart_data("test:1080", from_ts=0, to_ts=200)
        self.assertEqual(chart["tcp"][0]["successes"], 1)

    async def test_worker_reports_active_checks_and_completion(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def check(_proxy):
            entered.set()
            await release.wait()
            return {"tcp": {"success": True, "latency_ms": 5}}

        config = {"monitoring": {"check_interval_seconds": 60}, "proxies": [{"host": "test", "port": 1080}]}
        progress = CheckProgress()
        with patch.multiple(server, storage=self.storage, config=config, checker=SimpleNamespace(check_proxy=check),
                            check_progress=progress, stats_changed=asyncio.Event(), check_schedule_changed=asyncio.Event()):
            worker = asyncio.create_task(server._run_checks())
            try:
                await asyncio.wait_for(entered.wait(), 3)
                with patch.object(server, "check_task", worker):
                    stats = await server._all_stats()
                    self.assertEqual(stats["proxies"][0]["status"], "unknown")
                    self.assertTrue(stats["proxies"][0]["checking"])
                    self.assertEqual(stats["monitor"]["state"], "checking")
                    release.set()
                    async with asyncio.timeout(2):
                        while progress.finished_at is None:
                            await asyncio.sleep(0.01)
                    stats = await server._all_stats()
                    self.assertEqual(stats["proxies"][0]["status"], "alive")
                    self.assertFalse(stats["proxies"][0]["checking"])
                    self.assertEqual(stats["monitor"]["state"], "waiting")
            finally:
                worker.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await worker


class BroadcastTests(unittest.IsolatedAsyncioTestCase):
    async def test_disconnect_during_broadcast_does_not_interrupt_other_clients(self):
        clients = set()
        class Socket:
            def __init__(self, disconnect=False):
                self.disconnect = disconnect
                self.messages = []

            async def send_text(self, message):
                await asyncio.sleep(0)
                if self.disconnect:
                    clients.discard(self)
                    raise ConnectionError()
                self.messages.append(message)

        good, disconnected = Socket(), Socket(True)
        clients.update((good, disconnected))
        with patch.multiple(server, ws_clients=clients, broadcast_lock=asyncio.Lock()), \
                patch.object(server, "_all_stats", AsyncMock(return_value={})):
            await server._broadcast_stats()
        self.assertEqual(len(good.messages), 1)
        self.assertEqual(clients, {good})

    async def test_stats_publisher_runs_without_checker(self):
        event, published = asyncio.Event(), asyncio.Event()
        async def publish():
            published.set()
        with patch.object(server, "stats_changed", event), patch.object(server, "_broadcast_stats", publish):
            task = asyncio.create_task(server._run_stats())
            try:
                event.set()
                await asyncio.wait_for(published.wait(), 1)
            finally:
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task


class ConfigurationTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_settings_do_not_replace_working_config(self):
        bad_configs = [None, [], {"proxies": "invalid"}, {"monitoring": {"concurrent_checks": 0}},
                       {"storage": {"retention_days": -1}}, {"monitoring": {"check_interval_seconds": float("nan")}}]
        for config in bad_configs:
            with self.subTest(config=config), patch.object(server, "save_config") as save:
                with self.assertRaises(server.HTTPException) as error:
                    await server.api_save_config(SimpleNamespace(json=AsyncMock(return_value=config)), None)
                self.assertEqual(error.exception.status_code, 422)
                save.assert_not_called()

    def test_partial_configuration_remains_supported(self):
        validate_config({"proxies": [{"host": "localhost", "port": 1080}]})
        validate_config({"monitoring": {"check_interval_seconds": 0.5}, "proxies": []})

    def test_failed_atomic_save_keeps_previous_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.yaml"
            path.write_text("proxies: []\n", encoding="utf-8")
            with patch.object(server, "CONFIG_PATH", path), patch("server.os.replace", side_effect=OSError("failed")):
                with self.assertRaises(OSError):
                    server.save_config({"proxies": [{"host": "new", "port": 1080}]})
            self.assertEqual(path.read_text(encoding="utf-8"), "proxies: []\n")
            self.assertEqual(list(Path(directory).iterdir()), [path])


if __name__ == "__main__":
    unittest.main()
