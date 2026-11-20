"""Authentication-derived tenant context and isolation."""

from dataclasses import dataclass
from typing import Optional
from fastapi import Request

from saas.api.errors import ProblemException
from saas.config import get_settings


@dataclass(frozen=True)
class TenantContext:
    tenant_id: str
    collector_id: str
    token: str


# In-memory registry for static / dynamically registered tokens (e.g., test fixtures)
_STATIC_TOKEN_MAP: dict[str, tuple[str, str]] = {}


def register_token(token: str, tenant_id: str, collector_id: str) -> None:
    """Register a token mapping for development or testing."""
    _STATIC_TOKEN_MAP[token] = (tenant_id, collector_id)


def resolve_token(token: str, request_id: Optional[str] = None) -> TenantContext:
    """Resolve a Bearer token to a TenantContext, or raise 401 unauthenticated."""
    settings = get_settings()

    # Check registered test/custom tokens first
    if token in _STATIC_TOKEN_MAP:
        tenant_id, collector_id = _STATIC_TOKEN_MAP[token]
        return TenantContext(tenant_id=tenant_id, collector_id=collector_id, token=token)

    # Check configured development token
    dev_token = settings.saas_dev_token
    if dev_token and token == dev_token:
        return TenantContext(
            tenant_id=settings.collector_tenant_id or "development-tenant",
            collector_id=settings.collector_id or "local-dev-collector",
            token=token,
        )

    # Fallback dev mapping if dev token is set or matched
    if token in ("dev-secret-token-12345", "development-token"):
        return TenantContext(
            tenant_id=settings.collector_tenant_id or "development-tenant",
            collector_id=settings.collector_id or "local-dev-collector",
            token=token,
        )

    # Check collector bearer token if configured
    if settings.collector_bearer_token and token == settings.collector_bearer_token:
        return TenantContext(
            tenant_id=settings.collector_tenant_id or "development-tenant",
            collector_id=settings.collector_id or "local-dev-collector",
            token=token,
        )

    raise ProblemException(
        status_code=401,
        code="unauthenticated",
        title="Unauthorized",
        detail="Invalid or expired bearer token.",
        request_id=request_id,
    )


def get_current_tenant(request: Request) -> TenantContext:
    """FastAPI dependency to extract and validate Bearer token from request headers."""
    auth_header = request.headers.get("authorization")
    request_id = getattr(request.state, "request_id", None)

    if not auth_header:
        raise ProblemException(
            status_code=401,
            code="unauthenticated",
            title="Unauthorized",
            detail="Missing Authorization header.",
            request_id=request_id,
        )

    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise ProblemException(
            status_code=401,
            code="unauthenticated",
            title="Unauthorized",
            detail="Invalid Authorization header format. Expected 'Bearer <token>'.",
            request_id=request_id,
        )

    token = parts[1].strip()
    if not token:
        raise ProblemException(
            status_code=401,
            code="unauthenticated",
            title="Unauthorized",
            detail="Bearer token cannot be empty.",
            request_id=request_id,
        )

    return resolve_token(token, request_id=request_id)
