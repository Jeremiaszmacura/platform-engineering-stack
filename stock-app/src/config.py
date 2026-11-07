"""Runtime configuration, read from ``STOCK_``-prefixed environment variables."""

from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# Dev default; the cluster sets it from stock-app-secret.
DEFAULT_DB_PASSWORD = "stockapp"  # nosec B105 - dev-mode default, not a real credential

DEFAULT_VAULT_TOKEN = "root"  # nosec B105 - dev-mode root token, see vault/README.md


class Settings(BaseSettings):
    """Settings read from STOCK_* (and VAULT_*) environment variables."""

    model_config = SettingsConfigDict(env_prefix="STOCK_")

    db_host: str = "timescaledb-service.data"
    db_port: int = 5432
    db_name: str = "stockdata"
    db_user: str = "stockapp"
    db_password: SecretStr = SecretStr(DEFAULT_DB_PASSWORD)
    provider: str = "yahoo"
    stale_after_seconds: int = 3600

    # Unprefixed: every service uses the same VAULT_* variable names.
    vault_addr: str = Field(default="http://vault-service.vault:8200", validation_alias="VAULT_ADDR")
    vault_token: SecretStr = Field(default=SecretStr(DEFAULT_VAULT_TOKEN), validation_alias="VAULT_TOKEN")
    vault_secret_path: str = Field(default="stock-app", validation_alias="VAULT_SECRET_PATH")

    @property
    def database_url(self) -> str:
        """Return the SQLAlchemy URL, with credentials percent-encoded."""
        user = quote_plus(self.db_user)
        password = quote_plus(self.db_password.get_secret_value())
        return f"postgresql+psycopg://{user}:{password}@{self.db_host}:{self.db_port}/{self.db_name}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the settings, parsed once."""
    return Settings()
