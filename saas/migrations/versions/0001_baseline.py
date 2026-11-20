"""Baseline for the existing SaaS schema plus persisted incident evidence.

Revision ID: 0001_baseline
Revises:
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy import inspect

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing = set(inspector.get_table_names())

    if "telemetry_records" not in existing:
        op.create_table(
            "telemetry_records",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.String(length=128), nullable=False),
            sa.Column("payload_id", sa.String(length=64), nullable=False),
            sa.Column("collector_id", sa.String(length=128), nullable=False),
            sa.Column("schema_version", sa.String(length=32), nullable=False),
            sa.Column("event_time", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("service", sa.String(length=128), nullable=False),
            sa.Column("environment", sa.String(length=64), nullable=False),
            sa.Column("region", sa.String(length=128), nullable=True),
            sa.Column("metrics", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
            sa.Column("security", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
            sa.Column("health", sa.String(length=32), nullable=False),
            sa.Column("payload_hash", sa.String(length=64), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "payload_id", name="uq_telemetry_tenant_payload"),
        )

    inspector = inspect(bind)
    existing = set(inspector.get_table_names())
    if "payload_idempotency" not in existing:
        op.create_table(
            "payload_idempotency",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.String(length=128), nullable=False),
            sa.Column("payload_id", sa.String(length=64), nullable=False),
            sa.Column("payload_hash", sa.String(length=64), nullable=False),
            sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "payload_id", name="uq_idempotency_tenant_payload"),
        )

    inspector = inspect(bind)
    existing = set(inspector.get_table_names())
    if "incidents" not in existing:
        op.create_table(
            "incidents",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.String(length=128), nullable=False),
            sa.Column("incident_id", sa.String(length=64), nullable=False),
            sa.Column("service", sa.String(length=128), nullable=False),
            sa.Column("severity", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("contributing_signals", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
            sa.Column("confidence", sa.Float(), nullable=False),
            sa.Column("recommended_action", sa.String(length=512), nullable=False),
            sa.Column("rollback_plan", sa.String(length=512), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    # PostgreSQL requires a unique key on incident_id before the evidence FK is added.
    incident_indexes = {index["name"] for index in inspect(bind).get_indexes("incidents")}
    if "ix_incidents_incident_id" not in incident_indexes:
        op.create_index("ix_incidents_incident_id", "incidents", ["incident_id"], unique=True)
    if "uq_incidents_tenant_incident" not in incident_indexes:
        op.create_index("uq_incidents_tenant_incident", "incidents", ["tenant_id", "incident_id"], unique=True)

    inspector = inspect(bind)
    existing = set(inspector.get_table_names())
    if "incident_evidence" not in existing:
        op.create_table(
            "incident_evidence",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.String(length=128), nullable=False),
            sa.Column("incident_id", sa.String(length=64), nullable=False),
            sa.Column("payload_id", sa.String(length=64), nullable=False),
            sa.Column("event_time", sa.DateTime(timezone=True), nullable=False),
            sa.Column("signals", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
            sa.ForeignKeyConstraint(
                ["tenant_id", "incident_id"],
                ["incidents.tenant_id", "incidents.incident_id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["tenant_id", "payload_id"],
                ["telemetry_records.tenant_id", "telemetry_records.payload_id"],
                ondelete="CASCADE",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "incident_id", "payload_id", name="uq_incident_evidence_payload"),
        )

    _ensure_indexes(bind)


def _ensure_indexes(bind) -> None:
    desired = {
        "telemetry_records": [
            ("ix_telemetry_records_tenant_id", ["tenant_id"], False),
            ("ix_telemetry_records_service", ["service"], False),
            ("ix_telemetry_tenant_event_time", ["tenant_id", "event_time"], False),
            ("ix_telemetry_tenant_service", ["tenant_id", "service"], False),
        ],
        "payload_idempotency": [
            ("ix_payload_idempotency_tenant_id", ["tenant_id"], False),
            ("ix_idempotency_lookup", ["tenant_id", "payload_id"], False),
        ],
        "incidents": [
            ("ix_incidents_tenant_id", ["tenant_id"], False),
            ("ix_incidents_incident_id", ["incident_id"], True),
            ("uq_incidents_tenant_incident", ["tenant_id", "incident_id"], True),
            ("ix_incidents_service", ["service"], False),
            ("ix_incidents_tenant_service", ["tenant_id", "service"], False),
            ("ix_incidents_tenant_status", ["tenant_id", "status"], False),
        ],
        "incident_evidence": [
            ("ix_incident_evidence_tenant_incident_time", ["tenant_id", "incident_id", "event_time"], False),
        ],
    }
    inspector = inspect(bind)
    for table, indexes in desired.items():
        present = {index["name"] for index in inspector.get_indexes(table)}
        for name, columns, unique in indexes:
            if name not in present:
                op.create_index(name, table, columns, unique=unique)
                present.add(name)


def downgrade() -> None:
    # This is a non-destructive adoption baseline; downgrades must not drop existing telemetry.
    pass
