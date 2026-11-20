"""Alert correlation into operational incidents with remediation & rollback plans."""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
import uuid

from saas.aiops.anomaly import AnomalySignal
from saas.processing.staleness import format_rfc3339_z, parse_timestamp_to_utc


@dataclass
class CorrelatedIncident:
    """Incident model conforming to docs/API_CONTRACT.md GET /api/v1/incidents."""

    incident_id: str
    service: str
    severity: str  # "critical" | "high" | "medium" | "low"
    status: str  # "active" | "investigating" | "resolved"
    started_at: str
    last_seen_at: str
    contributing_signals: list[str]
    confidence: float  # 0.0 to 1.0
    recommended_action: str
    rollback_plan: str


def correlate_anomalies(
    service: str,
    anomalies: list[AnomalySignal],
    time_window_seconds: float = 300.0,
    incident_id: Optional[str] = None,
) -> Optional[CorrelatedIncident]:
    """
    Group anomaly signals for a service into a correlated incident.

    - Computes confidence score based on multi-signal confirmation.
    - Generates explainable remediation recommendation.
    - Provides a concrete rollback plan.
    """
    if not anomalies:
        return None

    # Filter signals within the time window relative to the latest signal
    sorted_signals = sorted(anomalies, key=lambda a: a.timestamp)
    latest_time = sorted_signals[-1].timestamp
    window_signals = [
        s for s in sorted_signals
        if (latest_time - s.timestamp).total_seconds() <= time_window_seconds
    ]

    if not window_signals:
        window_signals = sorted_signals

    started_at = window_signals[0].timestamp
    last_seen_at = window_signals[-1].timestamp

    metrics_affected = {s.metric for s in window_signals}
    signals_text = [s.description for s in window_signals]

    # Calculate confidence based on multi-signal correlation and deviation
    avg_z = sum(abs(s.deviation_score) for s in window_signals) / len(window_signals)
    if len(window_signals) == 1:
        confidence = min(0.78, 0.55 + 0.05 * avg_z)
    elif len(window_signals) == 2:
        confidence = min(0.92, 0.72 + 0.04 * avg_z)
    else:
        confidence = min(0.98, 0.85 + 0.03 * avg_z)
    confidence = round(confidence, 2)

    # Determine severity
    has_critical = any(s.severity == "critical" for s in window_signals)
    is_cpu_latency_storm = "cpu_percent" in metrics_affected and "latency_ms" in metrics_affected

    if has_critical or is_cpu_latency_storm:
        severity = "critical"
    elif len(window_signals) >= 2 or "failed_login_count" in metrics_affected:
        severity = "high"
    else:
        severity = "medium"

    # Explainable remediation rules
    if is_cpu_latency_storm:
        recommended_action = (
            "Scale horizontal replicas for service to absorb load and inspect slow query or thread contention."
        )
        rollback_plan = (
            "Revert recent deployment to previous stable image tag; if sudden traffic surge, enable rate limiting."
        )
    elif "memory_percent" in metrics_affected:
        recommended_action = (
            "Restart degrading container instances, capture heap dump, and verify cache eviction policies."
        )
        rollback_plan = (
            "Roll back to previous release version and temporarily increase container memory limit."
        )
    elif "failed_login_count" in metrics_affected:
        recommended_action = (
            "Enforce IP rate-limiting at edge gateway and trigger temporary lockout for targeted credentials."
        )
        rollback_plan = (
            "Block offending IP ranges in WAF and revoke potentially exposed active session tokens."
        )
    elif "latency_ms" in metrics_affected:
        recommended_action = (
            "Check downstream database and cache dependency health; profile network round-trip latency."
        )
        rollback_plan = (
            "Redirect ingress traffic to healthy failover region or replica node."
        )
    else:
        recommended_action = (
            "Inspect recent service logs and monitor CPU/memory saturation."
        )
        rollback_plan = (
            "Roll back recent configuration changes or restart unhealthy instances."
        )

    inc_id = incident_id or f"inc-{uuid.uuid4().hex[:12]}"

    return CorrelatedIncident(
        incident_id=inc_id,
        service=service,
        severity=severity,
        status="active",
        started_at=format_rfc3339_z(started_at),
        last_seen_at=format_rfc3339_z(last_seen_at),
        contributing_signals=signals_text,
        confidence=confidence,
        recommended_action=recommended_action,
        rollback_plan=rollback_plan,
    )
