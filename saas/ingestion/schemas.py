"""Strict Pydantic v2 schemas conforming to contracts/telemetry.schema.json v1.0.0."""

from datetime import datetime
from enum import Enum
import re
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class HealthStatus(str, Enum):
    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"


class MetricsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cpu_percent: Optional[float] = Field(None, ge=0.0, le=100.0)
    memory_percent: Optional[float] = Field(None, ge=0.0, le=100.0)
    disk_percent: Optional[float] = Field(None, ge=0.0, le=100.0)
    bandwidth_mbps: Optional[float] = Field(None, ge=0.0)
    latency_ms: Optional[float] = Field(None, ge=0.0)
    packet_loss_percent: Optional[float] = Field(None, ge=0.0, le=100.0)

    @model_validator(mode="after")
    def validate_min_properties(self) -> "MetricsPayload":
        values = [
            v
            for v in (
                self.cpu_percent,
                self.memory_percent,
                self.disk_percent,
                self.bandwidth_mbps,
                self.latency_ms,
                self.packet_loss_percent,
            )
            if v is not None
        ]
        if not values:
            raise ValueError("metrics object must contain at least 1 property")
        return self


class SecurityPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    failed_login_count: Optional[int] = Field(None, ge=0)
    suspicious_activity_count: Optional[int] = Field(None, ge=0)

    @model_validator(mode="after")
    def validate_min_properties(self) -> "SecurityPayload":
        values = [
            v
            for v in (self.failed_login_count, self.suspicious_activity_count)
            if v is not None
        ]
        if not values:
            raise ValueError("security object must contain at least 1 property")
        return self


RFC3339_UTC_REGEX = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$"
)


class TelemetryPayload(BaseModel):
    """Metadata payload conforming strictly to contracts/telemetry.schema.json."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0.0"]
    payload_id: UUID
    tenant_id: str = Field(..., min_length=1, max_length=128)
    collector_id: str = Field(..., min_length=1, max_length=128)
    event_time: str
    service: str = Field(..., min_length=1, max_length=128)
    environment: str = Field(..., min_length=1, max_length=64)
    region: Optional[str] = Field(None, max_length=128)
    metrics: MetricsPayload
    security: SecurityPayload
    health: HealthStatus

    @field_validator("event_time")
    @classmethod
    def validate_event_time_rfc3339_z(cls, v: str) -> str:
        if not RFC3339_UTC_REGEX.match(v):
            raise ValueError("event_time must be an RFC 3339 UTC timestamp ending in 'Z'")
        try:
            datetime.fromisoformat(v[:-1] + "+00:00")
        except Exception as e:
            raise ValueError(f"Invalid RFC 3339 date-time format: {e}")
        return v


class IngestionResponse(BaseModel):
    """Success response schema for POST /api/v1/ingest."""

    status: Literal["accepted"] = "accepted"
    payload_id: str
    tenant_id: str
    ingested_at: str
    duplicate: bool
