"""Vault and stock-app's /secret endpoints (its keys live under services/stock-app/).

Keys are random because dev-mode Vault keeps data while its pod lives.
"""

import uuid

import requests

from cluster import REQUEST_TIMEOUT_SECONDS, STOCK_APP_URL, VAULT_TOKEN, VAULT_URL


def unique_key(prefix):
    """Return a key no earlier run can have written."""
    return f"{prefix}-{uuid.uuid4().hex}"


def test_vault_is_initialized_and_unsealed():
    """Vault's health endpoint reports a ready dev-mode server."""
    response = requests.get(f"{VAULT_URL}/v1/sys/health", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    health = response.json()
    assert health["initialized"] is True
    assert health["sealed"] is False


def test_kv_mounts_for_services_and_infra_exist():
    """The vault-configure job enabled the services/ and infra/ KV mounts."""
    response = requests.get(
        f"{VAULT_URL}/v1/sys/mounts",
        headers={"X-Vault-Token": VAULT_TOKEN},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code == 200
    mounts = response.json()["data"]
    assert "services/" in mounts
    assert "infra/" in mounts


def test_secret_write_read_roundtrip():
    """A secret stored via POST /secret comes back via GET /secret/{key}."""
    key = unique_key("e2e-stock-app")

    write = requests.post(
        f"{STOCK_APP_URL}/secret",
        json={"key": key, "value": "hunter2"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert write.status_code == 201

    read = requests.get(f"{STOCK_APP_URL}/secret/{key}", timeout=REQUEST_TIMEOUT_SECONDS)
    assert read.status_code == 200
    assert read.json() == {"key": key, "value": "hunter2"}


def test_reading_missing_secret_returns_not_found():
    """GET /secret/{key} answers 404 for a key that was never written."""
    response = requests.get(
        f"{STOCK_APP_URL}/secret/{unique_key('e2e-missing')}",
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code == 404


def test_invalid_secret_payload_is_rejected():
    """An empty value or a key with a slash is rejected with 422."""
    for payload in ({"key": unique_key("e2e-empty"), "value": ""}, {"key": "a/b", "value": "x"}):
        response = requests.post(f"{STOCK_APP_URL}/secret", json=payload, timeout=REQUEST_TIMEOUT_SECONDS)
        assert response.status_code == 422, payload
