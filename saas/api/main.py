"""AegisOps central SaaS FastAPI application."""

from contextlib import asynccontextmanager
import uuid
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from saas.api.errors import ProblemException, problem_response
from saas.api.routes.dashboard import router as dashboard_router
from saas.database import Base, engine, format_rfc3339_z, get_db, record_telemetry
from saas.ingestion.schemas import IngestionResponse, TelemetryPayload
from saas.tenancy.auth import TenantContext, get_current_tenant


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Auto-create database tables on startup lifespan."""
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
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Request ID and tracking middleware
    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        req_id = request.headers.get("x-request-id") or f"req-{uuid.uuid4().hex[:12]}"
        request.state.request_id = req_id
        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response

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
        auth: TenantContext = Depends(get_current_tenant),
        db: Session = Depends(get_db),
    ) -> IngestionResponse:
        """
        Ingest single approved outbound telemetry metadata record.

        - Verifies body.tenant_id matches authenticated tenant.
        - Commits to Postgres durably.
        - Returns 202 Accepted for brand-new payload.
        - Returns 200 OK for safe idempotent retry.
        - Returns 409 Conflict on payload ID reused with different content.
        """
        ingested_at_dt, is_duplicate = record_telemetry(
            session=db,
            payload=payload,
            authenticated_tenant_id=auth.tenant_id,
        )

        if is_duplicate:
            response.status_code = status.HTTP_200_OK
        else:
            response.status_code = status.HTTP_202_ACCEPTED

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
