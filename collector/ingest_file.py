"""One-shot JSON/JSONL file import through the local collector pipeline."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Sequence

from collector.adapters.json_file import AdapterRecordError, JsonAdapterConfig, JsonFileAdapter
from collector.config import CollectorSettings
from collector.service import CollectorService


def _arguments(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import a JSON or JSONL file through AEGISOPS local privacy controls.")
    parser.add_argument("source", type=Path, help="local JSON or JSONL source file")
    parser.add_argument("--mapping", required=True, type=Path, help="JSON adapter mapping configuration")
    parser.add_argument("--format", choices=("auto", "json", "jsonl"), default="auto")
    return parser.parse_args(argv)


async def _ingest(source: Path, mapping_path: Path, format: str) -> int:
    try:
        mapping_data = json.loads(mapping_path.read_text(encoding="utf-8"))
        config = JsonAdapterConfig.from_dict(mapping_data)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError):
        print("Could not load adapter mapping configuration.", file=sys.stderr)
        return 2

    settings = CollectorSettings()
    service = CollectorService(settings)
    await service.start()
    try:
        count = await service.ingest_adapter(JsonFileAdapter(source, config, format=format))
        print(json.dumps({"source_kind": "local_file", "processed_count": count}))
        return 0
    except AdapterRecordError as exc:
        print(json.dumps({"error": exc.as_dict()}), file=sys.stderr)
        return 1
    except (RuntimeError, ValueError):
        # Never print arbitrary exception text; it can contain source values.
        print("File import failed validation or collector privacy configuration.", file=sys.stderr)
        return 1
    finally:
        await service.stop()


def main(argv: Sequence[str] | None = None) -> int:
    args = _arguments(argv)
    return asyncio.run(_ingest(args.source, args.mapping, args.format))


if __name__ == "__main__":
    raise SystemExit(main())
