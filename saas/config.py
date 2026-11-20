"""SaaS configuration management."""

from functools import lru_cache
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration for AegisOps SaaS service."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    aegisops_env: str = Field(default="development", alias="AEGISOPS_ENV")
    aegisops_log_level: str = Field(default="INFO", alias="AEGISOPS_LOG_LEVEL")
    collector_id: str = Field(default="local-dev-collector", alias="COLLECTOR_ID")
    collector_tenant_id: str = Field(default="development-tenant", alias="COLLECTOR_TENANT_ID")
    saas_database_url: str = Field(
        default="postgresql+psycopg://aegisops:aegisops-local-only@127.0.0.1:5432/aegisops",
        alias="SAAS_DATABASE_URL",
    )
    saas_dev_token: str = Field(default="dev-secret-token-12345", alias="SAAS_DEV_TOKEN")
    collector_bearer_token: Optional[str] = Field(default=None, alias="COLLECTOR_BEARER_TOKEN")
    collector_stale_threshold_seconds: float = Field(
        default=45.0, alias="COLLECTOR_STALE_THRESHOLD_SECONDS"
    )

    @property
    def normalized_database_url(self) -> str:
        """Resolve localhost to 127.0.0.1 to avoid Windows IPv6 resolution issues."""
        url = self.saas_database_url
        if "@localhost:" in url:
            url = url.replace("@localhost:", "@127.0.0.1:")
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()
