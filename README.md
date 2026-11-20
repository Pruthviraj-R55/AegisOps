# AEGISOPS

**Privacy-First AIOps Observability Platform**  
Secure telemetry. Explainable intelligence. Reliable operations.

AEGISOPS keeps raw operational telemetry inside the customer environment. A local collector scrubs and filters events, builds a small approved metadata record, and sends that record to a tenant-isolated central service. The central service computes fleet health and explainable alerts.

> This repository is the initial integration foundation. The collector, SaaS and dashboard are not yet a complete product. Organizer stream details are pending; no production endpoint or payload format is assumed.

## Repository map

```text
collector/       Local collector interfaces and configuration (Codex)
saas/            Central API, ingestion, database and AIOps (Antigravity)
frontend/        React + TypeScript dashboard (Antigravity)
contracts/       Shared outbound JSON Schema
docs/            Architecture, data flow, API and implementation guides
tests/           Collector and SaaS tests, separated by owner
```

## Prerequisites

- Python 3.12.x (the Python project manifest enforces this minor version)
- Node.js 20 or newer and npm
- Git
- Docker Compose v2 is optional; it will provide the pinned PostgreSQL 16 development service.
- `uv` is used to resolve and sync the Python environment from the committed `uv.lock`.

## Start from a clone

```powershell
git clone <repository-url> AegisOps
cd AegisOps
```

The initial scaffold has no complete runnable application yet. Install the locked Python environment (Python 3.12 required):

```powershell
uv sync --locked --extra collector --extra dev
Copy-Item .env.example .env
docker compose up -d postgres
```

Run the current automated checks:

```powershell
uv run --locked --extra dev python -m pytest
```

The SaaS and frontend run commands will be added by their owners when those components have runnable entry points. See [`docs/TECH_STACK.md`](docs/TECH_STACK.md) for stack and locking policy, [`docs/ANTIGRAVITY_START_HERE.md`](docs/ANTIGRAVITY_START_HERE.md) for the independent Tier 2 bootstrap instructions, and [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for ownership and sequence.

## Configuration

Copy `.env.example` to `.env` and set local values. Never commit `.env` or real credentials. The organizer adapter remains unconfigured until the organizer provides its protocol, endpoint, authentication and event definition.

## Integration source of truth

- API and auth: [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md)
- Approved outbound fields: [`contracts/telemetry.schema.json`](contracts/telemetry.schema.json)
- Trust boundaries: [`docs/SECURITY_MODEL.md`](docs/SECURITY_MODEL.md)
- End-to-end flow: [`docs/DATA_FLOW.md`](docs/DATA_FLOW.md)

## Git workflow

Use small commits and push your branch to the shared repository. Do not force-push shared branches. Coordinate edits to shared files and update both API and schema docs if a contract change is agreed.
