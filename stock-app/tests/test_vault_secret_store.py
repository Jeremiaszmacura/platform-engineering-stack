"""Tests for the Vault adapter, with a fake hvac client."""

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from hvac.exceptions import Forbidden, InvalidPath
from requests.exceptions import ConnectionError as RequestsConnectionError

from src.adapters.secrets.vault import MOUNT_POINT, VaultSecretStore
from src.domain.errors import SecretNotFoundError, SecretStoreError

SECRET_PATH = "stock-app"  # nosec B105 - Vault path name, not a secret
ROLE = "stock-app"
SERVICE_ACCOUNT_JWT = "header.payload.signature"  # nosec B105 - fake token


class FakeKeyValueEngine:
    """Fake hvac KV v2 engine; raises the given errors on its next calls."""

    def __init__(self, errors):
        """Create the fake; a None error lets that call succeed."""
        self.stored = {}
        self.errors = list(errors)
        self.calls = []

    def create_or_update_secret(self, path, secret, mount_point):
        """Record a write."""
        self._fail_if_configured()
        self.calls.append((mount_point, path))
        self.stored[path] = secret

    def read_secret_version(self, path, mount_point, raise_on_deleted_version):
        """Return a recorded write, or raise InvalidPath when there is none."""
        del raise_on_deleted_version
        self._fail_if_configured()
        self.calls.append((mount_point, path))
        if path not in self.stored:
            raise InvalidPath(f"no secret at {path}")
        return {"data": {"data": self.stored[path]}}

    def _fail_if_configured(self):
        """Raise the next configured error, if any."""
        error = self.errors.pop(0) if self.errors else None
        if error is not None:
            raise error


class FakeKubernetesAuth:
    """Fake hvac kubernetes auth: each login sets a new client token."""

    def __init__(self, client):
        """Create the fake for client."""
        self.client = client
        self.logins = []

    def login(self, role, jwt):
        """Record the login and set a new token."""
        self.logins.append((role, jwt))
        self.client.token = f"vault-token-{len(self.logins)}"


class FakeClient:
    """Fake hvac.Client: KV v2 engine, kubernetes auth and token."""

    def __init__(self, errors):
        """Create a client without a token."""
        self.token = None
        self.engine = FakeKeyValueEngine(errors)
        self.kubernetes = FakeKubernetesAuth(self)
        self.secrets = SimpleNamespace(kv=SimpleNamespace(v2=self.engine))
        self.auth = SimpleNamespace(kubernetes=self.kubernetes)


class VaultStoreTestCase(unittest.TestCase):
    """Base class with a ServiceAccount token file in a temporary directory."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.jwt_path = Path(directory.name) / "token"
        self.jwt_path.write_text(SERVICE_ACCOUNT_JWT, encoding="utf-8")

    def build_store(self, *errors):
        """Return a store whose next KV calls raise errors, and its fake client."""
        client = FakeClient(errors)
        with patch("src.adapters.secrets.vault.hvac.Client", return_value=client):
            store = VaultSecretStore("http://vault.invalid", ROLE, str(self.jwt_path), SECRET_PATH)
        return store, client


class TestRoundTrip(VaultStoreTestCase):
    """Tests that a written secret reads back."""

    def test_a_written_secret_reads_back(self):
        store, _ = self.build_store()

        store.write_secret("api-token", "s3cret")

        self.assertEqual(store.read_secret("api-token"), "s3cret")

    def test_writing_twice_keeps_the_last_value(self):
        store, _ = self.build_store()

        store.write_secret("api-token", "first")
        store.write_secret("api-token", "second")

        self.assertEqual(store.read_secret("api-token"), "second")


class TestSignIn(VaultStoreTestCase):
    """Tests that the store signs in only when it needs a Vault token."""

    def test_the_first_request_signs_in_with_the_role_and_the_token_file(self):
        store, client = self.build_store()

        store.write_secret("api-token", "s3cret")

        self.assertEqual(client.kubernetes.logins, [(ROLE, SERVICE_ACCOUNT_JWT)])

    def test_later_requests_reuse_the_vault_token(self):
        store, client = self.build_store()

        store.write_secret("api-token", "s3cret")
        store.read_secret("api-token")

        self.assertEqual(len(client.kubernetes.logins), 1)

    def test_a_rejected_token_signs_in_again_and_retries_once(self):
        store, client = self.build_store(Forbidden("token expired"))

        store.write_secret("api-token", "s3cret")

        self.assertEqual(len(client.kubernetes.logins), 2)
        self.assertEqual(client.engine.stored, {f"{SECRET_PATH}/api-token": {"value": "s3cret"}})

    def test_signing_in_again_rereads_the_rotated_token_file(self):
        store, client = self.build_store(None, Forbidden("token expired"))
        store.write_secret("api-token", "first")

        self.jwt_path.write_text("rotated.payload.signature", encoding="utf-8")
        store.write_secret("api-token", "second")

        self.assertEqual(client.kubernetes.logins[-1], (ROLE, "rotated.payload.signature"))

    def test_a_missing_token_file_raises_secret_store_error(self):
        store, _ = self.build_store()
        self.jwt_path.unlink()

        with self.assertRaises(SecretStoreError):
            store.read_secret("api-token")


class TestNamespacing(VaultStoreTestCase):
    """Tests that every key is scoped to this service's own path."""

    def test_keys_are_written_under_the_service_path_in_the_shared_mount(self):
        store, client = self.build_store()

        store.write_secret("api-token", "s3cret")

        self.assertEqual(client.engine.calls, [(MOUNT_POINT, f"{SECRET_PATH}/api-token")])

    def test_reads_look_under_the_same_path(self):
        store, client = self.build_store()

        store.write_secret("api-token", "s3cret")
        store.read_secret("api-token")

        self.assertEqual(client.engine.calls[-1], (MOUNT_POINT, f"{SECRET_PATH}/api-token"))


class TestErrorTranslation(VaultStoreTestCase):
    """Tests that hvac's exceptions never escape the adapter."""

    def test_a_missing_key_raises_secret_not_found(self):
        store, _ = self.build_store()

        with self.assertRaises(SecretNotFoundError):
            store.read_secret("never-written")

    def test_an_unreachable_vault_raises_secret_store_error_on_read(self):
        store, _ = self.build_store(RequestsConnectionError("vault down"))

        with self.assertRaises(SecretStoreError):
            store.read_secret("api-token")

    def test_an_unreachable_vault_raises_secret_store_error_on_write(self):
        store, _ = self.build_store(RequestsConnectionError("vault down"))

        with self.assertRaises(SecretStoreError):
            store.write_secret("api-token", "s3cret")

    def test_a_path_the_policy_denies_raises_secret_store_error(self):
        store, _ = self.build_store(Forbidden("permission denied"), Forbidden("permission denied"))

        with self.assertRaises(SecretStoreError):
            store.write_secret("api-token", "s3cret")


if __name__ == "__main__":
    unittest.main()
