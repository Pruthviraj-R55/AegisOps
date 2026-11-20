"""SaaS configuration management."""

from functools import lru_cache
import hmac
from urllib.parse import urlsplit
from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration for AegisOps SaaS service."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    aegisops_env: str = Field(default="production", alias="AEGISOPS_ENV")
    aegisops_log_level: str = Field(default="INFO", alias="AEGISOPS_LOG_LEVEL")
    collector_id: str | None = Field(default=None, alias="COLLECTOR_ID")
    collector_tenant_id: str | None = Field(default=None, alias="COLLECTOR_TENANT_ID")
    saas_database_url: str = Field(
        default="postgresql+psycopg://aegisops:aegisops-local-only@127.0.0.1:5432/aegisops",
        alias="SAAS_DATABASE_URL",
    )
    saas_dev_token: SecretStr | None = Field(default=None, alias="SAAS_DEV_TOKEN")
    saas_dashboard_dev_token: SecretStr | None = Field(default=None, alias="SAAS_DASHBOARD_DEV_TOKEN")
    collector_bearer_token: SecretStr | None = Field(default=None, alias="COLLECTOR_BEARER_TOKEN")
    saas_cors_origins: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173", alias="SAAS_CORS_ORIGINS"
    )
    dashboard_cookie_secure: bool = Field(default=False, alias="DASHBOARD_COOKIE_SECURE")
    dashboard_cookie_samesite: str = Field(default="lax", alias="DASHBOARD_COOKIE_SAMESITE")
    dashboard_session_ttl_seconds: int = Field(default=28800, alias="DASHBOARD_SESSION_TTL_SECONDS", ge=300, le=86400)
    dashboard_login_max_attempts: int = Field(default=5, alias="DASHBOARD_LOGIN_MAX_ATTEMPTS", ge=3, le=20)
    dashboard_login_window_seconds: int = Field(default=900, alias="DASHBOARD_LOGIN_WINDOW_SECONDS", ge=60, le=86400)
    dashboard_login_lock_seconds: int = Field(default=900, alias="DASHBOARD_LOGIN_LOCK_SECONDS", ge=60, le=86400)
    collector_stale_threshold_seconds: float = Field(
        default=45.0, alias="COLLECTOR_STALE_THRESHOLD_SECONDS"
    )
    incident_correlation_window_seconds: float = Field(
        default=300.0, alias="INCIDENT_CORRELATION_WINDOW_SECONDS", gt=0, le=86400, allow_inf_nan=False
    )
    openrouter_api_key: SecretStr | None = Field(default=None, alias="OPENROUTER_API_KEY")
    ai_enabled: bool = Field(default=True, alias="AI_ENABLED")
    openrouter_model: str = Field(default="openai/gpt-4o-mini", alias="OPENROUTER_MODEL", min_length=1, max_length=200)
    openrouter_base_url: str = Field(default="https://openrouter.ai/api/v1", alias="OPENROUTER_BASE_URL")
    openrouter_timeout_seconds: float = Field(default=20.0, alias="OPENROUTER_TIMEOUT_SECONDS", gt=0, le=120, allow_inf_nan=False)
    openrouter_max_retries: int = Field(default=1, alias="OPENROUTER_MAX_RETRIES", ge=0, le=3)

    @model_validator(mode="after")
    def require_distinct_dashboard_development_token(self) -> "Settings":
        dashboard = self.saas_dashboard_dev_token
        if dashboard is None:
            return self
        dashboard_value = dashboard.get_secret_value()
        other_tokens = (self.saas_dev_token, self.collector_bearer_token)
        if any(
            other is not None and hmac.compare_digest(dashboard_value, other.get_secret_value())
            for other in other_tokens
        ):
            raise ValueError("SAAS_DASHBOARD_DEV_TOKEN must differ from collector and SaaS development credentials")
        return self

    @model_validator(mode="after")
    def validate_dashboard_deployment_boundary(self) -> "Settings":
        origins = self.allowed_cors_origins
        if not origins or "*" in origins:
            raise ValueError("SAAS_CORS_ORIGINS must contain explicit origins and cannot contain a wildcard")
        if self.aegisops_env.lower() == "production":
            database_url = self.normalized_database_url.lower()
            if not database_url.startswith(("postgresql://", "postgresql+")) or "aegisops-local-only" in database_url:
                raise ValueError("Production requires an explicitly configured PostgreSQL SAAS_DATABASE_URL")
        parsed_origins = []
        for origin in origins:
            parsed = urlsplit(origin)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username:
                raise ValueError("SAAS_CORS_ORIGINS entries must be exact HTTP(S) origins without paths")
            if self.aegisops_env.lower() == "production" and parsed.scheme != "https":
                raise ValueError("Production SAAS_CORS_ORIGINS entries must use HTTPS")
            parsed_origins.append(origin)
        if len(set(parsed_origins)) != len(parsed_origins):
            raise ValueError("SAAS_CORS_ORIGINS cannot contain duplicates")
        if self.dashboard_cookie_samesite.lower() not in {"lax", "strict", "none"}:
            raise ValueError("DASHBOARD_COOKIE_SAMESITE must be Lax, Strict, or None")
        if self.aegisops_env.lower() == "production":
            if not self.dashboard_cookie_secure or self.dashboard_cookie_samesite.lower() != "none":
                raise ValueError("Production dashboard sessions require Secure cookies with SameSite=None")
        if self.dashboard_cookie_samesite.lower() == "none" and not self.dashboard_cookie_secure:
            raise ValueError("SameSite=None cookies require DASHBOARD_COOKIE_SECURE=true")
        return self

    @property
    def allowed_cors_origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.saas_cors_origins.split(",") if origin.strip()]

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
