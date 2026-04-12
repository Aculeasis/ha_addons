"""
storage.py – SQLite persistence layer for proxy check results.
"""
import logging
import time
from typing import Any, Dict, List, Optional

import aiosqlite

logger = logging.getLogger(__name__)


class Storage:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path

    # ------------------------------------------------------------------ #
    #  Init                                                                #
    # ------------------------------------------------------------------ #
    async def init(self) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.executescript(
                """
                CREATE TABLE IF NOT EXISTS proxy_checks (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    proxy_id    TEXT    NOT NULL,
                    check_type  TEXT    NOT NULL,   -- 'tcp' | 'udp'
                    timestamp   INTEGER NOT NULL,   -- unix seconds
                    success     INTEGER NOT NULL,   -- 0 | 1
                    latency_ms  REAL,
                    external_ip TEXT,
                    error       TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_proxy_ct_ts
                    ON proxy_checks(proxy_id, check_type, timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_ts
                    ON proxy_checks(timestamp);
                """
            )
            await db.commit()
        logger.info("Storage initialised: %s", self.db_path)

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
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """
                INSERT INTO proxy_checks
                    (proxy_id, check_type, timestamp, success, latency_ms, external_ip, error)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    proxy_id,
                    check_type,
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
    async def get_proxy_summary(
        self, proxy_id: str, window_minutes: int = 5
    ) -> Dict[str, Any]:
        now = int(time.time())
        window_start = now - window_minutes * 60
        sparkline_start = now - 3600  # last 60 min for mini-chart

        async with aiosqlite.connect(self.db_path) as db:
            # --- total aggregates per check_type ---
            async with db.execute(
                """
                SELECT check_type, SUM(success), COUNT(*)
                FROM proxy_checks
                WHERE proxy_id = ?
                GROUP BY check_type
                """,
                (proxy_id,),
            ) as cur:
                total_rows = await cur.fetchall()

            # --- window aggregates (includes latency stats for tooltip) ---
            async with db.execute(
                """
                SELECT check_type,
                       SUM(success),
                       COUNT(*),
                       AVG(CASE WHEN success=1 THEN latency_ms END) AS lat_avg,
                       MIN(CASE WHEN success=1 THEN latency_ms END) AS lat_min,
                       MAX(CASE WHEN success=1 THEN latency_ms END) AS lat_max
                FROM proxy_checks
                WHERE proxy_id = ? AND timestamp >= ?
                GROUP BY check_type
                """,
                (proxy_id, window_start),
            ) as cur:
                window_rows = await cur.fetchall()

            # --- last result per check_type ---
            async with db.execute(
                """
                SELECT check_type, success, latency_ms, external_ip, error, timestamp
                FROM proxy_checks
                WHERE proxy_id = ?
                ORDER BY timestamp DESC
                LIMIT 20
                """,
                (proxy_id,),
            ) as cur:
                last_rows = await cur.fetchall()

            # --- sparkline: last 60 min, bucketed by minute ---
            async with db.execute(
                """
                SELECT check_type,
                       (timestamp / 60) * 60  AS bucket,
                       SUM(success)            AS successes,
                       COUNT(*) - SUM(success) AS failures,
                       AVG(latency_ms)         AS avg_lat
                FROM proxy_checks
                WHERE proxy_id = ? AND timestamp >= ?
                GROUP BY check_type, bucket
                ORDER BY bucket ASC
                """,
                (proxy_id, sparkline_start),
            ) as cur:
                sparkline_rows = await cur.fetchall()

        def _agg_simple(rows: list) -> Dict[str, Dict]:
            """Totals – 3-column rows (no latency)."""
            out: Dict[str, Dict] = {}
            for check_type, success, total in rows:
                out[check_type] = {
                    "success": int(success or 0),
                    "fail": int(total - (success or 0)),
                    "total": int(total),
                }
            return out

        def _round(v: Optional[float]) -> Optional[float]:
            return round(v, 1) if v is not None else None

        def _agg_window(rows: list) -> Dict[str, Dict]:
            """Window stats - 6-column rows (includes latency avg/min/max)."""
            out: Dict[str, Dict] = {}
            for check_type, success, total, lat_avg, lat_min, lat_max in rows:
                out[check_type] = {
                    "success": int(success or 0),
                    "fail": int(total - (success or 0)),
                    "total": int(total),
                    "lat_avg": _round(lat_avg),
                    "lat_min": _round(lat_min),
                    "lat_max": _round(lat_max),
                }
            return out

        # one entry per check_type (most recent)
        last_checks: Dict[str, Dict] = {}
        for row in last_rows:
            ct = row[0]
            if ct not in last_checks:
                last_checks[ct] = {
                    "success": bool(row[1]),
                    "latency_ms": row[2],
                    "external_ip": row[3],
                    "error": row[4],
                    "timestamp": row[5],
                }

        sparkline: Dict[str, List[Dict]] = {}
        for row in sparkline_rows:
            ct = row[0]
            sparkline.setdefault(ct, []).append(
                {
                    "ts": row[1],
                    "success": int(row[2] or 0),
                    "fail": int(row[3] or 0),
                    "avg_latency": row[4],
                }
            )

        return {
            "total": _agg_simple(total_rows),
            "window": _agg_window(window_rows),
            "last_checks": last_checks,
            "sparkline": sparkline,
        }

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
                WHERE proxy_id = ? AND timestamp >= ?
                GROUP BY check_type, bucket
                ORDER BY bucket ASC
                """,
                (interval, interval, proxy_id, from_ts),
            ) as cur:
                rows = await cur.fetchall()

        result: Dict[str, List[Dict]] = {}
        for row in rows:
            ct = row[0]
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
            logger.info(
                "Cleaned %d old check records (retention=%dd)", deleted, retention_days
            )
        return deleted
