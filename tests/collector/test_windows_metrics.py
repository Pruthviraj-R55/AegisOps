from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from collector.adapters.json_file import AdapterRecordError
from collector.adapters.windows_metrics import WindowsMetricsAdapter
from collector.config import CollectorSettings
from collector.normalization.pipeline import TelemetryNormalizer, serialize_payload
from collector.queue.sqlite_queue import SQLiteQueue
from collector.service import CollectorService


class FakePsutil:
    def __init__(self, *, cpu=21.5, memory=43.25, disk=61.0, network=None):
        self.cpu = cpu
        self.memory = memory
        self.disk = disk
        self.network = network if isinstance(network, Exception) else list(network or [(1000, 2000), (1300, 2700)])
        self.cpu_interval = None

    def cpu_percent(self, *, interval):
        self.cpu_interval = interval
        if isinstance(self.cpu, Exception):
            raise self.cpu
        return self.cpu

    def virtual_memory(self):
        if isinstance(self.memory, Exception):
            raise self.memory
        return SimpleNamespace(percent=self.memory)

    def disk_usage(self, _root):
        if isinstance(self.disk, Exception):
            raise self.disk
        return SimpleNamespace(percent=self.disk)

    def net_io_counters(self):
        if isinstance(self.network, Exception):
            raise self.network
        sent, received = self.network.pop(0)
        return SimpleNamespace(bytes_sent=sent, bytes_recv=received)


async def _sample(adapter: WindowsMetricsAdapter) -> dict:
    return await anext(adapter.events())


@pytest.mark.asyncio
async def test_windows_metrics_map_real_measurement_interfaces_and_emit_v1_1():
    psutil = FakePsutil()
    event = await _sample(
        WindowsMetricsAdapter(
            service="local-host",
            environment="development",
            sample_interval_seconds=0.2,
            psutil_api=psutil,
        )
    )

    assert event["schema_version"] == "1.1.0"
    assert event["metrics"]["cpu_percent"] == 21.5
    assert event["metrics"]["memory_percent"] == 43.25
    assert event["metrics"]["disk_percent"] == 61.0
    assert event["metrics"]["bandwidth_mbps"] > 0
    assert event["event_time"].endswith("Z")
    assert event["health"] == "good"
    assert psutil.cpu_interval == 0.2
    assert "security" not in event
    assert set(event) == {"schema_version", "event_time", "service", "environment", "metrics", "health"}


@pytest.mark.asyncio
async def test_missing_or_invalid_measurements_stay_unavailable():
    partial = await _sample(
        WindowsMetricsAdapter(
            service="local-host",
            environment="test",
            psutil_api=FakePsutil(
                cpu=18.0,
                memory=OSError("private operating system detail"),
                disk=float("nan"),
                network=OSError("private interface detail"),
            ),
        )
    )
    assert partial["metrics"] == {"cpu_percent": 18.0}
    assert partial["health"] == "fair"
    assert "security" not in partial

    unavailable = FakePsutil(
        cpu=float("nan"),
        memory=OSError("do not leak"),
        disk=101,
        network=OSError("do not leak"),
    )
    with pytest.raises(AdapterRecordError) as error:
        await _sample(
            WindowsMetricsAdapter(
                service="local-host", environment="test", psutil_api=unavailable
            )
        )
    assert error.value.code == "measurements_unavailable"
    assert "do not leak" not in str(error.value)


@pytest.mark.asyncio
async def test_normalizer_and_sqlite_queue_keep_security_absent(tmp_path):
    settings = CollectorSettings(
        _env_file=None,
        collector_tenant_id="tenant-test",
        collector_id="collector-test",
        collector_queue_path=str(tmp_path / "windows.sqlite3"),
        collector_pseudonymization_key="test-pseudonym-key",
    )
    queue = SQLiteQueue(settings.collector_queue_path)
    await queue.initialize()
    service = CollectorService(settings, queue=queue)
    try:
        event = await _sample(
            WindowsMetricsAdapter(
                service="host-label-do-not-export",
                environment="test",
                psutil_api=FakePsutil(),
            )
        )
        event["username"] = "sensitive-user"
        event["file_path"] = r"C:\Users\sensitive-user\private.txt"
        event["command_line"] = "token=private-value"
        result = await service.ingest(event, source_category="windows_live_metrics")
        item = await queue.get(result["payload_id"])
        assert item is not None
        payload = json.loads(item.payload_json)
        encoded = serialize_payload(payload)

        assert payload["schema_version"] == "1.1.0"
        assert "security" not in payload
        assert payload["tenant_id"] == "tenant-test"
        assert payload["collector_id"] == "collector-test"
        assert item.proof()["source_category"] == "windows_live_metrics"
        assert "sensitive-user" not in encoded
        assert "private.txt" not in encoded
        assert "private-value" not in encoded
        assert "host-label-do-not-export" not in encoded
        assert item.egress_approved is False

        schema_path = __import__("pathlib").Path(__file__).parents[2] / "contracts" / "telemetry.schema.json"
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        Draft202012Validator(schema, format_checker=FormatChecker()).validate(payload)
        # The existing v1.0.0 normalizer path still validates a security record.
        legacy_event = {
            "event_time": event["event_time"],
            "service": "legacy-service",
            "environment": "test",
            "metrics": {"cpu_percent": 12},
            "security": {"failed_login_count": 0},
            "health": "good",
        }
        legacy, _ = TelemetryNormalizer("tenant-test", "collector-test", "test-key").build(legacy_event)
        assert legacy["schema_version"] == "1.0.0"
        assert legacy["security"]["failed_login_count"] == 0
    finally:
        await service.delivery.close()


def test_sample_interval_is_bounded():
    with pytest.raises(ValueError, match="between 0.1 and 5"):
        WindowsMetricsAdapter(service="host", environment="test", sample_interval_seconds=20)
