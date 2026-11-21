"""Capture one local Windows sample through normalization and the SQLite queue."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Sequence

from collector.adapters.json_file import AdapterRecordError
from collector.adapters.windows_metrics import WindowsMetricsAdapter
from collector.config import CollectorSettings
from collector.normalization.pipeline import InvalidTelemetry
from collector.service import CollectorService


def _arguments(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Capture one privacy-filtered local Windows metrics sample")
    parser.add_argument("--service", required=True, help="local service label to pseudonymize before queueing")
    parser.add_argument("--environment", required=True, help="environment label for the local sample")
    parser.add_argument("--sample-interval", type=float, default=1.0, help="bounded sample interval (0.1 to 5 seconds)")
    parser.add_argument("--queue-path", help="SQLite queue path (defaults to COLLECTOR_QUEUE_PATH)")
    return parser.parse_args(argv)


async def _capture(args: argparse.Namespace) -> dict[str, object]:
    # This command intentionally loads process environment only. It does not
    # read .env, and it never starts the delivery loop or approves egress.
    settings = CollectorSettings(_env_file=None)
    if args.queue_path:
        settings = settings.model_copy(update={"collector_queue_path": str(Path(args.queue_path))})
    service = CollectorService(settings)
    adapter = WindowsMetricsAdapter(
        service=args.service,
        environment=args.environment,
        sample_interval_seconds=args.sample_interval,
    )
    try:
        await service.queue.initialize()
        raw_event = await anext(adapter.events())
        result = await service.ingest(raw_event, source_category=adapter.source_kind)
        queued = await service.queue.get(result["payload_id"])
        if queued is None:
            raise RuntimeError("captured sample was not found in the local queue")
        payload = json.loads(queued.payload_json)
        return {
            "status": "queued_for_local_approval",
            "schema_version": payload["schema_version"],
            "event_time": payload["event_time"],
            "metrics": payload["metrics"],
            "security_status": "unavailable" if "security" not in payload else "available",
            "egress_approved": queued.egress_approved,
        }
    finally:
        await service.delivery.close()


def main(argv: Sequence[str] | None = None) -> int:
    args = _arguments(argv)
    try:
        result = asyncio.run(_capture(args))
    except AdapterRecordError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except InvalidTelemetry as exc:
        # Normalizer errors are fixed messages and never echo input values.
        print(str(exc), file=sys.stderr)
        return 2
    except RuntimeError:
        print("collector could not queue the sample; check local configuration", file=sys.stderr)
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
