"""Health and progress derived from completed checks, never from HTTP activity."""

import math
import time
from dataclasses import dataclass, field


STATUSES = ("alive", "partial", "dead", "unknown", "stale", "disabled")


def enabled_checks(proxy: dict) -> list[str]:
    return [kind for kind in ("tcp", "udp") if proxy.get(f"{kind}_check", kind == "tcp")]


def cycle_budget(monitoring: dict, count: int) -> float:
    batches = math.ceil(count / max(1, monitoring.get("concurrent_checks", 10)))
    return batches * (monitoring.get("check_timeout_seconds", 10) + 2)


def stale_after(monitoring: dict, count: int) -> float:
    interval = monitoring.get("check_interval_seconds", 60)
    return max(60, interval * 2, interval + cycle_budget(monitoring, count) + 5)


def proxy_health(proxy: dict, last_checks: dict, now: float, max_age: float) -> str:
    kinds = enabled_checks(proxy)
    if not kinds:
        return "disabled"
    checks = [last_checks.get(kind, {}) for kind in kinds]
    if any(check.get("timestamp") is None for check in checks):
        return "unknown"
    if any(now - check["timestamp"] > max_age for check in checks):
        return "stale"
    successes = sum(bool(check.get("success")) for check in checks)
    return "alive" if successes == len(checks) else "partial" if successes else "dead"


@dataclass
class CheckProgress:
    started_at: float | None = None
    finished_at: float | None = None
    started_monotonic: float = field(default_factory=time.monotonic)
    finished_monotonic: float | None = None
    budget: float = 0
    total: int = 0
    completed: int = 0
    active: set[str] = field(default_factory=set)

    def begin(self, monitoring: dict, count: int) -> None:
        self.started_at = time.time()
        self.started_monotonic = time.monotonic()
        self.finished_monotonic = None
        self.budget = cycle_budget(monitoring, count)
        self.total = count
        self.completed = 0
        self.active.clear()

    def finish(self) -> None:
        self.finished_at = time.time()
        self.finished_monotonic = time.monotonic()
        self.active.clear()

    def snapshot(self, running: bool, monitoring: dict, count: int) -> dict:
        now = time.time()
        clock = time.monotonic()
        interval = monitoring.get("check_interval_seconds", 60)
        checking = self.started_at is not None and self.finished_monotonic is None
        if checking:
            deadline = self.started_monotonic + self.budget + 5
        else:
            deadline = max(self.started_monotonic + interval, self.finished_monotonic or 0) + 5
        state = (
            "stopped" if not running else "idle" if not count else
            "stalled" if clock > deadline else "starting" if self.started_at is None else
            "checking" if checking else "waiting"
        )
        return {
            "state": state,
            "active_checks": len(self.active),
            "completed_checks": self.completed,
            "total_checks": self.total,
            "last_cycle_started": self.started_at,
            "last_cycle_finished": self.finished_at,
            "deadline_at": now + deadline - clock if running and count else None,
        }
