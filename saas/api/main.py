"""AegisOps central SaaS FastAPI application."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hmac
import secrets
import uuid
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException
from pydantic import BaseModel, ConfigDict, Field

from saas.api.errors import ProblemException, problem_response
from saas.api.routes.dashboard import router as dashboard_router
from saas.config import get_settings
from saas.database import Base, engine, format_rfc3339_z, get_db, record_telemetry
from saas.ingestion.schemas import IngestionResponse, TelemetryPayload
from saas.tenancy.auth import TenantContext, get_current_tenant
from saas.database.models import DashboardUser, DashboardSession
from saas.tenancy.auth import get_dashboard_tenant
from saas.tenancy.dashboard_auth import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    authenticate_dashboard_session,
    clear_login_failures,
    login_is_throttled,
    make_login_attempt_keys,
    new_session,
    normalize_email,
    record_failed_login,
    token_hash,
    verify_password,
)


class DashboardLoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=1024)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Keep create_all for local development; deploy schema through Alembic."""
    if get_settings().aegisops_env.lower() in {"development", "test"}:
        Base.metadata.create_all(bind=engine)
    yield


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="AegisOps SaaS API",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # CORS configuration
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().allowed_cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Accept", "Authorization", "Content-Type", "X-CSRF-Token", "X-Request-ID"],
    )

    # Request ID and tracking middleware
    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        req_id = request.headers.get("x-request-id") or f"req-{uuid.uuid4().hex[:12]}"
        request.state.request_id = req_id
        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response

    @app.middleware("http")
    async def require_https_in_production(request: Request, call_next):
        if get_settings().aegisops_env.lower() == "production" and request.url.scheme != "https":
            return problem_response(
                status_code=400, code="https_required", title="HTTPS required",
                detail="This API requires HTTPS.", request_id=getattr(request.state, "request_id", None),
            )
        return await call_next(request)

    # Exception Handlers conforming to RFC 7807 problem+json
    @app.exception_handler(ProblemException)
    def handle_problem_exception(request: Request, exc: ProblemException):
        req_id = getattr(request.state, "request_id", None) or exc.request_id
        return problem_response(
            status_code=exc.status_code,
            code=exc.code,
            title=exc.title,
            detail=exc.detail,
            type_=exc.type_,
            request_id=req_id,
        )

    @app.exception_handler(RequestValidationError)
    def handle_validation_error(request: Request, exc: RequestValidationError):
        req_id = getattr(request.state, "request_id", None)
        # Distinguish malformed JSON syntax from schema validation failure
        errors = exc.errors()
        is_json_syntax_error = any(
            err.get("type") == "json_invalid" for err in errors
        )
        if is_json_syntax_error:
            return problem_response(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="invalid_json",
                title="Invalid JSON",
                detail="Request body contains malformed JSON syntax.",
                request_id=req_id,
            )

        return problem_response(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="invalid_payload",
            title="Validation failed",
            detail="The metadata record does not match schema version 1.0.0.",
            request_id=req_id,
        )

    @app.exception_handler(StarletteHTTPException)
    def handle_http_exception(request: Request, exc: StarletteHTTPException):
        req_id = getattr(request.state, "request_id", None)
        status_code = exc.status_code
        code_map = {
            400: "invalid_json",
            401: "unauthenticated",
            403: "forbidden",
            404: "not_found",
            409: "conflict",
            422: "invalid_payload",
            429: "rate_limited",
            500: "internal_error",
            503: "temporarily_unavailable",
        }
        code = code_map.get(status_code, "error")
        detail = exc.detail if isinstance(exc.detail, str) else "An error occurred."
        return problem_response(
            status_code=status_code,
            code=code,
            title=code.replace("_", " ").title(),
            detail=detail,
            request_id=req_id,
        )

    @app.exception_handler(Exception)
    def handle_generic_exception(request: Request, exc: Exception):
        req_id = getattr(request.state, "request_id", None)
        return problem_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="temporarily_unavailable",
            title="Internal Server Error",
            detail="A service error occurred while processing your request.",
            request_id=req_id,
        )

    # Unauthenticated Health endpoint
    @app.get("/api/v1/health", tags=["Health"])
    def get_health() -> dict[str, Any]:
        """Liveness/readiness endpoint (no authentication required)."""
        return {"status": "ok", "version": "1.0.0"}

    @app.post("/api/v1/auth/login", tags=["Dashboard Authentication"])
    def dashboard_login(
        body: DashboardLoginRequest,
        request: Request,
        response: Response,
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        """Authenticate a provisioned dashboard user and issue an HttpOnly session cookie."""
        settings = get_settings()
        if settings.aegisops_env.lower() == "production" and request.url.scheme != "https":
            raise ProblemException(400, "https_required", "HTTPS required", "Dashboard sessions require HTTPS.")
        origin = request.headers.get("origin", "").rstrip("/")
        if origin not in settings.allowed_cors_origins:
            raise ProblemException(403, "origin_not_allowed", "Forbidden", "The browser origin is not allowed.")
        try:
            email = normalize_email(body.email)
        except ValueError:
            email = body.email.strip().casefold()[:320]
        attempt_keys = make_login_attempt_keys(email, request.client.host if request.client else None)
        if any(login_is_throttled(db, key_hash, settings) for key_hash in attempt_keys):
            raise ProblemException(429, "login_rate_limited", "Too many attempts", "Try again later.")

        user = db.query(DashboardUser).filter_by(email=email).first()
        password_valid = verify_password(body.password, user.password_hash if user else None)
        if user is None or not user.is_active or not password_valid:
            for key_hash in attempt_keys:
                record_failed_login(db, key_hash, settings)
            raise ProblemException(401, "invalid_credentials", "Unauthorized", "Email or password is invalid.")

        for key_hash in attempt_keys:
            clear_login_failures(db, key_hash)
        session_row, raw_session, csrf_token = new_session(db, user, settings)
        response.set_cookie(
            key=SESSION_COOKIE, value=raw_session, max_age=settings.dashboard_session_ttl_seconds,
            httponly=True, secure=settings.dashboard_cookie_secure,
            samesite=settings.dashboard_cookie_samesite.lower(), path="/",
        )
        response.set_cookie(
            key=CSRF_COOKIE, value=csrf_token, max_age=settings.dashboard_session_ttl_seconds,
            httponly=False, secure=settings.dashboard_cookie_secure,
            samesite=settings.dashboard_cookie_samesite.lower(), path="/",
        )
        return {
            "authenticated": True,
            "user_id": user.user_id,
            "csrf_token": csrf_token,
            "expires_at": format_rfc3339_z(session_row.expires_at),
        }

    @app.get("/api/v1/auth/session", tags=["Dashboard Authentication"])
    def dashboard_session(
        request: Request,
        response: Response,
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        """Validate the server-side session and refresh the CSRF token if needed."""
        _context, user, session_row = authenticate_dashboard_session(request, db, require_csrf=False)
        csrf_token = request.cookies.get(CSRF_COOKIE, "")
        if not csrf_token or not hmac.compare_digest(token_hash(csrf_token), session_row.csrf_hash):
            csrf_token = secrets.token_urlsafe(32)
            session_row.csrf_hash = token_hash(csrf_token)
            db.commit()
            response.set_cookie(
                key=CSRF_COOKIE, value=csrf_token, max_age=get_settings().dashboard_session_ttl_seconds,
                httponly=False, secure=get_settings().dashboard_cookie_secure,
                samesite=get_settings().dashboard_cookie_samesite.lower(), path="/",
            )
        return {"authenticated": True, "user_id": user.user_id, "csrf_token": csrf_token}

    @app.post("/api/v1/auth/logout", tags=["Dashboard Authentication"])
    def dashboard_logout(
        request: Request,
        response: Response,
        auth=Depends(get_dashboard_tenant),
        db: Session = Depends(get_db),
    ) -> dict[str, bool]:
        """Revoke the current server-side session and clear both browser cookies."""
        if hasattr(auth, "session_id"):
            row = db.query(DashboardSession).filter_by(session_id=auth.session_id, tenant_id=auth.tenant_id).first()
            if row is not None and row.revoked_at is None:
                row.revoked_at = datetime.now(timezone.utc)
                db.commit()
        settings = get_settings()
        response.delete_cookie(SESSION_COOKIE, path="/", secure=settings.dashboard_cookie_secure,
                               httponly=True, samesite=settings.dashboard_cookie_samesite.lower())
        response.delete_cookie(CSRF_COOKIE, path="/", secure=settings.dashboard_cookie_secure,
                               httponly=False, samesite=settings.dashboard_cookie_samesite.lower())
        return {"logged_out": True}

    # Authenticated Ingestion endpoint
    @app.post(
        "/api/v1/ingest",
        response_model=IngestionResponse,
        status_code=status.HTTP_202_ACCEPTED,
        tags=["Ingestion"],
    )
    def ingest_telemetry(
        payload: TelemetryPayload,
        response: Response,
        background_tasks: BackgroundTasks = None,
        auth: TenantContext = Depends(get_current_tenant),
        db: Session = Depends(get_db),
    ) -> IngestionResponse:
        """
        Ingest single approved outbound telemetry metadata record.

        - Verifies body tenant and collector IDs match the authenticated credential.
        - Commits to Postgres durably.
        - Returns 202 Accepted for brand-new payload.
        - Returns 200 OK for safe idempotent retry.
        - Returns 409 Conflict on payload ID reused with different content.
        """
        ingested_at_dt, is_duplicate = record_telemetry(
            session=db,
            payload=payload,
            authenticated_tenant_id=auth.tenant_id,
            authenticated_collector_id=auth.collector_id,
        )

        if is_duplicate:
            response.status_code = status.HTTP_200_OK
        else:
            response.status_code = status.HTTP_202_ACCEPTED
            # record_telemetry has committed before scheduling; analysis errors
            # therefore cannot roll back or delay the accepted telemetry record.
            if background_tasks is not None and get_settings().ai_enabled:
                from saas.aiops.analysis_service import process_payload_analyses
                background_tasks.add_task(process_payload_analyses, auth.tenant_id, str(payload.payload_id))

        return IngestionResponse(
            status="accepted",
            payload_id=str(payload.payload_id),
            tenant_id=payload.tenant_id,
            ingested_at=format_rfc3339_z(ingested_at_dt),
            duplicate=is_duplicate,
        )

    # Tenant-scoped Dashboard & Read endpoints
    app.include_router(dashboard_router)

    return app


app = create_app()
