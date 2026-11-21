"""Collector configuration loaded from environment variables."""

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class CollectorSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    collector_id: str = "local-dev-collector"
    collector_tenant_id: str = "development-tenant"
    collector_queue_path: str = "./var/collector-queue.sqlite3"
    collector_pseudonymization_key: SecretStr | None = None
    collector_heartbeat_interval_seconds: float = 15
    collector_offline_after_seconds: float = 60
    collector_retry_base_seconds: float = 1
    collector_retry_max_seconds: float = 60
    collector_request_timeout_seconds: float = 5
    collector_api_port: int = 8100
    collector_max_event_bytes: int = 1_048_576
    collector_cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    saas_ingest_url: str | None = None
    collector_bearer_token: SecretStr | None = None
    aegisops_env: str = "development"
