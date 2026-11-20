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
