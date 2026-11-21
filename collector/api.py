"""Loopback-only local collector API; these routes are not SaaS endpoints."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from collector.config import CollectorSettings
from collector.normalization.pipeline import InvalidTelemetry
from collector.service import CollectorService


def create_app(settings: CollectorSettings | None = None, service: CollectorService | None = None) -> FastAPI:
    resolved_settings = settings or CollectorSettings()
    collector = service or CollectorService(resolved_settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await collector.start()
        try:
            yield
        finally:
            await collector.stop()

    app = FastAPI(title="AEGISOPS Local Collector", version="0.1.0", lifespan=lifespan)
    allowed_origins = [origin.strip() for origin in resolved_settings.collector_cors_origins.split(",") if origin.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.state.collector = collector

    allowed_origin_keys = set()
    for origin in allowed_origins:
        parsed = urlsplit(origin)
        if parsed.scheme and parsed.netloc and parsed.path in {"", "/"} and not parsed.query and not parsed.fragment:
            allowed_origin_keys.add(f"{parsed.scheme.lower()}://{parsed.netloc.lower()}")

    @app.middleware("http")
    async def protect_loopback_boundary(request: Request, call_next):
        # CORS controls browser reads; these checks protect local routes from
        # DNS rebinding and cross-origin state-changing requests.
        try:
            request_host = request.url.hostname
        except ValueError:
            request_host = None
        if request_host not in {"localhost", "127.0.0.1", "::1"}:
            return JSONResponse({"detail": "invalid_host"}, status_code=403)
        if request.method.upper() not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if origin is not None:
                try:
                    parsed = urlsplit(origin)
                    origin_key = (
                        f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"
                        if parsed.scheme and parsed.netloc and parsed.path in {"", "/"}
                        and not parsed.query and not parsed.fragment else None
                    )
                except ValueError:
                    origin_key = None
                if origin_key not in allowed_origin_keys:
                    return JSONResponse({"detail": "origin_not_allowed"}, status_code=403)
        return await call_next(request)

    @app.get("/api/v1/collector/health")
    async def collector_health() -> dict[str, Any]:
        return await collector.health()

    @app.get("/api/v1/collector/queue")
    async def collector_queue() -> dict[str, Any]:
        return await collector.queue_status()

    @app.post("/api/v1/collector/queue/{payload_id}/retry", status_code=202)
    async def retry_failed_payload(payload_id: str) -> dict[str, str]:
        retried = await collector.queue.retry_failed(payload_id)
        if not retried:
            raise HTTPException(status_code=404, detail="failed_payload_not_found")
        return {"payload_id": payload_id, "status": "pending"}

    @app.post("/api/v1/collector/queue/{payload_id}/reject", status_code=204)
    async def reject_egress(payload_id: str) -> None:
        rejected = await collector.queue.reject_egress(payload_id)
        if not rejected:
            raise HTTPException(status_code=404, detail="pending_payload_not_found")
        return None

    @app.get("/api/v1/collector/egress-preview")
    async def egress_preview(payload_id: str | None = Query(default=None)) -> JSONResponse:
        item = await collector.queue.preview(payload_id)
        if item is None:
            return JSONResponse(
                {"available": False, "transmission_status": "no_pending_payload", "payload_json": None},
                status_code=200,
            )
        integrity_valid = item.payload_integrity_valid
        payload = json.loads(item.payload_json) if integrity_valid else None
        proof = item.proof()
        safe_sources = {"windows_live_metrics", "file", "development_only", "local_api", "adapter"}
        raw_source = proof.get("source_category")
        source_category = raw_source if isinstance(raw_source, str) and raw_source in safe_sources else "unknown"
        security = payload.get("security") if isinstance(payload, dict) else None
        security_keys = {"failed_login_count", "suspicious_activity_count"}
        if not isinstance(security, dict) or not security:
            security_status = "unavailable"
        elif security_keys <= set(security):
            security_status = "available"
        else:
            security_status = "partial"
        review_status = (
            "rejected" if item.last_error_code == "egress_rejected"
            else "approved" if item.egress_approved
            else "awaiting_review"
        )
        transmission_status = (
            "rejected" if review_status == "rejected"
            else "failed" if item.state == "failed"
            else item.state
        )
        safe_categories = {
            "unsupported_fields", "credential_fields", "untrusted_identity_overrides", "raw_or_source_fields"
        }
        safe_redacted_fields = {"service", "environment", "region"}
        excluded_count = proof.get("excluded_field_count", 0)
        if isinstance(excluded_count, bool) or not isinstance(excluded_count, int) or excluded_count < 0:
            excluded_count = 0
        return JSONResponse(
            {
                "available": True,
                "payload_id": item.payload_id,
                "validation_status": "valid" if integrity_valid else "integrity_error",
                "payload_integrity_valid": integrity_valid,
                "transmission_status": transmission_status,
                "egress_review_status": review_status,
                "payload_json": item.payload_json if integrity_valid else None,
                "payload": payload,
                "schema_version": payload.get("schema_version") if payload else None,
                "capture_timestamp": payload.get("event_time") if payload else None,
                "source_category": source_category,
                "metrics": payload.get("metrics", {}) if payload else {},
                "security_status": security_status if integrity_valid else "unknown",
                "excluded_field_count": excluded_count,
                "excluded_field_categories": [
                    value for value in proof.get("excluded_field_categories", [])
                    if isinstance(value, str) and value in safe_categories
                ],
                "excluded_fields": [
                    value for value in proof.get("excluded_fields", [])
                    if isinstance(value, str) and value in {
                        "unsupported fields", "credential-like fields", "untrusted tenant_id",
                        "untrusted collector_id", "untrusted payload_id",
                        "raw log or source identifier fields", "event_id (used only to derive a stable payload ID)",
                    }
                ],
                "redacted_fields": [
                    value for value in proof.get("redacted_fields", [])
                    if isinstance(value, str) and value in safe_redacted_fields
                ],
            }
        )

    @app.post("/api/v1/collector/egress-preview/{payload_id}/approve", status_code=204)
    async def approve_egress(payload_id: str) -> None:
        approved = await collector.queue.approve_egress(payload_id)
        if not approved:
            raise HTTPException(status_code=404, detail="pending_payload_not_found")
        return None

    @app.post("/api/v1/collector/telemetry", status_code=202)
    async def development_telemetry(request: Request) -> dict[str, Any]:
        if resolved_settings.aegisops_env.lower() not in {"development", "test"}:
            raise HTTPException(status_code=404, detail="not_found")
        content_length = request.headers.get("content-length")
        max_bytes = resolved_settings.collector_max_event_bytes
        if content_length and content_length.isdigit() and int(content_length) > max_bytes:
            raise HTTPException(status_code=413, detail="payload_too_large")
        chunks: list[bytes] = []
        received = 0
        async for chunk in request.stream():
            received += len(chunk)
            if received > max_bytes:
                raise HTTPException(status_code=413, detail="payload_too_large")
            chunks.append(chunk)
        body = b"".join(chunks)
        try:
            event = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise HTTPException(status_code=400, detail="invalid_json") from None
        try:
            result = await collector.ingest(event, source_category="development_only")
        except RuntimeError:
            raise HTTPException(status_code=503, detail="collector_privacy_configuration_missing") from None
        except InvalidTelemetry:
            # Do not reflect request data in validation errors.
            raise HTTPException(status_code=422, detail="invalid_telemetry") from None
        return {"source_kind": "development_only", **result}

    return app


app = create_app()
