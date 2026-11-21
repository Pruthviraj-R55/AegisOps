"""Privacy-first construction and validation of outbound metadata records."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker
from pydantic import SecretStr, ValidationError

from collector.normalization.models import OutboundTelemetry
from collector.security.scrubber import contains_sensitive_key, scrub_string

_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "contracts" / "telemetry.schema.json"
_SCHEMA = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))
_SCHEMA_VALIDATOR = Draft202012Validator(_SCHEMA, format_checker=FormatChecker())
_ID_NAMESPACE = uuid.UUID("e15e8584-a60f-4a18-8751-c5a955e133fc")
_METRIC_FIELDS = {
    "cpu_percent",
    "memory_percent",
    "disk_percent",
    "bandwidth_mbps",
    "latency_ms",
    "packet_loss_percent",
}
_SECURITY_FIELDS = {"failed_login_count", "suspicious_activity_count"}
_ROOT_FIELDS = {
    "schema_version", "service", "environment", "region", "event_time", "metrics", "security", "health", "event_id",
    "tenant_id", "collector_id", "payload_id", "source_id", "host_id", "raw", "logs", "log", "message",
}
_SECRET_KEY_NAME = re.compile(r"(?i)(?:pass|secret|api[_-]?key|token|auth|credential|private[_-]?key)")
_RAW_KEY_NAME = re.compile(r"(?i)(?:raw|logs?|message|source[_-]?id|host[_-]?id)")


class InvalidTelemetry(ValueError):
    """Input cannot safely produce a schema-valid outbound record."""


def stable_pseudonym(value: str, key: str | SecretStr) -> str:
    """Create a stable, non-reversible, keyed pseudonym for a source identifier."""
    secret = key.get_secret_value() if isinstance(key, SecretStr) else key
    if not secret:
        raise ValueError("collector pseudonymization key is required")
    digest = hmac.new(secret.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()[:32]
    return f"svc_{digest}"


def _iso_utc(value: object) -> str:
    if not isinstance(value, str):
        raise InvalidTelemetry("event_time must be a timestamp string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise InvalidTelemetry("event_time must be a valid timestamp") from exc
    if parsed.tzinfo is None:
        raise InvalidTelemetry("event_time must include a timezone")
    return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _raw_identity_id(raw: dict[str, Any], tenant_id: str, service: str, key: str | SecretStr) -> str:
    event_id = raw.get("event_id")
    if not isinstance(event_id, str) or not event_id:
        return str(uuid.uuid4())
    secret = key.get_secret_value() if isinstance(key, SecretStr) else key
    material = f"{tenant_id}\0{service}\0{event_id}".encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), material, hashlib.sha256).hexdigest()
    return str(uuid.uuid5(_ID_NAMESPACE, digest))


def _scrub_allowed_string(value: object, field: str, redacted: list[str]) -> str:
    if not isinstance(value, str):
        raise InvalidTelemetry(f"{field} must be a string")
    cleaned, changed = scrub_string(value)
    if changed and field not in redacted:
        redacted.append(field)
    if not cleaned.strip():
        raise InvalidTelemetry(f"{field} is empty after scrubbing")
    return cleaned.strip()


class TelemetryNormalizer:
    """Build a new allow-listed record; never retain or serialize the raw event."""

    def __init__(self, tenant_id: str, collector_id: str, pseudonymization_key: str | SecretStr):
        self.tenant_id = tenant_id
        self.collector_id = collector_id
        self.pseudonymization_key = pseudonymization_key

    def build(self, raw: object) -> tuple[dict[str, Any], dict[str, Any]]:
        """Return (validated outbound payload, safe proof metadata)."""
        if not isinstance(raw, dict) or not all(isinstance(key, str) for key in raw):
            raise InvalidTelemetry("telemetry event must be a JSON object")

        redacted_fields: list[str] = []
        unknown_root_count = sum(1 for key in raw if key not in _ROOT_FIELDS)
        has_sensitive_keys = contains_sensitive_key(raw)
        categories: list[str] = []
        if unknown_root_count:
            categories.append("unsupported_fields")
        if has_sensitive_keys or any(_SECRET_KEY_NAME.search(key) for key in raw):
            categories.append("credential_fields")
        if any(key in raw for key in ("tenant_id", "collector_id", "payload_id")):
            categories.append("untrusted_identity_overrides")
        if any(_RAW_KEY_NAME.search(key) for key in raw):
            categories.append("raw_or_source_fields")

        service_source = _scrub_allowed_string(raw.get("service"), "service", redacted_fields)
        pseudonym = stable_pseudonym(service_source, self.pseudonymization_key)
        environment = _scrub_allowed_string(raw.get("environment"), "environment", redacted_fields)

        region_value = raw.get("region")
        region = None
        if region_value is not None:
            region = _scrub_allowed_string(region_value, "region", redacted_fields)

        metric_source = raw.get("metrics")
        security_present = "security" in raw
        security_source = raw.get("security")
        if not isinstance(metric_source, dict):
            raise InvalidTelemetry("metrics object is required by the shared schema")
        if security_present and not isinstance(security_source, dict):
            raise InvalidTelemetry("security must be an object when supplied")

        schema_version = raw.get("schema_version") if "schema_version" in raw else (
            "1.0.0" if security_present else "1.1.0"
        )
        if not isinstance(schema_version, str) or schema_version not in {"1.0.0", "1.1.0"}:
            raise InvalidTelemetry("schema_version is unsupported")
        if schema_version == "1.0.0" and not security_present:
            raise InvalidTelemetry("schema version 1.0.0 requires security telemetry")

        metrics: dict[str, Any] = {}
        for key, value in metric_source.items():
            if key in _METRIC_FIELDS and value is not None:
                metrics[key] = value
        unknown_nested = sum(1 for key in metric_source if key not in _METRIC_FIELDS)
        security = None
        if security_present:
            for key, value in security_source.items():
                if key in _SECURITY_FIELDS and value is not None:
                    pass
                elif key not in _SECURITY_FIELDS:
                    unknown_nested += 1
            security = {key: security_source[key] for key in _SECURITY_FIELDS if key in security_source and security_source[key] is not None}
        if unknown_nested and "unsupported_fields" not in categories:
            categories.append("unsupported_fields")

        trusted_event = {
            "schema_version": schema_version,
            "payload_id": _raw_identity_id(raw, self.tenant_id, service_source, self.pseudonymization_key),
            "tenant_id": self.tenant_id,
            "collector_id": self.collector_id,
            "event_time": _iso_utc(raw.get("event_time")),
            "service": pseudonym,
            "environment": environment,
            "metrics": metrics,
            "health": raw.get("health"),
        }
        if security is not None:
            trusted_event["security"] = security
        if region is not None:
            trusted_event["region"] = region

        try:
            model = OutboundTelemetry.model_validate(trusted_event)
            payload = model.model_dump(mode="json", exclude_none=True)
            errors = list(_SCHEMA_VALIDATOR.iter_errors(payload))
            if errors:
                raise InvalidTelemetry("normalized record does not match the shared telemetry schema")
        except ValidationError as exc:
            raise InvalidTelemetry("normalized record does not match the shared telemetry schema") from exc

        proof = {
            "validation_status": "valid",
            "excluded_field_count": unknown_root_count + unknown_nested + sum(
                1 for key in raw if key in ("event_id", "tenant_id", "collector_id", "payload_id", "source_id", "host_id", "raw", "logs", "log", "message")
            ),
            "excluded_field_categories": categories,
            "excluded_fields": self._safe_excluded_labels(raw, categories, unknown_root_count, unknown_nested),
            "redacted_fields": sorted(redacted_fields),
        }
        return payload, proof

    @staticmethod
    def _safe_excluded_labels(
        raw: dict[str, Any], categories: list[str], unknown_root_count: int, unknown_nested_count: int
    ) -> list[str]:
        """Describe exclusions with fixed labels, never echo attacker-controlled key text."""
        labels: list[str] = []
        if unknown_root_count or unknown_nested_count:
            labels.append("unsupported fields")
        if "credential_fields" in categories:
            labels.append("credential-like fields")
        for field in ("tenant_id", "collector_id", "payload_id"):
            if field in raw:
                labels.append(f"untrusted {field}")
        if "raw_or_source_fields" in categories:
            labels.append("raw log or source identifier fields")
        if "event_id" in raw:
            labels.append("event_id (used only to derive a stable payload ID)")
        return labels


def serialize_payload(payload: dict[str, Any]) -> str:
    """Stable compact JSON used identically by preview, queue, and HTTP transport."""
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False, sort_keys=True)
