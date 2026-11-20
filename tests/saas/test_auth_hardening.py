from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from fastapi import Response
from pydantic import SecretStr, ValidationError
import pytest
from starlette.requests import Request

from saas.api.errors import ProblemException
from saas.api.main import app
from saas.config import Settings
from saas.database.repository import record_telemetry
from saas.ingestion.schemas import TelemetryPayload
from saas.tenancy import auth
from saas.tenancy.auth import TenantContext


def settings(
    *,
    environment: str = "production",
    tenant_id: str | None = "tenant-configured",
    collector_id: str | None = "collector-configured",
    dev_token: str | None = None,
    dashboard_dev_token: str | None = None,
    collector_token: str | None = "configured-collector-token",
) -> SimpleNamespace:
    return SimpleNamespace(
        aegisops_env=environment,
        collector_tenant_id=tenant_id,
        collector_id=collector_id,
        saas_dev_token=SecretStr(dev_token) if dev_token is not None else None,
        saas_dashboard_dev_token=(SecretStr(dashboard_dev_token) if dashboard_dev_token is not None else None),
        collector_bearer_token=(
            SecretStr(collector_token) if collector_token is not None else None
        ),
    )


@pytest.fixture(autouse=True)
def clear_registered_tokens():
    auth._STATIC_TOKEN_MAP.clear()
    yield
    auth._STATIC_TOKEN_MAP.clear()


def test_known_development_fallback_tokens_are_rejected_in_production(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: settings())

    for known_token in ("dev-secret-token-12345", "development-token"):
        with pytest.raises(ProblemException) as raised:
            auth.resolve_token(known_token)
        assert raised.value.status_code == 401


def test_default_settings_fail_closed_without_an_environment_file(monkeypatch):
    monkeypatch.delenv("AEGISOPS_ENV", raising=False)
    configured = Settings(
        _env_file=None,
        SAAS_DATABASE_URL="postgresql+psycopg://test:test@localhost:5432/aegisops_test",
        SAAS_CORS_ORIGINS="https://dashboard.example.test",
        DASHBOARD_COOKIE_SECURE=True,
        DASHBOARD_COOKIE_SAMESITE="none",
    )
    assert configured.aegisops_env == "production"
    assert configured.saas_dev_token is None
    assert configured.saas_dashboard_dev_token is None
    assert configured.collector_bearer_token is None
    assert configured.collector_tenant_id is None
    assert configured.collector_id is None

    monkeypatch.setattr(auth, "get_settings", lambda: configured)
    with pytest.raises(ProblemException) as raised:
        auth.resolve_token("dev-secret-token-12345")
    assert raised.value.status_code == 401


@pytest.mark.parametrize(
    "configured",
    [
        settings(collector_token=None),
        settings(tenant_id=None),
        settings(collector_id=None),
    ],
)
def test_missing_production_credentials_or_identity_fail_closed(monkeypatch, configured):
    monkeypatch.setattr(auth, "get_settings", lambda: configured)

    with pytest.raises(ProblemException) as raised:
        auth.resolve_token("any-presented-token")
    assert raised.value.status_code == 401


def test_valid_configured_production_credential_resolves_both_identities(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: settings())

    context = auth.resolve_token("configured-collector-token")

    assert context == TenantContext("tenant-configured", "collector-configured")
    assert not hasattr(context, "token")


def test_production_credentials_load_from_environment(monkeypatch):
    monkeypatch.setenv("AEGISOPS_ENV", "production")
    monkeypatch.setenv("COLLECTOR_TENANT_ID", "tenant-from-env")
    monkeypatch.setenv("COLLECTOR_ID", "collector-from-env")
    monkeypatch.setenv("COLLECTOR_BEARER_TOKEN", "credential-from-env")
    monkeypatch.setenv("SAAS_DATABASE_URL", "postgresql+psycopg://test:test@localhost:5432/aegisops_test")
    monkeypatch.setenv("SAAS_CORS_ORIGINS", "https://dashboard.example.test")
    monkeypatch.setenv("DASHBOARD_COOKIE_SECURE", "true")
    monkeypatch.setenv("DASHBOARD_COOKIE_SAMESITE", "none")
    configured = Settings(_env_file=None)
    monkeypatch.setattr(auth, "get_settings", lambda: configured)

    context = auth.resolve_token("credential-from-env")

    assert context == TenantContext("tenant-from-env", "collector-from-env")


def test_invalid_production_credential_returns_generic_401_without_echo(monkeypatch):
    presented = "incorrect-sensitive-token-value"
    monkeypatch.setattr(auth, "get_settings", lambda: settings())

    with pytest.raises(ProblemException) as raised:
        auth.resolve_token(presented)

    assert raised.value.status_code == 401
    assert raised.value.code == "unauthenticated"
    assert presented not in raised.value.detail


def test_development_auth_requires_an_explicit_environment_credential(monkeypatch):
    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: settings(environment="development", collector_token=None),
    )
    with pytest.raises(ProblemException):
        auth.resolve_token("dev-secret-token-12345")

    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: settings(
            environment="development",
            dev_token="locally-configured-token",
            collector_token=None,
        ),
    )
    context = auth.resolve_token("locally-configured-token")
    assert context == TenantContext("tenant-configured", "collector-configured")


def _request_with_bearer(token: str) -> Request:
    return Request({
        "type": "http",
        "method": "GET",
        "path": "/api/v1/services",
        "headers": [(b"authorization", f"Bearer {token}".encode())],
        "query_string": b"",
        "server": ("test", 80),
        "client": ("test", 1),
        "scheme": "http",
    })


def test_production_collector_credential_cannot_authenticate_dashboard_reads(monkeypatch):
    monkeypatch.setattr(auth, "get_settings", lambda: settings())

    with pytest.raises(ProblemException) as raised:
        auth.get_dashboard_tenant(_request_with_bearer("configured-collector-token"))

    assert raised.value.status_code == 401
    assert raised.value.code == "unauthenticated"


def test_dashboard_reads_accept_explicit_development_token_only(monkeypatch):
    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: settings(environment="development", dashboard_dev_token="locally-configured-dashboard-token", collector_token=None),
    )

    context = auth.get_dashboard_tenant(_request_with_bearer("locally-configured-dashboard-token"))
    assert context == TenantContext("tenant-configured", "collector-configured")


def test_collector_development_token_is_not_accepted_for_dashboard_reads(monkeypatch):
    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: settings(environment="development", dev_token="local-collector-token", dashboard_dev_token=None, collector_token=None),
    )

    with pytest.raises(ProblemException) as raised:
        auth.get_dashboard_tenant(_request_with_bearer("local-collector-token"))

    assert raised.value.status_code == 401
    assert raised.value.code == "unauthenticated"


@pytest.mark.parametrize("delivery_setting", ["SAAS_DEV_TOKEN", "COLLECTOR_BEARER_TOKEN"])
def test_dashboard_development_credential_must_differ_from_delivery_credentials(delivery_setting):
    shared_value = "sensitive-test-credential"
    values = {delivery_setting: shared_value}
    with pytest.raises(ValidationError) as raised:
        Settings(
            _env_file=None,
            **values,
            SAAS_DASHBOARD_DEV_TOKEN=shared_value,
        )
    assert shared_value not in str(raised.value)


def test_in_memory_token_registration_is_test_only(monkeypatch):
    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: settings(environment="development", collector_token=None),
    )
    with pytest.raises(RuntimeError):
        auth.register_token("local-memory-token", "tenant-a", "collector-a")

    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: settings(environment="test", collector_token=None),
    )
    auth.register_token("test-memory-token", "tenant-a", "collector-a")
    assert auth.resolve_token("test-memory-token") == TenantContext("tenant-a", "collector-a")


def valid_payload(
    *, tenant_id: str = "tenant-configured", collector_id: str = "collector-configured"
) -> TelemetryPayload:
    return TelemetryPayload.model_validate(
        {
            "schema_version": "1.0.0",
            "payload_id": str(uuid4()),
            "tenant_id": tenant_id,
            "collector_id": collector_id,
            "event_time": "2026-01-01T00:00:00Z",
            "service": "svc-test",
            "environment": "test",
            "metrics": {"cpu_percent": 20.0},
            "security": {"failed_login_count": 0},
            "health": "good",
        }
    )


def ingest_endpoint():
    return next(
        route.endpoint
        for route in app.routes
        if getattr(route, "path", None) == "/api/v1/ingest"
    )


def test_ingest_rejects_tenant_mismatch_without_echoing_identity():
    with pytest.raises(ProblemException) as raised:
        record_telemetry(
            session=object(),
            payload=valid_payload(tenant_id="other-tenant"),
            authenticated_tenant_id="tenant-configured",
            authenticated_collector_id="collector-configured",
        )

    assert raised.value.status_code == 403
    assert raised.value.code == "tenant_mismatch"
    assert "other-tenant" not in raised.value.detail


def test_ingest_rejects_collector_mismatch_without_echoing_identity():
    with pytest.raises(ProblemException) as raised:
        record_telemetry(
            session=object(),
            payload=valid_payload(collector_id="other-collector"),
            authenticated_tenant_id="tenant-configured",
            authenticated_collector_id="collector-configured",
        )

    assert raised.value.status_code == 403
    assert raised.value.code == "collector_mismatch"
    assert "other-collector" not in raised.value.detail


def test_ingest_route_passes_authenticated_tenant_and_collector_to_repository(monkeypatch):
    route = ingest_endpoint()
    auth_context = TenantContext("tenant-from-token", "collector-from-token")

    def reject_based_on_context(**kwargs):
        assert kwargs["authenticated_tenant_id"] == auth_context.tenant_id
        assert kwargs["authenticated_collector_id"] == auth_context.collector_id
        raise ProblemException(
            status_code=403,
            code="collector_mismatch",
            title="Forbidden",
            detail="Payload collector does not match the authenticated credential.",
        )

    monkeypatch.setattr("saas.api.main.record_telemetry", reject_based_on_context)
    with pytest.raises(ProblemException) as raised:
        route(
            payload=valid_payload(),
            response=Response(),
            auth=auth_context,
            db=object(),
        )

    assert raised.value.code == "collector_mismatch"
