"""
checker.py - SOCKS5 TCP and UDP proxy health checker.

TCP check : connects through the proxy via aiohttp-socks and performs an
            HTTP GET to the configured test URL (expects JSON with .origin/.ip).
UDP check : issues a SOCKS5 UDP ASSOCIATE, then sends a real DNS A-query for
            www.google.com through the relay and validates the response.
"""
import asyncio
import logging
import socket
import struct
import time
from typing import Any, Dict, Optional

import aiohttp
from aiohttp_socks import ProxyConnector

logger = logging.getLogger(__name__)


class ProxyChecker:
    def __init__(self, config: Dict) -> None:
        self.config = config

    # ------------------------------------------------------------------ #
    #  Helpers                                                             #
    # ------------------------------------------------------------------ #
    def _timeout(self) -> float:
        return float(
            self.config.get("monitoring", {}).get("check_timeout_seconds", 10)
        )

    def _proxy_url(self, proxy: Dict) -> str:
        host = proxy["host"]
        port = proxy["port"]
        user = proxy.get("username", "") or ""
        pwd = proxy.get("password", "") or ""
        if user and pwd:
            return f"socks5://{user}:{pwd}@{host}:{port}"
        return f"socks5://{host}:{port}"

    # ------------------------------------------------------------------ #
    #  TCP check                                                           #
    # ------------------------------------------------------------------ #
    async def check_tcp(self, proxy: Dict) -> Dict[str, Any]:
        timeout = self._timeout()
        test_url: str = self.config.get("monitoring", {}).get(
            "tcp_test_url", "http://httpbin.org/ip"
        )
        start = time.monotonic()
        try:
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
                "error": str(exc)[:250],
            }

    # ------------------------------------------------------------------ #
    #  UDP check (SOCKS5 UDP ASSOCIATE + DNS query)                       #
    # ------------------------------------------------------------------ #
    async def check_udp(self, proxy: Dict) -> Dict[str, Any]:
        host = proxy["host"]
        port = proxy["port"]
        user = proxy.get("username", "") or ""
        pwd = proxy.get("password", "") or ""
        timeout = self._timeout()
        start = time.monotonic()
        reader: Optional[asyncio.StreamReader] = None
        writer: Optional[asyncio.StreamWriter] = None
        udp_sock: Optional[socket.socket] = None

        def remaining() -> float:
            return max(0.5, timeout - (time.monotonic() - start))

        try:
            # 1 ── Open TCP connection to proxy ──────────────────────────
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), timeout=timeout
            )

            # 2 ── SOCKS5 greeting ────────────────────────────────────────
            writer.write(b"\x05\x02\x00\x02" if (user and pwd) else b"\x05\x01\x00")
            await writer.drain()

            greeting = await asyncio.wait_for(reader.read(2), timeout=remaining())
            if len(greeting) < 2 or greeting[0] != 0x05:
                raise ValueError(f"Bad SOCKS5 greeting: {greeting!r}")
            method = greeting[1]

            if method == 0xFF:
                raise ValueError("No acceptable auth methods offered by proxy")

            if method == 0x02:
                # Username / password sub-negotiation (RFC 1929)
                auth_payload = (
                    bytes([0x01, len(user)])
                    + user.encode()
                    + bytes([len(pwd)])
                    + pwd.encode()
                )
                writer.write(auth_payload)
                await writer.drain()
                auth_resp = await asyncio.wait_for(reader.read(2), timeout=remaining())
                if len(auth_resp) < 2 or auth_resp[1] != 0x00:
                    raise ValueError("SOCKS5 username/password authentication failed")

            # 3 ── UDP ASSOCIATE request ──────────────────────────────────
            # CMD=0x03, ATYP=0x01 (IPv4), DST.ADDR/PORT = 0 (let proxy pick)
            writer.write(b"\x05\x03\x00\x01\x00\x00\x00\x00\x00\x00")
            await writer.drain()

            bound = await asyncio.wait_for(reader.read(10), timeout=remaining())
            if len(bound) < 10:
                raise ValueError(f"Truncated UDP ASSOCIATE response: {bound!r}")
            if bound[1] != 0x00:
                err_codes = {
                    1: "general SOCKS failure",
                    2: "connection not allowed",
                    3: "network unreachable",
                    4: "host unreachable",
                    5: "connection refused",
                    7: "command not supported",
                }
                raise ValueError(
                    f"UDP ASSOCIATE rejected: {err_codes.get(bound[1], bound[1])}"
                )

            # BND.ADDR / BND.PORT – where we send UDP frames
            relay_ip = socket.inet_ntoa(bound[4:8])
            relay_port = struct.unpack("!H", bound[8:10])[0]
            if relay_ip == "0.0.0.0":
                relay_ip = host  # proxy said "use my address"

            # 4 ── Create local UDP socket ────────────────────────────────
            # Use a blocking socket with a timeout – run_in_executor already
            # runs it in a thread pool, so the event loop is not blocked.
            # setblocking(False) causes WSAEWOULDBLOCK on Windows immediately
            # because the OS can't complete the send/recv synchronously.
            udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            udp_sock.settimeout(remaining())

            # Minimal DNS A-query for www.google.com
            dns_query = (
                b"\xab\xcd"  # Transaction ID
                b"\x01\x00"  # Flags: RD=1 (recursion desired)
                b"\x00\x01"  # QDCOUNT=1
                b"\x00\x00\x00\x00\x00\x00"  # AN/NS/AR = 0
                b"\x03www\x06google\x03com\x00"  # QNAME
                b"\x00\x01"  # QTYPE  A
                b"\x00\x01"  # QCLASS IN
            )

            # SOCKS5 UDP request header: RSV(2) FRAG(1) ATYP(1) DST.ADDR(4) DST.PORT(2)
            udp_frame = (
                b"\x00\x00"  # RSV
                b"\x00"  # FRAG
                b"\x01"  # ATYP IPv4
                + socket.inet_aton("8.8.8.8")  # DST.ADDR (Google DNS)
                + struct.pack("!H", 53)  # DST.PORT
                + dns_query
            )

            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, udp_sock.sendto, udp_frame, (relay_ip, relay_port)
            )
            # Refresh socket timeout to reflect remaining budget after sendto
            udp_sock.settimeout(remaining())
            resp_data: bytes = await asyncio.wait_for(
                loop.run_in_executor(None, udp_sock.recv, 4096),
                timeout=remaining() + 0.5,  # outer guard: socket timeout fires first
            )

            # A valid SOCKS5 UDP response starts with 4 header bytes + at least
            # a minimal DNS reply (12 bytes header)
            if len(resp_data) < 16:
                raise ValueError(
                    f"UDP relay response too short ({len(resp_data)} bytes)"
                )

            latency = (time.monotonic() - start) * 1000
            return {
                "success": True,
                "latency_ms": round(latency, 2),
                "external_ip": None,
                "error": None,
            }

        except asyncio.TimeoutError:
            return {
                "success": False,
                "latency_ms": round((time.monotonic() - start) * 1000, 2),
                "external_ip": None,
                "error": "Timeout",
            }
        except Exception as exc:
            return {
                "success": False,
                "latency_ms": round((time.monotonic() - start) * 1000, 2),
                "external_ip": None,
                "error": str(exc)[:250],
            }
        finally:
            if writer:
                try:
                    writer.close()
                    await asyncio.wait_for(writer.wait_closed(), timeout=1.0)
                except Exception:
                    pass
            if udp_sock:
                udp_sock.close()

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
                    "error": str(res)[:250],
                }
            else:
                results[ct] = res  # type: ignore[assignment]
        return results
