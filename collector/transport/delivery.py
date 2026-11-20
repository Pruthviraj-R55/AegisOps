"""Authenticated asynchronous delivery with bounded retries and durable ack."""

from __future__ import annotations

import random
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Callable
from urllib.parse import urlparse

import httpx
from pydantic import SecretStr

from collector.config import CollectorSettings
from collector.queue.sqlite_queue import QueueItem, SQLiteQueue


def _retry_after_seconds(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return max(0.0, (parsed - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return None


class DeliveryClient:
    def __init__(
        self,
        queue: SQLiteQueue,
        settings: CollectorSettings,
        *,
        client: httpx.AsyncClient | None = None,
        clock: Callable[[], float] = time.time,
        jitter: Callable[[], float] = random.random,
    ):
        self.queue = queue
        self.settings = settings
        self.client = client or httpx.AsyncClient(timeout=settings.collector_request_timeout_seconds)
        self._owns_client = client is None
        self._clock = clock
        self._jitter = jitter
        self.last_success_at: str | None = None
        self.last_status: str = "not_configured"
        self.last_attempt_duration_ms: float | None = None

    async def restore_state(self) -> None:
        self.last_success_at = await self.queue.get_state("last_delivery_success")

    @property
    def configured(self) -> bool:
        token = self.settings.collector_bearer_token
        token_value = token.get_secret_value() if isinstance(token, SecretStr) else token
        return bool(self.settings.saas_ingest_url and self.settings.saas_ingest_url.strip() and token_value)

    def _validate_destination(self) -> None:
        assert self.settings.saas_ingest_url
        parsed = urlparse(self.settings.saas_ingest_url)
        if parsed.scheme == "https" and parsed.hostname:
            return
        local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if not local_http or self.settings.aegisops_env.lower() not in {"development", "test"}:
            raise ValueError("collector delivery requires HTTPS except to loopback in development")

    def _backoff(self, attempt_number: int, retry_after: float | None = None) -> float:
        base = max(0.05, self.settings.collector_retry_base_seconds)
        maximum = max(base, self.settings.collector_retry_max_seconds)
        exponential = min(maximum, base * (2 ** min(max(0, attempt_number), 20)))
        jittered = exponential * (0.5 + self._jitter())
        if retry_after is not None:
            jittered = max(jittered, retry_after)
        return min(maximum, jittered)

    async def deliver_once(self) -> str:
        if not self.configured:
            self.last_status = "not_configured"
            return "not_configured"
        try:
            self._validate_destination()
        except ValueError:
            self.last_status = "configuration_error"
            return "configuration_error"

        item = await self.queue.claim_next(self._clock())
        if item is None:
            self.last_status = "idle"
            return "idle"

        token: str | None = None
        configured_token = self.settings.collector_bearer_token
        if isinstance(configured_token, SecretStr):
            token = configured_token.get_secret_value()
        elif isinstance(configured_token, str):
            token = configured_token
        assert token and self.settings.saas_ingest_url
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        request_started = time.perf_counter()
        try:
            response = await self.client.post(
                self.settings.saas_ingest_url,
                content=item.payload_json.encode("utf-8"),
                headers=headers,
            )
        except httpx.HTTPError:
            self.last_attempt_duration_ms = round((time.perf_counter() - request_started) * 1000, 3)
            await self._retry(item, "request_error")
            self.last_status = "degraded"
            return "retry"

        self.last_attempt_duration_ms = round((time.perf_counter() - request_started) * 1000, 3)

        if response.status_code in (200, 202):
            if self._valid_ack(response, item):
                await self.queue.acknowledge(item.payload_id)
                self.last_success_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                await self.queue.set_state("last_delivery_success", self.last_success_at)
                self.last_status = "connected"
                return "acknowledged"
            await self._retry(item, "invalid_acknowledgement")
            self.last_status = "degraded"
            return "retry"

        if response.status_code in (408, 429) or response.status_code >= 500:
            retry_after = _retry_after_seconds(response.headers.get("Retry-After"))
            await self._retry(item, f"http_{response.status_code}", retry_after)
            self.last_status = "degraded"
            return "retry"

        await self.queue.mark_failed(item.payload_id, f"http_{response.status_code}")
        self.last_status = "failed"
        return "failed"

    @staticmethod
    def _valid_ack(response: httpx.Response, item: QueueItem) -> bool:
        try:
            body = response.json()
        except ValueError:
            return False
        import json

        payload = json.loads(item.payload_json)
        return (
            isinstance(body, dict)
            and body.get("status") == "accepted"
            and body.get("payload_id") == item.payload_id
            and body.get("tenant_id") == payload.get("tenant_id")
            and isinstance(body.get("duplicate"), bool)
            and isinstance(body.get("ingested_at"), str)
        )

    async def _retry(self, item: QueueItem, error_code: str, retry_after: float | None = None) -> None:
        delay = self._backoff(item.attempts, retry_after)
        await self.queue.mark_pending(item.payload_id, error_code, self._clock() + delay)

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

