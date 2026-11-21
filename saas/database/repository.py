"""Persistence, querying, and idempotency repository for telemetry records."""

from datetime import datetime, timezone
import base64
import hashlib
import json
import logging
from typing import Any, Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from saas.aiops.anomaly import detect_metric_anomalies
from saas.aiops.correlation import correlate_anomalies
from saas.aiops.health import evaluate_service_health
from saas.api.errors import ProblemException
from saas.config import get_settings
from saas.database.models import IncidentEvidence, IncidentRecord, PayloadIdempotency, TelemetryRecord
from saas.ingestion.schemas import TelemetryPayload
from saas.processing.staleness import collector_freshness, is_stale

logger = logging.getLogger("aegisops.saas.repository")


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


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _signal_evidence(signal: Any) -> dict[str, Any]:
    return {
        "metric": signal.metric,
        "observed_value": signal.current_value,
        "baseline": signal.expected_value,
        "sample_count": signal.sample_count,
        "threshold": signal.threshold,
        "deviation_score": signal.deviation_score,
        "method": signal.method,
        "severity": signal.severity,
        "event_time": format_rfc3339_z(signal.timestamp),
        "description": signal.description,
    }


def _security_response(record: TelemetryRecord) -> dict[str, Any] | None:
    """Represent v1.1.0 absence as unavailable; leave historical v1.0.0 untouched."""
    if record.schema_version == "1.1.0" and not record.security:
        return None
    return record.security


def _find_correlated_active_incident(
    session: Session,
    *,
    tenant_id: str,
    service: str,
    collector_id: str,
    environment: str,
    region: str | None,
    event_time: datetime,
    window_seconds: float,
) -> IncidentRecord | None:
    candidates = (
        session.query(IncidentRecord)
        .join(
            IncidentEvidence,
            and_(
                IncidentEvidence.tenant_id == IncidentRecord.tenant_id,
                IncidentEvidence.incident_id == IncidentRecord.incident_id,
            ),
        )
        .join(
            TelemetryRecord,
            and_(
                TelemetryRecord.tenant_id == IncidentEvidence.tenant_id,
                TelemetryRecord.payload_id == IncidentEvidence.payload_id,
            ),
        )
        .filter(
            IncidentRecord.tenant_id == tenant_id,
            IncidentRecord.status == "active",
            TelemetryRecord.service == service,
            TelemetryRecord.collector_id == collector_id,
            TelemetryRecord.environment == environment,
            TelemetryRecord.region == region,
        )
        .distinct()
        .all()
    )
    nearest: tuple[float, IncidentRecord] | None = None
    for candidate in candidates:
        evidence_times = (
            session.query(IncidentEvidence.event_time)
            .filter_by(tenant_id=tenant_id, incident_id=candidate.incident_id)
            .all()
        )
        times = [_utc(item[0]) for item in evidence_times]
        if not times:
            continue
        distance = min(abs((_utc(event_time) - item).total_seconds()) for item in times)
        if distance <= window_seconds and (nearest is None or distance < nearest[0]):
            nearest = (distance, candidate)
    return nearest[1] if nearest else None


def _detect_and_persist_incident(
    session: Session,
    record: TelemetryRecord,
    payload: TelemetryPayload,
) -> None:
    event_time = _utc(record.event_time)
    recent_history = (
        session.query(TelemetryRecord)
        .filter(
            TelemetryRecord.tenant_id == record.tenant_id,
            TelemetryRecord.service == record.service,
            TelemetryRecord.collector_id == record.collector_id,
            TelemetryRecord.environment == record.environment,
            TelemetryRecord.region == record.region,
            TelemetryRecord.event_time < event_time,
            TelemetryRecord.id != record.id,
        )
        .order_by(TelemetryRecord.event_time.desc(), TelemetryRecord.id.desc())
        .limit(50)
        .all()
    )
    history_dicts = [
        {"metrics": item.metrics, "security": item.security, "event_time": item.event_time}
        for item in reversed(recent_history)
    ]
    current_dict = {
        "metrics": payload.metrics.model_dump(mode="json", exclude_none=True),
        "security": payload.security.model_dump(mode="json", exclude_none=True) if payload.security is not None else {},
        "event_time": event_time,
    }
    settings = get_settings()
    window_seconds = settings.incident_correlation_window_seconds
    anomalies = detect_metric_anomalies(history_dicts, current_dict)
    correlated = correlate_anomalies(
        service=record.service,
        anomalies=anomalies,
        time_window_seconds=window_seconds,
    )
    if correlated is None:
        return

    incident = _find_correlated_active_incident(
        session,
        tenant_id=record.tenant_id,
        service=record.service,
        collector_id=record.collector_id,
        environment=record.environment,
        region=record.region,
        event_time=event_time,
        window_seconds=window_seconds,
    )
    if incident is None:
        incident = IncidentRecord(
            tenant_id=record.tenant_id,
            incident_id=correlated.incident_id,
            service=record.service,
            severity=correlated.severity,
            status="active",
            started_at=event_time,
            last_seen_at=event_time,
            contributing_signals=[],
            confidence=correlated.confidence,
            recommended_action=correlated.recommended_action,
            rollback_plan=correlated.rollback_plan,
        )
        session.add(incident)
        session.flush()
    else:
        incident.started_at = min(_utc(incident.started_at), event_time)
        incident.last_seen_at = max(_utc(incident.last_seen_at), event_time)
        severity_order = {"low": 1, "medium": 2, "high": 3, "critical": 4}
        if severity_order.get(correlated.severity, 0) > severity_order.get(incident.severity, 0):
            incident.severity = correlated.severity
        incident.confidence = max(incident.confidence, correlated.confidence)
        incident.recommended_action = correlated.recommended_action
        incident.rollback_plan = correlated.rollback_plan

    merged_signals = list(incident.contributing_signals or [])
    for signal in correlated.contributing_signals:
        if signal not in merged_signals:
            merged_signals.append(signal)
    incident.contributing_signals = merged_signals

    session.add(
        IncidentEvidence(
            tenant_id=record.tenant_id,
            incident_id=incident.incident_id,
            payload_id=record.payload_id,
            event_time=event_time,
            signals=[_signal_evidence(signal) for signal in anomalies],
        )
    )


def record_telemetry(
    session: Session,
    payload: TelemetryPayload,
    authenticated_tenant_id: str,
    authenticated_collector_id: str,
) -> tuple[datetime, bool]:
    """
    Persist telemetry record with idempotency semantics.

    Returns:
        tuple[datetime, bool]: (ingested_at, is_duplicate)

    Raises:
        ProblemException: 403 on tenant/collector mismatch, 409 on idempotency conflict.
    """
    if payload.tenant_id != authenticated_tenant_id:
        raise ProblemException(
            status_code=403,
            code="tenant_mismatch",
            title="Forbidden",
            detail="Payload tenant does not match the authenticated credential.",
        )

    if payload.collector_id != authenticated_collector_id:
        raise ProblemException(
            status_code=403,
            code="collector_mismatch",
            title="Forbidden",
            detail="Payload collector does not match the authenticated credential.",
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
        security=payload.security.model_dump(mode="json", exclude_none=True) if payload.security is not None else {},
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
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
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
            detail="Payload ID was already used with different content.",
        ) from None

    # Keep telemetry durable even if detection fails, but isolate detector writes
    # in a savepoint so a failed incident query cannot poison the ingest transaction.
    try:
        with session.begin_nested():
            _detect_and_persist_incident(session, record, payload)
    except Exception:
        logger.error("Deterministic detection failed; telemetry will still be committed")

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


def encode_history_cursor(event_time: datetime, payload_id: str) -> str:
    """Encode the event-time/payload keyset cursor as an opaque URL-safe token."""
    value = json.dumps([format_rfc3339_z(_utc(event_time)), payload_id], separators=(",", ":"))
    return base64.urlsafe_b64encode(value.encode("utf-8")).decode("ascii").rstrip("=")


def decode_history_cursor(cursor: str) -> tuple[datetime, str]:
    """Decode a history cursor, rejecting malformed input without leaking details."""
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        event_time, payload_id = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
        if not isinstance(event_time, str) or not isinstance(payload_id, str) or not payload_id:
            raise ValueError
        parsed_time = parse_rfc3339_z(event_time)
        if parsed_time.tzinfo is None:
            raise ValueError
        return _utc(parsed_time), payload_id
    except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError("invalid history cursor") from None


def get_tenant_telemetry_history(
    session: Session,
    tenant_id: str,
    *,
    limit: int = 50,
    cursor: str | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    security_only: bool = False,
) -> dict[str, Any]:
    """Return tenant-scoped telemetry in event-time order with keyset pagination."""
    query = session.query(TelemetryRecord).filter(TelemetryRecord.tenant_id == tenant_id)
    if start_time is not None:
        query = query.filter(TelemetryRecord.event_time >= _utc(start_time))
    if end_time is not None:
        query = query.filter(TelemetryRecord.event_time <= _utc(end_time))
    if security_only:
        failed_logins = func.coalesce(TelemetryRecord.security["failed_login_count"].as_integer(), 0)
        suspicious = func.coalesce(TelemetryRecord.security["suspicious_activity_count"].as_integer(), 0)
        query = query.filter(or_(failed_logins > 0, suspicious > 0))
    if cursor:
        cursor_time, cursor_payload_id = decode_history_cursor(cursor)
        query = query.filter(
            or_(
                TelemetryRecord.event_time < cursor_time,
                and_(
                    TelemetryRecord.event_time == cursor_time,
                    TelemetryRecord.payload_id < cursor_payload_id,
                ),
            )
        )

    records = (
        query.order_by(TelemetryRecord.event_time.desc(), TelemetryRecord.payload_id.desc())
        .limit(limit + 1)
        .all()
    )
    has_more = len(records) > limit
    page = records[:limit]
    items = [
        {
            "payload_id": record.payload_id,
            "collector_id": record.collector_id,
            "schema_version": record.schema_version,
            "event_time": format_rfc3339_z(record.event_time),
            "ingested_at": format_rfc3339_z(record.ingested_at),
            "service": record.service,
            "environment": record.environment,
            "region": record.region,
            "metrics": record.metrics,
            "security": _security_response(record),
            "health": record.health,
        }
        for record in page
    ]
    next_cursor = encode_history_cursor(page[-1].event_time, page[-1].payload_id) if has_more and page else None
    return {"items": items, "next_cursor": next_cursor, "has_more": has_more, "limit": limit}


def get_tenant_incident_evidence(
    session: Session,
    tenant_id: str,
    incident_id: str,
) -> list[dict[str, Any]] | None:
    """Return persisted telemetry references for an incident, or None if out of scope."""
    incident_exists = (
        session.query(IncidentRecord.id)
        .filter_by(tenant_id=tenant_id, incident_id=incident_id)
        .first()
    )
    if incident_exists is None:
        return None
    rows = (
        session.query(IncidentEvidence, TelemetryRecord)
        .join(
            TelemetryRecord,
            and_(
                TelemetryRecord.tenant_id == IncidentEvidence.tenant_id,
                TelemetryRecord.payload_id == IncidentEvidence.payload_id,
            ),
        )
        .filter(
            IncidentEvidence.tenant_id == tenant_id,
            IncidentEvidence.incident_id == incident_id,
            TelemetryRecord.tenant_id == tenant_id,
        )
        .order_by(IncidentEvidence.event_time.asc(), IncidentEvidence.payload_id.asc())
        .all()
    )
    return [
        {
            "payload_id": evidence.payload_id,
            "event_time": format_rfc3339_z(evidence.event_time),
            "ingested_at": format_rfc3339_z(record.ingested_at),
            "service": record.service,
            "collector_id": record.collector_id,
            "environment": record.environment,
            "region": record.region,
            "metrics": record.metrics,
            "security": _security_response(record),
            "signals": evidence.signals,
        }
        for evidence, record in rows
    ]


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
                "security_status": health_eval.security_status,
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
