"""Tests for the FastAPI routes, with Vault replaced by in-memory fakes."""

import unittest

from fastapi.testclient import TestClient

from main import app
from vault_client import SecretNotFoundError, VaultClientError, get_vault_client


class FakeVaultClient:
    """In-memory stand-in for VaultClient used in endpoint tests."""

    def __init__(self):
        self.secrets = {}

    def write_secret(self, key, value):
        """Store the value under key in memory."""
        self.secrets[key] = value

    def read_secret(self, key):
        """Return the stored value or raise SecretNotFoundError."""
        if key not in self.secrets:
            raise SecretNotFoundError(key)
        return self.secrets[key]


class FailingVaultClient:
    """Stand-in for VaultClient that simulates an unreachable Vault."""

    def write_secret(self, key, value):
        """Always fail as if Vault were down."""
        raise VaultClientError("vault unreachable")

    def read_secret(self, key):
        """Always fail as if Vault were down."""
        raise VaultClientError("vault unreachable")


class TestEndpoints(unittest.TestCase):
    """Tests for the FastAPI routes defined in endpoints.py."""

    def setUp(self):
        self.client = TestClient(app)

    def test_root_returns_200(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)

    def test_health_returns_200(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)

    def test_error_returns_500(self):
        response = self.client.get("/error")
        self.assertEqual(response.status_code, 500)

    def test_redirect_returns_302(self):
        response = self.client.get("/redirect", follow_redirects=False)
        self.assertEqual(response.status_code, 302)

    def test_metrics_returns_200(self):
        response = self.client.get("/metrics")
        self.assertEqual(response.status_code, 200)


class TestSecretEndpoints(unittest.TestCase):
    """Tests for the Vault-backed /secret endpoints using a fake client."""

    def setUp(self):
        self.fake_vault = FakeVaultClient()
        app.dependency_overrides[get_vault_client] = lambda: self.fake_vault
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def test_write_secret_returns_201(self):
        response = self.client.post("/secret", json={"key": "api-key", "value": "hunter2"})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"key": "api-key", "status": "stored"})

    def test_write_then_read_roundtrip(self):
        self.client.post("/secret", json={"key": "api-key", "value": "hunter2"})
        response = self.client.get("/secret/api-key")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"key": "api-key", "value": "hunter2"})

    def test_read_missing_secret_returns_404(self):
        response = self.client.get("/secret/missing")
        self.assertEqual(response.status_code, 404)

    def test_write_secret_without_value_returns_422(self):
        response = self.client.post("/secret", json={"key": "api-key"})
        self.assertEqual(response.status_code, 422)

    def test_write_secret_with_empty_value_returns_422(self):
        response = self.client.post("/secret", json={"key": "api-key", "value": ""})
        self.assertEqual(response.status_code, 422)

    def test_write_secret_with_slash_in_key_returns_422(self):
        response = self.client.post("/secret", json={"key": "a/b", "value": "hunter2"})
        self.assertEqual(response.status_code, 422)

    def test_vault_failure_returns_502(self):
        app.dependency_overrides[get_vault_client] = FailingVaultClient
        self.assertEqual(self.client.post("/secret", json={"key": "k", "value": "v"}).status_code, 502)
        self.assertEqual(self.client.get("/secret/k").status_code, 502)


if __name__ == "__main__":
    unittest.main()
