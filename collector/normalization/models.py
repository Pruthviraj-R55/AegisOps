"""Outbound model aligned with the shared telemetry JSON Schema."""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Metrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cpu_percent: float | None = None
    memory_percent: float | None = None
    disk_percent: float | None = None
    bandwidth_mbps: float | None = None
    latency_ms: float | None = None
    packet_loss_percent: float | None = None

    @field_validator("cpu_percent", "memory_percent", "disk_percent", "packet_loss_percent")
    @classmethod
    def percentage_range(cls, value: float | None) -> float | None:
        if value is not None and not 0 <= value <= 100:
            raise ValueError("percentage metric must be between 0 and 100")
        return value

    @field_validator("bandwidth_mbps", "latency_ms")
    @classmethod
    def nonnegative_metric(cls, value: float | None) -> float | None:
        if value is not None and value < 0:
            raise ValueError("metric must be nonnegative")
        return value

    @field_validator(
        "cpu_percent", "memory_percent", "disk_percent", "bandwidth_mbps", "latency_ms", "packet_loss_percent"
    )
    @classmethod
    def finite_metric(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("metric must be finite")
        return value

    @model_validator(mode="after")
    def at_least_one_metric(self) -> "Metrics":
        if not any(value is not None for value in self.model_dump().values()):
            raise ValueError("at least one metric is required")
        if any(name in self.model_fields_set and getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("metric values cannot be null")
        return self


class SecurityCounts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    failed_login_count: int | None = Field(default=None, ge=0)
    suspicious_activity_count: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def at_least_one_count(self) -> "SecurityCounts":
        if not any(value is not None for value in self.model_dump().values()):
            raise ValueError("at least one security count is required")
        if any(name in self.model_fields_set and getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("security counts cannot be null")
        return self


class OutboundTelemetry(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    schema_version: Literal["1.0.0"]
    payload_id: UUID
    tenant_id: str = Field(min_length=1, max_length=128)
    collector_id: str = Field(min_length=1, max_length=128)
    event_time: datetime
    service: str = Field(min_length=1, max_length=128)
    environment: str = Field(min_length=1, max_length=64)
    region: str | None = Field(default=None, max_length=128)
    metrics: Metrics
    security: SecurityCounts
    health: Literal["excellent", "good", "fair", "poor"]

    @field_validator("event_time", mode="before")
    @classmethod
    def utc_z_timestamp(cls, value: object) -> datetime:
        if not isinstance(value, str) or not value.endswith("Z"):
            raise ValueError("event_time must be an RFC 3339 UTC timestamp ending in Z")
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
        if parsed.utcoffset() != timezone.utc.utcoffset(parsed):
            raise ValueError("event_time must be UTC")
        return parsed

    @field_validator("region")
    @classmethod
    def valid_region(cls, value: str | None) -> str | None:
        return value or None
