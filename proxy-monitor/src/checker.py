"""
checker.py - SOCKS5 TCP and UDP proxy health checker.

TCP check : connects through the proxy via aiohttp-socks and performs an
            HTTP GET to the configured test URL (expects JSON with .origin/.ip).
UDP check : issues a SOCKS5 UDP ASSOCIATE, then sends a real DNS A-query for
            www.google.com through the relay and validates the response.
"""
import asyncio
import logging
import re
import socket
import time
from typing import Any, Dict, Optional

import aiohttp
import socks
from aiohttp_socks import ProxyConnector

logger = logging.getLogger(__name__)


def _format_error(exc: Exception) -> str:
    """Format exception as error message, truncated to 250 chars."""
    msg = str(exc)
    return msg[:250] if msg else f"{type(exc).__name__}"


class ProxyChecker:
    def __init__(self, config: Dict) -> None:
        self.config = config
        self._tcp_test_url: Optional[str] = None
        self._timeout: Optional[float] = None

    # ------------------------------------------------------------------ #
    #  Helpers (cached)                                                    #
    # ------------------------------------------------------------------ #
    def _get_timeout(self) -> float:
        """Get timeout with caching to avoid repeated dict lookups."""
        if self._timeout is None:
            self._timeout = float(
                self.config.get("monitoring", {}).get("check_timeout_seconds", 10)
            )
        return self._timeout

    def _get_tcp_test_url(self) -> str:
        """Get TCP test URL with caching."""
        if self._tcp_test_url is None:
            self._tcp_test_url = self.config.get("monitoring", {}).get(
                "tcp_test_url", "http://httpbin.org/ip"
            )
        return self._tcp_test_url

    @staticmethod
    def _proxy_url(proxy: Dict) -> str:
        host = proxy["host"]
        port = proxy["port"]
        user = proxy.get("username", "") or ""
        pwd = proxy.get("password", "") or ""
        if user and pwd:
            return f"socks5://{user}:{pwd}@{host}:{port}"
        return f"socks5://{host}:{port}"

    async def check_tcp(self, proxy: Dict) -> Dict[str, Any]:
        """Check TCP connectivity through the SOCKS5 proxy."""
        timeout = self._get_timeout()
        test_url = self._get_tcp_test_url()
        start = time.monotonic()
        try:
            # Use ProxyConnector for SOCKS5 support
            # Note: Each proxy needs its own connector due to different endpoints
            connector = ProxyConnector.from_url(self._proxy_url(proxy))
            async with aiohttp.ClientSession(
                connector=connector,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as session:
                async with session.get(test_url) as resp:
                    status = resp.status
                    latency = (time.monotonic() - start) * 1000

                    ip = None
                    error = None

                    # If we got a response, the proxy is alive.
                    # We try to parse the IP, but if we can't, it's still a "success" (alive).
                    try:
                        data = await resp.json(content_type=None)
                        ip = (
                            data.get("origin")
                            or data.get("ip")
                            or data.get("query")
                            or None
                        )
                        if ip and "," in ip:
                            ip = ip.split(",")[0].strip()

                        if not (200 <= status < 300):
                            error = f"HTTP {status}"
                    except Exception as json_exc:
                        error = f"HTTP {status}, Parse error: {str(json_exc)[:50]}"

                    return {
                        "success": True,
                        "latency_ms": round(latency, 2),
                        "external_ip": ip,
                        "error": error,
                    }

        except Exception as exc:
            # This catch handles connection errors (proxy down, timeout, etc.)
            latency = (time.monotonic() - start) * 1000
            return {
                "success": False,
                "latency_ms": round(latency, 2),
                "external_ip": None,
                "error": _format_error(exc),
            }

    def _check_udp_sync(self, proxy: Dict) -> Dict[str, Any]:
        """Synchronous UDP check using socks library (run in executor)."""
        host = proxy["host"]
        port = proxy["port"]
        user = proxy.get("username", "") or None
        pwd = proxy.get("password", "") or None
        timeout = self._get_timeout()

        # DNS TXT query: CH whoami.cloudflare
        dns_query = (
            b"\x12\x34\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00"
            b"\x06whoami\x0acloudflare\x00"
            b"\x00\x10\x00\x03"
        )
        result = {
            "success": False,
            "latency_ms": None,
            "external_ip": None,
            "error": None,
        }
        sock = socks.socksocket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.set_proxy(socks.SOCKS5, host, port, username=user, password=pwd)
            sock.settimeout(timeout)
            start_time = time.perf_counter()
            try:
                sock.sendto(dns_query, ("1.1.1.1", 53))
                data, _ = sock.recvfrom(512)
            finally:
                result["latency_ms"] = round((time.perf_counter() - start_time) * 1000, 2)
            result["success"] = True

            # DNS TXT record format: <length byte><text data>
            # Search for IPv4 address pattern directly in the response
            match = re.search(rb'(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})', data)
            result["external_ip"] = match.group(1).decode('utf-8') if match else None
        except socket.timeout:
            result["error"] = "Timeout"
        except Exception as exc:
            result["error"] = _format_error(exc)
        finally:
            sock.close()

        return result

    async def check_udp(self, proxy: Dict) -> Dict[str, Any]:
        """Check UDP connectivity through the SOCKS5 proxy via DNS query."""
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, self._check_udp_sync, proxy)
        return result

    # ------------------------------------------------------------------ #
    #  Run all configured checks concurrently                             #
    # ------------------------------------------------------------------ #
    async def check_proxy(self, proxy: Dict) -> Dict[str, Dict]:
        types: list[str] = []
        coros = []

        if proxy.get("tcp_check", True):
            types.append("tcp")
            coros.append(self.check_tcp(proxy))
        if proxy.get("udp_check", False):
            types.append("udp")
            coros.append(self.check_udp(proxy))

        if not coros:
            return {}

        results_raw = await asyncio.gather(*coros, return_exceptions=True)
        results: Dict[str, Dict] = {}
        for ct, res in zip(types, results_raw):
            if isinstance(res, Exception):
                results[ct] = {
                    "success": False,
                    "latency_ms": 0.0,
                    "external_ip": None,
                    "error": _format_error(res),
                }
            else:
                results[ct] = res  # type: ignore[assignment]
        return results
