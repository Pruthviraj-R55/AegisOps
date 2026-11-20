from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import uuid

from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
import pytest

from saas.api.main import app
from saas.config import Settings
from saas.database.models import DashboardLoginThrottle, DashboardSession, DashboardUser, IncidentAnalysis, IncidentRecord
from saas.database.session import SessionLocal
from saas.tenancy.dashboard_auth import hash_password

DEV_ORIGIN = "http://localhost:5173"
PASSWORD = "safe-test-password-123"


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        with SessionLocal() as db:
            db.query(DashboardLoginThrottle).delete(synchronize_session=False)
            db.commit()
        yield test_client


def provision_user(tenant: str | None = None, email: str | None = None, *, active: bool = True) -> DashboardUser:
    now = datetime.now(timezone.utc)
    user = DashboardUser(
        user_id=str(uuid.uuid4()),
        tenant_id=tenant or f"tenant-{uuid.uuid4().hex}",
        email=email or f"{uuid.uuid4().hex}@example.test",
        password_hash=hash_password(PASSWORD),
        is_active=active,
        created_at=now,
        updated_at=now,
    )
    with SessionLocal() as db:
        db.add(user)
        db.commit()
        db.refresh(user)
        return user


def login(client: TestClient, user: DashboardUser, password: str = PASSWORD):
    return client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password},
        headers={"Origin": DEV_ORIGIN},
    )


def test_valid_login_uses_scrypt_and_persists_only_session_hash(client: TestClient):
    user = provision_user()
    response = login(client, user)
    assert response.status_code == 200
    assert response.json()["authenticated"] is True
    assert response.json()["user_id"] == user.user_id
    assert response.json()["csrf_token"]
    session_token = response.cookies.get("aegisops_session")
    assert session_token
    with SessionLocal() as db:
        stored_user = db.query(DashboardUser).filter_by(user_id=user.user_id).one()
        stored_session = db.query(DashboardSession).filter_by(user_id=user.user_id).one()
        assert stored_user.password_hash.startswith("scrypt$")
        assert stored_user.password_hash != PASSWORD
        assert stored_session.token_hash == hashlib.sha256(session_token.encode()).hexdigest()
        assert stored_session.token_hash != session_token


def test_invalid_and_disabled_users_receive_safe_unauthorized(client: TestClient):
    user = provision_user()
    invalid = login(client, user, "wrong-password")
    assert invalid.status_code == 401
    assert invalid.json()["code"] == "invalid_credentials"
    assert "wrong-password" not in invalid.text

    disabled = provision_user(active=False)
    rejected = login(client, disabled)
    assert rejected.status_code == 401
    assert rejected.json()["code"] == "invalid_credentials"


def test_login_attempts_are_database_throttled(client: TestClient):
    user = provision_user()
    for _ in range(5):
        assert login(client, user, "incorrect-password").status_code == 401
    limited = login(client, user, "incorrect-password")
    assert limited.status_code == 429
    assert limited.json()["code"] == "login_rate_limited"


def test_session_validates_and_expires(client: TestClient):
    user = provision_user()
    accepted = login(client, user)
    assert accepted.status_code == 200
    csrf = accepted.json()["csrf_token"]
    session_response = client.get("/api/v1/auth/session")
    assert session_response.status_code == 200
    assert session_response.json()["csrf_token"] == csrf

    with SessionLocal() as db:
        row = db.query(DashboardSession).filter_by(user_id=user.user_id).one()
        row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    expired = client.get("/api/v1/auth/session")
    assert expired.status_code == 401


def test_logout_requires_csrf_and_invalidates_the_server_session(client: TestClient):
    user = provision_user()
    accepted = login(client, user)
    csrf = accepted.json()["csrf_token"]
    blocked = client.post("/api/v1/auth/logout", headers={"Origin": DEV_ORIGIN})
    assert blocked.status_code == 403
    assert blocked.json()["code"] == "csrf_failed"

    logged_out = client.post(
        "/api/v1/auth/logout",
        headers={"Origin": DEV_ORIGIN, "X-CSRF-Token": csrf},
    )
    assert logged_out.status_code == 200
    assert logged_out.json()["logged_out"] is True
    assert client.get("/api/v1/auth/session").status_code == 401
    with SessionLocal() as db:
        row = db.query(DashboardSession).filter_by(user_id=user.user_id).one()
        assert row.revoked_at is not None


def test_cookie_authenticated_dashboard_reads_are_tenant_scoped(client: TestClient):
    tenant_a = f"tenant-{uuid.uuid4().hex}"
    tenant_b = f"tenant-{uuid.uuid4().hex}"
    user_a = provision_user(tenant_a)
    user_b = provision_user(tenant_b)
    incident_id = f"inc-{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        db.add(IncidentRecord(
            tenant_id=tenant_a, incident_id=incident_id, service="svc", severity="critical", status="active",
            started_at=now, last_seen_at=now, contributing_signals=[], confidence=0.9,
            recommended_action="review", rollback_plan="rollback",
        ))
        db.flush()
        db.add(IncidentAnalysis(
            tenant_id=tenant_a, incident_id=incident_id, status="failed", provider="openrouter", model="model",
            prompt_version="v1", prompt_hash="a" * 64, evidence_ids=[], result=None, created_at=now,
            updated_at=now, completed_at=now, safe_error_code="provider_timeout",
        ))
        db.commit()

    assert login(client, user_b).status_code == 200
    incidents = client.get("/api/v1/incidents")
    assert incidents.status_code == 200
    assert incident_id not in incidents.text
    for path in (
        "/api/v1/dashboard/overview", "/api/v1/services", "/api/v1/telemetry",
        "/api/v1/security-events", "/api/v1/collectors",
    ):
        scoped = client.get(path)
        assert scoped.status_code == 200
        assert incident_id not in scoped.text
    assert client.get(f"/api/v1/incidents/{incident_id}/evidence").status_code == 404
    assert client.get(f"/api/v1/incidents/{incident_id}/analysis").status_code == 404
    retry = client.post(
        f"/api/v1/incidents/{incident_id}/analysis/retry",
        headers={"Origin": DEV_ORIGIN, "X-CSRF-Token": client.cookies.get("aegisops_csrf", "")},
    )
    assert retry.status_code == 404
    assert login(client, user_a).status_code == 200
    assert client.get(f"/api/v1/incidents/{incident_id}/analysis").status_code == 200


def test_collector_and_saas_tokens_cannot_create_dashboard_sessions(client: TestClient):
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "collector-token", "password": "configured-collector-token"},
        headers={"Origin": DEV_ORIGIN, "Authorization": "Bearer configured-collector-token"},
    )
    assert response.status_code == 401
    assert response.json()["code"] == "invalid_credentials"


def test_production_session_cookies_are_secure_and_https_is_required(client: TestClient, monkeypatch):
    production = Settings(
        _env_file=None,
        AEGISOPS_ENV="production",
        SAAS_DATABASE_URL="postgresql+psycopg://test:test@localhost:5432/aegisops_test",
        SAAS_CORS_ORIGINS="https://dashboard.example.test",
        DASHBOARD_COOKIE_SECURE=True,
        DASHBOARD_COOKIE_SAMESITE="none",
    )
    monkeypatch.setattr("saas.api.main.get_settings", lambda: production)
    user = provision_user()
    response = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": PASSWORD},
        headers={"Origin": "https://dashboard.example.test"},
    )
    assert response.status_code == 400  # TestClient uses HTTP; production requires HTTPS.

    with TestClient(app, base_url="https://api.example.test") as secure_client:
        secure_response = secure_client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
            headers={"Origin": "https://dashboard.example.test"},
        )
    assert secure_response.status_code == 200
    session_cookie = next(value for value in secure_response.headers.get_list("set-cookie") if value.startswith("aegisops_session="))
    csrf_cookie = next(value for value in secure_response.headers.get_list("set-cookie") if value.startswith("aegisops_csrf="))
    assert "secure" in session_cookie.lower()
    assert "httponly" in session_cookie.lower()
    assert "samesite=none" in session_cookie.lower()
    assert "secure" in csrf_cookie.lower()
    assert "httponly" not in csrf_cookie.lower()


def test_production_dashboard_without_session_is_unauthenticated(client: TestClient, monkeypatch):
    production = Settings(
        _env_file=None,
        AEGISOPS_ENV="production",
        SAAS_DATABASE_URL="postgresql+psycopg://test:test@localhost:5432/aegisops_test",
        SAAS_CORS_ORIGINS="https://dashboard.example.test",
        DASHBOARD_COOKIE_SECURE=True,
        DASHBOARD_COOKIE_SAMESITE="none",
    )
    monkeypatch.setattr("saas.api.main.get_settings", lambda: production)
    monkeypatch.setattr("saas.tenancy.auth.get_settings", lambda: production)
    with TestClient(app, base_url="https://api.example.test") as secure_client:
        response = secure_client.get("/api/v1/incidents")
    assert response.status_code == 401


def test_production_auth_configuration_rejects_http_and_insecure_cookies():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, AEGISOPS_ENV="production")
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None, AEGISOPS_ENV="production", SAAS_CORS_ORIGINS="https://dashboard.example.test",
            DASHBOARD_COOKIE_SECURE=True, DASHBOARD_COOKIE_SAMESITE="none",
        )
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None, AEGISOPS_ENV="production", SAAS_CORS_ORIGINS="http://dashboard.example.test",
            DASHBOARD_COOKIE_SECURE=True, DASHBOARD_COOKIE_SAMESITE="none",
        )
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None, AEGISOPS_ENV="production", SAAS_CORS_ORIGINS="https://dashboard.example.test",
            DASHBOARD_COOKIE_SECURE=False, DASHBOARD_COOKIE_SAMESITE="lax",
        )
    Settings(
        _env_file=None, AEGISOPS_ENV="production", SAAS_DATABASE_URL="postgresql+psycopg://user:opaque@db.example.test/aegisops",
        SAAS_CORS_ORIGINS="https://dashboard.example.test", DASHBOARD_COOKIE_SECURE=True,
        DASHBOARD_COOKIE_SAMESITE="none",
    )
    with pytest.raises(ValidationError):
        Settings(_env_file=None, AEGISOPS_ENV="test", SAAS_CORS_ORIGINS="*")


def test_cors_allows_only_explicit_configured_origins(client: TestClient):
    allowed = client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": DEV_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert allowed.headers.get("access-control-allow-origin") == DEV_ORIGIN
    assert allowed.headers.get("access-control-allow-credentials") == "true"
    denied = client.options(
        "/api/v1/auth/login",
        headers={"Origin": "https://attacker.example", "Access-Control-Request-Method": "POST"},
    )
    assert denied.headers.get("access-control-allow-origin") is None
