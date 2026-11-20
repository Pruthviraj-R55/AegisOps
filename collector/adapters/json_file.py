"""Generic JSON and JSONL telemetry source adapter.

This adapter maps source records to the collector's internal input shape only.
The resulting events must still pass through ``CollectorService.ingest`` and
the normalizer before they can be queued or transmitted.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal


CanonicalField = Literal[
    "event_id", "event_time", "service", "environment", "region", "health",
    "metrics.cpu_percent", "metrics.memory_percent", "metrics.disk_percent",
    "metrics.bandwidth_mbps", "metrics.latency_ms", "metrics.packet_loss_percent",
    "security.failed_login_count", "security.suspicious_activity_count",
]
_CANONICAL_FIELDS = frozenset(CanonicalField.__args__)
_AGGREGATIONS = {"mean", "sum", "min", "max", "last"}


@dataclass(frozen=True)
class AdapterRecordError(ValueError):
    """Safe, structured error for one malformed source record."""

    source: str
    record_number: int
    code: str
    message: str

    def __str__(self) -> str:
        return f"{self.source}: record {self.record_number}: {self.code}: {self.message}"

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "record_number": self.record_number,
            "code": self.code,
            "message": self.message,
        }


@dataclass(frozen=True)
class JsonAdapterConfig:
    """Source mapping and optional local summary aggregation settings.

    ``field_mapping`` maps canonical dotted paths to source dotted paths, for
    example ``{"metrics.cpu_percent": "host.cpu"}``. Aggregation, when set,
    maps canonical numeric paths to one of mean/sum/min/max/last and emits one
    summary per service/environment/region for the input file.
    """

    field_mapping: Mapping[str, str]
    timestamp_format: Literal["iso8601", "unix_seconds", "unix_milliseconds"] = "iso8601"
    aggregation: Mapping[str, str] = field(default_factory=dict)
    max_record_bytes: int = 1_048_576

    def __post_init__(self) -> None:
        if not isinstance(self.timestamp_format, str) or self.timestamp_format not in {
            "iso8601", "unix_seconds", "unix_milliseconds"
        }:
            raise ValueError("timestamp_format must be iso8601, unix_seconds, or unix_milliseconds")
        unknown = set(self.field_mapping) - _CANONICAL_FIELDS
        if unknown:
            raise ValueError("field_mapping contains unsupported canonical target fields")
        if any(
            not isinstance(path, str) or not path.strip() or any(not part for part in path.split("."))
            for path in self.field_mapping.values()
        ):
            raise ValueError("source paths must be non-empty strings")
        invalid_aggregations = {
            path: operation
            for path, operation in self.aggregation.items()
            if not isinstance(path, str)
            or not isinstance(operation, str)
            or path not in _CANONICAL_FIELDS
            or not (path.startswith("metrics.") or path.startswith("security."))
            or operation not in _AGGREGATIONS
        }
        if invalid_aggregations:
            raise ValueError("aggregation must map supported metric/security fields to mean, sum, min, max, or last")
        if set(self.aggregation) - set(self.field_mapping):
            raise ValueError("every aggregated field must also have a source field mapping")
        if self.aggregation and not self.field_mapping.get("health"):
            raise ValueError("aggregation requires a source mapping for health")
        if isinstance(self.max_record_bytes, bool) or not isinstance(self.max_record_bytes, int):
            raise ValueError("max_record_bytes must be a positive integer")
        if self.max_record_bytes < 1:
            raise ValueError("max_record_bytes must be a positive integer")

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "JsonAdapterConfig":
        if not isinstance(value, Mapping):
            raise ValueError("adapter configuration must be an object")
        allowed = {"field_mapping", "timestamp_format", "aggregation", "max_record_bytes"}
        if set(value) - allowed:
            raise ValueError("adapter configuration contains unsupported options")
        mapping = value.get("field_mapping")
        aggregation = value.get("aggregation", {})
        if not isinstance(mapping, Mapping) or not all(isinstance(k, str) and isinstance(v, str) for k, v in mapping.items()):
            raise ValueError("field_mapping must be an object of canonical path to source path strings")
        if not isinstance(aggregation, Mapping) or not all(isinstance(k, str) and isinstance(v, str) for k, v in aggregation.items()):
            raise ValueError("aggregation must be an object of canonical path to operation strings")
        return cls(
            field_mapping=dict(mapping),
            timestamp_format=value.get("timestamp_format", "iso8601"),
            aggregation=dict(aggregation),
            max_record_bytes=value.get("max_record_bytes", 1_048_576),
        )


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def _read_path(value: Mapping[str, Any], path: str) -> Any:
    current: Any = value
    for segment in path.split("."):
        if isinstance(current, Mapping) and segment in current:
            current = current[segment]
        else:
            return _MISSING
    return current


class _Missing:
    pass


_MISSING = _Missing()


def _timestamp(value: Any, timestamp_format: str) -> str:
    try:
        if timestamp_format == "iso8601":
            if not isinstance(value, str):
                raise ValueError
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError
        elif timestamp_format in {"unix_seconds", "unix_milliseconds"}:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError
            divisor = 1000 if timestamp_format == "unix_milliseconds" else 1
            parsed = datetime.fromtimestamp(value / divisor, timezone.utc)
        else:
            raise ValueError
    except (OverflowError, OSError, TypeError, ValueError):
        raise ValueError("timestamp does not match configured timestamp_format") from None
    return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class JsonFileAdapter:
    """Iterate a JSON object/array or JSONL file with explicit field mapping."""

    source_kind = "file"

    def __init__(
        self,
        path: str | Path,
        config: JsonAdapterConfig,
        *,
        format: Literal["auto", "json", "jsonl"] = "auto",
    ) -> None:
        self.path = Path(path)
        self.config = config
        self.source_name = self.path.name
        self.current_record_number = 0
        if format == "auto":
            self.format = "jsonl" if self.path.suffix.lower() in {".jsonl", ".ndjson"} else "json"
        elif format in {"json", "jsonl"}:
            self.format = format
        else:
            raise ValueError("format must be auto, json, or jsonl")

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        if self.config.aggregation:
            groups: dict[tuple[str, str, str | None], _AggregateGroup] = {}
            async for number, record in self._records():
                mapped = self._map_record(record, number)
                group_key = (mapped["service"], mapped["environment"], mapped.get("region"))
                group = groups.setdefault(group_key, _AggregateGroup())
                group.add(mapped, self.config.aggregation, self.path.name, number)
                self.current_record_number = number
            for key, group in groups.items():
                yield group.finish(key, self.config.aggregation)
            return

        async for number, record in self._records():
            mapped = self._map_record(record, number)
            self.current_record_number = number
            yield mapped

    async def _records(self) -> AsyncIterator[tuple[int, dict[str, Any]]]:
        if self.format == "jsonl":
            try:
                await asyncio.to_thread(self._ensure_readable)
                with self.path.open("r", encoding="utf-8-sig") as source:
                    line_number = 0
                    while True:
                        try:
                            line = await asyncio.to_thread(source.readline)
                        except UnicodeDecodeError:
                            raise self._error(line_number + 1, "invalid_encoding", "source must be UTF-8") from None
                        if not line:
                            break
                        line_number += 1
                        if len(line.encode("utf-8")) > self.config.max_record_bytes:
                            raise self._error(line_number, "record_too_large", "record exceeds configured size limit")
                        if not line.strip():
                            continue
                        try:
                            record = json.loads(line, object_pairs_hook=_reject_duplicate_keys)
                        except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
                            raise self._error(line_number, "invalid_json", "record is not valid JSON") from None
                        yield line_number, self._require_object(record, line_number)
            except OSError:
                raise self._error(1, "source_unavailable", "source file could not be read") from None
            return

        try:
            records = await asyncio.to_thread(self._load_json)
        except OSError:
            raise self._error(1, "source_unavailable", "source file could not be read") from None
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
            raise self._error(1, "invalid_json", "document is not valid JSON") from None
        if isinstance(records, dict):
            yield 1, records
        elif isinstance(records, list):
            for number, record in enumerate(records, start=1):
                yield number, self._require_object(record, number)
        else:
            raise self._error(1, "invalid_document", "JSON document must contain an object or array of objects")

    def _ensure_readable(self) -> None:
        if not self.path.is_file():
            raise self._error(1, "source_unavailable", "source file is unavailable")

    def _load_json(self) -> Any:
        self._ensure_readable()
        with self.path.open("r", encoding="utf-8-sig") as source:
            return json.load(source, object_pairs_hook=_reject_duplicate_keys)

    def _require_object(self, value: Any, number: int) -> dict[str, Any]:
        if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
            raise self._error(number, "invalid_record", "record must be a JSON object with string keys")
        return value

    def _map_record(self, record: dict[str, Any], number: int) -> dict[str, Any]:
        mapped: dict[str, Any] = {}
        for target, source_path in self.config.field_mapping.items():
            value = _read_path(record, source_path)
            if value is _MISSING or value is None:
                continue
            if target == "event_time":
                try:
                    value = _timestamp(value, self.config.timestamp_format)
                except ValueError as exc:
                    raise self._error(number, "invalid_timestamp", str(exc)) from None
            self._assign(mapped, target.split("."), value)

        for required in ("event_time", "service", "environment", "health"):
            if required not in mapped:
                raise self._error(number, "missing_required_field", f"mapped record is missing required field '{required}'")
        return mapped

    @staticmethod
    def _assign(target: dict[str, Any], segments: list[str], value: Any) -> None:
        current = target
        for segment in segments[:-1]:
            current = current.setdefault(segment, {})
        current[segments[-1]] = value

    def _error(self, number: int, code: str, message: str) -> AdapterRecordError:
        # Show only a basename: never echo file content, mapped values, or secrets.
        return AdapterRecordError(self.path.name, number, code, message)


@dataclass
class _AggregateGroup:
    values: dict[str, "_NumericAggregate"] = field(default_factory=dict)
    last_event: dict[str, Any] | None = None
    last_timestamp: datetime | None = None

    def add(self, event: dict[str, Any], operations: Mapping[str, str], source: str, number: int) -> None:
        try:
            timestamp = datetime.fromisoformat(event["event_time"].replace("Z", "+00:00"))
        except (KeyError, TypeError, ValueError):
            raise AdapterRecordError(source, number, "invalid_timestamp", "aggregation requires a valid mapped event_time") from None
        for path in operations:
            current: Any = event
            for segment in path.split("."):
                current = current.get(segment) if isinstance(current, dict) else None
            if current is None:
                continue
            if isinstance(current, bool) or not isinstance(current, (int, float)) or not math.isfinite(current):
                raise AdapterRecordError(source, number, "invalid_aggregate_value", f"'{path}' must be a finite number")
            self.values.setdefault(path, _NumericAggregate()).add(float(current), timestamp)
        if self.last_timestamp is None or timestamp >= self.last_timestamp:
            self.last_timestamp = timestamp
            self.last_event = event

    def finish(self, key: tuple[str, str, str | None], operations: Mapping[str, str]) -> dict[str, Any]:
        if self.last_event is None or self.last_timestamp is None:
            raise ValueError("cannot finish an empty aggregation group")
        result: dict[str, Any] = {
            "event_time": self.last_timestamp.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "service": key[0],
            "environment": key[1],
            "health": self.last_event["health"],
        }
        if key[2] is not None:
            result["region"] = key[2]
        for path, operation in operations.items():
            aggregate = self.values.get(path)
            if aggregate is None:
                continue
            if operation == "mean":
                value = aggregate.total / aggregate.count
            elif operation == "sum":
                value = aggregate.total
            elif operation == "min":
                value = aggregate.minimum
            elif operation == "max":
                value = aggregate.maximum
            else:
                value = aggregate.last_value
            JsonFileAdapter._assign(result, path.split("."), value)
        stable_material = "\0".join((key[0], key[1], key[2] or "", result["event_time"]))
        result["event_id"] = "aggregate-" + hashlib.sha256(stable_material.encode("utf-8")).hexdigest()
        return result


@dataclass
class _NumericAggregate:
    count: int = 0
    total: float = 0.0
    minimum: float = math.inf
    maximum: float = -math.inf
    last_timestamp: datetime | None = None
    last_value: float = 0.0

    def add(self, value: float, timestamp: datetime) -> None:
        self.count += 1
        self.total += value
        self.minimum = min(self.minimum, value)
        self.maximum = max(self.maximum, value)
        if self.last_timestamp is None or timestamp >= self.last_timestamp:
            self.last_timestamp = timestamp
            self.last_value = value
