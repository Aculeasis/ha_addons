import asyncio
import sys
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import server


class CheckScheduleTests(unittest.IsolatedAsyncioTestCase):
    async def test_config_save_keeps_the_existing_check_task(self):
        old_config, old_checker, old_task = server.config, server.checker, server.check_task
        old_event = server.check_schedule_changed
        running = asyncio.create_task(asyncio.sleep(60))
        body = {"monitoring": {"check_interval_seconds": 30}, "proxies": []}
        server.check_task = running
        server.check_schedule_changed = asyncio.Event()
        try:
            with patch.object(server, "save_config"), patch.object(server, "apply_logging_level"), \
                 patch.object(server, "_broadcast_stats", new_callable=AsyncMock):
                result = await server.api_save_config(
                    SimpleNamespace(json=AsyncMock(return_value=body)), None
                )
            self.assertEqual(result["status"], "ok")
            self.assertIs(server.check_task, running)
            self.assertFalse(running.cancelled())
            self.assertTrue(server.check_schedule_changed.is_set())
        finally:
            running.cancel()
            try:
                await running
            except asyncio.CancelledError:
                pass
            server.config, server.checker, server.check_task = old_config, old_checker, old_task
            server.check_schedule_changed = old_event

    async def test_shorter_interval_wakes_schedule_without_restart(self):
        old_config, old_event = server.config, server.check_schedule_changed
        server.config = {"monitoring": {"check_interval_seconds": 3600}}
        server.check_schedule_changed = asyncio.Event()
        task = asyncio.create_task(server._wait_for_next_check(time.monotonic() - 10))
        try:
            await asyncio.sleep(0)
            self.assertFalse(task.done())
            server.check_schedule_changed.set()
            await asyncio.sleep(0)
            self.assertFalse(task.done())  # an unrelated save does not trigger a check
            server.config = {"monitoring": {"check_interval_seconds": 5}}
            server.check_schedule_changed.set()
            await asyncio.wait_for(task, timeout=1)
        finally:
            task.cancel()
            server.config, server.check_schedule_changed = old_config, old_event


if __name__ == "__main__":
    unittest.main()
