# Implementation plan and ownership

The first milestone is contract-aligned independent work, followed by an end-to-end integration and measured reliability/performance. No target is claimed until measured in tests.

## Laptop 1 — Codex: collector

- [ ] Define adapter protocol independent of organizer specifics; add a labelled development simulator only if useful.
- [ ] Implement canonical internal event mapping once organizer examples arrive.
- [ ] Implement local secret redaction, strict allow-list serialization and identifier pseudonymization.
- [ ] Implement schema validation and exact-payload Egress Proof Panel output.
- [ ] Implement SQLite WAL queue with stable IDs, pending/ack transitions and crash recovery.
- [ ] Implement authenticated HTTPX transport, retry/backoff and server-ack handling.
- [ ] Add collector tests for secret egress, unknown fields, queue recovery, retry identity and reconnect behavior.
- [ ] Connect the organizer stream only after its actual details are provided.

## Laptop 2 — Antigravity: SaaS and frontend

- [ ] Read `docs/ANTIGRAVITY_START_HERE.md`, then the shared architecture and API/schema contracts.
- [ ] Implement FastAPI health route, bearer authentication and token-to-tenant context.
- [ ] Implement Pydantic ingest model matching the JSON Schema; derive and verify tenant context.
- [ ] Implement PostgreSQL SQLAlchemy model/repository, durable commit and unique `(tenant_id, payload_id)` constraint.
- [ ] Implement idempotent duplicate acknowledgement and conflicting-payload rejection.
- [ ] Implement tenant-scoped services, collectors, incidents and overview read endpoints.
- [ ] Implement event-time health, configurable stale downgrade, explainable anomaly rules/EWMA and service/time alert correlation.
- [ ] Build React/TypeScript/Vite dashboard with four health states, freshness, incidents and recommendations.
- [ ] Add SaaS tenant-isolation, schema, duplicate/out-of-order, stale downgrade and API tests.

## Shared integration and acceptance

- [ ] Confirm organizer source protocol, authentication, payload examples, event rate and simulator restriction.
- [ ] Agree on any contract changes before code changes; keep schema and API docs synchronized.
- [ ] Run both workstreams independently, then use a shared development environment for end-to-end tests.
- [ ] Exercise reconnect with a known sequence and verify zero dropped and zero duplicate persisted records.
- [ ] Measure dashboard latency p95 below 10 seconds, alert creation below 15 seconds, and offline detection below 60 seconds under an agreed test load. Record method, sample size and result; do not claim targets before measurement.
- [ ] Review secrets, tenant isolation, data residency and failure handling before demo.

## Open dependencies

- Organizer stream endpoint/protocol, authentication, event schema, rates, reconnect rules and any restrictions on simulators.
- Deployment endpoint and credential provisioning for SaaS collector authentication.
- Agreed operational thresholds and stale-data window for health calculation.
- Demo tenant provisioning and PostgreSQL deployment choice.
