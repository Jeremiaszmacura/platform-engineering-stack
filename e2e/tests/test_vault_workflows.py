"""Vault-backed /secret endpoints on go-app and stock-app (each has its own path under services/).

Keys are random because dev-mode Vault keeps data while its pod lives.
"""

import uuid

import requests

from cluster import REQUEST_TIMEOUT_SECONDS, SECRET_BACKENDS, VAULT_TOKEN, VAULT_URL


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


def test_secret_write_read_roundtrip(secret_backend):
    """A secret stored via POST /secret comes back via GET /secret/{key}."""
    key = unique_key(f"e2e-{secret_backend.name}")

    write = requests.post(
        f"{secret_backend.base_url}/secret",
        json={"key": key, "value": "hunter2"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert write.status_code == 201

    read = requests.get(f"{secret_backend.base_url}/secret/{key}", timeout=REQUEST_TIMEOUT_SECONDS)
    assert read.status_code == 200
    assert read.json() == {"key": key, "value": "hunter2"}


def test_reading_missing_secret_returns_not_found(secret_backend):
    """GET /secret/{key} answers 404 for a key that was never written."""
    response = requests.get(
        f"{secret_backend.base_url}/secret/{unique_key('e2e-missing')}",
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code == 404


def test_invalid_secret_payload_is_rejected(secret_backend):
    """Both backends answer 422 for an empty value or a key with a slash."""
    for payload in ({"key": unique_key("e2e-empty"), "value": ""}, {"key": "a/b", "value": "x"}):
        response = requests.post(f"{secret_backend.base_url}/secret", json=payload, timeout=REQUEST_TIMEOUT_SECONDS)
        assert response.status_code == 422, payload


def test_secret_paths_are_isolated_between_backends():
    """A secret written through one backend is a 404 through the other, in both directions."""
    go_app, stock_app = SECRET_BACKENDS

    for writer, reader in ((go_app, stock_app), (stock_app, go_app)):
        key = unique_key("e2e-isolated")
        write = requests.post(
            f"{writer.base_url}/secret",
            json={"key": key, "value": f"only-for-{writer.name}"},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        assert write.status_code == 201

        read = requests.get(f"{reader.base_url}/secret/{key}", timeout=REQUEST_TIMEOUT_SECONDS)
        assert read.status_code == 404
