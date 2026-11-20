"""Decision policy joining deterministic incidents with advisory AI results."""

from saas.aiops.reasoning import AdvisoryAnalysis


def fuse_advisory_analysis(deterministic_severity: str, analysis: AdvisoryAnalysis) -> dict[str, object]:
    """Record agreement while keeping all incident authority with deterministic logic."""
    if deterministic_severity not in {"critical", "high", "medium", "low"}:
        raise ValueError("unsupported deterministic incident severity")
    return {
        "deterministic_severity": deterministic_severity,
        "ai_assessment": analysis.assessment,
        "disagreement_recorded": analysis.assessment == "disagrees",
        "effective_severity": deterministic_severity,
        "authority": "deterministic",
        "remediation_authorized": False,
    }
