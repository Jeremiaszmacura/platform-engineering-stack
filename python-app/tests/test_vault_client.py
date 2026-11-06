"""Tests for VaultClient path handling, with hvac mocked out."""

import unittest
from unittest.mock import MagicMock

from hvac.exceptions import InvalidPath

from vault_client import MOUNT_POINT, SecretNotFoundError, VaultClient, VaultClientError


class TestVaultClient(unittest.TestCase):
    """Tests for the KV v2 path handling in VaultClient using a mocked hvac client."""

    def setUp(self):
        self.client = VaultClient("http://vault:8200", "root", "python-app")
        self.kv = MagicMock()
        self.client._client = MagicMock(secrets=MagicMock(kv=MagicMock(v2=self.kv)))

    def test_write_secret_uses_service_scoped_path(self):
        self.client.write_secret("api-key", "hunter2")
        self.kv.create_or_update_secret.assert_called_once_with(
            path="python-app/api-key", secret={"value": "hunter2"}, mount_point=MOUNT_POINT
        )

    def test_read_secret_uses_service_scoped_path(self):
        self.kv.read_secret_version.return_value = {"data": {"data": {"value": "hunter2"}}}
        value = self.client.read_secret("api-key")
        self.assertEqual(value, "hunter2")
        self.kv.read_secret_version.assert_called_once_with(
            path="python-app/api-key", mount_point=MOUNT_POINT, raise_on_deleted_version=True
        )

    def test_read_missing_secret_raises_not_found(self):
        self.kv.read_secret_version.side_effect = InvalidPath()
        with self.assertRaises(SecretNotFoundError):
            self.client.read_secret("missing")

    def test_read_secret_without_value_field_raises_client_error(self):
        self.kv.read_secret_version.return_value = {"data": {"data": {"other": "x"}}}
        with self.assertRaises(VaultClientError):
            self.client.read_secret("api-key")


if __name__ == "__main__":
    unittest.main()
