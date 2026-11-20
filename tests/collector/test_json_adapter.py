from __future__ import annotations

import json

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from collector.adapters.json_file import AdapterRecordError, JsonAdapterConfig, JsonFileAdapter
from collector.config import CollectorSettings
from collector.normalization.pipeline import TelemetryNormalizer, serialize_payload
from collector.queue.sqlite_queue import SQLiteQueue
from collector.service import CollectorService


def _config(**overrides) -> JsonAdapterConfig:
    values = {
        "field_mapping": {
            "event_id": "event.key",
            "event_time": "observed_at",
            "service": "component.name",
            "environment": "deployment.stage",
            "region": "location.zone",
            "health": "status",
            "metrics.cpu_percent": "measurements.cpu",
            "security.failed_login_count": "counters.failed_logins",
        }
    }
    values.update(overrides)
    return JsonAdapterConfig(**values)


def _record(event_key="src-1", *, time="2026-11-20T12:00:00+05:30", service="api", extra=None):
    record = {
        "event": {"key": event_key},
        "observed_at": time,
        "component": {"name": service},
        "deployment": {"stage": "test"},
        "status": "good",
        "measurements": {"cpu": 24.5, "ignored": 999},
        "counters": {"failed_logins": 0},
        "access_token": "fixture-secret-never-export",
        "unrecognized": {"message": "private raw source content"},
    }
    if extra:
        record.update(extra)
    return record


async def _collect(adapter):
    return [event async for event in adapter.events()]


async def test_json_object_mapping_drops_unmapped_fields_and_normalizes_to_contract(tmp_path):
    path = tmp_path / "source.json"
    path.write_text(json.dumps(_record()), encoding="utf-8")

    mapped = await _collect(JsonFileAdapter(path, _config()))
    payload, proof = TelemetryNormalizer("trusted-tenant", "trusted-collector", "test-key").build(mapped[0])
    schema = json.loads((__import__("pathlib").Path(__file__).parents[2] / "contracts" / "telemetry.schema.json").read_text())

    Draft202012Validator(schema, format_checker=FormatChecker()).validate(payload)
    encoded = serialize_payload(payload)
    assert payload["event_time"] == "2026-11-20T06:30:00Z"
    assert payload["tenant_id"] == "trusted-tenant"
    assert payload["collector_id"] == "trusted-collector"
    assert payload["metrics"] == {"cpu_percent": 24.5}
    assert "fixture-secret-never-export" not in encoded
    assert "private raw source content" not in encoded
    assert "unrecognized" not in mapped[0]
    assert proof["validation_status"] == "valid"


async def test_jsonl_stream_maps_multiple_services_optional_fields_and_unix_time(tmp_path):
    first = _record("alpha", time=1_795_176_000, service="edge")
    first["observed_at"] = 1_795_176_000
    second = _record("beta", time=1_795_176_005, service="worker")
    second["observed_at"] = 1_795_176_005
    second["location"] = None
    config = _config(timestamp_format="unix_seconds")
    path = tmp_path / "source.jsonl"
    path.write_text("\n".join(json.dumps(value) for value in (first, second)) + "\n", encoding="utf-8")

    mapped = await _collect(JsonFileAdapter(path, config))
    assert len(mapped) == 2
    assert [item["service"] for item in mapped] == ["edge", "worker"]
    assert "region" not in mapped[1]
    assert mapped[0]["event_id"] == "alpha"
    assert mapped[1]["event_time"] == "2026-11-20T12:00:05.000Z"


async def test_independent_flat_dataset_maps_unix_milliseconds_and_different_source_identity(tmp_path):
    source_record = {
        "recordKey": "node-event-77",
        "epoch_ms": 1_795_176_000_000,
        "serviceLabel": "database",
        "stageName": "staging",
        "healthState": "fair",
        "resourceCpu": 64,
        "loginFailures": 2,
        "credential": "flat-dataset-secret",
        "extraValue": "must remain local",
    }
    path = tmp_path / "flat-input.json"
    path.write_text(json.dumps(source_record), encoding="utf-8")
    config = JsonAdapterConfig(
        field_mapping={
            "event_id": "recordKey",
            "event_time": "epoch_ms",
            "service": "serviceLabel",
            "environment": "stageName",
            "health": "healthState",
            "metrics.cpu_percent": "resourceCpu",
            "security.failed_login_count": "loginFailures",
        },
        timestamp_format="unix_milliseconds",
    )

    mapped = (await _collect(JsonFileAdapter(path, config)))[0]
    payload, _ = TelemetryNormalizer("tenant", "collector", "key").build(mapped)
    serialized = serialize_payload(payload)
    assert mapped["event_id"] == "node-event-77"
    assert payload["event_time"] == "2026-11-20T12:00:00Z"
    assert payload["metrics"]["cpu_percent"] == 64
    assert "flat-dataset-secret" not in serialized
    assert "must remain local" not in serialized


async def test_jsonl_malformed_record_reports_line_and_stops_processing(tmp_path):
    path = tmp_path / "records.jsonl"
    path.write_text(json.dumps(_record()) + "\n" + "{invalid\n" + json.dumps(_record("third")), encoding="utf-8")
    iterator = JsonFileAdapter(path, _config()).events()
    assert await anext(iterator)
    with pytest.raises(AdapterRecordError) as error:
        await anext(iterator)
    assert error.value.as_dict() == {
        "source": "records.jsonl",
        "record_number": 2,
        "code": "invalid_json",
        "message": "record is not valid JSON",
    }


async def test_missing_required_mapping_and_wrong_timestamp_are_clear_errors(tmp_path):
    path = tmp_path / "source.json"
    record = _record()
    record.pop("observed_at")
    path.write_text(json.dumps(record), encoding="utf-8")
    with pytest.raises(AdapterRecordError, match="missing_required_field"):
        await _collect(JsonFileAdapter(path, _config()))

    path.write_text(json.dumps(_record(time="not-a-date")), encoding="utf-8")
    with pytest.raises(AdapterRecordError, match="invalid_timestamp"):
        await _collect(JsonFileAdapter(path, _config()))


def test_adapter_config_rejects_noncanonical_targets_and_unknown_timestamp_modes():
    with pytest.raises(ValueError, match="unsupported canonical target"):
        JsonAdapterConfig(field_mapping={"tenant_id": "tenant"})
    with pytest.raises(ValueError, match="timestamp_format"):
        JsonAdapterConfig(field_mapping={}, timestamp_format="ambiguous")


async def test_configurable_local_aggregation_uses_bounded_numeric_state_and_stable_group(tmp_path):
    records = [_record("one"), _record("two", time="2026-11-20T12:00:05Z")]
    records[0]["measurements"]["cpu"] = 20
    records[0]["counters"]["failed_logins"] = 1
    records[1]["measurements"]["cpu"] = 40
    records[1]["counters"]["failed_logins"] = 3
    path = tmp_path / "events.json"
    path.write_text(json.dumps(records), encoding="utf-8")
    config = _config(aggregation={"metrics.cpu_percent": "mean", "security.failed_login_count": "sum"})

    first = (await _collect(JsonFileAdapter(path, config)))[0]
    second = (await _collect(JsonFileAdapter(path, config)))[0]
    assert first["metrics"]["cpu_percent"] == 30
    assert first["security"]["failed_login_count"] == 4
    assert first["event_time"] == "2026-11-20T12:00:05.000Z"
    assert first["event_id"] == second["event_id"]
    assert TelemetryNormalizer("tenant", "collector", "key").build(first)[0]["payload_id"] == TelemetryNormalizer(
        "tenant", "collector", "key"
    ).build(second)[0]["payload_id"]


async def test_service_adapter_ingestion_uses_normalizer_and_existing_sqlite_queue(tmp_path):
    path = tmp_path / "events.json"
    path.write_text(json.dumps(_record()), encoding="utf-8")
    settings = CollectorSettings(
        collector_id="collector-test",
        collector_tenant_id="tenant-test",
        collector_queue_path=str(tmp_path / "queue.sqlite3"),
        collector_pseudonymization_key="test-pseudonym-key",
    )
    queue = SQLiteQueue(settings.collector_queue_path)
    await queue.initialize()
    service = CollectorService(settings, queue=queue)

    count = await service.ingest_adapter(JsonFileAdapter(path, _config()))
    items = await queue.list_items()
    assert count == 1
    assert len(items) == 1
    preview = await queue.preview(items[0]["payload_id"])
    assert preview is not None
    assert preview.payload_json == serialize_payload(json.loads(preview.payload_json))
    assert preview.egress_approved is False
    assert "fixture-secret-never-export" not in preview.payload_json
    assert await queue.approve_egress(preview.payload_id)
    claimed = await queue.claim_next(10**12)
    assert claimed is not None
    assert claimed.payload_id == preview.payload_id
    assert claimed.payload_json == preview.payload_json
    await service.delivery.close()
