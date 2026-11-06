"""Thin client for Vault's KV v2 secrets engine used by the /secret endpoints."""

import os
from functools import lru_cache

import hvac
from hvac.exceptions import InvalidPath, VaultError
from requests.exceptions import RequestException

DEFAULT_VAULT_ADDR = "http://vault-service:8200"

# Namespaces this service's secrets within the KV mount, so Vault policies
# can scope each service to its own path.
DEFAULT_SECRET_PATH = "python-app"  # nosec B105 - a KV path, not a credential

# KV v2 mount holding all service secrets (services/<service>/<key>),
# enabled by the vault-configure Job.
MOUNT_POINT = "services"


class VaultClientError(Exception):
    """Raised when Vault is unreachable or rejects a request."""


class SecretNotFoundError(Exception):
    """Raised when reading a secret that does not exist."""


class VaultClient:
    """Writes and reads single string values in Vault's KV v2 engine.

    All secrets live under one service-specific path in the KV mount.

    Attributes:
        _client: Underlying hvac client bound to one Vault server and token.
        _secret_path: Path within the KV mount that namespaces this service's secrets.
    """

    def __init__(self, address: str, token: str, secret_path: str):
        """Create a client for the Vault server at address using token auth.

        Args:
            address: Base URL of the Vault server, e.g. http://vault-service:8200.
            token: Vault token used for every request.
            secret_path: Path within the KV mount to keep this service's secrets under.
        """
        self._client = hvac.Client(url=address, token=token)
        self._secret_path = secret_path

    def write_secret(self, key: str, value: str) -> None:
        """Store value under key, overwriting any existing value.

        Args:
            key: Secret path within the KV v2 mount.
            value: Secret value to store.

        Raises:
            VaultClientError: If Vault is unreachable or rejects the write.
        """
        try:
            self._client.secrets.kv.v2.create_or_update_secret(
                path=f"{self._secret_path}/{key}", secret={"value": value}, mount_point=MOUNT_POINT
            )
        except (VaultError, RequestException) as error:
            raise VaultClientError(f"failed to write secret '{key}'") from error

    def read_secret(self, key: str) -> str:
        """Return the value stored under key.

        Args:
            key: Secret path within the KV v2 mount.

        Returns:
            The stored secret value.

        Raises:
            SecretNotFoundError: If no secret exists under key.
            VaultClientError: If Vault is unreachable, rejects the read, or the
                secret has no "value" field.
        """
        try:
            response = self._client.secrets.kv.v2.read_secret_version(
                path=f"{self._secret_path}/{key}", mount_point=MOUNT_POINT, raise_on_deleted_version=True
            )
        except InvalidPath as error:
            raise SecretNotFoundError(key) from error
        except (VaultError, RequestException) as error:
            raise VaultClientError(f"failed to read secret '{key}'") from error
        try:
            return response["data"]["data"]["value"]
        except KeyError as error:
            raise VaultClientError(f"secret '{key}' has no value field") from error


@lru_cache(maxsize=1)
def get_vault_client() -> VaultClient:
    """Return the process-wide VaultClient configured from the environment.

    Reads VAULT_ADDR, VAULT_TOKEN and VAULT_SECRET_PATH. Address and path fall
    back to the in-cluster service and this service's own path; the token has
    no default and must be set.

    Returns:
        A cached VaultClient instance.
    """
    address = os.getenv("VAULT_ADDR", DEFAULT_VAULT_ADDR)
    token = os.getenv("VAULT_TOKEN", "")
    secret_path = os.getenv("VAULT_SECRET_PATH", DEFAULT_SECRET_PATH)
    return VaultClient(address, token, secret_path)
