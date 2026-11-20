from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid

import pytest
from fastapi.testclient import TestClient

from saas.aiops.anomaly import AnomalySignal, calculate_ewma, calculate_z_score, detect_metric_anomalies
from saas.aiops.correlation import correlate_anomalies
from saas.api.main import app
from saas.tenancy.auth import register_token


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def _identity():
    tenant = f"history-{uuid.uuid4().hex}"
    collector = f"collector-{uuid.uuid4().hex[:12]}"
    token = f"token-{uuid.uuid4().hex}"
    register_token(token, tenant, collector)
    return tenant, collector, token


def _payload(
    tenant: str,
    collector: str,
    event_time: datetime,
    *,
    payload_id: str | None = None,
    service: str = "synthetic-service",
    cpu: float = 25.0,
    failed_logins: int = 0,
) -> dict:
    return {
        "schema_version": "1.0.0",
        "payload_id": payload_id or str(uuid.uuid4()),
        "tenant_id": tenant,
        "collector_id": collector,
        "event_time": event_time.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "service": service,
        "environment": "test",
        "region": "test-region",
        "metrics": {"cpu_percent": cpu, "latency_ms": 20.0},
        "security": {"failed_login_count": failed_logins},
        "health": "poor" if cpu >= 90 else "good",
    }


def _ingest(client: TestClient, payload: dict, token: str):
    return client.post("/api/v1/ingest", json=payload, headers={"Authorization": f"Bearer {token}"})


def test_history_is_tenant_scoped_ordered_paginated_and_time_filtered(client: TestClient):
    tenant_a, collector_a, token_a = _identity()
    tenant_b, collector_b, token_b = _identity()
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    payloads = [
        _payload(tenant_a, collector_a, base + timedelta(minutes=minute), failed_logins=1 if minute == 1 else 0)
        for minute in (0, 1, 2)
    ]
    # Deliberately arrive out of event-time order.
    for payload in (payloads[2], payloads[0], payloads[1]):
        assert _ingest(client, payload, token_a).status_code == 202
    assert _ingest(client, _payload(tenant_b, collector_b, base + timedelta(minutes=1)), token_b).status_code == 202

    headers = {"Authorization": f"Bearer {token_a}"}
    first = client.get("/api/v1/telemetry?limit=2", headers=headers)
    assert first.status_code == 200
    first_body = first.json()
    assert first_body["has_more"] is True
    assert first_body["next_cursor"]
    assert [row["payload_id"] for row in first_body["items"]] == [payloads[2]["payload_id"], payloads[1]["payload_id"]]

    second = client.get(
        "/api/v1/telemetry",
        params={"limit": 2, "cursor": first_body["next_cursor"]},
        headers=headers,
    )
    assert second.status_code == 200
    assert [row["payload_id"] for row in second.json()["items"]] == [payloads[0]["payload_id"]]
    assert second.json()["has_more"] is False
    assert {row["payload_id"] for row in first_body["items"] + second.json()["items"]} == {
        payload["payload_id"] for payload in payloads
    }

    filtered = client.get(
        "/api/v1/telemetry",
        params={"start_time": (base + timedelta(minutes=1)).isoformat(), "end_time": (base + timedelta(minutes=1)).isoformat()},
        headers=headers,
    )
    assert filtered.status_code == 200
    assert [row["payload_id"] for row in filtered.json()["items"]] == [payloads[1]["payload_id"]]
    assert client.get("/api/v1/telemetry?cursor=invalid", headers=headers).status_code == 422
    invalid_range = client.get(
        "/api/v1/telemetry",
        params={"start_time": (base + timedelta(minutes=2)).isoformat(), "end_time": base.isoformat()},
        headers=headers,
    )
    assert invalid_range.status_code == 422

    security = client.get("/api/v1/security-events", headers=headers)
    assert security.status_code == 200
    assert [row["payload_id"] for row in security.json()["items"]] == [payloads[1]["payload_id"]]
    tenant_b_ids = {
        row["payload_id"]
        for row in client.get("/api/v1/telemetry", headers={"Authorization": f"Bearer {token_b}"}).json()["items"]
    }
    assert tenant_b_ids.isdisjoint({payload["payload_id"] for payload in payloads})


def test_baseline_is_prior_event_time_only_and_incident_evidence_is_persisted(client: TestClient):
    tenant, collector, token = _identity()
    base = datetime(2026, 1, 2, 10, tzinfo=timezone.utc)
    headers = {"Authorization": f"Bearer {token}"}
    for minute, cpu in ((0, 20.0), (1, 22.0), (2, 21.0)):
        assert _ingest(client, _payload(tenant, collector, base + timedelta(minutes=minute), cpu=cpu), token).status_code == 202

    spike = _payload(tenant, collector, base + timedelta(minutes=3), cpu=95.0)
    accepted = _ingest(client, spike, token)
    assert accepted.status_code == 202
    replay = _ingest(client, spike, token)
    assert replay.status_code == 200
    assert replay.json()["duplicate"] is True

    incidents = client.get("/api/v1/incidents", headers=headers).json()["items"]
    assert len(incidents) == 1
    incident_id = incidents[0]["incident_id"]
    evidence = client.get(f"/api/v1/incidents/{incident_id}/evidence", headers=headers)
    assert evidence.status_code == 200
    evidence_rows = evidence.json()["items"]
    assert [row["payload_id"] for row in evidence_rows] == [spike["payload_id"]]
    cpu_signal = next(item for item in evidence_rows[0]["signals"] if item["metric"] == "cpu_percent")
    assert cpu_signal["sample_count"] == 3
    assert cpu_signal["baseline"] == pytest.approx(21.0)
    assert cpu_signal["observed_value"] == pytest.approx(95.0)
    assert cpu_signal["event_time"] == spike["event_time"]

    delayed = _payload(tenant, collector, base + timedelta(minutes=1, seconds=30), cpu=96.0)
    assert _ingest(client, delayed, token).status_code == 202
    incidents_after_delay = client.get("/api/v1/incidents", headers=headers).json()["items"]
    assert len(incidents_after_delay) == 1
    assert incidents_after_delay[0]["incident_id"] == incident_id
    assert incidents_after_delay[0]["started_at"] == delayed["event_time"]
    evidence_after_delay = client.get(f"/api/v1/incidents/{incident_id}/evidence", headers=headers).json()["items"]
    assert len(evidence_after_delay) == 2

    outside_window = _payload(tenant, collector, base + timedelta(minutes=20), cpu=97.0)
    assert _ingest(client, outside_window, token).status_code == 202
    incidents_outside = client.get("/api/v1/incidents", headers=headers).json()["items"]
    assert len(incidents_outside) == 2
    assert client.get(f"/api/v1/incidents/{incident_id}/evidence", headers={"Authorization": f"Bearer {token}"}).status_code == 200

    _, _, other_token = _identity()
    assert client.get(f"/api/v1/incidents/{incident_id}/evidence", headers={"Authorization": f"Bearer {other_token}"}).status_code == 404


def test_detector_reports_missing_baseline_and_ignores_invalid_values():
    current = {
        "event_time": datetime(2026, 1, 3, tzinfo=timezone.utc),
        "metrics": {"cpu_percent": 95.0, "memory_percent": None, "latency_ms": float("inf")},
        "security": {"failed_login_count": -1},
    }
    signals = detect_metric_anomalies([], current)
    cpu_signal = next(signal for signal in signals if signal.metric == "cpu_percent")
    assert cpu_signal.expected_value is None
    assert cpu_signal.sample_count == 0
    assert "baseline unavailable" in cpu_signal.description
    assert {signal.metric for signal in signals} == {"cpu_percent"}
    assert calculate_z_score([], 95.0)[1:] == (None, None)
    assert calculate_ewma([], 95.0)[1:] == (None, None)


def test_correlation_window_keeps_only_signals_in_configured_interval():
    start = datetime(2026, 1, 4, tzinfo=timezone.utc)
    signals = [
        AnomalySignal("cpu_percent", 95, 20, 4, "critical", "older signal", start),
        AnomalySignal("latency_ms", 600, 30, 5, "critical", "recent signal", start + timedelta(seconds=1000)),
    ]
    incident = correlate_anomalies("service", signals, time_window_seconds=300)
    assert incident is not None
    assert incident.contributing_signals == ["recent signal"]
    with pytest.raises(ValueError):
        correlate_anomalies("service", signals, time_window_seconds=-1)
