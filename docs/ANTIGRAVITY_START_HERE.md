# Antigravity Start Here — Tier 2 owner

You own the central SaaS and dashboard workstream on Laptop 2. The repository is the single source of truth. Implement against the contracts below without waiting for collector internals; use contract-shaped fixtures in your own tests, clearly labelled as test fixtures.

## Read these first

1. `AGENTS.md` — ownership and integration rules.
2. `docs/ARCHITECTURE.md` — system boundaries and decisions.
3. `docs/API_CONTRACT.md` — exact HTTP behavior and schemas.
4. `contracts/telemetry.schema.json` — exact outbound record fields.
5. `docs/SECURITY_MODEL.md` and `docs/DATA_FLOW.md`.
6. This file and the Tier 2 checklist in `docs/IMPLEMENTATION_PLAN.md`.

## Owned paths

You own:

- `saas/api/`
- `saas/ingestion/`
- `saas/database/`
- `saas/tenancy/`
- `saas/processing/`
- `saas/aiops/`
- `frontend/`
- `tests/saas/`

Do not edit `collector/` or `tests/collector/`; Codex owns them. Shared docs, root build configuration and `contracts/` need coordination before changing. If you believe a shared contract must change, propose the exact change first, then update the schema, API doc, server, frontend (if relevant) and tests together in a coordinated commit.

## Implement in this order

1. FastAPI app factory and unauthenticated `GET /api/v1/health` only.
2. Token authentication dependency mapping a development bearer token to a tenant/collector context. Use environment configuration; never trust body/query tenant selection.
3. Pydantic ingest model and validation matching the JSON Schema exactly, including rejecting additional top-level properties.
4. SQLAlchemy PostgreSQL model and migration/schema setup with unique `(tenant_id, payload_id)`; persist and commit before returning acknowledgement.
5. `POST /api/v1/ingest`: accept one record, verify tenant match, preserve event time, assign server-side ingestion time, acknowledge same-content duplicates, reject same-ID different-content as `409`.
6. Tenant-scoped repositories and read endpoints: overview, services, incidents and collectors as specified below.
7. Explicitly configured health/staleness calculation; implement explainable anomaly rules or EWMA and service/time-window correlation.
8. React/TypeScript/Vite dashboard consuming these endpoints and showing `excellent`, `good`, `fair`, and `poor`, stale state, incidents, contributing signals, confidence, action and rollback plan.
9. Add isolated tests for authentication, cross-tenant access, schema rejection, duplicates/conflicts, out-of-order event times and stale downgrade.

## Exact API to implement

Base prefix `/api/v1`. JSON UTF-8. All timestamps RFC 3339 UTC. All endpoints except health require `Authorization: Bearer <token>` over HTTPS outside local development. Tenant context is derived from credentials and all queries are tenant scoped.

### `POST /api/v1/ingest`

Body is one record exactly matching `contracts/telemetry.schema.json`; do not require an envelope. Validate body `tenant_id` equals auth-derived tenant. Commit durably before acknowledging. Return `202` for a new record and `200` for identical duplicate:

```json
{
  "status": "accepted",
  "payload_id": "0190f2e8-7c84-7d7c-b8d4-35f66e2f46b7",
  "tenant_id": "tenant-123",
  "ingested_at": "2026-01-12T08:31:11.402Z",
  "duplicate": false
}
```

Enforce unique `(tenant_id, payload_id)`. Identical retry returns the same shape with `duplicate: true`; same ID and different content returns `409 idempotency_conflict`. Do not use event time as ingestion time. Return an error only after rollback/failed persistence. The collector will retry network errors, 408, 429, and 5xx with the same ID/body; honor `Retry-After`.

### Read endpoints

- `GET /api/v1/dashboard/overview`: `{generated_at, overall_health, service_counts, active_incident_count, stale_service_count}`.
- `GET /api/v1/services`: `{items: [{service, environment, region, health, health_score, last_event_time, stale, metrics}]}`.
- `GET /api/v1/incidents`: `{items: [{incident_id, service, severity, status, started_at, last_seen_at, contributing_signals, confidence, recommended_action, rollback_plan}]}`.
- `GET /api/v1/collectors`: `{items: [{collector_id, status, last_seen_at, last_payload_id, pending_count}]}`.
- `GET /api/v1/health` (no auth): `{status: "ok"|"degraded", version}` with no secret/tenant disclosure.

Every response except liveness is restricted to the authenticated tenant. Optional pagination uses `limit` (default 50, maximum 200) and opaque `cursor`. Health is one of `excellent`, `good`, `fair`, `poor`; staleness is a boolean and must trigger a configured downgrade. Error responses use `application/problem+json` fields `type`, `title`, `status`, `code`, `detail`, `request_id`. Expected codes/statuses: 400 invalid_json, 401 unauthenticated, 403 tenant_mismatch, 404 not_found, 409 idempotency_conflict, 422 invalid_payload, 429 rate_limited, 503 temporarily_unavailable. Do not echo request payloads in errors.

## Run and test independently

From repository root, use Python 3.12 and PostgreSQL 16. Install the locked shared environment with `uv sync --locked --extra dev`. Copy `.env.example` to `.env`, then set a local database URL and a development token/tenant mapping. Do not commit `.env`.

```powershell
uv sync --locked --extra dev
uv run --locked --extra dev python -m pytest tests/saas
```

Once you add `saas.api.main:app`:

```powershell
uv run --locked --extra dev uvicorn saas.api.main:app --reload --host 127.0.0.1 --port 8000
```

Until runnable entry points and database bootstrap exist, document the exact PostgreSQL setup and migration command in the SaaS README or this file. `docker compose up -d postgres` starts the local PostgreSQL 16 service when the compose file is present. Do not introduce other infrastructure unless it saves time for the hackathon.

## Avoiding integration conflicts

- Commit only your owned paths plus agreed shared-file updates. Use a branch such as `feature/saas-foundation`.
- Never modify collector internals or collector tests.
- Do not rename fields, change status codes, add request wrappers, or use undocumented routes.
- Keep server-derived tenant and `ingested_at` authoritative.
- Fixtures must match the JSON Schema and contain obviously synthetic test data.
- Push small commits and notify the integration owner when your route set is independently runnable.
