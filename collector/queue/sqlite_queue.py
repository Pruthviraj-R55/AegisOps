"""Async, crash-recoverable SQLite WAL queue for validated egress records."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from dataclasses import dataclass
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

    def proof(self) -> dict[str, Any]:
        return json.loads(self.proof_json)


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
            if not any(column[1] == "egress_approved" for column in columns):
                await db.execute("ALTER TABLE telemetry_queue ADD COLUMN egress_approved INTEGER NOT NULL DEFAULT 0")
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
                   (payload_id,payload_json,proof_json,state,created_at,updated_at,next_attempt_at)
                   VALUES (?,?,?,'pending',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0)""",
                (payload_id, payload_json, proof_json),
            )
            await db.commit()
        return True

    @staticmethod
    def _item(row: tuple[Any, ...] | None) -> QueueItem | None:
        if row is None:
            return None
        return QueueItem(row[0], row[1], row[2], row[3], bool(row[4]), row[5], row[6], row[7])

    async def get(self, payload_id: str) -> QueueItem | None:
        async with self._connection() as db:
            cursor = await db.execute(
                """SELECT payload_id,payload_json,proof_json,state,egress_approved,attempts,created_at,next_attempt_at
                   FROM telemetry_queue WHERE payload_id=?""",
                (payload_id,),
            )
            return self._item(await cursor.fetchone())

    async def preview(self, payload_id: str | None = None) -> QueueItem | None:
        async with self._connection() as db:
            if payload_id:
                cursor = await db.execute(
                    """SELECT payload_id,payload_json,proof_json,state,egress_approved,attempts,created_at,next_attempt_at
                       FROM telemetry_queue WHERE payload_id=? AND state IN ('pending','in_flight')""",
                    (payload_id,),
                )
            else:
                cursor = await db.execute(
                    """SELECT payload_id,payload_json,proof_json,state,egress_approved,attempts,created_at,next_attempt_at
                       FROM telemetry_queue WHERE state IN ('pending','in_flight')
                       ORDER BY created_at,payload_id LIMIT 1"""
                )
            return self._item(await cursor.fetchone())

    async def claim_next(self, now: float) -> QueueItem | None:
        async with self._connection() as db:
            await db.execute("BEGIN IMMEDIATE")
            cursor = await db.execute(
                """SELECT payload_id,payload_json,proof_json,state,egress_approved,attempts,created_at,next_attempt_at
                   FROM telemetry_queue WHERE state='pending' AND egress_approved=1 AND next_attempt_at<=?
                   ORDER BY created_at,payload_id LIMIT 1""",
                (now,),
            )
            row = await cursor.fetchone()
            if row is None:
                await db.commit()
                return None
            await db.execute(
                "UPDATE telemetry_queue SET state='in_flight',updated_at=CURRENT_TIMESTAMP WHERE payload_id=? AND state='pending'",
                (row[0],),
            )
            await db.commit()
            return QueueItem(row[0], row[1], row[2], "in_flight", bool(row[4]), row[5], row[6], row[7])

    async def approve_egress(self, payload_id: str) -> bool:
        async with self._connection() as db:
            cursor = await db.execute(
                """UPDATE telemetry_queue SET egress_approved=1,updated_at=CURRENT_TIMESTAMP
                   WHERE payload_id=? AND state='pending' AND egress_approved=0""",
                (payload_id,),
            )
            await db.commit()
            return cursor.rowcount > 0

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
                   last_error_code=NULL WHERE payload_id=? AND state='failed'""",
                (payload_id,),
            )
            await db.commit()
            return cursor.rowcount > 0

    async def list_items(self, limit: int = 50) -> list[dict[str, Any]]:
        bounded_limit = min(200, max(1, limit))
        async with self._connection() as db:
            cursor = await db.execute(
                """SELECT payload_id,state,egress_approved,attempts,created_at,updated_at,last_error_code
                   FROM telemetry_queue ORDER BY created_at DESC,payload_id LIMIT ?""",
                (bounded_limit,),
            )
            rows = await cursor.fetchall()
        return [
            {
                "payload_id": row[0],
                "state": row[1],
                "egress_review_status": "approved" if row[2] else "awaiting_review",
                "attempts": row[3],
                "created_at": datetime.fromisoformat(row[4]).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
                "updated_at": datetime.fromisoformat(row[5]).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
                "last_error_code": row[6],
            }
            for row in rows
        ]

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
