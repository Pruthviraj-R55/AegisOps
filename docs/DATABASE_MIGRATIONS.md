# SaaS database migrations

Alembic is the schema migration mechanism for production. `saas.api.main` keeps `Base.metadata.create_all()` only for explicit development and test environments; production startup does not create or modify tables. Apply migrations before starting the production API.

## New database

Configure `SAAS_DATABASE_URL` through the local environment or deployment secret store, then run:

```powershell
uv run --locked alembic upgrade head
uv run --locked alembic current
```

The initial baseline creates the existing telemetry, idempotency, and incident tables plus `incident_evidence` when absent. It is non-destructive on downgrade and never drops existing telemetry.

## Existing database without Alembic history

Back up the database first. Compare its table definitions and constraints with `saas/database/models.py`; the baseline skips tables that already exist, so it does not repair an unexpected or partial schema. If the existing tables match the repository schema, run `alembic upgrade head`. It creates the new evidence table and indexes that are absent, then records the migration revision. If the schema differs, reconcile it deliberately before applying the baseline; do not assume `create_all()` or the baseline alters existing tables.

For local development, startup continues to create missing tables through SQLAlchemy metadata. Use Alembic when verifying migration behavior or before using the same database for production-like checks.

## Dashboard authentication migration and initial users

Dashboard authentication adds `dashboard_users`, `dashboard_sessions`, and `dashboard_login_throttles` in Alembic revision `0003_dashboard_auth`. Production startup does not call `create_all()`; apply `uv run --locked alembic upgrade head` before starting the API. Existing telemetry and incident tables are not dropped or rewritten by this revision.

Production requires `AEGISOPS_ENV=production`, an externally managed `SAAS_DATABASE_URL`, comma-separated explicit HTTPS `SAAS_CORS_ORIGINS`, `DASHBOARD_COOKIE_SECURE=true`, and `DASHBOARD_COOKIE_SAMESITE=none` for cross-origin frontend/API deployment. Set `DASHBOARD_SESSION_TTL_SECONDS`, `DASHBOARD_LOGIN_MAX_ATTEMPTS`, `DASHBOARD_LOGIN_WINDOW_SECONDS`, and `DASHBOARD_LOGIN_LOCK_SECONDS` only when overriding their validated defaults. Terminate TLS at the hosting proxy and configure Uvicorn's forwarded-proto handling to trust only that proxy so the ASGI request scheme remains HTTPS; the app rejects production requests whose effective scheme is HTTP. Never use `*` for credentialed CORS.

There is no public signup or hardcoded bootstrap account. After migration, provision each authorized user through an operator shell with database access:

```powershell
uv run --locked python -m saas.auth_admin create-user --tenant-id <trusted-tenant-id> --email <user-email>
```

The command prompts for and confirms the password without echoing it, stores only a scrypt password hash, and prints the generated stable user ID. The operator must obtain `tenant-id` from trusted provisioning records, not from the browser or telemetry. To disable an account, set its `is_active` column to `false` through the controlled database administration process; active sessions are rejected on their next request.
