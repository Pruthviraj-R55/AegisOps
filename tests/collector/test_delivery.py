from __future__ import annotations

import json

import httpx
import pytest
from pydantic import SecretStr

from collector.config import CollectorSettings
from collector.normalization.pipeline import serialize_payload
from collector.queue.sqlite_queue import SQLiteQueue
from collector.transport.delivery import DeliveryClient


def _settings(url: str, **overrides) -> CollectorSettings:
    return CollectorSettings(
        collector_id="collector-test",
        collector_tenant_id="tenant-test",
        collector_pseudonymization_key=SecretStr("test-key"),
        saas_ingest_url=url,
        collector_bearer_token=SecretStr("collector-token-test"),
        aegisops_env="test",
        collector_retry_base_seconds=1,
        collector_retry_max_seconds=8,
        **overrides,
    )


@pytest.mark.asyncio
async def test_failed_transmission_retains_pending_payload(event, normalizer, tmp_path):
    payload, proof = normalizer.build(event)
    queue = SQLiteQueue(tmp_path / "queue.sqlite3")
    await queue.initialize()
    await queue.enqueue(payload["payload_id"], serialize_payload(payload), proof)
    await queue.approve_egress(payload["payload_id"])
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(503)))
    delivery = DeliveryClient(queue, _settings("https://saas.example/api/v1/ingest"), client=client, clock=lambda: 100, jitter=lambda: 0.5)

    assert await delivery.deliver_once() == "retry"
    queued = await queue.get(payload["payload_id"])
    assert queued is not None and queued.state == "pending"
    assert queued.attempts == 1
    assert (await queue.counts())["pending_payload_count"] == 1
    await client.aclose()


@pytest.mark.asyncio
async def test_network_exception_retains_pending_payload(event, normalizer, tmp_path):
    payload, proof = normalizer.build(event)
    queue = SQLiteQueue(tmp_path / "queue.sqlite3")
    await queue.initialize()
    await queue.enqueue(payload["payload_id"], serialize_payload(payload), proof)
    await queue.approve_egress(payload["payload_id"])

    def fail(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("network unavailable")

    client = httpx.AsyncClient(transport=httpx.MockTransport(fail))
    delivery = DeliveryClient(queue, _settings("https://saas.example/api/v1/ingest"), client=client, clock=lambda: 10, jitter=lambda: 0.5)

    assert await delivery.deliver_once() == "retry"
    retained = await queue.get(payload["payload_id"])
    assert retained is not None and retained.state == "pending"
    assert retained.attempts == 1
    await client.aclose()


@pytest.mark.asyncio
async def test_retry_after_header_is_applied_within_configured_bound(event, normalizer, tmp_path):
    payload, proof = normalizer.build(event)
    queue = SQLiteQueue(tmp_path / "queue.sqlite3")
    await queue.initialize()
    await queue.enqueue(payload["payload_id"], serialize_payload(payload), proof)
    await queue.approve_egress(payload["payload_id"])
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(429, headers={"Retry-After": "3"})))
    delivery = DeliveryClient(queue, _settings("https://saas.example/api/v1/ingest"), client=client, clock=lambda: 10, jitter=lambda: 0.5)

    assert await delivery.deliver_once() == "retry"
    retained = await queue.get(payload["payload_id"])
    assert retained is not None
    assert retained.next_attempt_at == 13
    await client.aclose()


@pytest.mark.asyncio
async def test_retry_preserves_exact_payload_and_id_then_acknowledges(event, normalizer, tmp_path):
    payload, proof = normalizer.build(event)
    payload_json = serialize_payload(payload)
    queue = SQLiteQueue(tmp_path / "queue.sqlite3")
    await queue.initialize()
    await queue.enqueue(payload["payload_id"], payload_json, proof)
    await queue.approve_egress(payload["payload_id"])
    now = [100.0]
    seen: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.content.decode(), request.headers["authorization"]))
        if len(seen) == 1:
            return httpx.Response(503)
        return httpx.Response(
            200,
            json={
                "status": "accepted",
                "payload_id": payload["payload_id"],
                "tenant_id": "tenant-test",
                "ingested_at": "2026-11-20T12:00:01.000Z",
                "duplicate": True,
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    delivery = DeliveryClient(queue, _settings("https://saas.example/api/v1/ingest"), client=client, clock=lambda: now[0], jitter=lambda: 0.5)

    assert await delivery.deliver_once() == "retry"
    waiting = await queue.get(payload["payload_id"])
    assert waiting is not None
    now[0] = waiting.next_attempt_at
    assert await delivery.deliver_once() == "acknowledged"
    assert seen == [(payload_json, "Bearer collector-token-test"), (payload_json, "Bearer collector-token-test")]
    acknowledged = await queue.get(payload["payload_id"])
    assert acknowledged is not None and acknowledged.state == "acknowledged"
    assert (await queue.counts())["pending_payload_count"] == 0
    await client.aclose()


@pytest.mark.asyncio
async def test_permanent_client_error_marks_failed_and_can_be_retried_manually(event, normalizer, tmp_path):
    payload, proof = normalizer.build(event)
    queue = SQLiteQueue(tmp_path / "queue.sqlite3")
    await queue.initialize()
    await queue.enqueue(payload["payload_id"], serialize_payload(payload), proof)
    await queue.approve_egress(payload["payload_id"])
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _request: httpx.Response(422)))
    delivery = DeliveryClient(queue, _settings("https://saas.example/api/v1/ingest"), client=client)

    assert await delivery.deliver_once() == "failed"
    assert (await queue.get(payload["payload_id"])).state == "failed"
    assert await queue.retry_failed(payload["payload_id"]) is True
    assert (await queue.get(payload["payload_id"])).state == "pending"
    await client.aclose()
