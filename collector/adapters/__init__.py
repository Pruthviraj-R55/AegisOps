"""Interfaces and generic local-file adapters for telemetry sources."""

from collector.adapters.json_file import AdapterRecordError, JsonAdapterConfig, JsonFileAdapter
from collector.adapters.protocol import TelemetryAdapter

__all__ = ["AdapterRecordError", "JsonAdapterConfig", "JsonFileAdapter", "TelemetryAdapter"]
