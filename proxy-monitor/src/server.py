"""
server.py – FastAPI backend for the SOCKS Proxy Monitor.

Features
--------
* Async check loop with configurable concurrency and interval
* SQLite storage with automatic retention cleanup
* Session-token auth (optional; inactive when password is empty)
* IP / CIDR whitelist bypass
* WebSocket push of full stats after every check cycle
* REST API: stats, chart data, config read/write
* Serves the web/ SPA
"""
import argparse
import asyncio
import ipaddress
import json
import logging
import os
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

import uvicorn
import yaml
from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from checker import ProxyChecker
from configuration import validate_config
from monitoring import CheckProgress, STATUSES, enabled_checks, proxy_health, stale_after
from storage import Storage

# Logging
LOG_LEVELS = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def apply_logging_level() -> None:
    """Updates the logging level for the root logger and uvicorn loggers."""
    level_name = config.get("server", {}).get("log_level", "INFO").upper()
    level = LOG_LEVELS.get(level_name, logging.INFO)
    logging.getLogger().setLevel(level)
    # Update uvicorn loggers to match
    for name in ["uvicorn", "uvicorn.error", "uvicorn.access"]:
        logging.getLogger(name).setLevel(level)
    logger.info("Logging level set to %s", level_name)


# Global state & Args

def _parse_args():
    parser = argparse.ArgumentParser(description="SOCKS Proxy Monitor Server")
    parser.add_argument("-config", "--config", help="Path to config file (default: config.yaml)", default="config.yaml")
    # Using parse_known_args to avoid issues with uvicorn or other launchers
    args, _ = parser.parse_known_args()
    return args

_args = _parse_args()
CONFIG_PATH = Path(_args.config)

config: Dict[str, Any] = {}
storage: Optional[Storage] = None
checker: Optional[ProxyChecker] = None

ws_clients: Set[WebSocket] = set()
check_task: Optional[asyncio.Task] = None
cleanup_task: Optional[asyncio.Task] = None
stats_task: Optional[asyncio.Task] = None
check_schedule_changed = asyncio.Event()
stats_changed = asyncio.Event()
broadcast_lock = asyncio.Lock()
check_progress = CheckProgress()

# token -> expiry (unix timestamp)
sessions: Dict[str, float] = {}
SESSION_TTL = 86400  # 24 h

WEB_DIR = Path(__file__).parent / "web"

# Config helpers

def load_config() -> Dict[str, Any]:
    with open(CONFIG_PATH, encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh)
    validate_config(cfg)
    return cfg


def save_config(cfg: Dict[str, Any]) -> None:
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=CONFIG_PATH.parent, delete=False) as fh:
            temporary = Path(fh.name)
            yaml.safe_dump(cfg, fh, default_flow_style=False, allow_unicode=True)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temporary, CONFIG_PATH)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def get_proxy_id(proxy: Dict) -> str:
    return f"{proxy['host']}:{proxy['port']}"


# Auth helpers

def _auth_required() -> bool:
    return bool(config.get("server", {}).get("password", ""))


def _is_ip_in_list(client_ip: str, ip_list: List[str]) -> bool:
    if not client_ip:
        return False
    if client_ip in ip_list:
        return True
    try:
        addr = ipaddress.ip_address(client_ip)
        for item in ip_list:
            try:
                if addr in ipaddress.ip_network(item, strict=False):
                    return True
            except ValueError:
                pass
    except (ValueError, TypeError):
        pass
    return False


def _is_trusted_ip(client_ip: str) -> bool:
    srv = config.get("server", {})
    trusted = srv.get("trusted_ips", ["127.0.0.1", "::1"])
    return _is_ip_in_list(client_ip, trusted)


def _is_whitelisted_ip(client_ip: str) -> bool:
    srv = config.get("server", {})
    whitelist = srv.get("whitelist", [])
    if not whitelist:
        return True
    return _is_ip_in_list(client_ip, whitelist)


def _validate_session(token: str) -> bool:
    exp = sessions.get(token)
    if exp is None:
        return False
    if exp < time.time():
        sessions.pop(token, None)
        return False
    return True


def _create_session() -> str:
    token = str(uuid.uuid4())
    sessions[token] = time.time() + SESSION_TTL
    return token


async def _require_auth(request: Request) -> None:
    if not _auth_required():
        return
    client_ip = request.client.host if request.client else ""
    if _is_trusted_ip(client_ip):
        return
    token = request.headers.get("X-Session-Token", "")
    if token and _validate_session(token):
        return
    raise HTTPException(
        status_code=401,
        detail="Unauthorized",
        headers={"WWW-Authenticate": "Bearer realm='Proxy Monitor'"},
    )


# Check / cleanup

async def _db_cleanup(force_vacuum: bool = False) -> None:
    if storage:
        # Sync proxies: remove those that are no longer in the config
        configured_ids = [get_proxy_id(p) for p in config.get("proxies", [])]
        result1 = await storage.sync_proxies(configured_ids)

        # Cleanup old data based on retention setting
        retention = config.get("storage", {}).get("retention_days", 30)
        result2 = await storage.cleanup_old_data(retention)

        if result1 or result2 or force_vacuum:
            await storage.vacuum()
    else:
        raise RuntimeError("Storage not initialized")


async def _wait_for_next_check(cycle_start: float) -> None:
    """Keep the current cadence, but recalculate it when settings change."""
    while True:
        interval = max(0.1, float(config.get("monitoring", {}).get("check_interval_seconds", 60)))
        remaining = cycle_start + interval - time.monotonic()
        if remaining <= 0:
            await asyncio.sleep(0.1)
            return
        try:
            await asyncio.wait_for(check_schedule_changed.wait(), timeout=remaining)
            check_schedule_changed.clear()
        except asyncio.TimeoutError:
            return


async def _run_checks() -> None:
    """Main check loop. Config saves never start a second check cycle."""
    await asyncio.sleep(1)  # brief pause to let uvicorn settle
    while True:
        cycle_start = time.monotonic()

        mon = config.get("monitoring", {})
        concurrent = mon.get("concurrent_checks", 10)
        proxies = [proxy for proxy in config.get("proxies", []) if enabled_checks(proxy)]
        cycle_checker = checker

        if not proxies:
            await _wait_for_next_check(cycle_start)
            continue

        sem = asyncio.Semaphore(concurrent)
        check_progress.begin(mon, len(proxies))
        stats_changed.set()

        async def _check_one(proxy: Dict) -> None:
            async with sem:
                pid = get_proxy_id(proxy)
                check_progress.active.add(pid)
                stats_changed.set()
                try:
                    results = await cycle_checker.check_proxy(proxy)  # type: ignore[union-attr]
                    now = int(time.time())
                    for ct, res in results.items():
                        await storage.save_check(  # type: ignore[union-attr]
                            proxy_id=pid,
                            check_type=ct,
                            timestamp=now,
                            success=res["success"],
                            latency_ms=res.get("latency_ms"),
                            external_ip=res.get("external_ip"),
                            error=res.get("error"),
                        )
                    logger.info(
                        "Checked %-30s %s",
                        proxy.get("name", pid),
                        {ct: ("OK" if r["success"] else f"FAIL({r['error']})") for ct, r in results.items()},
                    )
                except Exception as err:
                    logger.error("Unhandled error checking %s: %s", proxy.get("name", pid), err)
                finally:
                    check_progress.active.discard(pid)
                    check_progress.completed += 1
                    stats_changed.set()

        try:
            await asyncio.gather(*[_check_one(p) for p in proxies], return_exceptions=True)
            await storage.commit()  # type: ignore[union-attr]
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Check loop error: %s", exc)
        finally:
            check_progress.finish()
            stats_changed.set()

        await _wait_for_next_check(cycle_start)


async def _run_cleanup() -> None:
    while True:
        interval_min = config.get("storage", {}).get("cleanup_interval_minutes", 60)
        try:
            await asyncio.sleep(interval_min * 60)
        except asyncio.CancelledError:
            return
        try:
            await _db_cleanup()
        except Exception as exc:
            logger.error("Cleanup error: %s", exc)


# Stats aggregation

async def _all_stats() -> Dict[str, Any]:
    proxies: List[Dict] = config.get("proxies", [])
    mon = config.get("monitoring", {})
    window = mon.get("recent_window_minutes", 5)
    interval = mon.get("check_interval_seconds", 60)
    now = time.time()
    sparkline_since = int(now) - max(60 * interval, window * 60)
    enabled_count = sum(bool(enabled_checks(proxy)) for proxy in proxies)
    max_age = stale_after(mon, enabled_count)
    proxy_list: List[Dict] = []
    counts = dict.fromkeys(STATUSES, 0)
    latest_check = None

    all_summaries = await storage.get_all_summaries(window, sparkline_since=sparkline_since)  # type: ignore[union-attr]

    for proxy in proxies:
        pid = get_proxy_id(proxy)
        summary = all_summaries.get(pid, {})

        last_checks: Dict = summary.get("last_checks", {})
        status = proxy_health(proxy, last_checks, now, max_age)
        counts[status] += 1
        checks = [last_checks.get(kind, {}) for kind in enabled_checks(proxy)]
        timestamps = [check["timestamp"] for check in checks if check.get("timestamp") is not None]
        last_checked = max(timestamps, default=None)
        if last_checked is not None:
            latest_check = max(latest_check or 0, last_checked)
        external_ip = next((check["external_ip"] for check in checks if check.get("external_ip")), None)

        proxy_list.append(
            {
                "id": pid,
                "name": proxy.get("name", pid),
                "host": proxy["host"],
                "port": proxy["port"],
                "tags": proxy.get("tags", []),
                "tcp_check": proxy.get("tcp_check", True),
                "udp_check": proxy.get("udp_check", False),
                "is_alive": status in ("alive", "partial"),
                "status": status,
                "checking": pid in check_progress.active,
                "last_checked": last_checked,
                "fresh_until": min(timestamps) + max_age if timestamps and len(timestamps) == len(checks) else None,
                "external_ip": external_ip,
                "stats": summary,
            }
        )

    return {
        "proxies": proxy_list,
        "summary": {"total": len(proxies), **counts},
        "last_updated": latest_check,
        "generated_at": now,
        "monitor": check_progress.snapshot(check_task is not None and not check_task.done(), mon, enabled_count),
        "meta": {
            "window_minutes": window,
            "check_interval": config.get("monitoring", {}).get("check_interval_seconds", 60),
            "stale_after_seconds": max_age,
            "time_format": config.get("server", {}).get("time_format", "24h"),
            "retention_days": config.get("storage", {}).get("retention_days", 30),
        },
    }


async def _broadcast_stats() -> None:
    async with broadcast_lock:
        if not ws_clients:
            return
        data = await _all_stats()
        msg = json.dumps({"type": "stats", "data": data})

        async def send(ws: WebSocket) -> None:
            try:
                await asyncio.wait_for(ws.send_text(msg), timeout=5)
            except Exception:
                ws_clients.discard(ws)

        # Connections can close while send_text yields to the event loop.
        await asyncio.gather(*(send(ws) for ws in tuple(ws_clients)))


async def _run_stats() -> None:
    """Publish activity and ageing even when the checker has stopped progressing."""
    while True:
        try:
            await asyncio.wait_for(stats_changed.wait(), timeout=5)
        except asyncio.TimeoutError:
            pass
        stats_changed.clear()
        try:
            await _broadcast_stats()
        except Exception:
            logger.exception("Stats broadcast failed")
        await asyncio.sleep(0.1)


# Lifespan

@asynccontextmanager
async def lifespan(app: FastAPI):
    global config, storage, checker, check_task, cleanup_task, stats_task, check_progress

    config = load_config()
    apply_logging_level()
    db_path = config.get("storage", {}).get("db_path", "proxy_data.db")
    storage = Storage(db_path)
    await storage.init()
    checker = ProxyChecker(config)
    check_progress = CheckProgress()

    check_task = asyncio.create_task(_run_checks())
    cleanup_task = asyncio.create_task(_run_cleanup())
    stats_task = asyncio.create_task(_run_stats())

    n = len(config.get("proxies", []))
    logger.warning("Proxy Monitor started - %d prox%s configured.", n, "ies" if n != 1 else "y")

    yield

    # Graceful shutdown
    for task in (check_task, cleanup_task, stats_task):
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    # Close database connection
    if storage:
        await storage.close()


# App

app = FastAPI(title="Proxy Monitor", lifespan=lifespan)

@app.middleware("http")
async def whitelist_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else ""
    if not _is_whitelisted_ip(client_ip):
        return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    return await call_next(request)


# Auth endpoints

class LoginBody(BaseModel):
    username: str
    password: str


@app.get("/api/auth-info")
async def auth_info(request: Request) -> Dict:
    srv = config.get("server", {})
    client_ip = request.client.host if request.client else ""
    safeguard = os.getenv("HASSIO_SAFEGUARD") == "true" or os.getenv("HASSIO_SAFEGUARD") == "1"
    if _is_trusted_ip(client_ip):
        return {
            "auth_required": False,
            "username": None,
            "safeguard": safeguard,
        }
    return {
        "auth_required": _auth_required(),
        "username": srv.get("username", "admin") if _auth_required() else None,
        "safeguard": safeguard,
    }


@app.post("/api/login")
async def login(body: LoginBody, request: Request) -> Dict:
    srv = config.get("server", {})
    # Trusted IPs always get a free pass, no token assigned
    client_ip = request.client.host if request.client else ""
    if _is_trusted_ip(client_ip):
        return {"token": "", "auth_required": False}

    if not _auth_required():
        return {"token": "", "auth_required": False}

    if body.username == srv.get("username", "admin") and body.password == srv.get("password", ""):
        return {"token": _create_session(), "auth_required": True}

    raise HTTPException(status_code=401, detail="Invalid credentials")


# Data API

@app.get("/api/stats")
async def api_stats(_: None = Depends(_require_auth)) -> Dict:
    return await _all_stats()


@app.get("/api/proxy/chart")
async def api_chart(
    proxy_id: str,
    hours: int = 24,
    group_by: str = "hour",
    from_ts: Optional[int] = None,
    to_ts: Optional[int] = None,
    _: None = Depends(_require_auth),
) -> Dict:
    return await storage.get_chart_data(proxy_id, hours=hours, group_by=group_by, from_ts=from_ts, to_ts=to_ts)


# Config API

@app.get("/api/config")
async def api_get_config(_: None = Depends(_require_auth)) -> Dict:
    return config


@app.get("/api/db-size")
async def api_db_size(_: None = Depends(_require_auth)) -> Dict:
    p = Path(config.get("storage", {}).get("db_path", "proxy_data.db"))
    if not p.is_file():
        return {"size": 0, "formatted": "0 B"}
    size_bytes = p.stat().st_size
    s = float(size_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if s < 1024 or unit == "GB":
            return {"size": size_bytes, "formatted": f"{s:.0f} {unit}" if unit == "B" else f"{s:.1f} {unit}"}
        s /= 1024


@app.post("/api/db-vacuum")
async def api_db_vacuum(_: None = Depends(_require_auth)) -> Dict:
    try:
        await _db_cleanup(force_vacuum=True)
        return {"status": "ok", "message": "Database optimized successfully"}
    except Exception as exc:
        logger.error("Vacuum error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/config")
async def api_save_config(
    request: Request,
    _: None = Depends(_require_auth),
) -> Dict:
    global config, checker

    try:
        body = await request.json()
        validate_config(body)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    save_config(body)
    config = body
    apply_logging_level()
    checker = ProxyChecker(config)

    check_schedule_changed.set()
    await _broadcast_stats()

    return {"status": "ok", "message": "Config saved"}


# WebSocket

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()

    client_ip = websocket.client.host if websocket.client else ""
    if not _is_whitelisted_ip(client_ip):
        await websocket.close(code=4403, reason="Forbidden")
        return

    needs_auth = _auth_required() and not _is_trusted_ip(client_ip)

    try:
        # Wait for auth message to prevent tokens in URL
        msg_text = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
        msg = json.loads(msg_text)
        if msg.get("type") != "auth":
            await websocket.close(code=4401, reason="Unauthorized")
            return

        token = msg.get("token", "")
        if needs_auth and not _validate_session(token):
            await websocket.close(code=4401, reason="Unauthorized")
            return
    except Exception:
        await websocket.close(code=4401, reason="Unauthorized")
        return

    ws_clients.add(websocket)

    try:
        # Push current state immediately
        data = await _all_stats()
        await websocket.send_text(json.dumps({"type": "stats", "data": data}))

        while True:
            try:
                msg_text = await asyncio.wait_for(websocket.receive_text(), timeout=25)
                if msg_text == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": "ping"}))
            except WebSocketDisconnect:
                break
    except Exception as exc:
        logger.error("WebSocket error: %s", exc, exc_info=True)
    finally:
        ws_clients.discard(websocket)


# Static files (SPA)

@app.get("/")
async def serve_root() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/{path:path}")
async def serve_static(path: str) -> FileResponse:
    try:
        root = WEB_DIR.resolve()
        # Resolve path to handle '..' and ensure it's absolute
        # We lstrip to prevent Path from treating it as an absolute path when joining
        fp = (root / path.lstrip("/\\")).resolve()

        # Check if the file is within WEB_DIR and exists
        if fp.is_file() and fp.is_relative_to(root):
            return FileResponse(fp)
    except Exception:
        pass

    return FileResponse(WEB_DIR / "index.html")


# Entry point

def _main():
    _cfg = load_config()
    srv = _cfg.get("server", {})
    uvicorn.run(
        "server:app",
        host=srv.get("host", "0.0.0.0"),
        port=int(srv.get("port", 8080)),
        reload=False,
        log_level="info",
    )

if __name__ == "__main__":
    _main()
