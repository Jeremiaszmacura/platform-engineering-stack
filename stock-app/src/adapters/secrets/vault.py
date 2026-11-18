"""Vault KV v2 implementation of the SecretStore port; the only module that imports hvac.

stock-app signs in with its Kubernetes ServiceAccount token. Its Vault role's policy allows only this service's path
under the services/ mount, so Vault refuses any other service's key.
"""

from collections.abc import Callable
from typing import Any

import hvac
from hvac.exceptions import Forbidden, InvalidPath, VaultError

from src.domain.errors import SecretNotFoundError, SecretStoreError

# KV v2 mount that Vault's postStart hook enables on every start.
MOUNT_POINT = "services"

# OSError covers an unreachable Vault (requests' errors subclass it) and a missing token file.
FAILURES = (VaultError, OSError)


class VaultSecretStore:
    """Reads and writes string values in Vault's KV v2 engine, signed in through Vault's kubernetes auth method."""

    def __init__(self, address: str, role: str, jwt_path: str, secret_path: str):
        """Create a store for the Vault at address that signs in as role with the token at jwt_path."""
        self._client = hvac.Client(url=address)
        self._role = role
        self._jwt_path = jwt_path
        self._secret_path = secret_path

    def write_secret(self, key: str, value: str) -> None:
        """Store value under key; raise SecretStoreError if Vault fails."""
        try:
            self._signed_in(
                lambda: self._client.secrets.kv.v2.create_or_update_secret(
                    path=self._path_for(key), secret={"value": value}, mount_point=MOUNT_POINT
                )
            )
        except FAILURES as error:
            raise SecretStoreError(f"failed to write secret {key!r}") from error

    def read_secret(self, key: str) -> str:
        """Return the value under key; raise SecretNotFoundError or SecretStoreError."""
        try:
            response = self._signed_in(
                lambda: self._client.secrets.kv.v2.read_secret_version(
                    path=self._path_for(key), mount_point=MOUNT_POINT, raise_on_deleted_version=True
                )
            )
        except InvalidPath as error:
            raise SecretNotFoundError(key) from error
        except FAILURES as error:
            raise SecretStoreError(f"failed to read secret {key!r}") from error
        return response["data"]["data"]["value"]

    def _signed_in(self, request: Callable[[], Any]) -> Any:
        """Run request with a Vault token: sign in first if there is none, and again once if Vault rejects it."""
        if not self._client.token:
            self._sign_in()
        try:
            return request()
        except Forbidden:
            # The token expired (1-hour TTL), or a restarted Vault no longer knows it.
            self._sign_in()
            return request()

    def _sign_in(self) -> None:
        """Exchange this pod's ServiceAccount token for a Vault token; hvac keeps it for the next requests."""
        with open(self._jwt_path, encoding="utf-8") as jwt_file:
            jwt = jwt_file.read()  # Read every time: the kubelet rotates the file
        self._client.auth.kubernetes.login(role=self._role, jwt=jwt)

    def _path_for(self, key: str) -> str:
        """Return the service-scoped path of key."""
        return f"{self._secret_path}/{key}"
