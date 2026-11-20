"""Persistence and post-commit execution for optional incident reasoning."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from saas.aiops.reasoning import (
    PROMPT_VERSION,
    PROVIDER,
    ProviderFailure,
    _request_material,
    get_analysis_provider,
    sanitized_evidence,
)
from saas.aiops.fusion import fuse_advisory_analysis
from saas.database.models import IncidentAnalysis, IncidentEvidence, IncidentRecord
from saas.database.session import SessionLocal
from saas.config import get_settings

logger = logging.getLogger("aegisops.saas.ai_reasoning")


def _evidence_rows(session: Session, tenant_id: str, incident_id: str) -> list[dict]:
    rows = (
        session.query(IncidentEvidence)
        .filter_by(tenant_id=tenant_id, incident_id=incident_id)
        .order_by(IncidentEvidence.event_time.asc(), IncidentEvidence.payload_id.asc())
        .all()
    )
    return [
        {"evidence_id": item.payload_id, "signals": item.signals}
        for item in rows
    ]


def prepare_analysis(session: Session, tenant_id: str, incident_id: str) -> bool:
    """Persist pending status and prompt provenance before making a provider call."""
    incident = session.query(IncidentRecord).filter_by(tenant_id=tenant_id, incident_id=incident_id).first()
    if incident is None:
        return False
    rows = _evidence_rows(session, tenant_id, incident_id)
    try:
        safe = sanitized_evidence(rows)
        _messages, prompt_hash = _request_material(
            safe, {"incident_id": incident.incident_id, "severity": incident.severity}
        )
    except ProviderFailure as exc:
        now = datetime.now(timezone.utc)
        analysis = session.query(IncidentAnalysis).filter_by(tenant_id=tenant_id, incident_id=incident_id).first()
        if analysis is None:
            analysis = IncidentAnalysis(
                tenant_id=tenant_id, incident_id=incident_id, status="failed", provider=PROVIDER,
                model="unconfigured", prompt_version=PROMPT_VERSION, prompt_hash="0" * 64,
                evidence_ids=[item["evidence_id"] for item in rows], result=None,
                created_at=now, updated_at=now, completed_at=now, safe_error_code=exc.code,
            )
            session.add(analysis)
        else:
            analysis.status = "failed"
            analysis.safe_error_code = exc.code
            analysis.updated_at = now
            analysis.completed_at = now
        session.commit()
        return False
    config = get_settings()
    now = datetime.now(timezone.utc)
    analysis = session.query(IncidentAnalysis).filter_by(tenant_id=tenant_id, incident_id=incident_id).first()
    if analysis is None:
        analysis = IncidentAnalysis(
            tenant_id=tenant_id, incident_id=incident_id, created_at=now,
        )
        session.add(analysis)
    analysis.status = "pending"
    analysis.provider = PROVIDER
    analysis.model = config.openrouter_model
    analysis.prompt_version = PROMPT_VERSION
    analysis.prompt_hash = prompt_hash
    analysis.evidence_ids = sorted({row["evidence_id"] for row in safe})
    analysis.result = None
    analysis.updated_at = now
    analysis.completed_at = None
    analysis.safe_error_code = None
    session.commit()
    return True


def execute_analysis(tenant_id: str, incident_id: str) -> None:
    """Execute a previously persisted pending analysis; never raises into ingest."""
    db = SessionLocal()
    try:
        analysis = db.query(IncidentAnalysis).filter_by(tenant_id=tenant_id, incident_id=incident_id).first()
        if analysis is None or analysis.status != "pending":
            return
        if not get_settings().ai_enabled:
            _mark_failed(db, tenant_id, incident_id, "analysis_disabled")
            return
        rows = _evidence_rows(db, tenant_id, incident_id)
        evidence_ids = sorted({row["evidence_id"] for row in sanitized_evidence(rows)})
        incident = db.query(IncidentRecord).filter_by(tenant_id=tenant_id, incident_id=incident_id).first()
        if incident is None:
            _mark_failed(db, tenant_id, incident_id, "incident_not_found")
            return
        result, prompt_hash, model = get_analysis_provider().analyze(
            rows, incident_context={"incident_id": incident.incident_id, "severity": incident.severity}
        )
        # The model cannot alter deterministic incident severity or incident fields.
        analysis = db.query(IncidentAnalysis).filter_by(tenant_id=tenant_id, incident_id=incident_id).first()
        if analysis is None:
            return
        analysis.status = "completed"
        analysis.model = model
        analysis.prompt_hash = prompt_hash
        analysis.evidence_ids = evidence_ids
        analysis.result = {
            "analysis": result.model_dump(mode="json"),
            "fusion": fuse_advisory_analysis(incident.severity, result),
        }
        analysis.safe_error_code = None
        analysis.completed_at = datetime.now(timezone.utc)
        analysis.updated_at = analysis.completed_at
        db.commit()
    except ProviderFailure as exc:
        _mark_failed(db, tenant_id, incident_id, exc.code)
    except Exception:
        logger.error("Advisory incident analysis failed")
        _mark_failed(db, tenant_id, incident_id, "analysis_internal_error")
    finally:
        db.close()


def _mark_failed(db: Session, tenant_id: str, incident_id: str, code: str) -> None:
    try:
        analysis = db.query(IncidentAnalysis).filter_by(tenant_id=tenant_id, incident_id=incident_id).first()
        if analysis is not None:
            now = datetime.now(timezone.utc)
            analysis.status = "failed"
            analysis.safe_error_code = code
            analysis.updated_at = now
            analysis.completed_at = now
            analysis.result = None
            db.commit()
    except Exception:
        db.rollback()
        logger.error("Unable to persist advisory analysis failure status")


def process_payload_analyses(tenant_id: str, payload_id: str) -> None:
    """Find any committed incident evidence for a fresh payload and process it."""
    db = SessionLocal()
    try:
        incident_ids = [row[0] for row in db.query(IncidentEvidence.incident_id)
                        .filter_by(tenant_id=tenant_id, payload_id=payload_id).all()]
    except Exception:
        logger.error("Unable to locate committed incident evidence for advisory analysis")
        return
    finally:
        db.close()
    for incident_id in incident_ids:
        db = SessionLocal()
        try:
            if prepare_analysis(db, tenant_id, incident_id):
                execute_analysis(tenant_id, incident_id)
        except Exception:
            db.rollback()
            logger.error("Unable to queue advisory incident analysis")
        finally:
            db.close()
