"""Persistence, querying, and idempotency repository for telemetry records."""

from datetime import datetime, timezone
import hashlib
import json
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from saas.aiops.anomaly import detect_metric_anomalies
from saas.aiops.correlation import correlate_anomalies
from saas.aiops.health import evaluate_service_health
from saas.api.errors import ProblemException
from saas.database.models import IncidentRecord, PayloadIdempotency, TelemetryRecord
from saas.ingestion.schemas import TelemetryPayload
from saas.processing.staleness import collector_freshness, is_stale


def compute_payload_hash(payload_data: dict[str, Any]) -> str:
    """Compute SHA-256 hash of canonical sorted JSON."""
    canonical_json = json.dumps(payload_data, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def format_rfc3339_z(dt: datetime) -> str:
    """Format a datetime to RFC 3339 UTC representation ending in 'Z' with millisecond precision."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def parse_rfc3339_z(ts_str: str) -> datetime:
    """Parse an RFC 3339 UTC string ending in 'Z' to a datetime with UTC timezone."""
    if ts_str.endswith("Z"):
        ts_str = ts_str[:-1] + "+00:00"
    return datetime.fromisoformat(ts_str)


def record_telemetry(
    session: Session,
    payload: TelemetryPayload,
    authenticated_tenant_id: str,
) -> tuple[datetime, bool]:
    """
    Persist telemetry record with idempotency semantics.

    Returns:
        tuple[datetime, bool]: (ingested_at, is_duplicate)

    Raises:
        ProblemException: 403 on tenant mismatch, 409 on idempotency conflict.
    """
    if payload.tenant_id != authenticated_tenant_id:
        raise ProblemException(
            status_code=403,
            code="tenant_mismatch",
            title="Forbidden",
            detail=f"Payload tenant '{payload.tenant_id}' does not match authenticated tenant '{authenticated_tenant_id}'.",
        )

    payload_dict = payload.model_dump(mode="json")
    payload_hash = compute_payload_hash(payload_dict)
    payload_id_str = str(payload.payload_id)

    # Check for existing idempotency record
    existing = (
        session.query(PayloadIdempotency)
        .filter_by(tenant_id=payload.tenant_id, payload_id=payload_id_str)
        .first()
    )

    if existing is not None:
        if existing.payload_hash == payload_hash:
            # Safe duplicate retry: return original ingested_at
            return existing.ingested_at, True
        else:
            # Reused payload_id with different content
            session.rollback()
            raise ProblemException(
                status_code=409,
                code="idempotency_conflict",
                title="Conflict",
                detail=f"Payload ID '{payload_id_str}' was previously ingested with different content.",
            )

    # Brand-new record
    now = datetime.now(timezone.utc)
    event_dt = parse_rfc3339_z(payload.event_time)

    record = TelemetryRecord(
        tenant_id=payload.tenant_id,
        payload_id=payload_id_str,
        collector_id=payload.collector_id,
        schema_version=payload.schema_version,
        event_time=event_dt,
        ingested_at=now,
        service=payload.service,
        environment=payload.environment,
        region=payload.region,
        metrics=payload.metrics.model_dump(mode="json", exclude_none=True),
        security=payload.security.model_dump(mode="json", exclude_none=True),
        health=payload.health.value,
        payload_hash=payload_hash,
    )

    idempotency = PayloadIdempotency(
        tenant_id=payload.tenant_id,
        payload_id=payload_id_str,
        payload_hash=payload_hash,
        ingested_at=now,
    )

    session.add(record)
    session.add(idempotency)

    # Trigger AIOps anomaly detection and correlation
    try:
        recent_history = (
            session.query(TelemetryRecord)
            .filter_by(tenant_id=payload.tenant_id, service=payload.service)
            .order_by(TelemetryRecord.event_time.desc())
            .limit(10)
            .all()
        )
        history_dicts = [
            {
                "metrics": r.metrics,
                "security": r.security,
                "event_time": r.event_time,
            }
            for r in recent_history
        ]
        current_dict = {
            "metrics": payload.metrics.model_dump(mode="json", exclude_none=True),
            "security": payload.security.model_dump(mode="json", exclude_none=True),
            "event_time": event_dt,
        }
        anomalies = detect_metric_anomalies(history_dicts, current_dict)
        if anomalies:
            correlated = correlate_anomalies(service=payload.service, anomalies=anomalies)
            if correlated:
                active_inc = (
                    session.query(IncidentRecord)
                    .filter_by(tenant_id=payload.tenant_id, service=payload.service, status="active")
                    .first()
                )
                if active_inc:
                    active_inc.last_seen_at = event_dt
                    active_inc.confidence = correlated.confidence
                    active_inc.severity = correlated.severity
                    combined_signals = list(
                        set(active_inc.contributing_signals + correlated.contributing_signals)
                    )
                    active_inc.contributing_signals = combined_signals
                    active_inc.recommended_action = correlated.recommended_action
                    active_inc.rollback_plan = correlated.rollback_plan
                else:
                    inc_record = IncidentRecord(
                        tenant_id=payload.tenant_id,
                        incident_id=correlated.incident_id,
                        service=correlated.service,
                        severity=correlated.severity,
                        status="active",
                        started_at=parse_rfc3339_z(correlated.started_at),
                        last_seen_at=parse_rfc3339_z(correlated.last_seen_at),
                        contributing_signals=correlated.contributing_signals,
                        confidence=correlated.confidence,
                        recommended_action=correlated.recommended_action,
                        rollback_plan=correlated.rollback_plan,
                    )
                    session.add(inc_record)
    except Exception:
        # AIOps analysis failure must never impede reliable telemetry ingestion
        pass

    try:
        session.commit()
        return now, False
    except IntegrityError:
        session.rollback()
        # Handle concurrent insertion race condition
        existing = (
            session.query(PayloadIdempotency)
            .filter_by(tenant_id=payload.tenant_id, payload_id=payload_id_str)
            .first()
        )
        if existing is not None and existing.payload_hash == payload_hash:
            return existing.ingested_at, True

        raise ProblemException(
            status_code=409,
            code="idempotency_conflict",
            title="Conflict",
            detail=f"Payload ID '{payload_id_str}' was previously ingested with different content.",
        )


def get_tenant_services(
    session: Session,
    tenant_id: str,
    limit: int = 50,
    cursor: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Retrieve current service health items scoped strictly to tenant_id."""
    subq = (
        session.query(
            TelemetryRecord.service,
            func.max(TelemetryRecord.event_time).label("max_event_time"),
        )
        .filter(TelemetryRecord.tenant_id == tenant_id)
        .group_by(TelemetryRecord.service)
        .subquery()
    )

    offset = 0
    if cursor:
        try:
            offset = max(0, int(cursor))
        except ValueError:
            pass

    records = (
        session.query(TelemetryRecord)
        .join(
            subq,
            (TelemetryRecord.service == subq.c.service)
            & (TelemetryRecord.event_time == subq.c.max_event_time),
        )
        .filter(TelemetryRecord.tenant_id == tenant_id)
        .order_by(TelemetryRecord.service.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    results = []
    for r in records:
        stale = is_stale(r.event_time)
        health_eval = evaluate_service_health(
            metrics=r.metrics,
            security=r.security,
            is_stale=stale,
        )
        results.append(
            {
                "service": r.service,
                "environment": r.environment,
                "region": r.region,
                "health": health_eval.health,
                "health_score": health_eval.health_score,
                "last_event_time": format_rfc3339_z(r.event_time),
                "stale": stale,
                "metrics": r.metrics,
            }
        )
    return results


def get_tenant_collectors(
    session: Session,
    tenant_id: str,
    limit: int = 50,
    cursor: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Retrieve collector connection and freshness items scoped strictly to tenant_id."""
    subq = (
        session.query(
            TelemetryRecord.collector_id,
            func.max(TelemetryRecord.ingested_at).label("max_ingested_at"),
        )
        .filter(TelemetryRecord.tenant_id == tenant_id)
        .group_by(TelemetryRecord.collector_id)
        .subquery()
    )

    offset = 0
    if cursor:
        try:
            offset = max(0, int(cursor))
        except ValueError:
            pass

    records = (
        session.query(TelemetryRecord)
        .join(
            subq,
            (TelemetryRecord.collector_id == subq.c.collector_id)
            & (TelemetryRecord.ingested_at == subq.c.max_ingested_at),
        )
        .filter(TelemetryRecord.tenant_id == tenant_id)
        .order_by(TelemetryRecord.collector_id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    results = []
    for r in records:
        stale, status_label = collector_freshness(r.ingested_at)
        results.append(
            {
                "collector_id": r.collector_id,
                "status": status_label,
                "last_seen_at": format_rfc3339_z(r.ingested_at),
                "last_payload_id": r.payload_id,
                "pending_count": 0,
            }
        )
    return results


def get_tenant_incidents(
    session: Session,
    tenant_id: str,
    limit: int = 50,
    cursor: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Retrieve open/recent incident items scoped strictly to tenant_id."""
    offset = 0
    if cursor:
        try:
            offset = max(0, int(cursor))
        except ValueError:
            pass

    incidents = (
        session.query(IncidentRecord)
        .filter(IncidentRecord.tenant_id == tenant_id)
        .order_by(IncidentRecord.started_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    results = []
    for inc in incidents:
        results.append(
            {
                "incident_id": inc.incident_id,
                "service": inc.service,
                "severity": inc.severity,
                "status": inc.status,
                "started_at": format_rfc3339_z(inc.started_at),
                "last_seen_at": format_rfc3339_z(inc.last_seen_at),
                "contributing_signals": inc.contributing_signals,
                "confidence": inc.confidence,
                "recommended_action": inc.recommended_action,
                "rollback_plan": inc.rollback_plan,
            }
        )
    return results


def get_dashboard_overview(
    session: Session,
    tenant_id: str,
) -> dict[str, Any]:
    """Calculate fleet summary overview scoped strictly to tenant_id."""
    services = get_tenant_services(session, tenant_id=tenant_id, limit=200)

    service_counts = {
        "excellent": 0,
        "good": 0,
        "fair": 0,
        "poor": 0,
    }
    stale_service_count = 0

    for s in services:
        h = s["health"]
        if h in service_counts:
            service_counts[h] += 1
        if s["stale"]:
            stale_service_count += 1

    if service_counts["poor"] > 0:
        overall_health = "poor"
    elif service_counts["fair"] > 0:
        overall_health = "fair"
    elif service_counts["good"] > 0:
        overall_health = "good"
    else:
        overall_health = "excellent"

    active_incidents = (
        session.query(func.count(IncidentRecord.id))
        .filter(IncidentRecord.tenant_id == tenant_id, IncidentRecord.status == "active")
        .scalar()
        or 0
    )

    return {
        "generated_at": format_rfc3339_z(datetime.now(timezone.utc)),
        "overall_health": overall_health,
        "service_counts": service_counts,
        "active_incident_count": active_incidents,
        "stale_service_count": stale_service_count,
    }
