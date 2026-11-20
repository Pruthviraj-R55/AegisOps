"""Run the local-only collector API on the loopback interface."""

import uvicorn

from collector.config import CollectorSettings


if __name__ == "__main__":
    settings = CollectorSettings()
    # Keep the interface loopback-only: local inspection APIs do not authenticate callers.
    uvicorn.run("collector.api:app", host="127.0.0.1", port=settings.collector_api_port, reload=False)
