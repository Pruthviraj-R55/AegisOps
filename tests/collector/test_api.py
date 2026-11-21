from __future__ import annotations

import asyncio
import json
import logging

import httpx
from pydantic import SecretStr

from collector.api import create_app
from collector.config import CollectorSettings
from collector.queue.sqlite_queue import SQLiteQueue
from collector.service import CollectorService
from collector.transport.delivery import DeliveryClient


def _settings(queue_path: str, environment: str = "development") -> CollectorSettings:
    return CollectorSettings(
        collector_id="collector-api-test",
        collector_tenant_id="tenant-api-test",
        collector_queue_path=queue_path,
        collector_pseudonymization_key=SecretStr("api-test-key"),
        aegisops_env=environment,
        collector_heartbeat_interval_seconds=1,
    )


def _event() -> dict:
    return {
        "event_id": "local-event-1",
        "event_time": "2026-11-20T12:00:00Z",
        "service": "inventory-service",
        "environment": "test",
        "metrics": {"cpu_percent": 20},
        "security": {"failed_login_count": 0},
        "health": "excellent",
    }


async def test_egress_preview_is_exact_queued_json_and_contains_no_raw_values(tmp_path):
    app = create_app(_settings(str(tmp_path / "queue.sqlite3")))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1") as client:
            event = _event()
            event["password"] = "very-private-password"
            response = await client.post("/api/v1/collector/telemetry", json=event)
            assert response.status_code == 202
            payload_id = response.json()["payload_id"]

            preview_response = await client.get("/api/v1/collector/egress-preview", params={"payload_id": payload_id})
            preview = preview_response.json()
            item = await app.state.collector.queue.get(payload_id)
            assert preview["payload_json"] == item.payload_json
            assert preview["validation_status"] == "valid"
            assert preview["transmission_status"] in {"pending", "in_flight"}
            assert preview["egress_review_status"] == "awaiting_review"
            assert "very-private-password" not in preview["payload_json"]
            assert preview["excluded_field_categories"]
            assert preview["source_category"] == "development_only"
            assert preview["schema_version"] == "1.0.0"
            assert preview["capture_timestamp"] == "2026-11-20T12:00:00Z"
            assert preview["metrics"] == {"cpu_percent": 20.0}
            assert preview["security_status"] == "partial"
            assert preview["payload_integrity_valid"] is True
            assert set(preview["excluded_field_categories"]) <= {
                "unsupported_fields", "credential_fields", "untrusted_identity_overrides", "raw_or_source_fields"
            }
            assert "password" not in json.dumps(preview["excluded_fields"])

            # The background sender cannot claim anything until this local approval.
            assert await app.state.collector.queue.claim_next(10**12) is None
            approved = await client.post(f"/api/v1/collector/egress-preview/{payload_id}/approve")
            assert approved.status_code == 204
            assert await app.state.collector.queue.claim_next(10**12) is not None


async def test_local_api_logs_do_not_contain_raw_telemetry_or_secret(caplog, tmp_path):
    app = create_app(_settings(str(tmp_path / "queue.sqlite3")))
    caplog.set_level(logging.INFO)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1") as client:
            event = _event()
            event["api_key"] = "never-log-this-api-key"
            event["message"] = "password=never-log-this-password"
            response = await client.post("/api/v1/collector/telemetry", json=event)
            assert response.status_code == 202

    logged = caplog.text
    assert "never-log-this-api-key" not in logged
    assert "never-log-this-password" not in logged
    assert "inventory-service" not in logged


async def test_collector_health_and_queue_endpoints_are_local_and_descriptive(tmp_path):
    app = create_app(_settings(str(tmp_path / "queue.sqlite3")))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1") as client:
            await client.post("/api/v1/collector/telemetry", json=_event())
            health = (await client.get("/api/v1/collector/health")).json()
            queue = (await client.get("/api/v1/collector/queue")).json()

    assert health["collector_id"] == "collector-api-test"
    assert health["last_successful_heartbeat"]
    assert health["pending_payload_count"] == 1
    assert queue["pending"] == 1


async def test_local_vite_origin_is_allowed_but_not_reflected_for_other_origins(tmp_path):
    app = create_app(_settings(str(tmp_path / "queue.sqlite3")))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1") as client:
            allowed = await client.options(
                "/api/v1/collector/health",
                headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
            )
            denied = await client.options(
                "/api/v1/collector/health",
                headers={"Origin": "http://untrusted.example", "Access-Control-Request-Method": "GET"},
            )
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-origin" not in denied.headers


async def test_cross_origin_mutations_and_non_loopback_hosts_are_rejected(tmp_path):
    app = create_app(_settings(str(tmp_path / "queue.sqlite3")))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1") as client:
            queued = await client.post("/api/v1/collector/telemetry", json=_event())
            payload_id = queued.json()["payload_id"]
            forged_approval = await client.post(
                f"/api/v1/collector/egress-preview/{payload_id}/approve",
                headers={"Origin": "https://attacker.example"},
            )
            forged_input = await client.post(
                "/api/v1/collector/telemetry",
                json=_event(),
                headers={"Origin": "https://attacker.example"},
            )
            malformed_origin = await client.post(
                f"/api/v1/collector/egress-preview/{payload_id}/approve",
                headers={"Origin": "http://["},
            )
            rebound_host = await client.get("/api/v1/collector/egress-preview", headers={"Host": "attacker.example"})
            item = await app.state.collector.queue.get(payload_id)

    assert forged_approval.status_code == 403
    assert forged_approval.json()["detail"] == "origin_not_allowed"
    assert forged_input.status_code == 403
    assert malformed_origin.status_code == 403
    assert rebound_host.status_code == 403
    assert item is not None and item.egress_approved is False


async def test_allowed_frontend_origin_can_approve_and_metrics_only_preview_is_explicit(tmp_path):
    app = create_app(_settings(str(tmp_path / "queue.sqlite3")))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1") as client:
            event = _event()
            event.pop("security")
            accepted = await client.post("/api/v1/collector/telemetry", json=event)
            payload_id = accepted.json()["payload_id"]
            preview = (await client.get("/api/v1/collector/egress-preview", params={"payload_id": payload_id})).json()
            approved = await client.post(
                f"/api/v1/collector/egress-preview/{payload_id}/approve",
                headers={"Origin": "http://localhost:5173"},
            )
            item = await app.state.collector.queue.get(payload_id)

    assert preview["schema_version"] == "1.1.0"
    assert preview["security_status"] == "unavailable"
    assert "security" not in preview["payload"]
    assert preview["payload_json"] == item.payload_json
    assert approved.status_code == 204
    assert item is not None and item.egress_approved is True
    assert item.approved_payload_sha256 == item.payload_sha256


async def test_reject_endpoint_keeps_record_local_and_reject_cannot_be_retried(tmp_path):
    app = create_app(_settings(str(tmp_path / "queue.sqlite3")))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1") as client:
            accepted = await client.post("/api/v1/collector/telemetry", json=_event())
            payload_id = accepted.json()["payload_id"]
            rejected = await client.post(
                f"/api/v1/collector/queue/{payload_id}/reject",
                headers={"Origin": "http://localhost:5173"},
            )
            preview = (await client.get("/api/v1/collector/egress-preview", params={"payload_id": payload_id})).json()
            retry = await client.post(f"/api/v1/collector/queue/{payload_id}/retry")
            item = await app.state.collector.queue.get(payload_id)
            assert await app.state.collector.queue.claim_next(10**12) is None

    assert rejected.status_code == 204
    assert preview["egress_review_status"] == "rejected"
    assert preview["transmission_status"] == "rejected"
    assert retry.status_code == 404
    assert item is not None and item.egress_approved is False and item.state == "failed"


async def test_development_telemetry_route_is_disabled_outside_development(tmp_path):
    app = create_app(_settings(str(tmp_path / "queue.sqlite3"), environment="production"))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1") as client:
            response = await client.post("/api/v1/collector/telemetry", json=_event())
            assert response.status_code == 404


async def test_ingestion_refuses_to_run_without_pseudonymization_key(tmp_path):
    settings = _settings(str(tmp_path / "queue.sqlite3"))
    settings.collector_pseudonymization_key = None
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1") as client:
            response = await client.post("/api/v1/collector/telemetry", json=_event())
    assert response.status_code == 503
    assert response.json()["detail"] == "collector_privacy_configuration_missing"


async def test_preview_payload_is_json_parsable_and_same_as_payload_object(tmp_path):
    app = create_app(_settings(str(tmp_path / "queue.sqlite3")))
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1") as client:
            await client.post("/api/v1/collector/telemetry", json=_event())
            preview = (await client.get("/api/v1/collector/egress-preview")).json()
            assert json.loads(preview["payload_json"]) == preview["payload"]


async def test_complete_local_flow_requires_preview_then_delivers_exact_approved_bytes(tmp_path):
    settings = _settings(str(tmp_path / "queue.sqlite3"))
    settings.saas_ingest_url = "https://saas.example/api/v1/ingest"
    settings.collector_bearer_token = SecretStr("mock-delivery-token")
    received: list[tuple[bytes, str]] = []

    def acknowledge(request: httpx.Request) -> httpx.Response:
        received.append((request.content, request.headers["authorization"]))
        payload = json.loads(request.content)
        return httpx.Response(
            202,
            json={
                "status": "accepted",
                "payload_id": payload["payload_id"],
                "tenant_id": payload["tenant_id"],
                "ingested_at": "2026-11-20T12:00:01Z",
                "duplicate": False,
            },
        )

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(acknowledge))
    queue = SQLiteQueue(settings.collector_queue_path)
    delivery = DeliveryClient(queue, settings, client=mock_client)
    service = CollectorService(settings, queue=queue, delivery=delivery)
    app = create_app(settings, service)

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1") as client:
            raw_event = _event()
            raw_event["password"] = "local-only-password-value"
            accepted = await client.post("/api/v1/collector/telemetry", json=raw_event)
            payload_id = accepted.json()["payload_id"]
            preview = (await client.get("/api/v1/collector/egress-preview", params={"payload_id": payload_id})).json()

            assert accepted.status_code == 202
            assert preview["egress_review_status"] == "awaiting_review"
            assert await queue.claim_next(10**12) is None
            assert "local-only-password-value" not in preview["payload_json"]
            await asyncio.sleep(0.05)
            assert received == []

            approved = await client.post(f"/api/v1/collector/egress-preview/{payload_id}/approve")
            assert approved.status_code == 204
            for _ in range(100):
                item = await queue.get(payload_id)
                if item and item.state == "acknowledged":
                    break
                await asyncio.sleep(0.01)
            assert item is not None and item.state == "acknowledged"

    assert received == [(preview["payload_json"].encode("utf-8"), "Bearer mock-delivery-token")]
    await mock_client.aclose()
