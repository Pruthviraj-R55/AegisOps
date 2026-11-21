from __future__ import annotations

import json

import pytest

from collector.normalization.pipeline import serialize_payload
from collector.queue.sqlite_queue import QueuePayloadConflict, SQLiteQueue


@pytest.mark.asyncio
async def test_queue_survives_restart_and_recovers_in_flight(event, normalizer, tmp_path):
    payload, proof = normalizer.build(event)
    encoded = serialize_payload(payload)
    first = SQLiteQueue(tmp_path / "queue.sqlite3")
    await first.initialize()
    async with first._connection() as db:
        cursor = await db.execute("PRAGMA journal_mode")
        assert (await cursor.fetchone())[0].lower() == "wal"
    await first.enqueue(payload["payload_id"], encoded, proof)
    assert await first.approve_egress(payload["payload_id"]) is True
    claimed = await first.claim_next(now=10**12)
    assert claimed is not None and claimed.state == "in_flight"

    restarted = SQLiteQueue(tmp_path / "queue.sqlite3")
    await restarted.initialize()
    recovered = await restarted.preview()
    assert recovered is not None
    assert recovered.state == "pending"
    assert recovered.egress_approved is True
    assert recovered.payload_json == encoded
    assert "payments-api" not in recovered.payload_json


@pytest.mark.asyncio
async def test_same_event_id_is_deduplicated_without_new_logical_payload(event, normalizer, tmp_path):
    first, proof = normalizer.build(event)
    second, second_proof = normalizer.build(event)
    queue = SQLiteQueue(tmp_path / "queue.sqlite3")
    await queue.initialize()

    assert await queue.enqueue(first["payload_id"], serialize_payload(first), proof) is True
    assert await queue.enqueue(second["payload_id"], serialize_payload(second), second_proof) is False
    counts = await queue.counts()
    assert counts["pending"] == 1


@pytest.mark.asyncio
async def test_queue_rejects_same_id_with_different_body(event, normalizer, tmp_path):
    payload, proof = normalizer.build(event)
    queue = SQLiteQueue(tmp_path / "queue.sqlite3")
    await queue.initialize()
    await queue.enqueue(payload["payload_id"], serialize_payload(payload), proof)

    with pytest.raises(QueuePayloadConflict):
        await queue.enqueue(payload["payload_id"], json.dumps({"different": True}), proof)


@pytest.mark.asyncio
async def test_approval_is_bound_to_exact_payload_and_tampering_revokes_delivery(event, normalizer, tmp_path):
    payload, proof = normalizer.build(event)
    queue = SQLiteQueue(tmp_path / "integrity.sqlite3")
    await queue.initialize()
    await queue.enqueue(payload["payload_id"], serialize_payload(payload), proof)

    assert await queue.approve_egress(payload["payload_id"]) is True
    approved = await queue.get(payload["payload_id"])
    assert approved is not None and approved.egress_approved is True
    assert approved.payload_integrity_valid is True
    assert approved.approved_payload_sha256 == approved.payload_sha256

    async with queue._connection() as db:
        await db.execute(
            "UPDATE telemetry_queue SET payload_json=? WHERE payload_id=?",
            (json.dumps({"tampered": "must not leave this machine"}), payload["payload_id"]),
        )
        await db.commit()

    tampered_preview = await queue.preview(payload["payload_id"])
    assert tampered_preview is not None
    assert tampered_preview.payload_integrity_valid is False
    assert tampered_preview.egress_approved is False
    assert tampered_preview.last_error_code == "payload_integrity_mismatch"
    assert await queue.claim_next(10**12) is None
    invalidated = await queue.get(payload["payload_id"])
    assert invalidated is not None
    assert invalidated.egress_approved is False
    assert invalidated.last_error_code == "payload_integrity_mismatch"


@pytest.mark.asyncio
async def test_payload_tampered_before_approval_cannot_be_approved(event, normalizer, tmp_path):
    payload, proof = normalizer.build(event)
    queue = SQLiteQueue(tmp_path / "preapproval-tamper.sqlite3")
    await queue.initialize()
    await queue.enqueue(payload["payload_id"], serialize_payload(payload), proof)
    async with queue._connection() as db:
        await db.execute(
            "UPDATE telemetry_queue SET payload_json=? WHERE payload_id=?",
            (json.dumps({"not": "the normalized record"}), payload["payload_id"]),
        )
        await db.commit()

    assert await queue.approve_egress(payload["payload_id"]) is False
    assert await queue.claim_next(10**12) is None


@pytest.mark.asyncio
async def test_rejected_record_cannot_be_delivered_or_manually_retried(event, normalizer, tmp_path):
    payload, proof = normalizer.build(event)
    queue = SQLiteQueue(tmp_path / "rejected.sqlite3")
    await queue.initialize()
    await queue.enqueue(payload["payload_id"], serialize_payload(payload), proof)

    assert await queue.reject_egress(payload["payload_id"]) is True
    rejected = await queue.get(payload["payload_id"])
    assert rejected is not None
    assert rejected.state == "failed"
    assert rejected.egress_approved is False
    assert rejected.last_error_code == "egress_rejected"
    assert await queue.approve_egress(payload["payload_id"]) is False
    assert await queue.retry_failed(payload["payload_id"]) is False
    assert await queue.claim_next(10**12) is None


@pytest.mark.asyncio
async def test_legacy_approved_rows_require_fresh_exact_payload_approval(tmp_path, event, normalizer):
    import aiosqlite

    payload, proof = normalizer.build(event)
    path = tmp_path / "legacy-queue.sqlite3"
    async with aiosqlite.connect(path) as db:
        await db.execute(
            """CREATE TABLE telemetry_queue (
                payload_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,proof_json TEXT NOT NULL,
                state TEXT NOT NULL,egress_approved INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,updated_at TEXT NOT NULL,next_attempt_at REAL NOT NULL DEFAULT 0,
                last_error_code TEXT
            )"""
        )
        await db.execute(
            """INSERT INTO telemetry_queue VALUES(?,?,?,'pending',1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,0,NULL)""",
            (payload["payload_id"], serialize_payload(payload), json.dumps(proof)),
        )
        await db.commit()

    queue = SQLiteQueue(path)
    await queue.initialize()
    prior = await queue.get(payload["payload_id"])
    assert prior is not None
    assert prior.egress_approved is False
    assert prior.last_error_code == "approval_revalidation_required"
    assert await queue.claim_next(10**12) is None
    assert await queue.approve_egress(payload["payload_id"]) is True


@pytest.mark.asyncio
async def test_raw_event_and_secret_values_are_not_persisted(event, normalizer, tmp_path):
    event["password"] = "queue-must-not-contain-this-password"
    event["message"] = "raw log text must stay local"
    database = tmp_path / "queue.sqlite3"
    payload, proof = normalizer.build(event)
    queue = SQLiteQueue(database)
    await queue.initialize()
    await queue.enqueue(payload["payload_id"], serialize_payload(payload), proof)

    stored_bytes = b"".join(path.read_bytes() for path in tmp_path.glob("queue.sqlite3*"))
    assert b"queue-must-not-contain-this-password" not in stored_bytes
    assert b"raw log text must stay local" not in stored_bytes
    assert b"payments-api" not in stored_bytes
