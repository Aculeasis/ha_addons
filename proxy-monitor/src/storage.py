"""
storage.py – SQLite persistence layer for proxy check results.
"""
import logging
import time
from typing import Any, Dict, List, Optional

import aiosqlite

logger = logging.getLogger(__name__)


CHECK_TYPE_MAP = {"tcp": 1, "udp": 2}
CHECK_TYPE_REV = {1: "tcp", 2: "udp"}

class Storage:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._proxy_cache: Dict[str, int] = {}

    # ------------------------------------------------------------------ #
    #  Init                                                                #
    # ------------------------------------------------------------------ #
    async def init(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            cur = await db.execute("PRAGMA table_info(proxy_checks)")
            cols = [row[1] for row in await cur.fetchall()]
            if cols and "external_ip" in cols:
                logger.warning("Outdated schema detected. Dropping old proxy_checks table...")
                await db.execute("DROP TABLE proxy_checks")
                await db.commit()

            await db.executescript(
                """
                CREATE TABLE IF NOT EXISTS proxies (
                    id INTEGER PRIMARY KEY,
                    proxy_id TEXT UNIQUE NOT NULL
                );
                CREATE TABLE IF NOT EXISTS proxy_checks (
                    proxy_fk    INTEGER NOT NULL,
                    check_type  INTEGER NOT NULL,
                    timestamp   INTEGER NOT NULL,
                    success     INTEGER NOT NULL,
                    latency_ms  REAL
                );
                CREATE TABLE IF NOT EXISTS proxy_state (
                    proxy_fk    INTEGER NOT NULL,
                    check_type  INTEGER NOT NULL,
                    timestamp   INTEGER NOT NULL,
                    success     INTEGER NOT NULL,
                    latency_ms  REAL,
                    external_ip TEXT,
                    error       TEXT,
                    PRIMARY KEY (proxy_fk, check_type)
                );
                CREATE INDEX IF NOT EXISTS idx_proxy_ct_ts
                    ON proxy_checks(proxy_fk, check_type, timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_ts
                    ON proxy_checks(timestamp);
                """
            )
            await db.commit()
            
            cur = await db.execute("SELECT id, proxy_id FROM proxies")
            for pid, p_str in await cur.fetchall():
                self._proxy_cache[p_str] = pid
        logger.warning("Storage initialised: %s", self.db_path)

    async def _get_proxy_fk(self, db: aiosqlite.Connection, proxy_id: str) -> int:
        if proxy_id in self._proxy_cache:
            return self._proxy_cache[proxy_id]
        await db.execute("INSERT OR IGNORE INTO proxies (proxy_id) VALUES (?)", (proxy_id,))
        await db.commit()
        cur = await db.execute("SELECT id FROM proxies WHERE proxy_id = ?", (proxy_id,))
        row = await cur.fetchone()
        if row:
            self._proxy_cache[proxy_id] = row[0]
            return row[0]
        return 0

    # ------------------------------------------------------------------ #
    #  Write                                                               #
    # ------------------------------------------------------------------ #
    async def save_check(
        self,
        proxy_id: str,
        check_type: str,
        timestamp: int,
        success: bool,
        latency_ms: Optional[float] = None,
        external_ip: Optional[str] = None,
        error: Optional[str] = None,
    ) -> None:
        ct_int = CHECK_TYPE_MAP.get(check_type, 1)
        async with aiosqlite.connect(self.db_path) as db:
            proxy_fk = await self._get_proxy_fk(db, proxy_id)
            await db.execute(
                """
                INSERT INTO proxy_checks
                    (proxy_fk, check_type, timestamp, success, latency_ms)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    proxy_fk,
                    ct_int,
                    timestamp,
                    1 if success else 0,
                    latency_ms,
                ),
            )
            await db.execute(
                """
                INSERT OR REPLACE INTO proxy_state
                    (proxy_fk, check_type, timestamp, success, latency_ms, external_ip, error)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    proxy_fk,
                    ct_int,
                    timestamp,
                    1 if success else 0,
                    latency_ms,
                    external_ip,
                    error,
                ),
            )
            await db.commit()

    # ------------------------------------------------------------------ #
    #  Read – summary (used by WebSocket broadcast)                       #
    # ------------------------------------------------------------------ #
    async def get_all_summaries(
        self, window_minutes: int = 5
    ) -> Dict[str, Dict[str, Any]]:
        """Fetch stats for ALL proxies in 4 bulk queries instead of N*4 queries."""
        now = int(time.time())
        window_start = now - window_minutes * 60
        sparkline_start = now - 3600

        async with aiosqlite.connect(self.db_path) as db:
            # 1. Totals
            async with db.execute(
                "SELECT proxy_fk, check_type, SUM(success), COUNT(*) FROM proxy_checks GROUP BY proxy_fk, check_type"
            ) as cur:
                total_rows = await cur.fetchall()

            # 2. Window stats
            async with db.execute(
                """
                SELECT proxy_fk, check_type, SUM(success), COUNT(*),
                       AVG(CASE WHEN success=1 THEN latency_ms END),
                       MIN(CASE WHEN success=1 THEN latency_ms END),
                       MAX(CASE WHEN success=1 THEN latency_ms END)
                FROM proxy_checks WHERE timestamp >= ? GROUP BY proxy_fk, check_type
                """,
                (window_start,),
            ) as cur:
                window_rows = await cur.fetchall()

            # 3. Last states
            async with db.execute(
                "SELECT proxy_fk, check_type, success, latency_ms, external_ip, error, timestamp FROM proxy_state"
            ) as cur:
                last_rows = await cur.fetchall()

            # 4. Sparklines
            async with db.execute(
                """
                SELECT proxy_fk, check_type, (timestamp / 60) * 60 AS bucket,
                       SUM(success), COUNT(*) - SUM(success), AVG(latency_ms)
                FROM proxy_checks WHERE timestamp >= ? GROUP BY proxy_fk, check_type, bucket ORDER BY bucket ASC
                """,
                (sparkline_start,),
            ) as cur:
                sparkline_rows = await cur.fetchall()

        fk_to_id = {v: k for k, v in self._proxy_cache.items()}
        by_proxy: Dict[str, List[list]] = {pid: [[], [], [], []] for pid in self._proxy_cache}

        for r in total_rows:
            if pid := fk_to_id.get(r[0]): by_proxy[pid][0].append(r[1:])
        for r in window_rows:
            if pid := fk_to_id.get(r[0]): by_proxy[pid][1].append(r[1:])
        for r in last_rows:
            if pid := fk_to_id.get(r[0]): by_proxy[pid][2].append(r[1:])
        for r in sparkline_rows:
            if pid := fk_to_id.get(r[0]): by_proxy[pid][3].append(r[1:])

        return {pid: self._assemble_summary(*rows) for pid, rows in by_proxy.items()}

    def _assemble_summary(
        self, total_rows: list, window_rows: list, last_rows: list, sparkline_rows: list
    ) -> Dict[str, Any]:
        """Helper to structure raw DB rows into the summary dictionary."""
        def _round(v: Optional[float]) -> Optional[float]:
            return round(v, 1) if v is not None else None

        total_stats: Dict[str, Dict] = {}
        for ct_int, success, total in total_rows:
            ct = CHECK_TYPE_REV.get(ct_int, "tcp")
            total_stats[ct] = {"success": int(success or 0), "fail": int(total - (success or 0)), "total": int(total)}

        window_stats: Dict[str, Dict] = {}
        for ct_int, success, total, lat_avg, lat_min, lat_max in window_rows:
            ct = CHECK_TYPE_REV.get(ct_int, "tcp")
            window_stats[ct] = {
                "success": int(success or 0), "fail": int(total - (success or 0)), "total": int(total),
                "lat_avg": _round(lat_avg), "lat_min": _round(lat_min), "lat_max": _round(lat_max),
            }

        last_checks: Dict[str, Dict] = {}
        for row in last_rows:
            ct = CHECK_TYPE_REV.get(row[0], "tcp")
            last_checks[ct] = {
                "success": bool(row[1]), "latency_ms": row[2], "external_ip": row[3], "error": row[4], "timestamp": row[5],
            }

        sparkline: Dict[str, List[Dict]] = {}
        for row in sparkline_rows:
            ct = CHECK_TYPE_REV.get(row[0], "tcp")
            sparkline.setdefault(ct, []).append({
                "ts": row[1], "success": int(row[2] or 0), "fail": int(row[3] or 0), "avg_latency": row[4],
            })

        return {"total": total_stats, "window": window_stats, "last_checks": last_checks, "sparkline": sparkline}

    # ------------------------------------------------------------------ #
    #  Read – chart data (detail modal)                                    #
    # ------------------------------------------------------------------ #
    async def get_chart_data(
        self,
        proxy_id: str,
        hours: int = 24,
        group_by: str = "hour",
    ) -> Dict[str, List[Dict]]:
        now = int(time.time())
        from_ts = now - hours * 3600
        interval = {"minute": 60, "hour": 3600, "day": 86400}.get(group_by, 3600)

        async with aiosqlite.connect(self.db_path) as db:
            proxy_fk = await self._get_proxy_fk(db, proxy_id)
            async with db.execute(
                """
                SELECT check_type,
                       (timestamp / ?) * ?  AS bucket,
                       SUM(success)         AS successes,
                       COUNT(*) - SUM(success) AS failures,
                       AVG(latency_ms)      AS avg_lat,
                       MIN(latency_ms)      AS min_lat,
                       MAX(latency_ms)      AS max_lat
                FROM proxy_checks
                WHERE proxy_fk = ? AND timestamp >= ?
                GROUP BY check_type, bucket
                ORDER BY bucket ASC
                """,
                (interval, interval, proxy_fk, from_ts),
            ) as cur:
                rows = await cur.fetchall()

        result: Dict[str, List[Dict]] = {}
        for row in rows:
            ct = CHECK_TYPE_REV.get(row[0], "tcp")
            result.setdefault(ct, []).append(
                {
                    "ts": row[1],
                    "successes": int(row[2] or 0),
                    "failures": int(row[3] or 0),
                    "avg_latency": row[4],
                    "min_latency": row[5],
                    "max_latency": row[6],
                }
            )
        return result

    # ------------------------------------------------------------------ #
    #  Cleanup                                                             #
    # ------------------------------------------------------------------ #
    async def cleanup_old_data(self, retention_days: int) -> int:
        cutoff = int(time.time()) - retention_days * 86400
        async with aiosqlite.connect(self.db_path) as db:
            cur = await db.execute(
                "DELETE FROM proxy_checks WHERE timestamp < ?", (cutoff,)
            )
            await db.commit()
            deleted = cur.rowcount
            
        if deleted:
            # VACUUM reclaims unused disk space. It cannot run in a transaction.
            async with aiosqlite.connect(self.db_path, isolation_level=None) as db:
                await db.execute("VACUUM")
                
            logger.warning(
                "Cleaned %d old records (retention=%dd) and vacuumed database", 
                deleted, retention_days
            )
        return deleted

    async def vacuum(self) -> None:
        async with aiosqlite.connect(self.db_path, isolation_level=None) as db:
            await db.execute("VACUUM")
        logger.warning("Database optimized (VACUUM)")
