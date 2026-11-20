"""Authentication-derived tenant context and isolation."""

from dataclasses import dataclass
import hmac
from typing import Optional

from fastapi import Depends, Request
from pydantic import SecretStr
from sqlalchemy.orm import Session

from saas.api.errors import ProblemException
from saas.config import get_settings
from saas.database.session import get_db
from saas.tenancy.dashboard_auth import DashboardContext, authenticate_dashboard_session


@dataclass(frozen=True)
class TenantContext:
    tenant_id: str
    collector_id: str


# In-memory credential mappings are used only by isolated SaaS tests.
_STATIC_TOKEN_MAP: dict[str, tuple[str, str]] = {}


def register_token(token: str, tenant_id: str, collector_id: str) -> None:
    """Register an in-memory token mapping for tests only."""
    if get_settings().aegisops_env.lower() != "test":
        raise RuntimeError("in-memory token registration is available only in tests")
    if not token or not tenant_id or not collector_id:
        raise ValueError("token, tenant ID, and collector ID must be configured")
    _STATIC_TOKEN_MAP[token] = (tenant_id, collector_id)


def _secret_value(value: SecretStr | str | None) -> str | None:
    if isinstance(value, SecretStr):
        return value.get_secret_value()
    return value


def _matches(token: str, configured: SecretStr | str | None) -> bool:
    expected = _secret_value(configured)
    return bool(expected and hmac.compare_digest(token, expected))


def _configured_identity(settings: object) -> tuple[str, str] | None:
    tenant_id = getattr(settings, "collector_tenant_id", None)
    collector_id = getattr(settings, "collector_id", None)
    if not isinstance(tenant_id, str) or not tenant_id.strip():
        return None
    if not isinstance(collector_id, str) or not collector_id.strip():
        return None
    return tenant_id.strip(), collector_id.strip()


def resolve_token(token: str, request_id: Optional[str] = None) -> TenantContext:
    """Resolve a Bearer token to a TenantContext, or raise 401 unauthenticated."""
    settings = get_settings()
    environment = settings.aegisops_env.lower()
    identity = _configured_identity(settings)

    # In-memory mappings exist only for isolated tests, never for local or production auth.
    if environment == "test":
        for registered_token, (tenant_id, collector_id) in _STATIC_TOKEN_MAP.items():
            if hmac.compare_digest(token, registered_token):
                return TenantContext(tenant_id=tenant_id, collector_id=collector_id)

    # Local development requires an explicitly configured environment token and IDs.
    if environment == "development":
        if identity and _matches(token, settings.saas_dev_token):
            return TenantContext(tenant_id=identity[0], collector_id=identity[1])

    # Production authentication requires a configured token and both bound IDs.
    if identity and _matches(token, settings.collector_bearer_token):
        return TenantContext(tenant_id=identity[0], collector_id=identity[1])

    raise ProblemException(
        status_code=401,
        code="unauthenticated",
        title="Unauthorized",
        detail="Invalid or expired bearer token.",
        request_id=request_id,
    )


def get_current_tenant(request: Request) -> TenantContext:
    """FastAPI dependency to extract and validate Bearer token from request headers."""
    request_id = getattr(request.state, "request_id", None)
    return resolve_token(_extract_bearer_token(request, request_id), request_id=request_id)


def _extract_bearer_token(request: Request, request_id: str | None) -> str:
    auth_header = request.headers.get("authorization")
    if not auth_header:
        raise ProblemException(401, "unauthenticated", "Unauthorized", "Missing Authorization header.", request_id=request_id)
    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise ProblemException(401, "unauthenticated", "Unauthorized", "Invalid Authorization header format.", request_id=request_id)
    token = parts[1].strip()
    if not token:
        raise ProblemException(401, "unauthenticated", "Unauthorized", "Bearer token cannot be empty.", request_id=request_id)
    return token


def get_dashboard_tenant(request: Request, db: Session = Depends(get_db)) -> DashboardContext | TenantContext:
    """Resolve dashboard scope from a session, or the explicit local-only dev token."""
    settings = get_settings()
    if request.cookies.get("aegisops_session"):
        context, _user, _session = authenticate_dashboard_session(request, db)
        return context
    if settings.aegisops_env.lower() not in {"development", "test"}:
        raise ProblemException(
            status_code=401,
            code="unauthenticated",
            title="Unauthorized",
            detail="Sign in is required.",
            request_id=getattr(request.state, "request_id", None),
        )
    request_id = getattr(request.state, "request_id", None)
    token = _extract_bearer_token(request, request_id)
    if settings.aegisops_env.lower() == "test":
        return resolve_token(token, request_id=request_id)
    identity = _configured_identity(settings)
    if identity and _matches(token, settings.saas_dashboard_dev_token):
        return TenantContext(tenant_id=identity[0], collector_id=identity[1])
    raise ProblemException(
        status_code=401,
        code="unauthenticated",
        title="Unauthorized",
        detail="Invalid or expired dashboard credential.",
        request_id=request_id,
    )
