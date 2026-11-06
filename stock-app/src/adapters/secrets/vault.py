"""HashiCorp Vault implementation of the SecretStore port.

The only module allowed to import hvac, mirroring how the provider adapter owns
yfinance and the persistence adapter owns SQLAlchemy. Everything above it sees
two methods and two domain errors.

Secrets live under one service-specific path inside the shared ``services/``
KV v2 mount, so a Vault policy can later scope this service to its own path
without any code change. Reading a key another service wrote is not a
permission failure here - the path simply does not exist, so it is a 404.
"""

import hvac
from hvac.exceptions import InvalidPath, VaultError
from requests.exceptions import RequestException

from src.domain.errors import SecretNotFoundError, SecretStoreError

# KV v2 mount holding every service's secrets, enabled by the vault-configure
# Job. `infra/` is the other mount and is not this service's business.
MOUNT_POINT = "services"


class VaultSecretStore:
    """Reads and writes single string values in Vault's KV v2 engine.

    Attributes:
        _client: hvac client bound to one Vault server and token.
        _secret_path: Path within the mount namespacing this service's secrets.
    """

    def __init__(self, address: str, token: str, secret_path: str):
        """Create a store backed by the Vault server at an address.

        Args:
            address: Base URL of the Vault server.
            token: Token used for every request.
            secret_path: Path within the KV mount to keep this service's
                secrets under.
        """
        self._client = hvac.Client(url=address, token=token)
        self._secret_path = secret_path

    def write_secret(self, key: str, value: str) -> None:
        """Store a value under a key, replacing whatever was there.

        Args:
            key: Key within this service's path.
            value: Value to store.

        Raises:
            SecretStoreError: If Vault is unreachable or rejects the write.
        """
        try:
            self._client.secrets.kv.v2.create_or_update_secret(
                path=self._path_for(key), secret={"value": value}, mount_point=MOUNT_POINT
            )
        except (VaultError, RequestException) as error:
            raise SecretStoreError(f"failed to write secret {key!r}") from error

    def read_secret(self, key: str) -> str:
        """Return the value stored under a key.

        Args:
            key: Key within this service's path.

        Returns:
            The stored value.

        Raises:
            SecretNotFoundError: If nothing is stored under the key.
            SecretStoreError: If Vault is unreachable or rejects the read.
        """
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
        """Return the full path of a key inside the mount.

        Args:
            key: Key within this service's path.

        Returns:
            The service-scoped path Vault stores the value at.
        """
        return f"{self._secret_path}/{key}"
