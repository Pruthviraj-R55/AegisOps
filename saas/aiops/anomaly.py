"""Baseline anomaly detection using rolling Z-Score and EWMA on key metrics."""

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Any, Optional

from saas.processing.staleness import parse_timestamp_to_utc


@dataclass
class AnomalySignal:
    """Detected anomaly signal for a metric."""

    metric: str
    current_value: float
    expected_value: float | None
    deviation_score: float  # Z-score or EWMA deviation
    severity: str  # "critical", "warning", "info"
    description: str
    timestamp: datetime
    sample_count: int = 0
    threshold: float | None = None
    method: str = "rolling_z_score"


def calculate_z_score(
    history: list[float], current: float, min_std: float = 0.5
) -> tuple[float, float | None, float | None]:
    """
    Calculate Z-score of current value against historical sequence.

    Returns:
        tuple[float, float, float]: (z_score, mean, std_dev)
    """
    if not history:
        return 0.0, None, None

    n = len(history)
    mean = sum(history) / n

    if n < 2:
        variance = 0.0
    else:
        variance = sum((x - mean) ** 2 for x in history) / (n - 1)

    std_dev = math.sqrt(variance)
    effective_std = max(std_dev, min_std)

    z = (current - mean) / effective_std
    return z, mean, std_dev


def calculate_ewma(
    history: list[float], current: float, alpha: float = 0.3
) -> tuple[float, float | None, float | None]:
    """
    Calculate Exponentially Weighted Moving Average (EWMA) and deviation.

    Returns:
        tuple[float, float, float]: (deviation_score, ewma_mean, ewma_std)
    """
    if not history:
        return 0.0, None, None

    s = history[0]
    v = 0.0
    for x in history[1:]:
        prev_s = s
        s = alpha * x + (1.0 - alpha) * s
        v = (1.0 - alpha) * (v + alpha * (x - prev_s) ** 2)

    ewma_std = math.sqrt(v) if v > 0 else 0.5
    dev = (current - s) / max(ewma_std, 0.5)
    return dev, s, ewma_std


def _valid_observation(metric_name: str, raw_value: Any) -> float | None:
    if isinstance(raw_value, bool):
        return None
    try:
        value = float(raw_value)
    except (TypeError, ValueError, OverflowError):
        return None
    if not math.isfinite(value) or value < 0:
        return None
    if metric_name in {"cpu_percent", "memory_percent"} and value > 100:
        return None
    if metric_name == "failed_login_count" and not value.is_integer():
        return None
    return value


KEY_METRICS: dict[str, dict[str, Any]] = {
    "cpu_percent": {"z_thresh": 2.5, "min_std": 2.0, "critical_val": 90.0},
    "latency_ms": {"z_thresh": 2.5, "min_std": 10.0, "critical_val": 500.0},
    "memory_percent": {"z_thresh": 2.5, "min_std": 2.0, "critical_val": 90.0},
    "failed_login_count": {"z_thresh": 2.0, "min_std": 1.0, "critical_val": 10.0},
}


def detect_metric_anomalies(
    history_records: list[dict[str, Any]],
    current_record: dict[str, Any],
    z_threshold_override: Optional[float] = None,
) -> list[AnomalySignal]:
    """
    Analyze current record against historical records to detect metric anomalies.

    Records are dictionaries with 'metrics', 'security', and 'event_time'.
    """
    anomalies: list[AnomalySignal] = []

    raw_time = current_record.get("event_time", datetime.now(timezone.utc))
    ts = parse_timestamp_to_utc(raw_time)

    current_metrics = current_record.get("metrics") or {}
    current_sec = current_record.get("security") or {}

    for metric_name, conf in KEY_METRICS.items():
        if metric_name == "failed_login_count":
            val = current_sec.get("failed_login_count")
        else:
            val = current_metrics.get(metric_name)

        if val is None:
            continue

        current_val = _valid_observation(metric_name, val)
        if current_val is None:
            continue

        history_vals: list[float] = []
        for rec in history_records:
            m = rec.get("metrics") or {}
            s = rec.get("security") or {}
            if metric_name == "failed_login_count":
                hv = s.get("failed_login_count")
            else:
                hv = m.get(metric_name)
            historical_value = _valid_observation(metric_name, hv)
            if historical_value is not None:
                history_vals.append(historical_value)

        z_thresh = z_threshold_override or conf["z_thresh"]
        min_std = conf["min_std"]
        crit_val = conf["critical_val"]

        z, mean, _std_dev = calculate_z_score(history_vals, current_val, min_std=min_std)

        is_anomalous = False
        severity = "warning"

        if len(history_vals) >= 3 and z >= z_thresh:
            is_anomalous = True
            if z >= z_thresh + 1.0 or current_val >= crit_val:
                severity = "critical"
        elif current_val >= crit_val:
            is_anomalous = True
            severity = "critical"
            if history_vals:
                z = max(z, 3.0)

        if is_anomalous:
            if mean is None:
                desc = (
                    f"{metric_name} crossed critical threshold: observed {current_val:.1f} "
                    f"(threshold: {crit_val:.1f}; historical baseline unavailable)"
                )
            else:
                desc = (
                    f"{metric_name} anomalous: observed {current_val:.1f} "
                    f"(baseline: {mean:.1f}, z-score: {z:.2f})"
                )
            anomalies.append(
                AnomalySignal(
                    metric=metric_name,
                    current_value=current_val,
                    expected_value=mean,
                    deviation_score=round(z, 2),
                    severity=severity,
                    description=desc,
                    timestamp=ts,
                    sample_count=len(history_vals),
                    threshold=crit_val if severity == "critical" and current_val >= crit_val else z_thresh,
                    method="rolling_z_score" if len(history_vals) >= 3 else "absolute_threshold",
                )
            )

    return anomalies
