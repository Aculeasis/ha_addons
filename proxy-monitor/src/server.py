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
from storage import Storage

# ------------------------------------------------------------------ #
#  Logging                                                             #
# ------------------------------------------------------------------ #
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


# ------------------------------------------------------------------ #
#  Global state & Args                                                 #
# ------------------------------------------------------------------ #

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
session_cleanup_task: Optional[asyncio.Task] = None

# token -> expiry (unix timestamp)
sessions: Dict[str, float] = {}
SESSION_TTL = 86400  # 24 h

WEB_DIR = Path(__file__).parent / "web"

# Cached monitoring settings (updated on config load)
class MonitoringSettings:
    """Cached monitoring settings to avoid repeated dict lookups in the check loop."""
    __slots__ = ('interval', 'timeout', 'concurrent', 'stagger', 'window_minutes')

    def __init__(self):
        self.interval: int = 60
        self.timeout: float = 10.0
        self.concurrent: int = 10
        self.stagger: bool = True
        self.window_minutes: int = 5

    def update(self, cfg: Dict[str, Any]) -> None:
        mon = cfg.get("monitoring", {})
        self.interval = mon.get("check_interval_seconds", 60)
        self.timeout = float(mon.get("check_timeout_seconds", 10))
        self.concurrent = mon.get("concurrent_checks", 10)
        self.stagger = mon.get("stagger", True)
        self.window_minutes = mon.get("recent_window_minutes", 5)

mon_settings = MonitoringSettings()

# ------------------------------------------------------------------ #
#  Config helpers                                                      #
# ------------------------------------------------------------------ #

def load_config() -> Dict[str, Any]:
    with open(CONFIG_PATH, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def save_config(cfg: Dict[str, Any]) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
        yaml.dump(cfg, fh, default_flow_style=False, allow_unicode=True)


def proxy_id(proxy: Dict) -> str:
    return f"{proxy['host']}:{proxy['port']}"


# ------------------------------------------------------------------ #
#  Auth helpers                                                        #
# ------------------------------------------------------------------ #

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


# ------------------------------------------------------------------ #
#  Check / cleanup loops                                              #
# ------------------------------------------------------------------ #

async def _run_checks() -> None:
    """Main check loop using cached monitoring settings."""
    await asyncio.sleep(1)  # brief pause to let uvicorn settle
    while True:
        cycle_start = time.monotonic()

        # Use cached settings instead of repeated dict lookups
        interval = mon_settings.interval
        concurrent = mon_settings.concurrent
        stagger = mon_settings.stagger
        proxies: List[Dict] = config.get("proxies", [])

        if not proxies:
            await asyncio.sleep(interval)
            continue

        sem = asyncio.Semaphore(concurrent)

        # Calculate stagger delay to spread checks over the interval
        # We aim to finish starting all checks by 80% of the interval
        stagger_delay = 0.0
        if stagger and len(proxies) > 1:
            total_spread = interval * 0.8
            stagger_delay = total_spread / len(proxies)

        async def _check_one(proxy: Dict, delay: float) -> None:
            if delay > 0:
                await asyncio.sleep(delay)

            async with sem:
                pid = proxy_id(proxy)
                try:
                    results = await checker.check_proxy(proxy)  # type: ignore[union-attr]
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
                except Exception as exc:
                    logger.error("Unhandled error checking %s: %s", proxy.get("name", pid), exc)

        try:
            # Plan checks with incremental delays
            tasks = []
            for i, p in enumerate(proxies):
                tasks.append(_check_one(p, i * stagger_delay))

            await asyncio.gather(*tasks, return_exceptions=True)
            await _broadcast_stats()
        except asyncio.CancelledError:
            return
        except Exception as exc:
            logger.error("Check loop error: %s", exc)

        # Calculate time to sleep until the next interval starts
        elapsed = time.monotonic() - cycle_start
        sleep_time = max(0.1, interval - elapsed)

        try:
            await asyncio.sleep(sleep_time)
        except asyncio.CancelledError:
            return


async def _run_cleanup() -> None:
    while True:
        interval_min = config.get("storage", {}).get("cleanup_interval_minutes", 60)
        try:
            await asyncio.sleep(interval_min * 60)
        except asyncio.CancelledError:
            return
        try:
            retention = config.get("storage", {}).get("retention_days", 30)
            await storage.cleanup_old_data(retention)  # type: ignore[union-attr]
        except Exception as exc:
            logger.error("Cleanup error: %s", exc)


async def _run_session_cleanup() -> None:
    """Periodically clean up expired sessions to prevent memory leaks."""
    while True:
        try:
            await asyncio.sleep(3600)  # Run every hour
        except asyncio.CancelledError:
            return
        try:
            now = time.time()
            expired = [token for token, expiry in sessions.items() if expiry < now]
            for token in expired:
                sessions.pop(token, None)
            if expired:
                logger.info("Cleaned up %d expired session(s)", len(expired))
        except Exception as exc:
            logger.error("Session cleanup error: %s", exc)


# ------------------------------------------------------------------ #
#  Stats aggregation                                                  #
# ------------------------------------------------------------------ #

async def _all_stats() -> Dict[str, Any]:
    proxies: List[Dict] = config.get("proxies", [])
    window = config.get("monitoring", {}).get("recent_window_minutes", 5)
    proxy_list: List[Dict] = []
    alive_count = 0
    partial_count = 0
    dead_count = 0

    # Batch fetch all summaries in 4 bulk queries instead of N*4 queries
    all_summaries = await storage.get_all_summaries(window)  # type: ignore[union-attr]

    for proxy in proxies:
        pid = proxy_id(proxy)
        summary = all_summaries.get(pid, {})

        last_checks: Dict = summary.get("last_checks", {})
        is_alive = False
        all_clean = True
        external_ip: Optional[str] = None

        for ct in ["tcp", "udp"]:
            # Check if this protocol is enabled for this proxy
            # Default: TCP is enabled if not specified; UDP is disabled if not specified
            enabled = proxy.get(f"{ct}_check", ct == "tcp")
            if enabled:
                lc = last_checks.get(ct, {})
                if lc.get("success"):
                    is_alive = True
                    if lc.get("error"):
                        all_clean = False
                else:
                    all_clean = False

                if lc.get("external_ip"):
                    external_ip = lc["external_ip"]

        if is_alive:
            if all_clean:
                alive_count += 1
            else:
                partial_count += 1
        else:
            dead_count += 1

        proxy_list.append(
            {
                "id": pid,
                "name": proxy.get("name", pid),
                "host": proxy["host"],
                "port": proxy["port"],
                "tags": proxy.get("tags", []),
                "tcp_check": proxy.get("tcp_check", True),
                "udp_check": proxy.get("udp_check", False),
                "is_alive": is_alive,
                "external_ip": external_ip,
                "stats": summary,
            }
        )

    return {
        "proxies": proxy_list,
        "summary": {
            "total": len(proxies),
            "alive": alive_count,
            "partial": partial_count,
            "dead": dead_count,
        },
        "last_updated": int(time.time()),
        "meta": {
            "window_minutes": window,
            "check_interval": config.get("monitoring", {}).get("check_interval_seconds", 60),
            "time_format": config.get("server", {}).get("time_format", "24h"),
        },
    }


async def _broadcast_stats() -> None:
    if not ws_clients:
        return
    data = await _all_stats()
    msg = json.dumps({"type": "stats", "data": data})
    dead: List[WebSocket] = []
    for ws in ws_clients:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        ws_clients.discard(ws)


# ------------------------------------------------------------------ #
#  Lifespan                                                            #
# ------------------------------------------------------------------ #

@asynccontextmanager
async def lifespan(app: FastAPI):
    global config, storage, checker, check_task, cleanup_task, session_cleanup_task

    config = load_config()
    apply_logging_level()
    mon_settings.update(config)  # Cache monitoring settings
    db_path = config.get("storage", {}).get("db_path", "proxy_data.db")
    storage = Storage(db_path)
    await storage.init()
    checker = ProxyChecker(config)

    check_task = asyncio.create_task(_run_checks())
    cleanup_task = asyncio.create_task(_run_cleanup())
    session_cleanup_task = asyncio.create_task(_run_session_cleanup())

    n = len(config.get("proxies", []))
    logger.warning("Proxy Monitor started - %d prox%s configured.", n, "ies" if n != 1 else "y")

    yield

    # Graceful shutdown
    for task in (check_task, cleanup_task, session_cleanup_task):
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    # Close checker sessions
    if checker:
        await checker.close()

    # Close database connection
    if storage:
        await storage.close()


# ------------------------------------------------------------------ #
#  App                                                                 #
# ------------------------------------------------------------------ #

app = FastAPI(title="Proxy Monitor", lifespan=lifespan)

@app.middleware("http")
async def whitelist_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else ""
    if not _is_whitelisted_ip(client_ip):
        return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    return await call_next(request)


# ------------------------------------------------------------------ #
#  Auth endpoints                                                      #
# ------------------------------------------------------------------ #

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


# ------------------------------------------------------------------ #
#  Data API                                                            #
# ------------------------------------------------------------------ #

@app.get("/api/stats")
async def api_stats(_: None = Depends(_require_auth)) -> Dict:
    return await _all_stats()


@app.get("/api/proxy/chart")
async def api_chart(
    proxy_id: str,
    hours: int = 24,
    group_by: str = "hour",
    _: None = Depends(_require_auth),
) -> Dict:
    return await storage.get_chart_data(proxy_id, hours=hours, group_by=group_by)  # type: ignore[union-attr]


# ------------------------------------------------------------------ #
#  Config API                                                          #
# ------------------------------------------------------------------ #

@app.get("/api/config")
async def api_get_config(_: None = Depends(_require_auth)) -> Dict:
    return config


@app.get("/api/db-size")
async def api_db_size(_: None = Depends(_require_auth)) -> Dict:
    db_path = str(config.get("storage", {}).get("db_path", "proxy_data.db"))
    try:
        p = Path(db_path).resolve()
    except Exception:
        return {"size": 0, "formatted": "Error"}

    # Define allowed roots for database location
    roots = [Path.cwd().resolve()]
    data_dir = Path("/data")
    if data_dir.exists():
        roots.append(data_dir.resolve())

    # Check if the path is within any allowed root
    is_safe = False
    for r in roots:
        try:
            if p.is_relative_to(r):
                is_safe = True
                break
        except ValueError:
            continue

    if not (p.is_file() and is_safe):
        return {"size": 0, "formatted": "0 B" if not p.exists() else "N/A"}

    size_bytes = p.stat().st_size

    # Format size (KB, MB, GB with rounding to 1 decimal place)
    if size_bytes < 1024:
        formatted = f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        formatted = f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        formatted = f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        formatted = f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"

    return {"size": size_bytes, "formatted": formatted}


@app.post("/api/db-vacuum")
async def api_db_vacuum(_: None = Depends(_require_auth)) -> Dict:
    try:
        if storage:
            await storage.vacuum()
            return {"status": "ok", "message": "Database optimized successfully"}
        else:
            raise HTTPException(status_code=500, detail="Storage not initialized")
    except Exception as exc:
        logger.error("Vacuum error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/config")
async def api_save_config(
    request: Request,
    _: None = Depends(_require_auth),
) -> Dict:
    global config, checker, check_task

    body: Dict = await request.json()
    save_config(body)
    config = body
    apply_logging_level()
    mon_settings.update(config)  # Update cached settings
    checker = ProxyChecker(config)

    # Restart check loop with new settings
    if check_task and not check_task.done():
        check_task.cancel()
        try:
            await check_task
        except asyncio.CancelledError:
            pass
    check_task = asyncio.create_task(_run_checks())
    await _broadcast_stats()

    return {"status": "ok", "message": "Config saved, monitoring restarted"}


# ------------------------------------------------------------------ #
#  WebSocket                                                           #
# ------------------------------------------------------------------ #

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
    except (asyncio.TimeoutError, Exception) as exc:
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
        logger.debug("WebSocket closed: %s", exc)
    finally:
        ws_clients.discard(websocket)


# ------------------------------------------------------------------ #
#  Static files (SPA)                                                  #
# ------------------------------------------------------------------ #

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



# ------------------------------------------------------------------ #
#  Entry point                                                         #
# ------------------------------------------------------------------ #

if __name__ == "__main__":
    _cfg = load_config()
    srv = _cfg.get("server", {})
    uvicorn.run(
        "server:app",
        host=srv.get("host", "0.0.0.0"),
        port=int(srv.get("port", 8080)),
        reload=False,
        log_level="info",
    )
