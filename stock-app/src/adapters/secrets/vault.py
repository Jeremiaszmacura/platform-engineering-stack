"""Vault KV v2 implementation of the SecretStore port; the only module that imports hvac."""

from collections.abc import Callable
from typing import Any

import hvac
from hvac.exceptions import Forbidden, InvalidPath, VaultError

from src.domain.errors import SecretNotFoundError, SecretStoreError

# KV v2 mount that Vault's postStart hook enables on every start.
MOUNT_POINT = "services"

# OSError: Vault unreachable (requests' errors) or no token file.
FAILURES = (VaultError, OSError)


class VaultSecretStore:
    """Reads and writes secrets in Vault's KV v2 engine, signed in with Kubernetes auth."""

    def __init__(self, address: str, role: str, jwt_path: str, secret_path: str):
        """Create a store for the Vault at address, signing in as role with the token at jwt_path."""
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
        """Run request, signing in first if needed and once more if Vault rejects the token."""
        if not self._client.token:
            self._sign_in()
        try:
            return request()
        except Forbidden:
            # Expired or revoked.
            self._sign_in()
            return request()

    def _sign_in(self) -> None:
        """Exchange the ServiceAccount token for a Vault token, which hvac keeps."""
        with open(self._jwt_path, encoding="utf-8") as jwt_file:
            jwt = jwt_file.read()  # Not cached: the kubelet rotates it
        self._client.auth.kubernetes.login(role=self._role, jwt=jwt)

    def _path_for(self, key: str) -> str:
        """Return the service-scoped path of key."""
        return f"{self._secret_path}/{key}"
