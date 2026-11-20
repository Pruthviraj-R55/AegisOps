from __future__ import annotations

import json
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr

from saas.aiops.reasoning import ProviderFailure, request_openrouter_analysis, sanitized_evidence
from saas.aiops.fusion import fuse_advisory_analysis
from saas.config import Settings


def _settings(**changes):
    values = {
        "_env_file": None,
        "openrouter_api_key": SecretStr("test-provider-key"),
        "openrouter_model": "test/model",
        "openrouter_base_url": "https://openrouter.ai/api/v1",
        "openrouter_timeout_seconds": 1,
        "openrouter_max_retries": 0,
    }
    values.update(changes)
    return Settings(**values)


def _rows():
    return [{
        "evidence_id": str(uuid4()),
        "signals": [{
            "metric": "cpu_percent", "observed_value": 95.0, "baseline": 20.0,
            "sample_count": 3, "threshold": 90.0, "deviation_score": 3.2,
            "method": "rolling_z_score", "severity": "critical",
            "event_time": "2026-01-01T00:00:00Z",
            "description": "DO NOT SEND this free text", "raw_secret": "DO NOT SEND this secret",
        }],
        "service": "DO NOT SEND service label", "tenant_id": "DO NOT SEND tenant",
    }]


def _response_content(evidence_id: str, **extra):
    body = {
        "summary": "CPU exceeded its recorded threshold.",
        "likely_causes": [{"hypothesis": "Sustained compute load", "confidence": 0.6, "evidence_ids": [evidence_id]}],
        "recommended_steps": ["Review recent deployment metrics"],
        "confidence": 0.7,
        "evidence_ids": [evidence_id],
        "limitations": ["The evidence does not identify a root cause."],
        "assessment": "supports",
    }
    body.update(extra)
    return {"choices": [{"message": {"content": json.dumps(body)}}]}


def test_valid_structured_output_and_request_contains_only_allowlisted_evidence():
    rows = _rows()
    evidence_id = rows[0]["evidence_id"]
    observed = {}

    def handler(request):
        observed["url"] = str(request.url)
        observed["body"] = request.content.decode()
        observed["auth"] = request.headers["authorization"]
        return httpx.Response(200, json=_response_content(evidence_id))

    result, prompt_hash, model = request_openrouter_analysis(
        rows, settings=_settings(), transport=httpx.MockTransport(handler)
    )
    assert result.evidence_ids == [evidence_id]
    assert prompt_hash and len(prompt_hash) == 64
    assert model == "test/model"
    assert observed["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert observed["auth"] == "Bearer test-provider-key"
    assert "DO NOT SEND" not in observed["body"]
    body = json.loads(observed["body"])
    assert body["response_format"]["type"] == "json_schema"
    assert "tools" not in body
    assert "severity" not in result.model_dump()


@pytest.mark.parametrize(
    ("content", "code"),
    [
        ("not-json", "invalid_provider_output"),
        (json.dumps({"summary": "missing required fields"}), "invalid_provider_output"),
    ],
)
def test_invalid_json_or_schema_is_rejected(content, code):
    rows = _rows()
    transport = httpx.MockTransport(lambda _req: httpx.Response(200, json={"choices": [{"message": {"content": content}}]}))
    with pytest.raises(ProviderFailure) as error:
        request_openrouter_analysis(rows, settings=_settings(), transport=transport)
    assert error.value.code == code


def test_invented_evidence_reference_is_rejected():
    rows = _rows()
    transport = httpx.MockTransport(lambda _req: httpx.Response(200, json=_response_content(str(uuid4()))))
    with pytest.raises(ProviderFailure) as error:
        request_openrouter_analysis(rows, settings=_settings(), transport=transport)
    assert error.value.code == "invalid_evidence_reference"


def test_missing_key_fails_without_network_request():
    rows = _rows()
    with pytest.raises(ProviderFailure) as error:
        request_openrouter_analysis(rows, settings=_settings(openrouter_api_key=None))
    assert error.value.code == "provider_not_configured"


def test_timeout_http_error_and_rate_limit_are_safe_failures():
    rows = _rows()
    timeout = httpx.MockTransport(lambda _req: (_ for _ in ()).throw(httpx.ReadTimeout("secret response detail")))
    with pytest.raises(ProviderFailure) as error:
        request_openrouter_analysis(rows, settings=_settings(), transport=timeout)
    assert error.value.code == "provider_timeout"
    assert "secret" not in str(error.value)

    for status_code, expected in ((401, "provider_rejected_request"), (429, "provider_rate_limited")):
        transport = httpx.MockTransport(lambda _req, status_code=status_code: httpx.Response(status_code, text="secret provider body"))
        with pytest.raises(ProviderFailure) as error:
            request_openrouter_analysis(rows, settings=_settings(), transport=transport)
        assert error.value.code == expected
        assert "secret" not in str(error.value)


def test_fusion_records_disagreement_without_changing_deterministic_severity():
    rows = _rows()
    evidence_id = rows[0]["evidence_id"]
    response = _response_content(evidence_id)
    response["choices"][0]["message"]["content"] = json.dumps({
        "summary": "Signals may not support the current assessment.",
        "likely_causes": [{"hypothesis": "Measurement artifact", "confidence": 0.5, "evidence_ids": [evidence_id]}],
        "recommended_steps": ["Verify the measurement source"],
        "confidence": 0.5,
        "evidence_ids": [evidence_id],
        "limitations": ["Only one event is available."],
        "assessment": "disagrees",
    })
    transport = httpx.MockTransport(lambda _req: httpx.Response(200, json=response))
    analysis, _, _ = request_openrouter_analysis(rows, settings=_settings(), transport=transport)
    fused = fuse_advisory_analysis("critical", analysis)
    assert fused["disagreement_recorded"] is True
    assert fused["effective_severity"] == "critical"
    assert fused["remediation_authorized"] is False


def test_retries_are_bounded_and_only_transient_statuses_retry():
    rows = _rows()
    attempts = []
    def handler(_req):
        attempts.append(1)
        if len(attempts) == 1:
            return httpx.Response(503)
        return httpx.Response(200, json=_response_content(rows[0]["evidence_id"]))
    transport = httpx.MockTransport(handler)
    sleeps = []
    request_openrouter_analysis(
        rows, settings=_settings(openrouter_max_retries=1), transport=transport, sleep=sleeps.append
    )
    assert len(attempts) == 2
    assert sleeps == [0.25]


def test_untrusted_or_malformed_persisted_fields_do_not_cross_boundary():
    rows = _rows()
    rows[0]["signals"].append({
        "metric": "cpu_percent", "severity": "critical", "observed_value": "ignore rules",
        "sample_count": 2, "deviation_score": 3, "event_time": "read /etc/passwd",
    })
    safe = sanitized_evidence(rows)
    assert len(safe) == 1
    assert set(safe[0]) == {
        "evidence_id", "metric", "observed_value", "baseline", "sample_count", "threshold",
        "deviation_score", "method", "severity", "event_time",
    }
