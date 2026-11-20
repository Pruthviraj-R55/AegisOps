# Advisory incident reasoning

AEGISOPS keeps deterministic anomaly detection and incident correlation authoritative. After a **new telemetry record and any resulting evidence have committed**, an in-process FastAPI background task may request an advisory analysis from OpenRouter. The ingest acknowledgement does not wait for the provider. Duplicate payload retries do not enqueue a second task.

The task reloads persisted `IncidentEvidence` and sends only a bounded allowlist of detector fields: UUID evidence IDs, supported metric names, finite numeric observations/baselines/thresholds/deviation/sample counts, detector severity/method, and UTC event time. Service labels, tenant and collector identities, telemetry payloads, raw logs, credentials, and arbitrary JSON fields are not sent. Evidence values are treated as untrusted data, never instructions. The provider has no tools or remediation authority.

The response is validated locally against a strict Pydantic model and every cited evidence ID must belong to the supplied evidence set. The persisted result includes provider/model, prompt version and SHA-256 hash, evidence IDs, status, timestamps, validated result, and a safe error code. It does not store the API key, raw prompt, or provider error body. AI output does not set or lower deterministic severity, change incident state, or execute recommended checks.

## Configuration

Set these values in the SaaS process environment or deployment secret store. Keep `OPENROUTER_API_KEY` server-side; never add it to a `VITE_` variable or frontend build configuration.

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_ENABLED` | `true` | Kill switch for background analysis; set `false` to stop new analyses and retries |
| `OPENROUTER_API_KEY` | unset | Optional server-side bearer credential; when unset analysis records fail with `provider_not_configured` |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | Explicit OpenRouter model identifier; no silent model fallback |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | HTTPS OpenRouter-compatible API root |
| `OPENROUTER_TIMEOUT_SECONDS` | `20` | Per-request HTTP timeout, bounded to 120 seconds |
| `OPENROUTER_MAX_RETRIES` | `1` | Bounded retries for network, timeout, 408, 429 and selected 5xx errors; range 0–3 |

The provider request uses `POST /chat/completions` and OpenRouter structured JSON Schema output. Local validation remains required even when the selected model supports structured outputs. HTTP failures and invalid model output are isolated as advisory status failures; they do not affect ingestion. Configure the selected model to support structured outputs; requests fail visibly if the provider/model rejects that format.

The prompt is versioned as `incident-evidence-v1`. It includes only the incident ID, deterministic severity, and allowlisted persisted evidence. Output includes a concise summary, confidence-scored hypotheses tied to evidence IDs, recommended investigation steps, explicit limitations, and an assessment of whether the evidence supports or disagrees with the deterministic assessment. A fusion record stores that assessment and any disagreement while retaining deterministic severity as the effective severity and setting remediation authorization to false.

## Manual provider verification

With a valid OpenRouter key in the SaaS environment and `AI_ENABLED=true`, start the API after applying migrations, then ingest enough telemetry to create a deterministic incident. Retrieve that tenant-owned incident and call `GET /api/v1/incidents/{incident_id}/analysis`; expect a `completed` result with `provider: openrouter`, configured model, prompt hash/version, evidence IDs, advisory output, and fusion policy. Do not paste the key into a shell command, request body, browser variable, or log. Automated tests use mocked HTTP responses and never require a live key.

## API and operations

- `GET /api/v1/incidents/{incident_id}/analysis` returns analysis and provenance for an incident belonging to the authenticated tenant. A missing analysis returns `status: not_requested`.
- `POST /api/v1/incidents/{incident_id}/analysis/retry` retries only a failed analysis for that tenant's incident. Pending or completed analyses return `409 analysis_not_retryable`.
- These endpoints use the same tenant-scoped dashboard authentication dependency as other dashboard reads. Production access requires a provisioned dashboard user and active server-side session; development bearer access remains restricted to explicitly configured local development/test environments.
- Apply the additive schema migration before production use with `uv run --locked alembic upgrade head`.

Execution currently uses in-process background tasks. A process crash after an analysis is marked pending can leave it pending; pending work is not recovered after restart. This is documented as a deployment limitation, not a durable job queue. No Redis, Kafka, or additional service is required for this block.
