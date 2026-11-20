# Data flow and record lifecycle

1. **Receive locally:** an adapter consumes events from the organizer's eventual stream protocol. Its interface is configured without assuming a URL, auth scheme, rate or event format. A development simulator, if added, must label its data as simulated.
2. **Normalize:** map known source values into an internal representation. Unknown fields are not carried forward.
3. **Scrub locally:** detect and redact secrets in values and free text before any further handling or diagnostic logging.
4. **Allow-list:** construct a fresh outbound record from approved schema fields. Never copy/serialize the original event object.
5. **Pseudonymize and aggregate:** replace source identifiers with stable, tenant-local pseudonyms; aggregate failed-login and suspicious-activity counts and supported metrics as appropriate.
6. **Inspect egress:** show the exact JSON serialization of the approved record before enqueue/transmission. Keep this panel local.
7. **Persist:** generate `payload_id` once and persist the record in SQLite WAL. Keep it pending until acknowledged.
8. **Send:** post one record over HTTPS with a bearer credential. Retry transient failures with bounded exponential backoff and jitter; preserve body and ID.
9. **Commit and acknowledge:** authenticate, derive tenant from credential, validate tenant and schema, then durably commit under a unique `(tenant_id, payload_id)` constraint. A duplicate with identical content is acknowledged as duplicate. A conflicting reuse is rejected.
10. **Process:** calculate service health from event-time-aware data, downgrade stale data, detect anomalies using explainable baselines/rules, and correlate related signals by service and time window.
11. **Present:** expose tenant-scoped fleet health and incidents with contributing signals, confidence, recommended action and rollback plan.

Raw logs, source secrets, unapproved properties and full original events never enter the outbound queue or SaaS. Transport buffering on the SaaS begins only after approved metadata crosses the boundary.
