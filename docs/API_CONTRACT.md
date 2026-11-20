# API Contract — v1

This is the integration source of truth. Changes require coordinated updates to this document, the JSON Schema, SaaS validation, collector serialization and tests. All paths below are relative to the service origin. JSON uses UTF-8. Timestamps are RFC 3339 UTC (`Z`).

## Authentication and tenant context

All endpoints except `GET /api/v1/health` require `Authorization: Bearer <collector-or-user-token>` over HTTPS. Tokens are provisioned outside this API and map to a tenant and, for collector tokens, a collector identity. The server derives tenant context from the validated token. `tenant_id` in an ingest record must match that context or the request is rejected with `403 tenant_mismatch`. Never select a database tenant based solely on request JSON or query parameters. Dashboard tokens are also tenant-scoped.

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
| `GET /api/v1/incidents` | Open/recent incidents | `incident_id`, `service`, `severity`, `status`, `started_at`, `last_seen_at`, `contributing_signals`, `confidence` (0–1), `recommended_action`, `rollback_plan` |
| `GET /api/v1/collectors` | Collector connection and freshness | `collector_id`, `status`, `last_seen_at`, `last_payload_id`, `pending_count` |
| `GET /api/v1/health` | Liveness/readiness (no auth) | `status` (`ok` or `degraded`), `version`; must not disclose secrets or tenant data |

Read endpoints accept optional `limit` (default 50, maximum 200) and opaque `cursor` where pagination is needed. Unknown query parameters are ignored or rejected consistently; they never alter tenant scope. Filter semantics beyond pagination must be documented before use.

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

Expected codes: `400 invalid_json`, `401 unauthenticated`, `403 tenant_mismatch`, `404 not_found`, `409 idempotency_conflict`, `422 invalid_payload`, `429 rate_limited`, `503 temporarily_unavailable`. Error details must not echo raw or secret-bearing input.

## Schema and versioning

The outbound JSON Schema uses `schema_version: "1.0.0"`, rejects unknown top-level properties, and defines bounded optional metric/security fields. Additive, backward-compatible metadata may increment the minor version only after coordination; breaking changes require a new major contract and explicit endpoint/schema migration plan. `payload_id` is a UUID generated once before queue insertion, stable across retries.
