from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid

from fastapi.testclient import TestClient

from saas.aiops.reasoning import AdvisoryAnalysis, ProviderFailure
from saas.api.main import app
from saas.tenancy.auth import register_token


def _identity():
    tenant = f"ai-{uuid.uuid4().hex}"
    collector = f"collector-{uuid.uuid4().hex[:12]}"
    token = f"token-{uuid.uuid4().hex}"
    register_token(token, tenant, collector)
    return tenant, collector, token


def _payload(tenant, collector, when, cpu):
    return {
        "schema_version": "1.0.0", "payload_id": str(uuid.uuid4()), "tenant_id": tenant,
        "collector_id": collector,
        "event_time": when.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "service": "synthetic-service", "environment": "test", "region": "test-region",
        "metrics": {"cpu_percent": cpu, "latency_ms": 20},
        "security": {"failed_login_count": 0}, "health": "poor" if cpu >= 90 else "good",
    }


def test_fresh_ingest_schedules_advisory_analysis_and_duplicate_does_not(monkeypatch):
    from saas.aiops import reasoning

    tenant, collector, token = _identity()
    calls = []

    def successful_analysis(rows, **_context):
        calls.append(rows)
        return AdvisoryAnalysis(
            summary="Check the observed CPU excursion.",
            likely_causes=[{"hypothesis": "Compute load", "confidence": 0.6, "evidence_ids": [rows[0]["evidence_id"]]}],
            recommended_steps=["Review recent workload changes"], confidence=0.7,
            evidence_ids=[rows[0]["evidence_id"]],
            limitations=["Evidence cannot establish root cause."], assessment="supports",
        ), "a" * 64, "test/model"

    monkeypatch.setattr(reasoning, "request_openrouter_analysis", successful_analysis)
    base = datetime.now(timezone.utc) - timedelta(minutes=5)
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app) as client:
        for minute, cpu in ((0, 20), (1, 22), (2, 21)):
            response = client.post("/api/v1/ingest", json=_payload(tenant, collector, base + timedelta(minutes=minute), cpu), headers=headers)
            assert response.status_code == 202
        spike = _payload(tenant, collector, base + timedelta(minutes=3), 95)
        accepted = client.post("/api/v1/ingest", json=spike, headers=headers)
        assert accepted.status_code == 202
        assert accepted.json()["duplicate"] is False
        duplicate = client.post("/api/v1/ingest", json=spike, headers=headers)
        assert duplicate.status_code == 200
        assert duplicate.json()["duplicate"] is True

        incident = client.get("/api/v1/incidents", headers=headers).json()["items"][0]
        before_severity = incident["severity"]
        result = client.get(f"/api/v1/incidents/{incident['incident_id']}/analysis", headers=headers)
        assert result.status_code == 200
        assert result.json()["status"] == "completed"
        assert result.json()["result"]["analysis"]["evidence_ids"] == [spike["payload_id"]]
        assert result.json()["result"]["fusion"]["effective_severity"] == before_severity
        assert result.json()["result"]["fusion"]["remediation_authorized"] is False
        assert result.json()["prompt_hash"] == "a" * 64
        assert len(calls) == 1
        _, _, other_token = _identity()
        hidden = client.get(
            f"/api/v1/incidents/{incident['incident_id']}/analysis",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert hidden.status_code == 404
        after = client.get("/api/v1/incidents", headers=headers).json()["items"][0]
        assert after["severity"] == before_severity


def test_provider_failure_does_not_fail_ingest_and_can_be_retried(monkeypatch):
    from saas.aiops import reasoning

    tenant, collector, token = _identity()
    calls = []

    def failed_analysis(_rows, **_context):
        calls.append(1)
        raise ProviderFailure("provider_timeout")

    monkeypatch.setattr(reasoning, "request_openrouter_analysis", failed_analysis)
    base = datetime.now(timezone.utc) - timedelta(minutes=5)
    headers = {"Authorization": f"Bearer {token}"}
    with TestClient(app) as client:
        for minute, cpu in ((0, 20), (1, 22), (2, 21)):
            assert client.post("/api/v1/ingest", json=_payload(tenant, collector, base + timedelta(minutes=minute), cpu), headers=headers).status_code == 202
        spike = _payload(tenant, collector, base + timedelta(minutes=3), 95)
        assert client.post("/api/v1/ingest", json=spike, headers=headers).status_code == 202
        incident = client.get("/api/v1/incidents", headers=headers).json()["items"][0]
        status = client.get(f"/api/v1/incidents/{incident['incident_id']}/analysis", headers=headers).json()
        assert status["status"] == "failed"
        assert status["safe_error_code"] == "provider_timeout"
        assert len(calls) == 1
        retried = client.post(f"/api/v1/incidents/{incident['incident_id']}/analysis/retry", headers=headers)
        assert retried.status_code == 202
        assert retried.json()["status"] == "pending"  # the callback runs after the response body is prepared
        assert len(calls) == 2
        duplicate = client.post("/api/v1/ingest", json=spike, headers=headers)
        assert duplicate.status_code == 200
        assert len(calls) == 2
