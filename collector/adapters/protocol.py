"""Source adapter boundary; organizer-specific details remain intentionally unknown."""

from collections.abc import AsyncIterator
from typing import Any, Protocol


class TelemetryAdapter(Protocol):
    """Yield source events without assuming a protocol or source event schema.

    Implementations must identify their source as organizer-provided or
    development-simulated. Raw events are local inputs and must never be sent
    directly to the SaaS API.
    """

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        """Stream source-native event objects to the local normalization layer."""
        ...
