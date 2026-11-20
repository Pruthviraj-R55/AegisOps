"""Collector orchestration: normalize, prove, enqueue, then deliver."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

from collector.adapters.json_file import AdapterRecordError
from collector.adapters.protocol import TelemetryAdapter
from collector.config import CollectorSettings
from collector.normalization.pipeline import InvalidTelemetry, TelemetryNormalizer, serialize_payload
from collector.queue.sqlite_queue import SQLiteQueue
from collector.transport.delivery import DeliveryClient

logger = logging.getLogger("aegisops.collector")


class CollectorService:
    def __init__(self, settings: CollectorSettings, queue: SQLiteQueue | None = None, delivery: DeliveryClient | None = None):
        self.settings = settings
        self.queue = queue or SQLiteQueue(settings.collector_queue_path)
        key = settings.collector_pseudonymization_key
        self.normalizer = TelemetryNormalizer(settings.collector_tenant_id, settings.collector_id, key or "")
        self.delivery = delivery or DeliveryClient(self.queue, settings)
        self.last_local_heartbeat: str | None = None
        self.last_event_queued_at: str | None = None
        self.last_queue_duration_ms: float | None = None
        self.started_at: str | None = None
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._delivery_task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    async def start(self) -> None:
        await self.queue.initialize()
        await self.delivery.restore_state()
        self.started_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        self._stop_event.clear()
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop(), name="collector-heartbeat")
        self._delivery_task = asyncio.create_task(self._delivery_loop(), name="collector-delivery")

    async def stop(self) -> None:
        self._stop_event.set()
        tasks = [task for task in (self._heartbeat_task, self._delivery_task) if task]
        if tasks:
            # Let current aiosqlite/HTTPX operations finish before closing their resources.
            await asyncio.gather(*tasks, return_exceptions=True)
        await self.delivery.close()

    async def _heartbeat_loop(self) -> None:
        interval = max(1.0, self.settings.collector_heartbeat_interval_seconds)
        while not self._stop_event.is_set():
            self.last_local_heartbeat = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=interval)
            except TimeoutError:
                continue

    async def _delivery_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                result = await self.delivery.deliver_once()
                if result in {"idle", "not_configured", "configuration_error"}:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=0.5)
            except TimeoutError:
                continue
            except asyncio.CancelledError:
                raise
            except Exception:
                # Never include an exception string: HTTP errors can carry payloads or credentials.
                logger.error("Collector delivery loop failed (details suppressed)")
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=1.0)
                except TimeoutError:
                    pass

    async def ingest(self, raw_event: object) -> dict[str, Any]:
        started = time.perf_counter()
        configured_key = self.settings.collector_pseudonymization_key
        if configured_key is None or not configured_key.get_secret_value():
            raise RuntimeError("collector pseudonymization key is not configured")
        payload, proof = await asyncio.to_thread(self.normalizer.build, raw_event)
        payload_json = serialize_payload(payload)
        created = await self.queue.enqueue(payload["payload_id"], payload_json, proof)
        self.last_queue_duration_ms = round((time.perf_counter() - started) * 1000, 3)
        self.last_event_queued_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        # Safe metadata only; never log raw event values or exception text.
        logger.info("Collector event queued", extra={"payload_id": payload["payload_id"], "duplicate": not created})
        return {
            "payload_id": payload["payload_id"],
            "queued": created,
            "duplicate": not created,
            "queue_duration_ms": self.last_queue_duration_ms,
        }

    async def ingest_adapter(self, adapter: TelemetryAdapter) -> int:
        """Process adapter events through the same normalizer and durable queue."""
        queued_count = 0
        async for raw_event in adapter.events():
            try:
                await self.ingest(raw_event)
            except InvalidTelemetry as exc:
                source_name = getattr(adapter, "source_name", "adapter")
                record_number = getattr(adapter, "current_record_number", queued_count + 1)
                raise AdapterRecordError(
                    str(source_name), record_number, "invalid_telemetry", str(exc)
                ) from None
            queued_count += 1
        return queued_count

    async def health(self) -> dict[str, Any]:
        counts = await self.queue.counts()
        status = "running"
        if self.last_local_heartbeat is None:
            status = "starting"
        elif self.delivery.configured and (counts["pending_delivery"] + counts["in_flight"]):
            reference_time = self.delivery.last_success_at or self.started_at
            age = (
                datetime.now(timezone.utc) - datetime.fromisoformat(reference_time.replace("Z", "+00:00"))
            ).total_seconds() if reference_time else 0
            threshold = max(1.0, self.settings.collector_offline_after_seconds)
            if age > threshold:
                status = "offline"
            elif counts["pending_delivery"] + counts["in_flight"]:
                status = "degraded"
        elif not self.delivery.configured:
            status = "delivery_unconfigured"
        return {
            "collector_id": self.settings.collector_id,
            "operational_status": status,
            "last_successful_heartbeat": self.last_local_heartbeat,
            "queue_depth": counts["queue_depth"],
            "pending_payload_count": counts["pending_payload_count"],
            "delivery_status": self.delivery.last_status,
            "last_delivery_success": self.delivery.last_success_at,
            "heartbeat_interval_seconds": self.settings.collector_heartbeat_interval_seconds,
            "offline_after_seconds": self.settings.collector_offline_after_seconds,
            "last_ingestion_to_queue_ms": self.last_queue_duration_ms,
            "last_queue_to_delivery_attempt_ms": self.delivery.last_attempt_duration_ms,
        }

    async def queue_status(self) -> dict[str, Any]:
        return {**(await self.queue.counts()), "items": await self.queue.list_items()}
