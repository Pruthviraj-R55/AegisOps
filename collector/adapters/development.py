"""Synthetic input helper for local tests; this is never an organizer adapter."""

from collections.abc import AsyncIterator
from typing import Any


class DevelopmentOnlyAdapter:
    """Yield a tiny, clearly synthetic event through the adapter protocol."""

    source_kind = "development_only"

    def __init__(self, events: list[dict[str, Any]]):
        self._events = events

    async def events(self) -> AsyncIterator[dict[str, Any]]:
        for event in self._events:
            yield event
