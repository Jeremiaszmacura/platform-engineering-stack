"""Tests for the Vault adapter: error translation and per-service key paths, with a fake KV engine."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from hvac.exceptions import Forbidden, InvalidPath
from requests.exceptions import ConnectionError as RequestsConnectionError

from src.adapters.secrets.vault import MOUNT_POINT, VaultSecretStore
from src.domain.errors import SecretNotFoundError, SecretStoreError

SECRET_PATH = "stock-app"  # nosec B105 - Vault path name, not a secret


class FakeKeyValueEngine:
    """Fake hvac KV v2 engine that records calls and can raise error."""

    def __init__(self, error=None):
        """Create the fake with an optional error to raise."""
        self.stored = {}
        self.error = error
        self.calls = []

    def create_or_update_secret(self, path, secret, mount_point):
        """Record a write."""
        self._fail_if_configured()
        self.calls.append((mount_point, path))
        self.stored[path] = secret

    def read_secret_version(self, path, mount_point, raise_on_deleted_version):
        """Return a recorded write, or raise InvalidPath when there is none."""
        self._fail_if_configured()
        self.calls.append((mount_point, path))
        if path not in self.stored:
            raise InvalidPath(f"no secret at {path}")
        return {"data": {"data": self.stored[path]}}

    def _fail_if_configured(self):
        """Raise the configured error, if any."""
        if self.error is not None:
            raise self.error


def build_store(error=None):
    """Return a store with a fake KV engine (set at construction, as the hvac property is read-only) and the fake."""
    engine = FakeKeyValueEngine(error)
    client = SimpleNamespace(secrets=SimpleNamespace(kv=SimpleNamespace(v2=engine)))
    with patch("src.adapters.secrets.vault.hvac.Client", return_value=client):
        store = VaultSecretStore("http://vault.invalid", "token", SECRET_PATH)  # nosec B106 - fake token
    return store, engine


class TestRoundTrip(unittest.TestCase):
    """Tests that a written secret reads back."""

    def test_a_written_secret_reads_back(self):
        store, _ = build_store()

        store.write_secret("api-token", "s3cret")

        self.assertEqual(store.read_secret("api-token"), "s3cret")

    def test_writing_twice_keeps_the_last_value(self):
        store, _ = build_store()

        store.write_secret("api-token", "first")
        store.write_secret("api-token", "second")

        self.assertEqual(store.read_secret("api-token"), "second")


class TestNamespacing(unittest.TestCase):
    """Tests that every key is scoped to this service's own path."""

    def test_keys_are_written_under_the_service_path_in_the_shared_mount(self):
        store, engine = build_store()

        store.write_secret("api-token", "s3cret")

        self.assertEqual(engine.calls, [(MOUNT_POINT, f"{SECRET_PATH}/api-token")])

    def test_reads_look_under_the_same_path(self):
        store, engine = build_store()

        store.write_secret("api-token", "s3cret")
        store.read_secret("api-token")

        self.assertEqual(engine.calls[-1], (MOUNT_POINT, f"{SECRET_PATH}/api-token"))


class TestErrorTranslation(unittest.TestCase):
    """Tests that hvac's exceptions never escape the adapter."""

    def test_a_missing_key_raises_secret_not_found(self):
        store, _ = build_store()

        with self.assertRaises(SecretNotFoundError):
            store.read_secret("never-written")

    def test_an_unreachable_vault_raises_secret_store_error_on_read(self):
        store, _ = build_store(RequestsConnectionError("vault down"))

        with self.assertRaises(SecretStoreError):
            store.read_secret("api-token")

    def test_an_unreachable_vault_raises_secret_store_error_on_write(self):
        store, _ = build_store(RequestsConnectionError("vault down"))

        with self.assertRaises(SecretStoreError):
            store.write_secret("api-token", "s3cret")

    def test_a_rejected_request_raises_secret_store_error(self):
        store, _ = build_store(Forbidden("permission denied"))

        with self.assertRaises(SecretStoreError):
            store.write_secret("api-token", "s3cret")


if __name__ == "__main__":
    unittest.main()
