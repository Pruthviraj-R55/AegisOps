from __future__ import annotations

import json

import pytest
from jsonschema import Draft202012Validator, FormatChecker

from collector.normalization.pipeline import InvalidTelemetry, TelemetryNormalizer, serialize_payload, stable_pseudonym


def test_password_and_api_key_never_appear_in_outbound(event, normalizer):
    event["password"] = "super-secret-password"
    event["api_key"] = "AKIA1234567890ABCDEF"
    event["region"] = "Bearer eyJhbGciOiJsecret"

    payload, proof = normalizer.build(event)

    encoded = serialize_payload(payload)
    assert "super-secret-password" not in encoded
    assert "AKIA1234567890ABCDEF" not in encoded
    assert "eyJhbGciOiJsecret" not in encoded
    assert "password" not in encoded
    assert proof["redacted_fields"] == ["region"]
    assert "credential_fields" in proof["excluded_field_categories"]


def test_authorization_header_redacts_scheme_and_entire_credential(event, normalizer):
    event["region"] = "Authorization: Bearer secret-value-must-not-leak"
    payload, proof = normalizer.build(event)
    encoded = serialize_payload(payload)

    assert "secret-value-must-not-leak" not in encoded
    assert "Bearer" not in encoded
    assert proof["redacted_fields"] == ["region"]


def test_unknown_fields_are_excluded_and_reported_by_category(event, normalizer):
    event["raw_log_line"] = "service restarted"
    event["arbitrary_extension"] = {"secret": "do-not-copy"}
    event["metrics"]["unapproved_metric"] = 100

    payload, proof = normalizer.build(event)

    assert "raw_log_line" not in payload
    assert "arbitrary_extension" not in payload
    assert "unapproved_metric" not in payload["metrics"]
    assert "do-not-copy" not in serialize_payload(payload)
    assert "unsupported_fields" in proof["excluded_field_categories"]
    assert "raw_or_source_fields" in proof["excluded_field_categories"]


def test_emitted_keys_match_schema_allow_list(event, normalizer):
    payload, _ = normalizer.build(event)
    schema = json.loads((__import__("pathlib").Path(__file__).parents[2] / "contracts" / "telemetry.schema.json").read_text())

    Draft202012Validator(schema, format_checker=FormatChecker()).validate(payload)
    assert set(payload) <= set(schema["properties"])
    assert set(payload["metrics"]) <= set(schema["properties"]["metrics"]["properties"])
    assert set(payload["security"]) <= set(schema["properties"]["security"]["properties"])
    assert payload["tenant_id"] == "tenant-test"
    assert payload["collector_id"] == "collector-test"


def test_service_pseudonym_is_stable_and_does_not_expose_source(event, normalizer):
    first, _ = normalizer.build(event)
    second, _ = normalizer.build(event)

    assert first["service"] == second["service"]
    assert first["service"] != "payments-api"
    assert stable_pseudonym("payments-api", "test-key") == stable_pseudonym("payments-api", "test-key")
    assert "payments-api" not in serialize_payload(first)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda e: e.update(health="unknown"),
        lambda e: e["metrics"].update(cpu_percent=101),
        lambda e: e.update(event_time="not-a-timestamp"),
        lambda e: e.update(metrics={"unknown": 1}),
    ],
)
def test_invalid_or_unsupported_payload_is_rejected(event, normalizer, mutation):
    mutation(event)
    with pytest.raises(InvalidTelemetry):
        normalizer.build(event)


def test_offset_event_time_is_normalized_to_utc_z(event, normalizer):
    event["event_time"] = "2026-11-20T17:30:00+05:30"
    payload, _ = normalizer.build(event)
    assert payload["event_time"] == "2026-11-20T12:00:00Z"


def test_identity_from_raw_telemetry_is_never_trusted(event, normalizer):
    event["tenant_id"] = "attacker-tenant"
    event["collector_id"] = "attacker-collector"
    event["payload_id"] = "00000000-0000-0000-0000-000000000001"

    payload, proof = normalizer.build(event)

    assert payload["tenant_id"] == "tenant-test"
    assert payload["collector_id"] == "collector-test"
    assert payload["payload_id"] != event["payload_id"]
    assert "untrusted_identity_overrides" in proof["excluded_field_categories"]
