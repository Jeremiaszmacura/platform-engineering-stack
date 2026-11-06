"""Vault KV v2 implementation of the SecretStore port; the only module that imports hvac.

Each service has its own path under the services/ mount, so another service's key is a 404.
"""

import hvac
from hvac.exceptions import InvalidPath, VaultError
from requests.exceptions import RequestException

from src.domain.errors import SecretNotFoundError, SecretStoreError

# KV v2 mount created by the vault-configure Job.
MOUNT_POINT = "services"


class VaultSecretStore:
    """Reads and writes string values in Vault's KV v2 engine."""

    def __init__(self, address: str, token: str, secret_path: str):
        """Create a store for the Vault at address, using token and this service's secret_path."""
        self._client = hvac.Client(url=address, token=token)
        self._secret_path = secret_path

    def write_secret(self, key: str, value: str) -> None:
        """Store value under key; raise SecretStoreError if Vault fails."""
        try:
            self._client.secrets.kv.v2.create_or_update_secret(
                path=self._path_for(key), secret={"value": value}, mount_point=MOUNT_POINT
            )
        except (VaultError, RequestException) as error:
            raise SecretStoreError(f"failed to write secret {key!r}") from error

    def read_secret(self, key: str) -> str:
        """Return the value under key; raise SecretNotFoundError or SecretStoreError."""
        try:
            response = self._client.secrets.kv.v2.read_secret_version(
                path=self._path_for(key), mount_point=MOUNT_POINT, raise_on_deleted_version=True
            )
        except InvalidPath as error:
            raise SecretNotFoundError(key) from error
        except (VaultError, RequestException) as error:
            raise SecretStoreError(f"failed to read secret {key!r}") from error
        return response["data"]["data"]["value"]

    def _path_for(self, key: str) -> str:
        """Return the service-scoped path of key."""
        return f"{self._secret_path}/{key}"
