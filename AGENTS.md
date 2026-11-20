# AEGISOPS contributor instructions

AEGISOPS is a privacy-first, two-tier observability platform. Keep changes understandable, testable, and within the ownership boundaries below. The repository and the versioned API contract are the source of truth for both laptop workstreams.

## Read first

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `docs/API_CONTRACT.md`
4. `docs/SECURITY_MODEL.md`
5. `docs/DATA_FLOW.md`
6. `docs/IMPLEMENTATION_PLAN.md`
7. `contracts/telemetry.schema.json`

Tier 2 developers should then follow `docs/ANTIGRAVITY_START_HERE.md`.

## Ownership

- **Codex / Laptop 1:** `collector/`, `tests/collector/`.
- **Antigravity / Laptop 2:** `saas/`, `frontend/`, `tests/saas/`.
- **Shared contract steward:** Codex / Laptop 1 owns the canonical edits to `contracts/telemetry.schema.json` and `docs/API_CONTRACT.md`. Antigravity proposes changes in a reviewable diff; Codex coordinates and applies agreed shared-contract changes. Both workstreams update their implementation/tests against the accepted contract.
- **Other shared files, coordinated edits only:** `AGENTS.md`, remaining `docs/`, root tooling and CI configuration. Discuss changes before implementation; do not make conflicting edits independently.

Do not edit another workstream's implementation files without coordinating with its owner. Shared contract changes require updating the API document, JSON Schema, and both sides' tests together.

## Integration rules

- Treat `docs/API_CONTRACT.md` and `contracts/telemetry.schema.json` as authoritative.
- API base path is `/api/v1`; ingest uses `POST /api/v1/ingest` with a single metadata record per request.
- Use UTC RFC 3339 timestamps. `tenant_id` is checked against the tenant derived from the authenticated collector credential; never trust a tenant identifier supplied by telemetry alone.
- `payload_id` is stable across retries. The server enforces uniqueness on `(tenant_id, payload_id)` and acknowledges only after durable commit.
- Only construct outbound records from the schema allow-list. Never serialize, attach, or forward the source event/raw logs.
- Use environment variables for credentials and deployment-specific configuration. Keep real secrets, local databases, and `.env` files out of Git.
- Do not add undocumented endpoints, fields, dependencies, performance claims, or organizer stream details.
- Keep simulator data explicitly labelled as development-only. Replace/disable it when organizer connection details arrive.

## Quality bar

- Add focused tests alongside the owned component for behavior you implement.
- Run relevant checks before proposing integration; do not claim a performance target until measured and recorded.
- Prefer small modules, typed interfaces, explicit errors, and explainable detection rules over speculative abstractions.
