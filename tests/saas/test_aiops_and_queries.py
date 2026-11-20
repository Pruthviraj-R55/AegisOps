"""Tests for AIOps engine (health, staleness, anomaly, correlation) and tenant-isolated read endpoints."""

from datetime import datetime, timedelta, timezone
import uuid
from fastapi.testclient import TestClient
import pytest

from saas.aiops.anomaly import (
    calculate_ewma,
    calculate_z_score,
    detect_metric_anomalies,
)
from saas.aiops.correlation import correlate_anomalies
from saas.aiops.health import evaluate_service_health
from saas.api.main import app
from saas.database import Base, engine, format_rfc3339_z
from saas.processing.staleness import (
    apply_staleness_downgrade,
    collector_freshness,
    is_stale,
)
from saas.tenancy.auth import register_token


@pytest.fixture(scope="session", autouse=True)
def setup_database():
    """Ensure all tables are created."""
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def client():
    """Test client."""
    with TestClient(app) as c:
        yield c


def build_telemetry(
    tenant_id: str,
    service: str,
    collector_id: str = "collector-main",
    event_time: str | None = None,
    cpu_percent: float = 35.0,
    memory_percent: float = 50.0,
    latency_ms: float = 25.0,
    packet_loss_percent: float = 0.0,
    failed_logins: int = 0,
    health: str = "excellent",
) -> dict:
    now_z = format_rfc3339_z(datetime.now(timezone.utc))
    return {
        "schema_version": "1.0.0",
        "payload_id": str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "collector_id": collector_id,
        "event_time": event_time or now_z,
        "service": service,
        "environment": "production",
        "region": "us-west-2",
        "metrics": {
            "cpu_percent": cpu_percent,
            "memory_percent": memory_percent,
            "disk_percent": 40.0,
            "bandwidth_mbps": 100.0,
            "latency_ms": latency_ms,
            "packet_loss_percent": packet_loss_percent,
        },
        "security": {
            "failed_login_count": failed_logins,
            "suspicious_activity_count": 0,
        },
        "health": health,
    }


# ==============================================================================
# Unit Tests: Staleness & Freshness
# ==============================================================================

def test_staleness_detection():
    now = datetime.now(timezone.utc)
    fresh_time = now - timedelta(seconds=15)
    stale_time = now - timedelta(seconds=55)

    assert not is_stale(fresh_time, current_time=now, threshold_seconds=45.0)
    assert is_stale(stale_time, current_time=now, threshold_seconds=45.0)


def test_collector_freshness_states():
    now = datetime.now(timezone.utc)
    online_time = now - timedelta(seconds=20)
    stale_time = now - timedelta(seconds=60)
    offline_time = now - timedelta(seconds=120)

    stale1, status1 = collector_freshness(online_time, current_time=now, threshold_seconds=45.0)
    assert not stale1
    assert status1 == "online"

    stale2, status2 = collector_freshness(stale_time, current_time=now, threshold_seconds=45.0)
    assert stale2
    assert status2 == "stale"

    stale3, status3 = collector_freshness(offline_time, current_time=now, threshold_seconds=45.0)
    assert stale3
    assert status3 == "offline"


# ==============================================================================
# Unit Tests: 4-State Health Evaluation & Staleness Downgrade
# ==============================================================================

def test_health_evaluation_4_states():
    # 1. Excellent
    h_exc = evaluate_service_health(
        metrics={"cpu_percent": 30.0, "memory_percent": 45.0, "latency_ms": 25.0},
        security={"failed_login_count": 0},
        is_stale=False,
    )
    assert h_exc.health == "excellent"
    assert h_exc.health_score >= 90
    assert not h_exc.stale

    # 2. Good
    h_good = evaluate_service_health(
        metrics={"cpu_percent": 78.0, "memory_percent": 60.0, "latency_ms": 50.0},
        security={"failed_login_count": 1},
        is_stale=False,
    )
    assert h_good.health == "good"
    assert 70 <= h_good.health_score < 90

    # 3. Fair
    h_fair = evaluate_service_health(
        metrics={"cpu_percent": 82.0, "memory_percent": 82.0, "latency_ms": 260.0},
        security={"failed_login_count": 2},
        is_stale=False,
    )
    assert h_fair.health == "fair"
    assert 40 <= h_fair.health_score < 70

    # 4. Poor (critical load)
    h_poor = evaluate_service_health(
        metrics={"cpu_percent": 96.0, "memory_percent": 92.0, "latency_ms": 650.0},
        security={"failed_login_count": 12},
        is_stale=False,
    )
    assert h_poor.health == "poor"
    assert h_poor.health_score < 40


def test_health_staleness_automatic_downgrade():
    """Even nominal metrics downgrade to poor when stale."""
    h_stale = evaluate_service_health(
        metrics={"cpu_percent": 25.0, "memory_percent": 30.0, "latency_ms": 15.0},
        security={"failed_login_count": 0},
        is_stale=True,
    )
    assert h_stale.health == "poor"
    assert h_stale.health_score <= 30
    assert h_stale.stale is True
    assert any("stale" in r.lower() for r in h_stale.reasons)


# ==============================================================================
# Unit Tests: Anomaly Detection & Correlation
# ==============================================================================

def test_anomaly_detection_z_score_and_ewma():
    history = [
        {"metrics": {"cpu_percent": 25.0, "latency_ms": 20.0}, "event_time": datetime.now(timezone.utc)},
        {"metrics": {"cpu_percent": 27.0, "latency_ms": 22.0}, "event_time": datetime.now(timezone.utc)},
        {"metrics": {"cpu_percent": 24.0, "latency_ms": 19.0}, "event_time": datetime.now(timezone.utc)},
        {"metrics": {"cpu_percent": 26.0, "latency_ms": 21.0}, "event_time": datetime.now(timezone.utc)},
        {"metrics": {"cpu_percent": 25.5, "latency_ms": 20.5}, "event_time": datetime.now(timezone.utc)},
    ]

    # Current normal
    normal_cur = {"metrics": {"cpu_percent": 26.0, "latency_ms": 21.0}, "event_time": datetime.now(timezone.utc)}
    assert len(detect_metric_anomalies(history, normal_cur)) == 0

    # Current anomalous spike in CPU and Latency
    anom_cur = {"metrics": {"cpu_percent": 95.0, "latency_ms": 550.0}, "event_time": datetime.now(timezone.utc)}
    signals = detect_metric_anomalies(history, anom_cur)
    assert len(signals) >= 2
    metrics_flagged = {s.metric for s in signals}
    assert "cpu_percent" in metrics_flagged
    assert "latency_ms" in metrics_flagged
    assert any(s.severity == "critical" for s in signals)


def test_alert_correlation_into_incident():
    history = [
        {"metrics": {"cpu_percent": 30.0, "latency_ms": 20.0}, "event_time": datetime.now(timezone.utc)},
        {"metrics": {"cpu_percent": 31.0, "latency_ms": 22.0}, "event_time": datetime.now(timezone.utc)},
        {"metrics": {"cpu_percent": 29.0, "latency_ms": 19.0}, "event_time": datetime.now(timezone.utc)},
        {"metrics": {"cpu_percent": 30.5, "latency_ms": 21.0}, "event_time": datetime.now(timezone.utc)},
    ]
    cur = {"metrics": {"cpu_percent": 98.0, "latency_ms": 620.0}, "event_time": datetime.now(timezone.utc)}
    signals = detect_metric_anomalies(history, cur)
    assert len(signals) >= 2

    incident = correlate_anomalies("checkout-service", signals)
    assert incident is not None
    assert incident.service == "checkout-service"
    assert incident.severity == "critical"
    assert incident.status == "active"
    assert incident.confidence >= 0.8
    assert len(incident.contributing_signals) >= 2
    assert "Scale horizontal replicas" in incident.recommended_action
    assert "Revert recent deployment" in incident.rollback_plan


# ==============================================================================
# Integration Tests: Multi-Tenant Isolation on Read Endpoints
# ==============================================================================

def test_tenant_isolation_on_read_endpoints(client: TestClient):
    token_a = f"token-tenant-a-{uuid.uuid4().hex[:6]}"
    token_b = f"token-tenant-b-{uuid.uuid4().hex[:6]}"
    tenant_a = f"tenant-a-{uuid.uuid4().hex[:6]}"
    tenant_b = f"tenant-b-{uuid.uuid4().hex[:6]}"

    register_token(token_a, tenant_a, "collector-a")
    register_token(token_b, tenant_b, "collector-b")

    # Ingest for Tenant A
    p_a1 = build_telemetry(tenant_id=tenant_a, service="service-alpha-1", collector_id="collector-a-1")
    p_a2 = build_telemetry(tenant_id=tenant_a, service="service-alpha-2", collector_id="collector-a-2")
    res_a1 = client.post("/api/v1/ingest", json=p_a1, headers={"Authorization": f"Bearer {token_a}"})
    res_a2 = client.post("/api/v1/ingest", json=p_a2, headers={"Authorization": f"Bearer {token_a}"})
    assert res_a1.status_code == 202
    assert res_a2.status_code == 202

    # Ingest for Tenant B
    p_b1 = build_telemetry(tenant_id=tenant_b, service="service-beta-1", collector_id="collector-b-1")
    res_b1 = client.post("/api/v1/ingest", json=p_b1, headers={"Authorization": f"Bearer {token_b}"})
    assert res_b1.status_code == 202

    # Query GET /api/v1/services as Tenant A
    res_services_a = client.get("/api/v1/services", headers={"Authorization": f"Bearer {token_a}"})
    assert res_services_a.status_code == 200
    services_a = res_services_a.json()["items"]
    names_a = [s["service"] for s in services_a]
    assert "service-alpha-1" in names_a
    assert "service-alpha-2" in names_a
    # STRICT ISOLATION: Tenant B's service must NEVER appear in Tenant A's query
    assert "service-beta-1" not in names_a

    # Query GET /api/v1/services as Tenant B
    res_services_b = client.get("/api/v1/services", headers={"Authorization": f"Bearer {token_b}"})
    assert res_services_b.status_code == 200
    services_b = res_services_b.json()["items"]
    names_b = [s["service"] for s in services_b]
    assert "service-beta-1" in names_b
    assert "service-alpha-1" not in names_b
    assert "service-alpha-2" not in names_b

    # Query GET /api/v1/collectors as Tenant A
    res_coll_a = client.get("/api/v1/collectors", headers={"Authorization": f"Bearer {token_a}"})
    assert res_coll_a.status_code == 200
    collectors_a = [c["collector_id"] for c in res_coll_a.json()["items"]]
    assert "collector-a-1" in collectors_a
    assert "collector-a-2" in collectors_a
    assert "collector-b-1" not in collectors_a

    # Query GET /api/v1/dashboard/overview as Tenant A
    res_ov_a = client.get("/api/v1/dashboard/overview", headers={"Authorization": f"Bearer {token_a}"})
    assert res_ov_a.status_code == 200
    ov_a = res_ov_a.json()
    assert "generated_at" in ov_a
    assert ov_a["generated_at"].endswith("Z")
    assert ov_a["service_counts"]["excellent"] >= 2
    assert "overall_health" in ov_a

    # Ingest anomalous payload for Tenant A to trigger automated incident creation
    p_anom = build_telemetry(
        tenant_id=tenant_a,
        service="service-alpha-1",
        collector_id="collector-a-1",
        cpu_percent=98.5,
        latency_ms=650.0,
        health="poor",
    )
    res_anom = client.post("/api/v1/ingest", json=p_anom, headers={"Authorization": f"Bearer {token_a}"})
    assert res_anom.status_code == 202

    # Query GET /api/v1/incidents as Tenant A
    res_inc_a = client.get("/api/v1/incidents", headers={"Authorization": f"Bearer {token_a}"})
    assert res_inc_a.status_code == 200
    incidents_a = res_inc_a.json()["items"]
    assert len(incidents_a) >= 1
    assert incidents_a[0]["service"] == "service-alpha-1"
    assert incidents_a[0]["severity"] == "critical"
    assert incidents_a[0]["status"] == "active"
    assert "recommended_action" in incidents_a[0]
    assert "rollback_plan" in incidents_a[0]

    # Query GET /api/v1/incidents as Tenant B -> must NOT see Tenant A's incidents
    res_inc_b = client.get("/api/v1/incidents", headers={"Authorization": f"Bearer {token_b}"})
    assert res_inc_b.status_code == 200
    incidents_b = res_inc_b.json()["items"]
    assert len(incidents_b) == 0

    # Unauthenticated requests to read endpoints return 401
    assert client.get("/api/v1/dashboard/overview").status_code == 401
    assert client.get("/api/v1/services").status_code == 401
    assert client.get("/api/v1/incidents").status_code == 401
    assert client.get("/api/v1/collectors").status_code == 401

    # Pagination bounds check (> 200 items returns 422)
    res_limit = client.get("/api/v1/services?limit=250", headers={"Authorization": f"Bearer {token_a}"})
    assert res_limit.status_code == 422
    assert res_limit.headers["content-type"].startswith("application/problem+json")
