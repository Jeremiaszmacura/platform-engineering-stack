"""Runtime configuration, read from ``STOCK_``-prefixed environment variables."""

from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# Dev default only; the cluster injects the real value from a Kubernetes
# Secret, see stock-app/k8s/stock-app-secret.yaml.
DEFAULT_DB_PASSWORD = "stockapp"  # nosec B105 - dev-mode default, not a real credential

DEFAULT_VAULT_TOKEN = "root"  # nosec B105 - dev-mode root token, see vault/README.md


class Settings(BaseSettings):
    """Environment-driven settings for the service.

    Attributes:
        db_host: Hostname of the TimescaleDB server.
        db_port: Port the database listens on.
        db_name: Database holding the market data schema.
        db_user: Database role the service connects as.
        db_password: Password for that role.
        provider: Name of the market data provider to use.
        stale_after_seconds: How long a synced trailing edge stays fresh before
            it is refetched from the provider.
        vault_addr: Base URL of the cluster's Vault server.
        vault_token: Token used for every Vault request.
        vault_secret_path: Path within the KV mount namespacing this service's
            secrets.
    """

    model_config = SettingsConfigDict(env_prefix="STOCK_")

    db_host: str = "timescaledb-service.data"
    db_port: int = 5432
    db_name: str = "stockdata"
    db_user: str = "stockapp"
    db_password: SecretStr = SecretStr(DEFAULT_DB_PASSWORD)
    provider: str = "yahoo"
    stale_after_seconds: int = 3600

    # The Vault variables deliberately escape the STOCK_ prefix: every service
    # that talks to Vault is wired with the same VAULT_ADDR/VAULT_TOKEN/
    # VAULT_SECRET_PATH names, so the Deployments stay uniform.
    vault_addr: str = Field(default="http://vault-service.vault:8200", validation_alias="VAULT_ADDR")
    vault_token: SecretStr = Field(default=SecretStr(DEFAULT_VAULT_TOKEN), validation_alias="VAULT_TOKEN")
    vault_secret_path: str = Field(default="stock-app", validation_alias="VAULT_SECRET_PATH")

    @property
    def database_url(self) -> str:
        """Return the SQLAlchemy URL for the configured database.

        User and password are percent-encoded so credentials containing URL
        metacharacters cannot corrupt the connection string.
        """
        user = quote_plus(self.db_user)
        password = quote_plus(self.db_password.get_secret_value())
        return f"postgresql+psycopg://{user}:{password}@{self.db_host}:{self.db_port}/{self.db_name}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings, parsed once from the environment.

    Returns:
        The cached Settings instance.
    """
    return Settings()
