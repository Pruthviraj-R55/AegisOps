# API Contract — v1

This is the integration source of truth. Changes require coordinated updates to this document, the JSON Schema, SaaS validation, collector serialization and tests. All paths below are relative to the service origin. JSON uses UTF-8. Timestamps are RFC 3339 UTC (`Z`).

## Authentication and tenant context

All endpoints except `GET /api/v1/health` require authentication over HTTPS. Ingest uses a collector bearer token provisioned outside this API and bound to a tenant and collector identity. The server derives that context from the validated token. `tenant_id` and `collector_id` in an ingest record must match it; mismatches are rejected with `403 tenant_mismatch` or `403 collector_mismatch`. Never select a database tenant based solely on request JSON, query parameters, or a frontend tenant label. Production dashboard routes use provisioned dashboard-user sessions in Secure, HttpOnly cookies. State-changing cookie-authenticated requests require the matching CSRF cookie and `X-CSRF-Token` header. Local development may use the separate `SAAS_DASHBOARD_DEV_TOKEN` only when `AEGISOPS_ENV=development`; it must differ from collector delivery credentials. Never put collector delivery credentials in a browser.

| Method and path | Purpose |
| --- | --- |
| `POST /api/v1/auth/login` | Verify a provisioned email/password and create a server-side session; cookie token is HttpOnly, token hash only is stored |
| `GET /api/v1/auth/session` | Validate the current session and return the user ID plus CSRF token for the page's memory |
| `POST /api/v1/auth/logout` | Revoke the current session and clear session/CSRF cookies; requires CSRF validation |

Login uses generic invalid-credential responses and database-backed bounded attempt throttling. Dashboard identity and tenant scope come only from the active session's user row. Collector bearer credentials and SaaS development credentials cannot create dashboard sessions.

`POST /api/v1/auth/login` accepts `{ "email": "user@example.com", "password": "..." }` and requires an `Origin` matching `SAAS_CORS_ORIGINS`. Its response includes a CSRF value for page memory; the API also sets the matching non-HttpOnly CSRF cookie. `GET /api/v1/auth/session` validates the HttpOnly session cookie and returns the current CSRF value. For every unsafe method using a session, send the same value in both the CSRF cookie and `X-CSRF-Token`. The session token itself is never returned in JSON or browser storage. Login attempts are throttled per account and client address. There is no public registration endpoint; operators provision users through the command documented in `docs/DATABASE_MIGRATIONS.md`.

## `POST /api/v1/ingest`

Submits one record conforming to `contracts/telemetry.schema.json`. Request body is the record itself; no raw event wrapper is allowed. The server assigns `ingested_at` in its response/storage and records the authenticated tenant.

Success (`202 Accepted`, after durable commit):

```json
{
  "status": "accepted",
  "payload_id": "0190f2e8-7c84-7d7c-b8d4-35f66e2f46b7",
  "tenant_id": "tenant-123",
  "ingested_at": "2026-01-12T08:31:11.402Z",
  "duplicate": false
}
```

An already committed `(tenant_id, payload_id)` returns `200 OK` with the same response shape, `status: "accepted"`, and `duplicate: true`. A payload ID reused with different content is `409 idempotency_conflict`; the server must not overwrite the original. Client retries preserve the original `payload_id` and exact body. Do not dequeue until either accepted response is received. Retry network failures, `408`, `429`, and `5xx` with exponential backoff and jitter; honor `Retry-After`. Do not blindly retry other `4xx` responses.

The server validates payload shape and verifies body tenant against authenticated tenant. It acknowledges only after the record and idempotency key are durably committed.

## Read endpoints

All responses are tenant-scoped from auth context, with no caller-supplied tenant selector. Collections return `{ "items": [...] }` and stable, opaque IDs. Date-time fields are UTC RFC 3339.

| Method and path | Purpose | Response item fields |
| --- | --- | --- |
| `GET /api/v1/dashboard/overview` | Fleet summary | `generated_at`, `overall_health`, `service_counts` keyed by health state, `active_incident_count`, `stale_service_count` |
| `GET /api/v1/services` | Current service health | `service`, `environment`, `region`, `health`, `health_score` (0–100), `last_event_time`, `stale`, `metrics` |
| `GET /api/v1/telemetry` | Persisted telemetry history ordered by event time | `payload_id`, `collector_id`, `schema_version`, `event_time`, `ingested_at`, `service`, `environment`, `region`, `metrics`, `security`, `health` |
| `GET /api/v1/security-events` | Telemetry history with non-zero schema-supported security counters | Same telemetry fields; only records with a non-zero supported security count |
| `GET /api/v1/incidents` | Open/recent incidents | `incident_id`, `service`, `severity`, `status`, `started_at`, `last_seen_at`, `contributing_signals`, `confidence` (0–1), `recommended_action`, `rollback_plan` |
| `GET /api/v1/incidents/{incident_id}/evidence` | Persisted telemetry evidence for a tenant incident | `payload_id`, `event_time`, `ingested_at`, service dimensions, metrics, security counters, and structured signals |
| `GET /api/v1/collectors` | Collector connection and freshness | `collector_id`, `status`, `last_seen_at`, `last_payload_id`, `pending_count` |
| `GET /api/v1/health` | Liveness/readiness (no auth) | `status` (`ok` or `degraded`), `version`; must not disclose secrets or tenant data |

Read endpoints accept optional `limit` (default 50, maximum 200) and opaque `cursor` where pagination is needed. Unknown query parameters are ignored or rejected consistently; they never alter tenant scope. Filter semantics beyond pagination must be documented before use.

`GET /api/v1/telemetry` and `GET /api/v1/security-events` accept optional timezone-aware `start_time` and `end_time` query parameters; both bounds are inclusive and apply to `event_time` in UTC. The response is `{ "items": [...], "limit": N, "has_more": boolean, "next_cursor": opaque-or-null }`. Items are ordered by `event_time` descending, then `payload_id` descending. Supply `next_cursor` with the same time filters to retrieve the next page. The server always applies authenticated tenant scope, regardless of cursor contents.

Incident evidence is persisted as tenant-scoped links to accepted payload IDs and structured detector signals. The evidence endpoint returns the corresponding telemetry records ordered by event time. The deterministic detector compares an observation only with strictly earlier observations sharing tenant, service, collector, environment, and region. Statistical detection requires at least three valid historical samples for a metric; absolute critical thresholds can still signal without a baseline and report that the baseline is unavailable. Incident correlation uses `INCIDENT_CORRELATION_WINDOW_SECONDS` (default 300 seconds) and the same source/service dimensions. Correlation is evidence of related observations, not a root-cause claim.

## Advisory incident analysis

After a new telemetry commit creates persisted incident evidence, the SaaS may enqueue an in-process advisory analysis when `AI_ENABLED=true`. Ingest acknowledgement does not wait for analysis; duplicate payload retries do not enqueue duplicate work. The provider receives only the incident ID, deterministic severity and a bounded allowlist of structured detector fields from persisted evidence. It does not receive raw telemetry, logs, credentials, tenant/collector identities, service labels, or arbitrary fields. Deterministic incident severity and status remain authoritative; AI output cannot downgrade severity or trigger remediation. Structured model output is independently validated and all cited evidence IDs must be a subset of the persisted evidence IDs supplied to the model. A fusion record preserves deterministic effective severity and records when the AI assessment disagrees; AI-only hypotheses do not create incidents.

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/incidents/{incident_id}/analysis` | Tenant-scoped analysis, status, provenance, and validated advisory result; missing analysis returns `status: not_requested` |
| `POST /api/v1/incidents/{incident_id}/analysis/retry` | Retry a failed analysis for the authenticated tenant's incident; pending/completed analyses return `409 analysis_not_retryable`; disabled analysis returns `503 analysis_disabled` |

Both endpoints use the existing tenant-scoped dashboard authentication dependency. Production access requires a provisioned dashboard user and active server-side session. OpenRouter configuration and the limitation that in-process pending work is not recovered after process restart are documented in `docs/AI_REASONING.md`.

`health` is exactly one of `excellent`, `good`, `fair`, `poor`. `stale` is a boolean. Health calculation thresholds and staleness duration belong to the SaaS implementation and must be explicit, configurable, and tested; no threshold is implied by this contract. Missing or stale samples must cause a documented downgrade rather than preserving a misleading healthy state.

## Error format

Errors use `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Validation failed",
  "status": 422,
  "code": "invalid_payload",
  "detail": "The metadata record does not match schema version 1.0.0.",
  "request_id": "req-opaque"
}
```

Expected codes include `400 invalid_json` or `https_required`, `401 unauthenticated` or `invalid_credentials`, `403 tenant_mismatch`, `collector_mismatch`, `csrf_failed`, or `origin_not_allowed`, `404 not_found`, `409 idempotency_conflict` or `analysis_not_retryable`, `422 invalid_payload`, `invalid_cursor`, or `invalid_time_range`, `429 rate_limited` or `login_rate_limited`, and `503 temporarily_unavailable` or `analysis_disabled`. Error details must not echo raw or secret-bearing input.

## Schema and versioning

The outbound JSON Schema uses `schema_version: "1.0.0"`, rejects unknown top-level properties, and defines bounded optional metric/security fields. Additive, backward-compatible metadata may increment the minor version only after coordination; breaking changes require a new major contract and explicit endpoint/schema migration plan. `payload_id` is a UUID generated once before queue insertion, stable across retries.
