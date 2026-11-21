"""Bounded, metrics-only sampling of the local host through psutil."""

from __future__ import annotations

import asyncio
import importlib
import math
import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from collector.adapters.json_file import AdapterRecordError


class WindowsMetricsAdapter:
    """Yield one safe v1.1.0 host sample; never read logs or identity details.

    The adapter reads only utilization percentages and aggregate network byte
    counters. Network counters are converted to a sampled Mbps rate because
    the shared telemetry contract has no cumulative-byte fields.
    """

    source_kind = "windows_live_metrics"
    source_name = "windows-metrics"

    def __init__(
        self,
        *,
        service: str,
        environment: str,
        sample_interval_seconds: float = 1.0,
        psutil_api: Any | None = None,
    ) -> None:
        if not isinstance(service, str) or not service.strip():
            raise ValueError("service is required")
        if not isinstance(environment, str) or not environment.strip():
            raise ValueError("environment is required")
        if (
            isinstance(sample_interval_seconds, bool)
            or not isinstance(sample_interval_seconds, (int, float))
            or not math.isfinite(sample_interval_seconds)
            or not 0.1 <= sample_interval_seconds <= 5.0
        ):
            raise ValueError("sample interval must be between 0.1 and 5 seconds")
        self.service = service.strip()
        self.environment = environment.strip()
        self.sample_interval_seconds = float(sample_interval_seconds)
        self._psutil_api = psutil_api
        self.current_record_number = 0

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        """Capture one sample in a worker thread with a bounded wait."""
        self.current_record_number = 1
        try:
            event = await asyncio.wait_for(
                asyncio.to_thread(self._capture),
                timeout=self.sample_interval_seconds + 3.0,
            )
        except TimeoutError:
            raise AdapterRecordError(
                self.source_name, 1, "capture_timeout", "host metrics capture exceeded its time limit"
            ) from None
        yield event

    def _psutil(self) -> Any:
        if self._psutil_api is None:
            try:
                self._psutil_api = importlib.import_module("psutil")
            except ImportError:
                raise AdapterRecordError(
                    self.source_name, 1, "dependency_unavailable", "psutil is required for host metrics capture"
                ) from None
        return self._psutil_api

    def _capture(self) -> dict[str, Any]:
        psutil = self._psutil()
        metrics: dict[str, float] = {}

        try:
            network_before = psutil.net_io_counters()
            network_started = time.monotonic()
        except Exception:
            network_before = None
            network_started = None

        self._add_percentage(metrics, "cpu_percent", lambda: psutil.cpu_percent(interval=self.sample_interval_seconds))
        self._add_percentage(metrics, "memory_percent", lambda: psutil.virtual_memory().percent)
        self._add_percentage(
            metrics,
            "disk_percent",
            lambda: psutil.disk_usage(Path.cwd().anchor).percent if Path.cwd().anchor else None,
        )

        try:
            if network_started is not None:
                remaining = self.sample_interval_seconds - (time.monotonic() - network_started)
                if remaining > 0:
                    time.sleep(remaining)
            network_after = psutil.net_io_counters()
            network_ended = time.monotonic()
            if network_before is not None and network_started is not None:
                sent_before = self._valid_counter(network_before.bytes_sent)
                received_before = self._valid_counter(network_before.bytes_recv)
                sent_after = self._valid_counter(network_after.bytes_sent)
                received_after = self._valid_counter(network_after.bytes_recv)
                elapsed = network_ended - network_started
                sent_delta = sent_after - sent_before
                received_delta = received_after - received_before
                if elapsed > 0 and sent_delta >= 0 and received_delta >= 0:
                    # Aggregate sent and received bytes into the contract's
                    # sampled-throughput field; raw counters stay local.
                    bandwidth = (sent_delta + received_delta) * 8 / elapsed / 1_000_000
                    if math.isfinite(bandwidth):
                        metrics["bandwidth_mbps"] = bandwidth
        except Exception:
            # A reset/reconnect or inaccessible interface makes this metric
            # unavailable; it must not be represented as zero.
            pass

        if not metrics:
            raise AdapterRecordError(
                self.source_name, 1, "measurements_unavailable", "no supported host metrics could be collected"
            )

        captured_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        return {
            "schema_version": "1.1.0",
            "event_time": captured_at,
            "service": self.service,
            "environment": self.environment,
            "metrics": metrics,
            # This indicates measurement coverage only; it makes no security
            # assertion and contains no fabricated host measurements.
            "health": "good" if len(metrics) == 4 else "fair",
        }

    @staticmethod
    def _valid_counter(value: Any) -> int:
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError("invalid network counter")
        return value

    @staticmethod
    def _add_percentage(metrics: dict[str, float], name: str, read: Any) -> None:
        try:
            value = read()
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                return
            value = float(value)
            if math.isfinite(value) and 0 <= value <= 100:
                metrics[name] = value
        except Exception:
            # Individual metrics can be unavailable on restricted systems.
            return
