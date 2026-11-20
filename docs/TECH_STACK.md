# Technology stack and enforcement

This is the agreed stack for AEGISOPS. It intentionally stays small for the hackathon. The table distinguishes dependencies already constrained by repository manifests from components that are not scaffolded yet; planned technology is not represented as implemented.

| Area | Required technology | Repository enforcement/status |
| --- | --- | --- |
| Python runtime | Python 3.12.x | `pyproject.toml` sets `requires-python = "==3.12.*"`; `uv.lock` resolves the Python project and must be checked in with it. |
| Collector/SaaS APIs | FastAPI | Python dependency constrained to `<1`. |
| Data validation | Pydantic v2 | Python dependency constrained to `>=2.7,<3`. |
| SaaS ORM/migrations | SQLAlchemy 2.x, Alembic | Python dependencies constrained to `>=2.0,<3` and `>=1.14,<2`. |
| Central database | PostgreSQL 16 | Development service is `postgres:16`; production deployment remains undecided. |
| Local durable queue | SQLite WAL | SQLite is provided by Python; `aiosqlite` supports async access. WAL mode must be explicitly enabled by the collector queue implementation. |
| HTTP client | HTTPX | Python dependency constrained to `<1`. |
| Frontend | React 19, TypeScript, Vite | Frontend implementation has not started. `frontend/` currently has only `.gitkeep`; there is no `package.json` or `package-lock.json` yet. Create both together when the frontend scaffold is started. |
| UI utilities | Tailwind CSS, Recharts, Lucide React | Planned frontend dependencies; not installed/enforced until its package manifest exists. |
| Tests | pytest | Python dev dependency constrained to `<9`; current `tests/` has no test modules. |
| Local services | Docker Compose | PostgreSQL 16 development service is defined in `docker-compose.yml`; Compose is optional when using another local PostgreSQL 16 instance. |

## Python dependency lock

`uv.lock` is the cross-platform Python dependency lock and must be checked in. `pyproject.toml` holds direct dependency ranges and pins the supported Python minor version; `uv.lock` records the resolved transitive versions and artifact hashes. Keep both files in the same change when adding/changing Python dependencies.

Install/sync the collector and development dependencies on Python 3.12:

```powershell
uv sync --locked --extra collector --extra dev
```

The SaaS shares the same Python environment and lock:

```powershell
uv sync --locked --extra dev
```

After changing a dependency in `pyproject.toml`, regenerate and verify the lock with:

```powershell
uv lock
uv sync --locked --extra collector --extra dev
```

Do not hand-edit `uv.lock`. Commit it alongside the manifest change. Frontend dependencies will use npm's committed `frontend/package-lock.json`; generate it with `npm install` after `frontend/package.json` is added, and use `npm ci` in clean installs/CI.

## Version policy

Python direct dependencies use bounded major-version ranges and the lock captures the tested resolution. The frontend owner must use React 19, TypeScript, Vite, Tailwind CSS, Recharts and Lucide React, commit `package.json` plus `package-lock.json`, and avoid adding another backend framework or database. PostgreSQL is the only SaaS database; SQLite is reserved for the collector's local queue.
