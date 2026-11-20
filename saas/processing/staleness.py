"""Event-time freshness evaluation and staleness downgrade detection."""

from datetime import datetime, timezone
from typing import Optional

from saas.config import get_settings


def parse_timestamp_to_utc(ts: datetime | str) -> datetime:
    """Ensure a timestamp is a timezone-aware UTC datetime."""
    if isinstance(ts, str):
        if ts.endswith("Z"):
            ts = ts[:-1] + "+00:00"
        dt = datetime.fromisoformat(ts)
    else:
        dt = ts

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt


def format_rfc3339_z(dt: datetime) -> str:
    """Format a datetime to RFC 3339 UTC representation ending in 'Z' with millisecond precision."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def parse_rfc3339_z(ts_str: str) -> datetime:
    """Parse an RFC 3339 UTC string ending in 'Z' to a datetime with UTC timezone."""
    if ts_str.endswith("Z"):
        ts_str = ts_str[:-1] + "+00:00"
    return datetime.fromisoformat(ts_str)


def is_stale(
    last_time: datetime | str,
    current_time: Optional[datetime] = None,
    threshold_seconds: Optional[float] = None,
) -> bool:
    """
    Evaluate if an event timestamp or heartbeat is older than threshold_seconds.
    Defaults safely to under the 60s offline detection requirement (45.0s).
    """
    if threshold_seconds is None:
        threshold_seconds = get_settings().collector_stale_threshold_seconds

    if current_time is None:
        current_time = datetime.now(timezone.utc)
    else:
        current_time = parse_timestamp_to_utc(current_time)

    last_dt = parse_timestamp_to_utc(last_time)
    elapsed = (current_time - last_dt).total_seconds()
    return elapsed > threshold_seconds


def collector_freshness(
    last_seen: datetime | str,
    current_time: Optional[datetime] = None,
    threshold_seconds: Optional[float] = None,
) -> tuple[bool, str]:
    """
    Evaluate collector connection status based on heartbeat age.

    Returns:
        tuple[bool, str]: (is_stale, status_label)
        status_label: "online" | "stale" | "offline"
    """
    if threshold_seconds is None:
        threshold_seconds = get_settings().collector_stale_threshold_seconds

    if current_time is None:
        current_time = datetime.now(timezone.utc)
    else:
        current_time = parse_timestamp_to_utc(current_time)

    last_dt = parse_timestamp_to_utc(last_seen)
    elapsed = max(0.0, (current_time - last_dt).total_seconds())

    if elapsed <= threshold_seconds:
        return False, "online"
    elif elapsed <= threshold_seconds * 2:
        return True, "stale"
    else:
        return True, "offline"


def apply_staleness_downgrade(
    health: str,
    stale: bool,
    reasons: Optional[list[str]] = None,
    threshold_seconds: Optional[float] = None,
) -> tuple[str, list[str]]:
    """
    Downgrade health state to 'poor' if stale.

    Returns:
        tuple[str, list[str]]: (updated_health, updated_reasons)
    """
    out_reasons = list(reasons or [])
    if stale:
        thresh = threshold_seconds or get_settings().collector_stale_threshold_seconds
        out_reasons.append(
            f"Collector heartbeat / event data is stale (>{thresh:.0f}s); automatically downgraded to poor"
        )
        return "poor", out_reasons
    return health, out_reasons
