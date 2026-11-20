# Local collector

The collector is a local process and local API, separate from the central SaaS API. The current implementation has no organizer stream connection because the organizer protocol/schema/credentials have not been provided. `TelemetryAdapter` is the integration boundary; the development-only local POST endpoint is a test input and must not be described as live organizer telemetry.

## Configure

Use Python 3.12 and install the repository lock:

```powershell
uv sync --locked --extra collector --extra dev
Copy-Item .env.example .env
```

Generate a private pseudonymization key and put it in `.env` as `COLLECTOR_PSEUDONYMIZATION_KEY`:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Keep that key stable across restarts; rotating it changes service pseudonyms and event-ID-derived payload IDs. Never commit `.env` or expose the key in logs. The collector API can report health without the key, but refuses telemetry ingestion until the key is configured.

Set `COLLECTOR_ID` and `COLLECTOR_TENANT_ID` from trusted local provisioning. Raw event values for these fields are ignored. For SaaS delivery, set `SAAS_INGEST_URL` to the exact `/api/v1/ingest` URL and `COLLECTOR_BEARER_TOKEN` to a provisioned collector token. HTTP is accepted only for loopback development URLs; non-local delivery requires HTTPS. With URL/token absent, records remain safely queued and the delivery status reports `not_configured`.

## Run

```powershell
uv run --locked --extra collector python -m collector
```

The process binds to `127.0.0.1:${COLLECTOR_API_PORT}` (default `8100`). Keep it loopback-only; the local health, queue and egress endpoints do not implement user authentication. CORS is limited to the two local Vite origins by default and can be set with `COLLECTOR_CORS_ORIGINS` (comma-separated exact origins). The development telemetry input route is disabled unless `AEGISOPS_ENV` is `development` or `test`.

## Local collector endpoints

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/collector/health` | Collector ID, process heartbeat, queue depth, delivery state, and configured offline threshold. |
| `GET /api/v1/collector/queue` | Counts and metadata-only queue items (ID, state, attempts, timestamps and safe error code); never includes payload bodies. |
| `POST /api/v1/collector/queue/{payload_id}/retry` | Requeue a permanently failed, previously approved payload for another attempt. |
| `GET /api/v1/collector/egress-preview` | Exact queued JSON string and parsed object for the next pending record, plus validation and value-free redaction/exclusion metadata. Optional `payload_id` selects one waiting item. |
| `POST /api/v1/collector/egress-preview/{payload_id}/approve` | Approve the exact previewed record for automatic delivery. Until this call, the sender cannot claim or transmit it. |
| `POST /api/v1/collector/telemetry` | Development/test-only input adapter. Accepts the canonical internal event fixture shape and returns `source_kind: development_only`. Not an organizer integration. |

These endpoints are local collector APIs and do not alter the shared SaaS API contract. The explicit approval gate ensures that a record cannot be transmitted before the UI has had an opportunity to inspect the exact queued JSON. The preview endpoint exposes approved metadata, so do not bind the server to a public interface.

## Accepted development event shape

This is only an adapter-neutral local fixture shape, not the organizer schema:

```json
{
  "event_id": "local-event-001",
  "event_time": "2026-11-20T12:00:00Z",
  "service": "synthetic-service",
  "environment": "development",
  "region": "local",
  "metrics": {"cpu_percent": 32.5, "latency_ms": 8.2},
  "security": {"failed_login_count": 0, "suspicious_activity_count": 0},
  "health": "good"
}
```

The collector currently requires at least one supported metric and one security count because the shared schema requires both objects to be non-empty. Unknown fields/metrics/security keys are excluded. Raw `tenant_id`, `collector_id`, and `payload_id` values are never trusted. The `service` value is HMAC-pseudonymized into the schema's `service` field. A production adapter should map an organizer-provided stable event identifier to `event_id`; without one, the collector generates a new ID per input event and cannot deduplicate source replays.

This slice validates one normalized record at a time; it does not aggregate a stream window or infer health. The organizer adapter must map source events into this input shape and provide already-aggregated security counters (or a later coordinated collector implementation must add local aggregation).

## Reliability and heartbeat semantics

SQLite is set to WAL mode with `synchronous=FULL`. Queue writes contain only the validated serialized outbound payload and value-free proof metadata. New records await local egress approval; restart recovery returns in-flight records to pending while preserving approval state. Every retry reuses the same exact payload bytes and `payload_id`; an item becomes acknowledged only after a response matching the shared API's accepted acknowledgement shape. Same-ID/same-body local enqueue is idempotent; same-ID/different-body is rejected.

Transient network failures, `408`, `429`, and `5xx` use bounded exponential backoff with jitter and honor numeric/date `Retry-After`. Other non-success `4xx` responses are retained as `failed` for operator review/manual retry through the queue service. Error bodies and raw telemetry are never logged.

`COLLECTOR_HEARTBEAT_INTERVAL_SECONDS` records a local process heartbeat; it is not a SaaS heartbeat request. There is no heartbeat endpoint in the shared central API. `COLLECTOR_OFFLINE_AFTER_SECONDS` (default 60 seconds) is an explicit local assumption used when evaluating stale successful delivery; change it when organizer/SaaS operating requirements are agreed. No performance SLA is claimed by this scaffold.

Local health exposes the last measured normalization-plus-durable-queue duration and last HTTP-attempt duration in milliseconds. These are observations for debugging, not latency guarantees.

## Tests

```powershell
uv run --locked --extra collector --extra dev python -m pytest tests/collector -q
```

The tests use temporary SQLite files and `httpx.MockTransport`; they require no organizer stream or live SaaS service.

## Generic JSON and JSONL file ingestion

`JsonFileAdapter` reads a single JSON object, a JSON array of objects, or JSONL/NDJSON and maps source fields to the collector's internal event shape. Configure canonical target paths and source paths explicitly; only mapped fields leave the adapter. ISO-8601 timestamps with a timezone are normalized to UTC, or configure numeric Unix seconds/milliseconds. Adapter errors include a safe source basename, record number, stable error code, and message; source values and raw records are not included. Processing stops at the first malformed record so later records are not silently treated as a clean import.

JSONL is read one line at a time and is preferred for large inputs. JSON arrays are currently parsed as one JSON document in memory. `max_record_bytes` limits individual JSONL records. Optional local aggregation can be configured per canonical numeric metric/security field using `mean`, `sum`, `min`, `max`, or `last`; it emits one summary per service/environment/region for that file, uses the latest event-time health, and keeps numeric accumulators rather than raw source records. Aggregation is opt-in: choose it only when input rows are measurements/events rather than already summarized telemetry. A source health value must still be mapped because the existing contract requires health and this adapter does not invent it.

The import command sends every mapped event through `CollectorService.ingest`, preserving pseudonymization, scrubbing, allow-listing, Pydantic/JSON Schema validation, SQLite queueing, and the existing egress approval gate. If a later record fails, earlier valid records remain safely queued and the command exits with a record-specific error; map a stable source event ID to `event_id` to make a corrected re-import idempotent:

```powershell
uv run --locked --extra collector python -m collector.ingest_file .\path\to\events.jsonl --mapping .\path\to\mapping.json
```

The example files under `examples/telemetry/` are synthetic fixtures only. Copy and edit the mapping for a source format; do not use the example values as production identity or telemetry configuration. Tenant/collector identity and privacy keys continue to come only from collector configuration, never from the source mapping.
