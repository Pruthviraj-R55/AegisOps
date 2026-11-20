# Security model

## Assets and boundary

Protected data includes raw logs/events, credentials, infrastructure identifiers, tenant records and collector queue contents. The customer-controlled collector is the privacy boundary. Only allow-listed, scrubbed metadata crosses it. The central service is multi-tenant and must treat every request as hostile, even when authenticated.

## Collector controls

- Redact recognized credentials, tokens, keys, and sensitive values locally before diagnostics or normalization output can leave the boundary.
- Construct outbound records from a new object containing only schema-approved fields. Unknown properties are rejected/dropped; no raw source payload is retained in the outbound record.
- Pseudonymize source identifiers with a tenant-local keyed digest; do not send the original identifier or key. Key rotation behavior must be documented when implemented.
- Persist only approved egress records in a local SQLite database with WAL. Protect the database and its directory with customer OS permissions. Treat the local queue as sensitive metadata.
- Render the exact serialized outbound record in the local Egress Proof Panel before transmission.
- Load tokens and organizer credentials from environment/secret management, never source control. Do not log authorization headers.

## Transport and SaaS controls

- Require TLS for every non-local deployment; reject cleartext collector endpoints outside explicitly local development.
- Authenticate bearer credentials and derive tenant and collector identity server-side. Reject payload tenant mismatch.
- Validate schema and size limits before persistence. Never echo submitted content in errors.
- Apply tenant predicates in every repository/query and enforce database uniqueness on `(tenant_id, payload_id)`. Add cross-tenant negative tests.
- Commit durably before acknowledging. Duplicate delivery is expected and safe; a conflicting body under an existing idempotency key is an error.
- Restrict access to secrets, use least-privilege database credentials, and avoid logging metadata values unless operationally necessary.

## Threats and limits

The collector host and its local administrators are inside the customer trust domain; this design does not protect raw data from a compromised collector host. Secret detection is imperfect, so strict allow-listing is the primary egress control and scrubbing is an additional safeguard. TLS protects transport, not data after SaaS receipt. Retention, encryption-at-rest, key management, audit logging and incident response require explicit deployment decisions before production use. This foundation makes no certification or production-readiness claim.
