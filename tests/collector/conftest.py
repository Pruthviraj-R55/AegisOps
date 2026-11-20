from __future__ import annotations

import pytest

from collector.normalization.pipeline import TelemetryNormalizer


@pytest.fixture
def event() -> dict:
    return {
        "event_id": "event-0001",
        "event_time": "2026-11-20T12:00:00Z",
        "service": "payments-api",
        "environment": "staging",
        "region": "ap-south-1",
        "metrics": {"cpu_percent": 31.5, "latency_ms": 12.4, "ignored_metric": 99},
        "security": {"failed_login_count": 0, "suspicious_activity_count": 1},
        "health": "good",
    }


@pytest.fixture
def normalizer() -> TelemetryNormalizer:
    return TelemetryNormalizer("tenant-test", "collector-test", "test-key-never-use-in-production")
