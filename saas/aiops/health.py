"""Explainable 4-state health evaluation engine for services."""

from dataclasses import dataclass, field
from typing import Any, Optional

from saas.processing.staleness import apply_staleness_downgrade


@dataclass
class HealthThresholds:
    """Configurable threshold bounds for health determination."""

    # CPU thresholds (%)
    cpu_critical: float = 90.0
    cpu_elevated: float = 75.0
    cpu_moderate: float = 60.0

    # Memory thresholds (%)
    memory_critical: float = 90.0
    memory_elevated: float = 80.0
    memory_moderate: float = 70.0

    # Disk thresholds (%)
    disk_critical: float = 90.0
    disk_elevated: float = 80.0

    # Latency thresholds (ms)
    latency_critical: float = 500.0
    latency_elevated: float = 250.0
    latency_moderate: float = 100.0

    # Packet loss thresholds (%)
    packet_loss_critical: float = 5.0
    packet_loss_detected: float = 1.0

    # Security thresholds
    failed_login_high: int = 10
    failed_login_elevated: int = 3


@dataclass
class HealthEvaluation:
    """Result of an explainable health evaluation."""

    health: str  # "excellent" | "good" | "fair" | "poor"
    health_score: int  # 0 to 100
    stale: bool
    reasons: list[str] = field(default_factory=list)


def evaluate_service_health(
    metrics: Optional[dict[str, Any]] = None,
    security: Optional[dict[str, Any]] = None,
    is_stale: bool = False,
    thresholds: Optional[HealthThresholds] = None,
) -> HealthEvaluation:
    """
    Compute explainable 4-state health score (0-100) and status from metrics, security, and staleness.

    Health score brackets:
        - score >= 90: "excellent"
        - score >= 70: "good"
        - score >= 40: "fair"
        - score < 40: "poor"

    If is_stale is True:
        - Enforces automatic downgrade to "poor"
        - Caps score at <= 30
        - Documents the staleness downgrade reason
    """
    t = thresholds or HealthThresholds()
    metrics = metrics or {}
    security = security or {}
    reasons: list[str] = []

    score = 100

    # 1. CPU percent
    cpu = metrics.get("cpu_percent")
    if cpu is not None:
        if cpu >= t.cpu_critical:
            score -= 40
            reasons.append(f"CPU usage critical: {cpu:.1f}% (>={t.cpu_critical}%)")
        elif cpu >= t.cpu_elevated:
            score -= 20
            reasons.append(f"CPU usage elevated: {cpu:.1f}% (>={t.cpu_elevated}%)")
        elif cpu >= t.cpu_moderate:
            score -= 10
            reasons.append(f"CPU usage moderate: {cpu:.1f}% (>={t.cpu_moderate}%)")

    # 2. Memory percent
    mem = metrics.get("memory_percent")
    if mem is not None:
        if mem >= t.memory_critical:
            score -= 35
            reasons.append(f"Memory usage critical: {mem:.1f}% (>={t.memory_critical}%)")
        elif mem >= t.memory_elevated:
            score -= 20
            reasons.append(f"Memory usage elevated: {mem:.1f}% (>={t.memory_elevated}%)")
        elif mem >= t.memory_moderate:
            score -= 10
            reasons.append(f"Memory usage moderate: {mem:.1f}% (>={t.memory_moderate}%)")

    # 3. Disk percent
    disk = metrics.get("disk_percent")
    if disk is not None:
        if disk >= t.disk_critical:
            score -= 30
            reasons.append(f"Disk usage critical: {disk:.1f}% (>={t.disk_critical}%)")
        elif disk >= t.disk_elevated:
            score -= 15
            reasons.append(f"Disk usage elevated: {disk:.1f}% (>={t.disk_elevated}%)")

    # 4. Latency ms
    latency = metrics.get("latency_ms")
    if latency is not None:
        if latency >= t.latency_critical:
            score -= 35
            reasons.append(f"Latency critical: {latency:.1f}ms (>={t.latency_critical}ms)")
        elif latency >= t.latency_elevated:
            score -= 20
            reasons.append(f"Latency elevated: {latency:.1f}ms (>={t.latency_elevated}ms)")
        elif latency >= t.latency_moderate:
            score -= 10
            reasons.append(f"Latency moderate: {latency:.1f}ms (>={t.latency_moderate}ms)")

    # 5. Packet loss percent
    loss = metrics.get("packet_loss_percent")
    if loss is not None:
        if loss >= t.packet_loss_critical:
            score -= 40
            reasons.append(f"Packet loss critical: {loss:.1f}% (>={t.packet_loss_critical}%)")
        elif loss >= t.packet_loss_detected:
            score -= 20
            reasons.append(f"Packet loss detected: {loss:.1f}% (>={t.packet_loss_detected}%)")

    # 6. Security
    suspicious = security.get("suspicious_activity_count", 0)
    if suspicious and suspicious > 0:
        score -= 30
        reasons.append(f"Suspicious activity detected: {suspicious} event(s)")

    failed_logins = security.get("failed_login_count", 0)
    if failed_logins:
        if failed_logins >= t.failed_login_high:
            score -= 25
            reasons.append(f"High failed login attempts: {failed_logins} (>={t.failed_login_high})")
        elif failed_logins >= t.failed_login_elevated:
            score -= 10
            reasons.append(f"Elevated failed login attempts: {failed_logins} (>={t.failed_login_elevated})")

    score = max(0, min(100, score))

    # Base 4-state mapping
    if score >= 90:
        health_state = "excellent"
    elif score >= 70:
        health_state = "good"
    elif score >= 40:
        health_state = "fair"
    else:
        health_state = "poor"

    # Enforce staleness downgrade
    if is_stale:
        health_state, reasons = apply_staleness_downgrade(
            health=health_state,
            stale=True,
            reasons=reasons,
        )
        score = min(score, 30)

    if not reasons:
        reasons.append("All observed metrics and security indicators are within nominal bounds.")

    return HealthEvaluation(
        health=health_state,
        health_score=score,
        stale=is_stale,
        reasons=reasons,
    )
