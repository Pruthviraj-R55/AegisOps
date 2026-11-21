"""Async, crash-recoverable SQLite WAL queue for validated egress records."""

from __future__ import annotations

import hashlib
import hmac
import json
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite


class QueuePayloadConflict(RuntimeError):
    """A payload ID already exists locally with a different serialized body."""


@dataclass(frozen=True)
class QueueItem:
    payload_id: str
    payload_json: str
    proof_json: str
    state: str
    egress_approved: bool
    attempts: int
    created_at: str
    next_attempt_at: float
    payload_sha256: str | None = None
    approved_payload_sha256: str | None = None
    last_error_code: str | None = None

    def proof(self) -> dict[str, Any]:
        return json.loads(self.proof_json)

    @property
    def payload_integrity_valid(self) -> bool:
        if self.payload_sha256 is None:
            return False
        current = hashlib.sha256(self.payload_json.encode("utf-8")).hexdigest()
        return hmac.compare_digest(current, self.payload_sha256)

    @property
    def approval_integrity_valid(self) -> bool:
        if not self.egress_approved:
            return True
        if self.approved_payload_sha256 is None or not self.payload_integrity_valid:
            return False
        current = hashlib.sha256(self.payload_json.encode("utf-8")).hexdigest()
        return hmac.compare_digest(current, self.approved_payload_sha256)


class SQLiteQueue:
    STATES = ("pending", "in_flight", "acknowledged", "failed")

    def __init__(self, database_path: str | Path):
        self.path = Path(database_path)

    @asynccontextmanager
    async def _connection(self):
        db = await aiosqlite.connect(str(self.path))
        await db.execute("PRAGMA busy_timeout=5000")
        await db.execute("PRAGMA synchronous=FULL")
        try:
            yield db
        finally:
            await db.close()

    async def initialize(self) -> None:
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        async with self._connection() as db:
            await db.execute("PRAGMA journal_mode=WAL")
            await db.execute(
                """CREATE TABLE IF NOT EXISTS telemetry_queue (
                    payload_id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    proof_json TEXT NOT NULL,
                    state TEXT NOT NULL CHECK(state IN ('pending','in_flight','acknowledged','failed')),
                    egress_approved INTEGER NOT NULL DEFAULT 0,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    next_attempt_at REAL NOT NULL DEFAULT 0,
                    last_error_code TEXT
                )"""
            )
            columns = await (await db.execute("PRAGMA table_info(telemetry_queue)")).fetchall()
            column_names = {column[1] for column in columns}
            if "egress_approved" not in column_names:
                await db.execute("ALTER TABLE telemetry_queue ADD COLUMN egress_approved INTEGER NOT NULL DEFAULT 0")
            if "payload_sha256" not in column_names:
                await db.execute("ALTER TABLE telemetry_queue ADD COLUMN payload_sha256 TEXT")
            if "approved_payload_sha256" not in column_names:
                await db.execute("ALTER TABLE telemetry_queue ADD COLUMN approved_payload_sha256 TEXT")
            rows = await (
                await db.execute(
                    "SELECT payload_id,payload_json,payload_sha256,approved_payload_sha256,egress_approved,last_error_code FROM telemetry_queue"
                )
            ).fetchall()
            for payload_id, payload_json, stored_digest, approved_digest, approved, error_code in rows:
                current_digest = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
                if stored_digest is None:
                    # Legacy rows gain integrity tracking, but prior approvals
                    # must be reviewed again because no approval snapshot exists.
                    await db.execute(
                        "UPDATE telemetry_queue SET payload_sha256=?,egress_approved=0,approved_payload_sha256=NULL,last_error_code=? WHERE payload_id=?",
                        (current_digest, "approval_revalidation_required" if approved else error_code, payload_id),
                    )
                elif not hmac.compare_digest(stored_digest, current_digest):
                    await db.execute(
                        "UPDATE telemetry_queue SET egress_approved=0,approved_payload_sha256=NULL,last_error_code='payload_integrity_mismatch' WHERE payload_id=?",
                        (payload_id,),
                    )
                elif approved and (
                    approved_digest is None or not hmac.compare_digest(approved_digest, current_digest)
                ):
                    await db.execute(
                        "UPDATE telemetry_queue SET egress_approved=0,approved_payload_sha256=NULL,last_error_code='approval_revalidation_required' WHERE payload_id=?",
                        (payload_id,),
                    )
            await db.execute(
                """CREATE TABLE IF NOT EXISTS collector_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )"""
            )
            await db.execute(
                "UPDATE telemetry_queue SET state='pending', updated_at=CURRENT_TIMESTAMP WHERE state='in_flight'"
            )
            await db.commit()

    async def enqueue(self, payload_id: str, payload_json: str, proof: dict[str, Any]) -> bool:
        """Persist only approved payload JSON and value-free proof metadata.

        Returns True for a newly queued item and False for an identical duplicate.
        """
        proof_json = json.dumps(proof, separators=(",", ":"), sort_keys=True)
        async with self._connection() as db:
            await db.execute("BEGIN IMMEDIATE")
            cursor = await db.execute(
                "SELECT payload_json FROM telemetry_queue WHERE payload_id=?", (payload_id,)
            )
            existing = await cursor.fetchone()
            if existing is not None:
                await db.rollback()
                if existing[0] != payload_json:
                    raise QueuePayloadConflict("payload ID already exists with different content")
                return False
            await db.execute(
                """INSERT INTO telemetry_queue
                   (payload_id,payload_json,proof_json,state,created_at,updated_at,next_attempt_at,payload_sha256)
                   VALUES (?,?,?,'pending',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,?)""",
                (payload_id, payload_json, proof_json, hashlib.sha256(payload_json.encode("utf-8")).hexdigest()),
            )
            await db.commit()
        return True

    @staticmethod
    def _item(row: tuple[Any, ...] | None) -> QueueItem | None:
        if row is None:
            return None
        return QueueItem(
            row[0], row[1], row[2], row[3], bool(row[4]), row[5], row[6], row[7],
            row[8] if len(row) > 8 else None,
            row[9] if len(row) > 9 else None,
            row[10] if len(row) > 10 else None,
        )

    async def get(self, payload_id: str) -> QueueItem | None:
        async with self._connection() as db:
            cursor = await db.execute(
                """SELECT payload_id,payload_json,proof_json,state,egress_approved,attempts,created_at,next_attempt_at,
                          payload_sha256,approved_payload_sha256,last_error_code
                   FROM telemetry_queue WHERE payload_id=?""",
                (payload_id,),
            )
            item = self._item(await cursor.fetchone())
            if item is not None and item.state == "pending" and item.egress_approved and not item.approval_integrity_valid:
                await db.execute(
                    """UPDATE telemetry_queue SET egress_approved=0,approved_payload_sha256=NULL,
                       last_error_code='payload_integrity_mismatch',updated_at=CURRENT_TIMESTAMP
                       WHERE payload_id=? AND state='pending'""",
                    (item.payload_id,),
                )
                await db.commit()
                item = replace(
                    item, egress_approved=False, approved_payload_sha256=None,
                    last_error_code="payload_integrity_mismatch",
                )
            return item

    async def preview(self, payload_id: str | None = None) -> QueueItem | None:
        async with self._connection() as db:
            if payload_id:
                cursor = await db.execute(
                    """SELECT payload_id,payload_json,proof_json,state,egress_approved,attempts,created_at,next_attempt_at,
                              payload_sha256,approved_payload_sha256,last_error_code
                       FROM telemetry_queue WHERE payload_id=?""",
                    (payload_id,),
                )
            else:
                cursor = await db.execute(
                    """SELECT payload_id,payload_json,proof_json,state,egress_approved,attempts,created_at,next_attempt_at,
                              payload_sha256,approved_payload_sha256,last_error_code
                       FROM telemetry_queue WHERE state IN ('pending','in_flight')
                       ORDER BY created_at,payload_id LIMIT 1"""
                )
            item = self._item(await cursor.fetchone())
            if item is not None and item.state == "pending" and item.egress_approved and not item.approval_integrity_valid:
                await db.execute(
                    """UPDATE telemetry_queue SET egress_approved=0,approved_payload_sha256=NULL,
                       last_error_code='payload_integrity_mismatch',updated_at=CURRENT_TIMESTAMP
                       WHERE payload_id=? AND state='pending'""",
                    (item.payload_id,),
                )
                await db.commit()
                item = replace(
                    item, egress_approved=False, approved_payload_sha256=None,
                    last_error_code="payload_integrity_mismatch",
                )
            return item

    async def claim_next(self, now: float) -> QueueItem | None:
        async with self._connection() as db:
            await db.execute("BEGIN IMMEDIATE")
            cursor = await db.execute(
                """SELECT payload_id,payload_json,proof_json,state,egress_approved,attempts,created_at,next_attempt_at,
                          payload_sha256,approved_payload_sha256,last_error_code
                   FROM telemetry_queue WHERE state='pending' AND egress_approved=1 AND next_attempt_at<=?
                   ORDER BY created_at,payload_id""",
                (now,),
            )
            rows = await cursor.fetchall()
            for row in rows:
                current_digest = hashlib.sha256(row[1].encode("utf-8")).hexdigest()
                if (
                    row[8] is None
                    or row[9] is None
                    or not hmac.compare_digest(row[8], current_digest)
                    or not hmac.compare_digest(row[9], current_digest)
                ):
                    await db.execute(
                        """UPDATE telemetry_queue SET egress_approved=0,approved_payload_sha256=NULL,
                           last_error_code='payload_integrity_mismatch',updated_at=CURRENT_TIMESTAMP
                           WHERE payload_id=? AND state='pending'""",
                        (row[0],),
                    )
                    continue
                changed = await db.execute(
                    "UPDATE telemetry_queue SET state='in_flight',updated_at=CURRENT_TIMESTAMP WHERE payload_id=? AND state='pending'",
                    (row[0],),
                )
                if changed.rowcount == 1:
                    await db.commit()
                    return QueueItem(
                        row[0], row[1], row[2], "in_flight", True, row[5], row[6], row[7], row[8], row[9], row[10]
                    )
            await db.commit()
            return None

    async def approve_egress(self, payload_id: str) -> bool:
        async with self._connection() as db:
            await db.execute("BEGIN IMMEDIATE")
            cursor = await db.execute(
                "SELECT payload_json,payload_sha256 FROM telemetry_queue WHERE payload_id=? AND state='pending' AND egress_approved=0",
                (payload_id,),
            )
            row = await cursor.fetchone()
            if row is None:
                await db.commit()
                return False
            digest = hashlib.sha256(row[0].encode("utf-8")).hexdigest()
            if row[1] is None or not hmac.compare_digest(row[1], digest):
                await db.execute(
                    "UPDATE telemetry_queue SET last_error_code='payload_integrity_mismatch' WHERE payload_id=?",
                    (payload_id,),
                )
                await db.commit()
                return False
            await db.execute(
                """UPDATE telemetry_queue SET egress_approved=1,approved_payload_sha256=?,
                   last_error_code=NULL,updated_at=CURRENT_TIMESTAMP WHERE payload_id=? AND state='pending' AND egress_approved=0""",
                (digest, payload_id),
            )
            await db.commit()
            return True

    async def reject_egress(self, payload_id: str) -> bool:
        """Reject one pending record. It cannot be manually retried afterward."""
        async with self._connection() as db:
            cursor = await db.execute(
                """UPDATE telemetry_queue SET state='failed',egress_approved=0,approved_payload_sha256=NULL,
                   last_error_code='egress_rejected',updated_at=CURRENT_TIMESTAMP
                   WHERE payload_id=? AND state='pending'""",
                (payload_id,),
            )
            await db.commit()
            return cursor.rowcount == 1

    async def mark_pending(self, payload_id: str, error_code: str, next_attempt_at: float) -> None:
        async with self._connection() as db:
            await db.execute(
                """UPDATE telemetry_queue SET state='pending',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP,
                   next_attempt_at=?,last_error_code=? WHERE payload_id=? AND state='in_flight'""",
                (next_attempt_at, error_code[:64], payload_id),
            )
            await db.commit()

    async def mark_failed(self, payload_id: str, error_code: str) -> None:
        async with self._connection() as db:
            await db.execute(
                """UPDATE telemetry_queue SET state='failed',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP,
                   last_error_code=? WHERE payload_id=? AND state='in_flight'""",
                (error_code[:64], payload_id),
            )
            await db.commit()

    async def acknowledge(self, payload_id: str) -> None:
        async with self._connection() as db:
            await db.execute(
                """UPDATE telemetry_queue SET state='acknowledged',updated_at=CURRENT_TIMESTAMP,
                   last_error_code=NULL WHERE payload_id=? AND state='in_flight'""",
                (payload_id,),
            )
            await db.commit()

    async def retry_failed(self, payload_id: str) -> bool:
        async with self._connection() as db:
            cursor = await db.execute(
                """UPDATE telemetry_queue SET state='pending',next_attempt_at=0,updated_at=CURRENT_TIMESTAMP,
                   last_error_code=NULL WHERE payload_id=? AND state='failed' AND COALESCE(last_error_code,'')!='egress_rejected'""",
                (payload_id,),
            )
            await db.commit()
            return cursor.rowcount > 0

    async def list_items(self, limit: int = 50) -> list[dict[str, Any]]:
        bounded_limit = min(200, max(1, limit))
        async with self._connection() as db:
            cursor = await db.execute(
                """SELECT payload_id,state,egress_approved,attempts,created_at,updated_at,last_error_code,
                          payload_json,proof_json,payload_sha256,approved_payload_sha256,next_attempt_at
                   FROM telemetry_queue ORDER BY created_at DESC,payload_id LIMIT ?""",
                (bounded_limit,),
            )
            rows = await cursor.fetchall()
        items: list[dict[str, Any]] = []
        safe_categories = {
            "windows_live_metrics", "file", "development_only", "local_api", "adapter", "unknown"
        }
        allowed_metrics = {
            "cpu_percent", "memory_percent", "disk_percent", "bandwidth_mbps",
            "latency_ms", "packet_loss_percent",
        }
        for row in rows:
            try:
                payload = json.loads(row[7])
                proof = json.loads(row[8])
            except (json.JSONDecodeError, TypeError):
                payload, proof = {}, {}
            current_digest = hashlib.sha256(row[7].encode("utf-8")).hexdigest()
            integrity_valid = row[9] is not None and hmac.compare_digest(row[9], current_digest)
            approval_valid = (
                not row[2]
                or (
                    integrity_valid and row[10] is not None
                    and hmac.compare_digest(row[10], current_digest)
                )
            )
            security = payload.get("security") if isinstance(payload, dict) else None
            security_fields = {"failed_login_count", "suspicious_activity_count"}
            if not isinstance(security, dict) or not security:
                security_status = "unavailable"
            elif security_fields <= set(security):
                security_status = "available"
            else:
                security_status = "partial"
            rejected = row[6] == "egress_rejected"
            raw_source = proof.get("source_category") if isinstance(proof, dict) else None
            source_category = raw_source if isinstance(raw_source, str) and raw_source in safe_categories else "unknown"
            metrics = payload.get("metrics", {}) if integrity_valid and isinstance(payload, dict) else {}
            safe_metrics = {
                name: value for name, value in metrics.items()
                if name in allowed_metrics and isinstance(value, (int, float)) and not isinstance(value, bool)
            } if isinstance(metrics, dict) else {}
            items.append({
                "payload_id": row[0],
                "state": row[1],
                "egress_approved": bool(row[2] and approval_valid),
                "egress_review_status": (
                    "rejected" if rejected
                    else "integrity_error" if not approval_valid
                    else "approved" if row[2]
                    else "awaiting_review"
                ),
                "attempts": row[3],
                "created_at": datetime.fromisoformat(row[4]).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
                "updated_at": datetime.fromisoformat(row[5]).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
                "next_attempt_at": row[11],
                "last_error_code": row[6],
                "schema_version": payload.get("schema_version") if integrity_valid and isinstance(payload, dict) else None,
                "event_time": payload.get("event_time") if integrity_valid and isinstance(payload, dict) else None,
                "source_category": source_category,
                "metrics": safe_metrics,
                "security_status": security_status if integrity_valid else "unknown",
                "payload_integrity_valid": integrity_valid,
            })
        return items

    async def counts(self) -> dict[str, int]:
        counts = {state: 0 for state in self.STATES}
        async with self._connection() as db:
            cursor = await db.execute("SELECT state,COUNT(*) FROM telemetry_queue GROUP BY state")
            for state, count in await cursor.fetchall():
                counts[state] = int(count)
            cursor = await db.execute(
                "SELECT COUNT(*) FROM telemetry_queue WHERE state='pending' AND egress_approved=0"
            )
            counts["awaiting_egress_review"] = int((await cursor.fetchone())[0])
            cursor = await db.execute(
                "SELECT COUNT(*) FROM telemetry_queue WHERE state='pending' AND egress_approved=1"
            )
            counts["pending_delivery"] = int((await cursor.fetchone())[0])
        counts["queue_depth"] = counts["pending"] + counts["in_flight"]
        counts["pending_payload_count"] = counts["pending"] + counts["in_flight"]
        return counts

    async def set_state(self, key: str, value: str) -> None:
        async with self._connection() as db:
            await db.execute(
                "INSERT INTO collector_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
            await db.commit()

    async def get_state(self, key: str) -> str | None:
        async with self._connection() as db:
            cursor = await db.execute("SELECT value FROM collector_state WHERE key=?", (key,))
            row = await cursor.fetchone()
            return str(row[0]) if row else None
