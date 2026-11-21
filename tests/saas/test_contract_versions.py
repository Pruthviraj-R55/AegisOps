from __future__ import annotations

from datetime import datetime, timezone
import uuid

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from saas.aiops.anomaly import detect_metric_anomalies
from saas.aiops.health import evaluate_service_health
from saas.api.main import app
from saas.database import Base, engine
from saas.ingestion.schemas import TelemetryPayload
from saas.tenancy.auth import register_token


@pytest.fixture(scope="module", autouse=True)
def create_test_tables():
    Base.metadata.create_all(bind=engine)


def _payload(tenant_id: str, collector_id: str, *, version: str = "1.1.0") -> dict:
    body = {
        "schema_version": version,
        "payload_id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "collector_id": collector_id,
        "event_time": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "service": "contract-test-service",
        "environment": "test",
        "metrics": {"cpu_percent": 20.0},
        "health": "good",
    }
    return body


def test_v1_0_requires_security_and_v1_1_may_omit_it():
    v1_0 = _payload("tenant-contract-v10", "collector-contract-v10", version="1.0.0")
    v1_0["security"] = {"failed_login_count": 0}
    assert TelemetryPayload.model_validate(v1_0).security.failed_login_count == 0

    v1_0.pop("security")
    with pytest.raises(ValidationError):
        TelemetryPayload.model_validate(v1_0)

    v1_1 = _payload("tenant-contract-v11", "collector-contract-v11")
    assert TelemetryPayload.model_validate(v1_1).security is None


def test_v1_1_accepts_valid_security_and_rejects_malformed_security():
    body = _payload("tenant-contract-v11-valid", "collector-contract-v11-valid")
    body["security"] = {"failed_login_count": 2}
    assert TelemetryPayload.model_validate(body).security.failed_login_count == 2

    for value in (None, {}, {"failed_login_count": -1}, {"unapproved": 1}):
        malformed = {**body, "security": value}
        with pytest.raises(ValidationError):
            TelemetryPayload.model_validate(malformed)


def test_unsupported_schema_version_is_rejected():
    with pytest.raises(ValidationError):
        TelemetryPayload.model_validate(_payload("tenant-unsupported", "collector-unsupported", version="2.0.0"))


def test_absent_security_is_not_zero_or_a_security_detection():
    history = [
        {"metrics": {"cpu_percent": 20.0}, "security": {"failed_login_count": 0}, "event_time": datetime.now(timezone.utc)}
        for _ in range(4)
    ]
    current = {"metrics": {"cpu_percent": 21.0}, "event_time": datetime.now(timezone.utc)}
    for missing_security in (None, {}):
        current["security"] = missing_security
        signals = detect_metric_anomalies(history, current)
        assert all(signal.metric != "failed_login_count" for signal in signals)

        evaluation = evaluate_service_health(metrics=current["metrics"], security=missing_security)
        assert evaluation.security_status == "unavailable"
        assert any("security telemetry is unavailable" in reason.lower() for reason in evaluation.reasons)
        assert not any("security indicators are within nominal bounds" in reason.lower() for reason in evaluation.reasons)


def test_v1_1_ingestion_is_idempotent_tenant_scoped_and_reports_unavailable_security():
    tenant_a = f"contract-a-{uuid.uuid4().hex}"
    tenant_b = f"contract-b-{uuid.uuid4().hex}"
    collector_a = f"collector-a-{uuid.uuid4().hex[:12]}"
    collector_b = f"collector-b-{uuid.uuid4().hex[:12]}"
    token_a = f"token-a-{uuid.uuid4().hex}"
    token_b = f"token-b-{uuid.uuid4().hex}"
    register_token(token_a, tenant_a, collector_a)
    register_token(token_b, tenant_b, collector_b)
    payload = _payload(tenant_a, collector_a)

    with TestClient(app) as client:
        headers_a = {"Authorization": f"Bearer {token_a}"}
        headers_b = {"Authorization": f"Bearer {token_b}"}
        accepted = client.post("/api/v1/ingest", json=payload, headers=headers_a)
        duplicate = client.post("/api/v1/ingest", json=payload, headers=headers_a)
        assert accepted.status_code == 202
        assert duplicate.status_code == 200
        assert duplicate.json()["duplicate"] is True

        history = client.get("/api/v1/telemetry", headers=headers_a).json()["items"]
        stored = next(item for item in history if item["payload_id"] == payload["payload_id"])
        assert stored["schema_version"] == "1.1.0"
        assert stored["security"] is None

        service = client.get("/api/v1/services", headers=headers_a).json()["items"]
        assert next(item for item in service if item["service"] == stored["service"])["security_status"] == "unavailable"

        cross_tenant = client.post("/api/v1/ingest", json=payload, headers=headers_b)
        assert cross_tenant.status_code == 403
        assert cross_tenant.json()["code"] == "tenant_mismatch"
        other_history = client.get("/api/v1/telemetry", headers=headers_b).json()["items"]
        assert all(item["payload_id"] != payload["payload_id"] for item in other_history)
