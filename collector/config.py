"""Collector configuration loaded from environment variables."""

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class CollectorSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    collector_id: str = "local-dev-collector"
    collector_tenant_id: str = "development-tenant"
    collector_queue_path: str = "./var/collector-queue.sqlite3"
    saas_base_url: str | None = None
    collector_bearer_token: SecretStr | None = None
    aegisops_env: str = "development"


settings = CollectorSettings()
