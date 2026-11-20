"""Loopback-only local collector API; these routes are not SaaS endpoints."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any

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

    @app.get("/api/v1/collector/egress-preview")
    async def egress_preview(payload_id: str | None = Query(default=None)) -> JSONResponse:
        item = await collector.queue.preview(payload_id)
        if item is None:
            return JSONResponse(
                {"available": False, "transmission_status": "no_pending_payload", "payload_json": None},
                status_code=200,
            )
        return JSONResponse(
            {
                "available": True,
                "payload_id": item.payload_id,
                "validation_status": "valid",
                "transmission_status": "in_flight" if item.state == "in_flight" else "pending",
                "egress_review_status": "approved" if item.egress_approved else "awaiting_review",
                "payload_json": item.payload_json,
                "payload": json.loads(item.payload_json),
                **item.proof(),
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
            result = await collector.ingest(event)
        except RuntimeError:
            raise HTTPException(status_code=503, detail="collector_privacy_configuration_missing") from None
        except InvalidTelemetry:
            # Do not reflect request data in validation errors.
            raise HTTPException(status_code=422, detail="invalid_telemetry") from None
        return {"source_kind": "development_only", **result}

    return app


app = create_app()
