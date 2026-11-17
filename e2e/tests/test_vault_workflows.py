"""Vault and stock-app's /secret endpoints (its keys live under services/stock-app/).

Keys are random because dev-mode Vault keeps data until its container restarts.
"""

import subprocess  # nosec B404 - runs kubectl with fixed arguments
import uuid

import requests

from cluster import KUBE_CONTEXT, REQUEST_TIMEOUT_SECONDS, STOCK_APP_URL, VAULT_TOKEN, VAULT_URL, wait_until

SECRET_VALUE = "hunter2"  # nosec B105 - test value, not a credential
# Generous: a rerun within ten minutes meets the kubelet's growing restart delay (10s, 20s, 40s...).
VAULT_RESTART_TIMEOUT_SECONDS = 120


def unique_key(prefix):
    """Return a key no earlier run can have written."""
    return f"{prefix}-{uuid.uuid4().hex}"


def write_secret(key):
    """Store SECRET_VALUE under key through stock-app and return the response."""
    return requests.post(
        f"{STOCK_APP_URL}/secret", json={"key": key, "value": SECRET_VALUE}, timeout=REQUEST_TIMEOUT_SECONDS
    )


def read_secret(key):
    """Read key through stock-app and return the response."""
    return requests.get(f"{STOCK_APP_URL}/secret/{key}", timeout=REQUEST_TIMEOUT_SECONDS)


def restart_vault_container():
    """Stop Vault's main process; the kubelet starts a new container in the same pod, as after a crash or OOM kill."""
    subprocess.run(  # nosec B603 B607 - fixed kubectl command, pinned to the test cluster
        ["kubectl", "--context", KUBE_CONTEXT, "exec", "-n", "vault", "deploy/vault", "--", "kill", "1"],
        check=True,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )


def test_vault_is_initialized_and_unsealed():
    """Vault's health endpoint reports a ready dev-mode server."""
    response = requests.get(f"{VAULT_URL}/v1/sys/health", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    health = response.json()
    assert health["initialized"] is True
    assert health["sealed"] is False


def test_kv_mounts_for_services_and_infra_exist():
    """Vault's postStart hook enabled the services/ and infra/ KV mounts."""
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
    assert write_secret(key).status_code == 201

    read = read_secret(key)
    assert read.status_code == 200
    assert read.json() == {"key": key, "value": SECRET_VALUE}


def test_reading_missing_secret_returns_not_found():
    """GET /secret/{key} answers 404 for a key that was never written."""
    assert read_secret(unique_key("e2e-missing")).status_code == 404


def test_invalid_secret_payload_is_rejected():
    """An empty value or a key with a slash is rejected with 422."""
    for payload in ({"key": unique_key("e2e-empty"), "value": ""}, {"key": "a/b", "value": "x"}):
        response = requests.post(f"{STOCK_APP_URL}/secret", json=payload, timeout=REQUEST_TIMEOUT_SECONDS)
        assert response.status_code == 422, payload


def test_secrets_work_again_after_vault_restarts():
    """After a Vault restart, secrets can be stored and read again: the new Vault is empty but has its mounts."""
    old_key = unique_key("e2e-before-restart")
    assert write_secret(old_key).status_code == 201

    restart_vault_container()
    # 404 instead of 200 (the old Vault) or 502 (no Vault yet): the new Vault answers and has lost the old secret
    wait_until(lambda: read_secret(old_key).status_code == 404, VAULT_RESTART_TIMEOUT_SECONDS, "Vault to restart")

    new_key = unique_key("e2e-after-restart")
    assert write_secret(new_key).status_code == 201
    assert read_secret(new_key).json() == {"key": new_key, "value": SECRET_VALUE}
