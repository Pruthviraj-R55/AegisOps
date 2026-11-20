"""Tenant-scoped dashboard and observability read endpoints."""

from datetime import datetime, timezone
from typing import Any, Optional
from fastapi import APIRouter, BackgroundTasks, Depends, Query
from sqlalchemy.orm import Session

from saas.database import (
    get_dashboard_overview,
    get_db,
    get_tenant_collectors,
    get_tenant_incidents,
    get_tenant_incident_evidence,
    get_tenant_services,
    get_tenant_telemetry_history,
)
from saas.api.errors import ProblemException
from saas.tenancy.auth import TenantContext, get_dashboard_tenant
from saas.database.models import IncidentAnalysis, IncidentRecord
from saas.database import format_rfc3339_z
from saas.config import get_settings

router = APIRouter(prefix="/api/v1", tags=["Dashboard"])


def _history_response(
    db: Session,
    tenant_id: str,
    limit: int,
    cursor: str | None,
    start_time: datetime | None,
    end_time: datetime | None,
    *,
    security_only: bool = False,
) -> dict[str, Any]:
    if start_time is not None and start_time.tzinfo is None:
        raise ProblemException(422, "invalid_time_range", "Invalid time range", "start_time must include a timezone.")
    if end_time is not None and end_time.tzinfo is None:
        raise ProblemException(422, "invalid_time_range", "Invalid time range", "end_time must include a timezone.")
    if start_time is not None and end_time is not None and start_time.astimezone(timezone.utc) > end_time.astimezone(timezone.utc):
        raise ProblemException(422, "invalid_time_range", "Invalid time range", "start_time must be earlier than or equal to end_time.")
    try:
        return get_tenant_telemetry_history(
            session=db,
            tenant_id=tenant_id,
            limit=limit,
            cursor=cursor,
            start_time=start_time,
            end_time=end_time,
            security_only=security_only,
        )
    except ValueError:
        raise ProblemException(422, "invalid_cursor", "Invalid cursor", "The history cursor is invalid.") from None


@router.get("/dashboard/overview")
def get_overview(
    auth: TenantContext = Depends(get_dashboard_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retrieve tenant-scoped fleet summary overview."""
    return get_dashboard_overview(session=db, tenant_id=auth.tenant_id)


@router.get("/telemetry")
def list_telemetry_history(
    limit: int = Query(default=50, ge=1, le=200),
    cursor: Optional[str] = Query(default=None),
    start_time: datetime | None = Query(default=None),
    end_time: datetime | None = Query(default=None),
    auth: TenantContext = Depends(get_dashboard_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retrieve tenant-scoped telemetry ordered by source event time."""
    return _history_response(db, auth.tenant_id, limit, cursor, start_time, end_time)


@router.get("/security-events")
def list_security_history(
    limit: int = Query(default=50, ge=1, le=200),
    cursor: Optional[str] = Query(default=None),
    start_time: datetime | None = Query(default=None),
    end_time: datetime | None = Query(default=None),
    auth: TenantContext = Depends(get_dashboard_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retrieve telemetry records with non-zero schema-supported security counts."""
    return _history_response(db, auth.tenant_id, limit, cursor, start_time, end_time, security_only=True)


@router.get("/services")
def list_services(
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    cursor: Optional[str] = Query(default=None, description="Pagination cursor"),
    auth: TenantContext = Depends(get_dashboard_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retrieve current service health items scoped to authenticated tenant."""
    items = get_tenant_services(
        session=db,
        tenant_id=auth.tenant_id,
        limit=limit,
        cursor=cursor,
    )
    return {"items": items}


@router.get("/incidents")
def list_incidents(
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    cursor: Optional[str] = Query(default=None, description="Pagination cursor"),
    auth: TenantContext = Depends(get_dashboard_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retrieve open/recent incident items scoped to authenticated tenant."""
    items = get_tenant_incidents(
        session=db,
        tenant_id=auth.tenant_id,
        limit=limit,
        cursor=cursor,
    )
    return {"items": items}


@router.get("/incidents/{incident_id}/evidence")
def get_incident_evidence(
    incident_id: str,
    auth: TenantContext = Depends(get_dashboard_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retrieve persisted tenant-scoped telemetry records supporting an incident."""
    items = get_tenant_incident_evidence(db, auth.tenant_id, incident_id)
    if items is None:
        raise ProblemException(404, "not_found", "Not Found", "Incident was not found.")
    return {"items": items}


def _analysis_response(item: IncidentAnalysis) -> dict[str, Any]:
    return {
        "incident_id": item.incident_id,
        "status": item.status,
        "provider": item.provider,
        "model": item.model,
        "prompt_version": item.prompt_version,
        "prompt_hash": item.prompt_hash,
        "evidence_ids": item.evidence_ids,
        "result": item.result,
        "created_at": format_rfc3339_z(item.created_at),
        "updated_at": format_rfc3339_z(item.updated_at),
        "completed_at": format_rfc3339_z(item.completed_at) if item.completed_at else None,
        "safe_error_code": item.safe_error_code,
    }


@router.get("/incidents/{incident_id}/analysis")
def get_incident_analysis(
    incident_id: str,
    auth: TenantContext = Depends(get_dashboard_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retrieve AI analysis and provenance scoped to the authenticated tenant."""
    incident = db.query(IncidentRecord).filter_by(tenant_id=auth.tenant_id, incident_id=incident_id).first()
    if incident is None:
        raise ProblemException(404, "not_found", "Not Found", "Incident was not found.")
    item = db.query(IncidentAnalysis).filter_by(tenant_id=auth.tenant_id, incident_id=incident_id).first()
    if item is None:
        return {"incident_id": incident_id, "status": "not_requested", "result": None}
    return _analysis_response(item)


@router.post("/incidents/{incident_id}/analysis/retry", status_code=202)
def retry_incident_analysis(
    incident_id: str,
    background_tasks: BackgroundTasks,
    auth: TenantContext = Depends(get_dashboard_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retry a failed advisory analysis for a tenant-owned incident."""
    if not get_settings().ai_enabled:
        raise ProblemException(503, "analysis_disabled", "Analysis disabled", "Advisory incident analysis is disabled.")
    item = db.query(IncidentAnalysis).filter_by(tenant_id=auth.tenant_id, incident_id=incident_id).first()
    if item is None:
        raise ProblemException(404, "not_found", "Not Found", "Incident analysis was not found.")
    if item.status != "failed":
        raise ProblemException(409, "analysis_not_retryable", "Conflict", "Only failed incident analyses can be retried.")
    from saas.aiops.analysis_service import execute_analysis, prepare_analysis
    if not prepare_analysis(db, auth.tenant_id, incident_id):
        raise ProblemException(409, "analysis_not_retryable", "Conflict", "Incident evidence is unavailable for analysis.")
    background_tasks.add_task(execute_analysis, auth.tenant_id, incident_id)
    refreshed = db.query(IncidentAnalysis).filter_by(tenant_id=auth.tenant_id, incident_id=incident_id).first()
    return _analysis_response(refreshed)


@router.get("/collectors")
def list_collectors(
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    cursor: Optional[str] = Query(default=None, description="Pagination cursor"),
    auth: TenantContext = Depends(get_dashboard_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retrieve collector connection and freshness items scoped to authenticated tenant."""
    items = get_tenant_collectors(
        session=db,
        tenant_id=auth.tenant_id,
        limit=limit,
        cursor=cursor,
    )
    return {"items": items}
