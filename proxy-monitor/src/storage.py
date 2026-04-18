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

# Current database schema version
SCHEMA_VERSION = 2

class Storage:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._proxy_cache: Dict[str, int] = {}
        # Cache for error states: key=(proxy_fk, check_type), value=(error, error_timestamp)
        self._error_cache: Dict[tuple, tuple] = {}
        self._db: Optional[aiosqlite.Connection] = None

    # ------------------------------------------------------------------ #
    #  Init / Close                                                        #
    # ------------------------------------------------------------------ #
    async def _get_schema_version(self) -> int:
        """Get current schema version from database. Returns 0 if version table doesn't exist."""
        cur = await self._db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
        )
        if await cur.fetchone() is None:
            return 0
        cur = await self._db.execute("SELECT version FROM schema_version LIMIT 1")
        row = await cur.fetchone()
        return row[0] if row else 0

    async def _set_schema_version(self, version: int) -> None:
        """Update schema version in database."""
        await self._db.execute(
            "INSERT OR REPLACE INTO schema_version (id, version) VALUES (1, ?)",
            (version,)
        )
        await self._db.commit()

    async def _migrate_v0_to_v1(self) -> None:
        """
        Migration from v0 (no version) to v1.
        Creates all initial tables and indexes.
        """
        await self._db.executescript(
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
        await self._db.commit()
        logger.warning("Migration v0 -> v1: Created initial schema")

    async def _migrate_v1_to_v2(self) -> None:
        """
        Migration from v1 to v2.
        Adds error_timestamp column to proxy_state table.
        """
        cur = await self._db.execute("PRAGMA table_info(proxy_state)")
        cols = [row[1] for row in await cur.fetchall()]
        if "error_timestamp" not in cols:
            await self._db.execute("ALTER TABLE proxy_state ADD COLUMN error_timestamp INTEGER")
            await self._db.commit()
            logger.warning("Migration v1 -> v2: Added error_timestamp column")

    async def init(self) -> None:
        """Initialize database connection and run migrations if needed."""
        self._db = await aiosqlite.connect(self.db_path)

        # Enable WAL mode for better concurrent read/write performance
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute("PRAGMA synchronous=NORMAL")

        # Create version table if needed
        await self._db.execute(
            "CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)"
        )
        await self._db.commit()

        current_version = await self._get_schema_version()
        logger.warning("Database schema version: %d, target: %d", current_version, SCHEMA_VERSION)

        # Run migrations sequentially
        if current_version < 1:
            await self._migrate_v0_to_v1()
            await self._set_schema_version(1)
            current_version = 1

        if current_version < 2:
            await self._migrate_v1_to_v2()
            await self._set_schema_version(2)
            current_version = 2

        # Add future migrations here:
        # if current_version < 3:
        #     await self._migrate_v2_to_v3()
        #     await self._set_schema_version(3)
        #     current_version = 3

        # Load proxy cache
        cur = await self._db.execute("SELECT id, proxy_id FROM proxies")
        for pid, p_str in await cur.fetchall():
            self._proxy_cache[p_str] = pid

        # Load error cache from existing proxy_state
        cur = await self._db.execute(
            "SELECT proxy_fk, check_type, error, error_timestamp FROM proxy_state WHERE error IS NOT NULL"
        )
        for row in await cur.fetchall():
            if row[2]:  # error is not None/empty
                self._error_cache[(row[0], row[1])] = (row[2], row[3])

        logger.warning("Storage initialised: %s", self.db_path)

    async def close(self) -> None:
        """Close the database connection."""
        if self._db:
            await self._db.close()
            self._db = None

    async def _get_proxy_fk(self, proxy_id: str) -> int:
        """Get or create proxy foreign key using the cached connection."""
        if proxy_id in self._proxy_cache:
            return self._proxy_cache[proxy_id]
        if not self._db:
            raise RuntimeError("Database not initialized")
        await self._db.execute("INSERT OR IGNORE INTO proxies (proxy_id) VALUES (?)", (proxy_id,))
        await self._db.commit()
        cur = await self._db.execute("SELECT id FROM proxies WHERE proxy_id = ?", (proxy_id,))
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
        """Save a check result using the persistent connection."""
        if not self._db:
            raise RuntimeError("Database not initialized")
        ct_int = CHECK_TYPE_MAP.get(check_type, 1)
        proxy_fk = await self._get_proxy_fk(proxy_id)
        await self._db.execute(
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
        # Determine what to store for error fields
        # If new check has error - store it with current timestamp
        # If new check is successful - preserve previous error and its timestamp
        store_error = error
        store_error_ts = None
        cache_key = (proxy_fk, ct_int)

        if error:
            store_error_ts = timestamp
            # Update cache with new error
            self._error_cache[cache_key] = (error, timestamp)
        else:
            # Try to get previous error from cache first
            cached_error = self._error_cache.get(cache_key)
            if cached_error and cached_error[0]:
                store_error = cached_error[0]
                store_error_ts = cached_error[1]
            else:
                # Cache miss - query database
                cur = await self._db.execute(
                    "SELECT error, error_timestamp FROM proxy_state WHERE proxy_fk = ? AND check_type = ?",
                    (proxy_fk, ct_int),
                )
                prev_row = await cur.fetchone()
                if prev_row and prev_row[0]:
                    store_error = prev_row[0]
                    store_error_ts = prev_row[1]
                    # Update cache
                    self._error_cache[cache_key] = (store_error, store_error_ts)


        await self._db.execute(
            """
            INSERT OR REPLACE INTO proxy_state
                (proxy_fk, check_type, timestamp, success, latency_ms, external_ip, error, error_timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                proxy_fk,
                ct_int,
                timestamp,
                1 if success else 0,
                latency_ms,
                external_ip,
                store_error,
                store_error_ts,
            ),
        )
        await self._db.commit()

    # ------------------------------------------------------------------ #
    #  Read – summary (used by WebSocket broadcast)                       #
    # ------------------------------------------------------------------ #
    async def get_all_summaries(
        self, window_minutes: int = 5
    ) -> Dict[str, Dict[str, Any]]:
        """Fetch stats for ALL proxies in 4 bulk queries instead of N*4 queries."""
        if not self._db:
            raise RuntimeError("Database not initialized")

        now = int(time.time())
        window_start = now - window_minutes * 60
        # 1. Totals
        async with self._db.execute(
            "SELECT proxy_fk, check_type, SUM(success), COUNT(*) FROM proxy_checks GROUP BY proxy_fk, check_type"
        ) as cur:
            total_rows = await cur.fetchall()

        # 2. Window stats
        async with self._db.execute(
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
        async with self._db.execute(
            "SELECT proxy_fk, check_type, success, latency_ms, external_ip, error, timestamp, error_timestamp FROM proxy_state"
        ) as cur:
            last_rows = await cur.fetchall()

        # 4. Sparklines: last 60 checks for each proxy + type
        async with self._db.execute(
            """
            WITH RecentChecks AS (
                SELECT proxy_fk, check_type, timestamp, success, latency_ms,
                       ROW_NUMBER() OVER (PARTITION BY proxy_fk, check_type ORDER BY timestamp DESC) as rn
                FROM proxy_checks
            )
            SELECT proxy_fk, check_type, timestamp, success, 1 - success as fail, latency_ms
            FROM RecentChecks
            WHERE rn <= 60
            ORDER BY proxy_fk, check_type, timestamp ASC
            """
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

    @staticmethod
    def _assemble_summary(
            total_rows: list, window_rows: list, last_rows: list, sparkline_rows: list
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
            # row: check_type(0), success(1), latency_ms(2), external_ip(3), error(4), timestamp(5), error_timestamp(6)
            ct = CHECK_TYPE_REV.get(row[0], "tcp")
            last_checks[ct] = {
                "success": bool(row[1]),
                "latency_ms": row[2],
                "external_ip": row[3],
                "error": row[4],
                "timestamp": row[5],
                "error_timestamp": row[6],
            }

        sparkline: Dict[str, List[Dict]] = {}
        for row in sparkline_rows:
            # row: check_type(0), timestamp(1), success(2), fail(3), latency_ms(4)
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
        from_ts: Optional[int] = None,
        to_ts: Optional[int] = None,
    ) -> Dict[str, List[Dict]]:
        if not self._db:
            raise RuntimeError("Database not initialized")

        now = int(time.time())
        from_ts = from_ts if from_ts is not None else now - hours * 3600
        to_ts = to_ts if to_ts is not None else now
        interval = {"minute": 60, "hour": 3600, "day": 86400}.get(group_by, 3600)

        proxy_fk = await self._get_proxy_fk(proxy_id)
        async with self._db.execute(
            """
            SELECT check_type,
                   (timestamp / ?) * ?  AS bucket,
                   SUM(success)         AS successes,
                   COUNT(*) - SUM(success) AS failures,
                   AVG(latency_ms)      AS avg_lat,
                   MIN(latency_ms)      AS min_lat,
                   MAX(latency_ms)      AS max_lat
            FROM proxy_checks
            WHERE proxy_fk = ? AND timestamp >= ? AND timestamp < ?
            GROUP BY check_type, bucket
            ORDER BY bucket ASC
            """,
            (interval, interval, proxy_fk, from_ts, to_ts),
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
        if not self._db:
            raise RuntimeError("Database not initialized")

        cutoff = int(time.time()) - retention_days * 86400
        cur = await self._db.execute(
            "DELETE FROM proxy_checks WHERE timestamp < ?", (cutoff,)
        )
        await self._db.commit()
        deleted = cur.rowcount

        if deleted:
            # VACUUM reclaims unused disk space. It cannot run in a transaction.
            await self._db.execute("VACUUM")
            logger.warning(
                "Cleaned %d old records (retention=%dd) and vacuumed database",
                deleted, retention_days
            )
        return deleted

    async def sync_proxies(self, configured_ids: List[str]) -> int:
        """Remove proxies from database that are not in the configured_ids list."""
        if not self._db:
            raise RuntimeError("Database not initialized")

        # Get all proxy IDs and their FKs from the DB
        async with self._db.execute("SELECT id, proxy_id FROM proxies") as cur:
            db_proxies = await cur.fetchall()

        to_delete_fks = []
        to_delete_ids = []
        configured_set = set(configured_ids)

        for fk, pid in db_proxies:
            if pid not in configured_set:
                to_delete_fks.append(fk)
                to_delete_ids.append(pid)

        if not to_delete_fks:
            return 0

        logger.warning("Removing %d obsolete proxies from database: %s", len(to_delete_ids), to_delete_ids)

        placeholders = ",".join("?" for _ in to_delete_fks)
        await self._db.execute(f"DELETE FROM proxy_checks WHERE proxy_fk IN ({placeholders})", to_delete_fks)
        await self._db.execute(f"DELETE FROM proxy_state WHERE proxy_fk IN ({placeholders})", to_delete_fks)
        await self._db.execute(f"DELETE FROM proxies WHERE id IN ({placeholders})", to_delete_fks)
        await self._db.commit()

        # Update caches
        for pid in to_delete_ids:
            self._proxy_cache.pop(pid, None)

        # Clear error cache entries for deleted proxies
        for fk in to_delete_fks:
            # Remove both tcp (1) and udp (2) entries
            self._error_cache.pop((fk, 1), None)
            self._error_cache.pop((fk, 2), None)

        return len(to_delete_ids)

    async def vacuum(self) -> None:
        if not self._db:
            raise RuntimeError("Database not initialized")
        await self._db.execute("VACUUM")
        logger.warning("Database optimized (VACUUM)")