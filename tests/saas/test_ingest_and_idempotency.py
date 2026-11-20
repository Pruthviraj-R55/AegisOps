"""Comprehensive tests for SaaS Ingestion API, Authentication, and Idempotency."""

import uuid
from fastapi.testclient import TestClient
import pytest

from saas.api.main import app
from saas.database import Base, SessionLocal, engine
from saas.tenancy.auth import register_token


@pytest.fixture(scope="session", autouse=True)
def setup_database():
    """Ensure database tables exist for test run."""
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def client():
    """Test client instance."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def valid_token():
    """Default valid development token."""
    return "dev-secret-token-12345"


@pytest.fixture
def dev_tenant_id():
    """Default development tenant ID."""
    return "development-tenant"


def build_valid_payload(
    tenant_id: str = "development-tenant",
    payload_id: str | None = None,
    service: str = "order-service",
    cpu_percent: float = 42.5,
) -> dict:
    """Construct a valid contract-conforming telemetry dictionary."""
    return {
        "schema_version": "1.0.0",
        "payload_id": payload_id or str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "collector_id": "local-dev-collector",
        "event_time": "2026-01-12T08:31:11.402Z",
        "service": service,
        "environment": "production",
        "region": "us-east-1",
        "metrics": {
            "cpu_percent": cpu_percent,
            "memory_percent": 65.0,
            "disk_percent": 30.0,
            "bandwidth_mbps": 120.5,
            "latency_ms": 15.2,
            "packet_loss_percent": 0.0,
        },
        "security": {
            "failed_login_count": 0,
            "suspicious_activity_count": 0,
        },
        "health": "excellent",
    }


def test_health_unauthenticated(client: TestClient):
    """GET /api/v1/health succeeds without authentication."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "version" in data


def test_ingest_new_record_returns_202(client: TestClient, valid_token: str, dev_tenant_id: str):
    """Brand-new (tenant_id, payload_id) is durably committed and returns 202 Accepted with duplicate=False."""
    payload = build_valid_payload(tenant_id=dev_tenant_id)
    headers = {"Authorization": f"Bearer {valid_token}"}

    response = client.post("/api/v1/ingest", json=payload, headers=headers)
    assert response.status_code == 202
    assert response.headers["content-type"].startswith("application/json")

    data = response.json()
    assert data["status"] == "accepted"
    assert data["duplicate"] is False
    assert data["payload_id"] == payload["payload_id"]
    assert data["tenant_id"] == dev_tenant_id
    assert "ingested_at" in data
    assert data["ingested_at"].endswith("Z")


def test_ingest_duplicate_identical_payload_returns_200(client: TestClient, valid_token: str, dev_tenant_id: str):
    """Resending the exact same payload returns 200 OK with duplicate=True and preserves ingested_at."""
    payload = build_valid_payload(tenant_id=dev_tenant_id)
    headers = {"Authorization": f"Bearer {valid_token}"}

    # First request -> 202
    first_res = client.post("/api/v1/ingest", json=payload, headers=headers)
    assert first_res.status_code == 202
    first_data = first_res.json()
    assert first_data["duplicate"] is False
    original_ingested_at = first_data["ingested_at"]

    # Second identical request -> 200
    second_res = client.post("/api/v1/ingest", json=payload, headers=headers)
    assert second_res.status_code == 200
    second_data = second_res.json()
    assert second_data["status"] == "accepted"
    assert second_data["duplicate"] is True
    assert second_data["payload_id"] == payload["payload_id"]
    assert second_data["tenant_id"] == dev_tenant_id
    assert second_data["ingested_at"] == original_ingested_at


def test_ingest_idempotency_conflict_returns_409(client: TestClient, valid_token: str, dev_tenant_id: str):
    """Reusing payload_id with altered content returns 409 Conflict with RFC 7807 problem+json."""
    payload_id = str(uuid.uuid4())
    payload1 = build_valid_payload(tenant_id=dev_tenant_id, payload_id=payload_id, service="auth-service")
    headers = {"Authorization": f"Bearer {valid_token}"}

    res1 = client.post("/api/v1/ingest", json=payload1, headers=headers)
    assert res1.status_code == 202

    # Modified payload with same payload_id and tenant_id
    payload2 = build_valid_payload(tenant_id=dev_tenant_id, payload_id=payload_id, service="payment-service")
    res2 = client.post("/api/v1/ingest", json=payload2, headers=headers)
    assert res2.status_code == 409
    assert res2.headers["content-type"].startswith("application/problem+json")

    err = res2.json()
    assert err["code"] == "idempotency_conflict"
    assert err["status"] == 409
    assert "request_id" in err


def test_ingest_missing_auth_header_returns_401(client: TestClient, dev_tenant_id: str):
    """Missing Authorization header returns 401 unauthenticated with RFC 7807 problem+json."""
    payload = build_valid_payload(tenant_id=dev_tenant_id)
    response = client.post("/api/v1/ingest", json=payload)
    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/problem+json")

    err = response.json()
    assert err["code"] == "unauthenticated"
    assert err["status"] == 401
    assert "request_id" in err


def test_ingest_invalid_token_returns_401(client: TestClient, dev_tenant_id: str):
    """Invalid bearer token returns 401 unauthenticated."""
    payload = build_valid_payload(tenant_id=dev_tenant_id)
    headers = {"Authorization": "Bearer completely-bogus-token-xyz"}
    response = client.post("/api/v1/ingest", json=payload, headers=headers)
    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/problem+json")

    err = response.json()
    assert err["code"] == "unauthenticated"
    assert err["status"] == 401


def test_ingest_tenant_mismatch_returns_403(client: TestClient, valid_token: str):
    """Valid token for dev tenant attempting to ingest for different tenant returns 403 tenant_mismatch."""
    payload = build_valid_payload(tenant_id="tenant-unauthorized-target")
    headers = {"Authorization": f"Bearer {valid_token}"}

    response = client.post("/api/v1/ingest", json=payload, headers=headers)
    assert response.status_code == 403
    assert response.headers["content-type"].startswith("application/problem+json")

    err = response.json()
    assert err["code"] == "tenant_mismatch"
    assert err["status"] == 403
    assert "request_id" in err


def test_ingest_registered_token_multi_tenant(client: TestClient):
    """Custom registered token resolves to its own tenant context properly."""
    custom_token = f"token-test-{uuid.uuid4().hex[:8]}"
    custom_tenant = f"tenant-{uuid.uuid4().hex[:6]}"
    register_token(custom_token, custom_tenant, "collector-custom")

    payload = build_valid_payload(tenant_id=custom_tenant)
    headers = {"Authorization": f"Bearer {custom_token}"}

    response = client.post("/api/v1/ingest", json=payload, headers=headers)
    assert response.status_code == 202
    assert response.json()["tenant_id"] == custom_tenant


def test_ingest_extra_field_forbidden_returns_422(client: TestClient, valid_token: str, dev_tenant_id: str):
    """Payload with forbidden extra fields (e.g. raw logs or unapproved metadata) returns 422 invalid_payload."""
    payload = build_valid_payload(tenant_id=dev_tenant_id)
    payload["raw_logs"] = "FATAL error in user transaction database"
    headers = {"Authorization": f"Bearer {valid_token}"}

    response = client.post("/api/v1/ingest", json=payload, headers=headers)
    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")

    err = response.json()
    assert err["code"] == "invalid_payload"
    assert err["status"] == 422


def test_ingest_metrics_bounds_validation_returns_422(client: TestClient, valid_token: str, dev_tenant_id: str):
    """Metrics with values outside schema bounds (e.g. cpu_percent > 100) return 422."""
    payload = build_valid_payload(tenant_id=dev_tenant_id, cpu_percent=150.0)
    headers = {"Authorization": f"Bearer {valid_token}"}

    response = client.post("/api/v1/ingest", json=payload, headers=headers)
    assert response.status_code == 422
    err = response.json()
    assert err["code"] == "invalid_payload"


def test_ingest_invalid_event_time_format_returns_422(client: TestClient, valid_token: str, dev_tenant_id: str):
    """event_time not ending in 'Z' or invalid datetime string returns 422."""
    payload = build_valid_payload(tenant_id=dev_tenant_id)
    payload["event_time"] = "2026-01-12T08:31:11+00:00"  # Missing 'Z'
    headers = {"Authorization": f"Bearer {valid_token}"}

    response = client.post("/api/v1/ingest", json=payload, headers=headers)
    assert response.status_code == 422
    err = response.json()
    assert err["code"] == "invalid_payload"


def test_ingest_empty_metrics_returns_422(client: TestClient, valid_token: str, dev_tenant_id: str):
    """Empty metrics object (minProperties: 1) returns 422."""
    payload = build_valid_payload(tenant_id=dev_tenant_id)
    payload["metrics"] = {}
    headers = {"Authorization": f"Bearer {valid_token}"}

    response = client.post("/api/v1/ingest", json=payload, headers=headers)
    assert response.status_code == 422
    err = response.json()
    assert err["code"] == "invalid_payload"


def test_ingest_invalid_health_enum_returns_422(client: TestClient, valid_token: str, dev_tenant_id: str):
    """Invalid health enum value returns 422."""
    payload = build_valid_payload(tenant_id=dev_tenant_id)
    payload["health"] = "critical"  # Valid are excellent, good, fair, poor
    headers = {"Authorization": f"Bearer {valid_token}"}

    response = client.post("/api/v1/ingest", json=payload, headers=headers)
    assert response.status_code == 422
    err = response.json()
    assert err["code"] == "invalid_payload"


def test_ingest_malformed_json_returns_400(client: TestClient, valid_token: str):
    """Malformed JSON syntax returns 400 invalid_json."""
    headers = {
        "Authorization": f"Bearer {valid_token}",
        "Content-Type": "application/json",
    }
    response = client.post("/api/v1/ingest", content=b"{not valid json...", headers=headers)
    assert response.status_code == 400
    assert response.headers["content-type"].startswith("application/problem+json")
    err = response.json()
    assert err["code"] == "invalid_json"
    assert err["status"] == 400
