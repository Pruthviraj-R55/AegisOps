"""Tenant-scoped dashboard and observability read endpoints."""

from typing import Any, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from saas.database import (
    get_dashboard_overview,
    get_db,
    get_tenant_collectors,
    get_tenant_incidents,
    get_tenant_services,
)
from saas.tenancy.auth import TenantContext, get_current_tenant

router = APIRouter(prefix="/api/v1", tags=["Dashboard"])


@router.get("/dashboard/overview")
def get_overview(
    auth: TenantContext = Depends(get_current_tenant),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Retrieve tenant-scoped fleet summary overview."""
    return get_dashboard_overview(session=db, tenant_id=auth.tenant_id)


@router.get("/services")
def list_services(
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    cursor: Optional[str] = Query(default=None, description="Pagination cursor"),
    auth: TenantContext = Depends(get_current_tenant),
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
    auth: TenantContext = Depends(get_current_tenant),
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


@router.get("/collectors")
def list_collectors(
    limit: int = Query(default=50, ge=1, le=200, description="Items per page"),
    cursor: Optional[str] = Query(default=None, description="Pagination cursor"),
    auth: TenantContext = Depends(get_current_tenant),
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
