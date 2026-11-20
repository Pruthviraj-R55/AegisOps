"""SQLAlchemy 2.0 database models for AegisOps SaaS."""

from datetime import datetime
from typing import Any, Optional
from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, ForeignKeyConstraint, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import JSON


class Base(DeclarativeBase):
    """Declarative base class for SaaS models."""
    pass


class TelemetryRecord(Base):
    """Durably committed telemetry record."""

    __tablename__ = "telemetry_records"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    payload_id: Mapped[str] = mapped_column(String(64), nullable=False)
    collector_id: Mapped[str] = mapped_column(String(128), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(32), nullable=False, default="1.0.0")
    event_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    service: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    environment: Mapped[str] = mapped_column(String(64), nullable=False)
    region: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    metrics: Mapped[dict[str, Any]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=False
    )
    security: Mapped[dict[str, Any]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=False
    )
    health: Mapped[str] = mapped_column(String(32), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "payload_id", name="uq_telemetry_tenant_payload"),
        Index("ix_telemetry_tenant_event_time", "tenant_id", "event_time"),
        Index("ix_telemetry_tenant_service", "tenant_id", "service"),
    )


class PayloadIdempotency(Base):
    """Idempotency tracking record for deduplication and conflict detection."""

    __tablename__ = "payload_idempotency"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    payload_id: Mapped[str] = mapped_column(String(64), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "payload_id", name="uq_idempotency_tenant_payload"),
        Index("ix_idempotency_lookup", "tenant_id", "payload_id"),
    )


class IncidentRecord(Base):
    """Correlated operational incident."""

    __tablename__ = "incidents"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    incident_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    service: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    contributing_signals: Mapped[list[str]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=False
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    recommended_action: Mapped[str] = mapped_column(String(512), nullable=False)
    rollback_plan: Mapped[str] = mapped_column(String(512), nullable=False)

    __table_args__ = (
        Index("ix_incidents_tenant_service", "tenant_id", "service"),
        Index("ix_incidents_tenant_status", "tenant_id", "status"),
        Index("uq_incidents_tenant_incident", "tenant_id", "incident_id", unique=True),
    )


class IncidentEvidence(Base):
    """Tenant-scoped link between a persisted incident and its telemetry evidence."""

    __tablename__ = "incident_evidence"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False)
    incident_id: Mapped[str] = mapped_column(String(64), nullable=False)
    payload_id: Mapped[str] = mapped_column(String(64), nullable=False)
    event_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    signals: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON().with_variant(JSONB, "postgresql"), nullable=False
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "payload_id"],
            ["telemetry_records.tenant_id", "telemetry_records.payload_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "incident_id"],
            ["incidents.tenant_id", "incidents.incident_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("tenant_id", "incident_id", "payload_id", name="uq_incident_evidence_payload"),
        Index("ix_incident_evidence_tenant_incident_time", "tenant_id", "incident_id", "event_time"),
    )


class IncidentAnalysis(Base):
    """Advisory AI analysis with tenant-owned incident provenance."""

    __tablename__ = "incident_analyses"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False)
    incident_id: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="openrouter")
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(32), nullable=False)
    prompt_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    evidence_ids: Mapped[list[str]] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=False)
    result: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    safe_error_code: Mapped[Optional[str]] = mapped_column(String(48), nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["incident_id"],
            ["incidents.incident_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("tenant_id", "incident_id", name="uq_analysis_tenant_incident"),
        Index("ix_analysis_tenant_status", "tenant_id", "status"),
    )


class DashboardUser(Base):
    """Provisioned dashboard identity; passwords are stored only as scrypt hashes."""

    __tablename__ = "dashboard_users"

    user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class DashboardSession(Base):
    """Server-side dashboard session; only a hash of the cookie token is persisted."""

    __tablename__ = "dashboard_sessions"

    session_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    csrf_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("dashboard_users.user_id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class DashboardLoginThrottle(Base):
    """Database-backed bounded login attempts keyed by a hash of client and account."""

    __tablename__ = "dashboard_login_throttles"

    attempt_key_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    failure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    blocked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
