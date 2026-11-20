"""Event-time health and stream processing."""

from saas.processing.staleness import (
    apply_staleness_downgrade,
    collector_freshness,
    is_stale,
    parse_timestamp_to_utc,
)

__all__ = [
    "apply_staleness_downgrade",
    "collector_freshness",
    "is_stale",
    "parse_timestamp_to_utc",
]
