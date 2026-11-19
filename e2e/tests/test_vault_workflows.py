"""Vault, its kubernetes auth, and stock-app's /secret endpoints (its keys live under services/stock-app/).

Every /secret response is validated against the /openapi.yaml stock-app publishes.

Keys are random because dev-mode Vault keeps data until its container restarts.
"""

import subprocess  # nosec B404 - runs kubectl with fixed arguments
import uuid

import requests

from cluster import KUBE_CONTEXT, REQUEST_TIMEOUT_SECONDS, STOCK_APP_URL, VAULT_TOKEN, VAULT_URL, wait_until
from contract import conforming

SECRET_VALUE = "hunter2"  # nosec B105 - test value, not a credential
# Generous: a rerun within ten minutes meets the kubelet's growing restart delay (10s, 20s, 40s...).
VAULT_RESTART_TIMEOUT_SECONDS = 120


def unique_key(prefix):
    """Return a key no earlier run can have written."""
    return f"{prefix}-{uuid.uuid4().hex}"


def post_secret(contract, payload):
    """POST payload to stock-app's /secret and return the response, which must match the contract."""
    return conforming(contract, requests.post(f"{STOCK_APP_URL}/secret", json=payload, timeout=REQUEST_TIMEOUT_SECONDS))


def write_secret(contract, key):
    """Store SECRET_VALUE under key through stock-app and return the response."""
    return post_secret(contract, {"key": key, "value": SECRET_VALUE})


def read_secret(contract, key):
    """Read key through stock-app and return the response, which must match the contract."""
    return conforming(contract, requests.get(f"{STOCK_APP_URL}/secret/{key}", timeout=REQUEST_TIMEOUT_SECONDS))


def service_account_token(name, audience=None):
    """Return a 10-minute token for ServiceAccount name in apps."""
    command = ["kubectl", "--context", KUBE_CONTEXT, "create", "token", name, "-n", "apps", "--duration=10m"]
    if audience:
        command += ["--audience", audience]
    result = subprocess.run(  # nosec B603 B607 - fixed kubectl command, pinned to the test cluster
        command, check=True, capture_output=True, text=True, timeout=REQUEST_TIMEOUT_SECONDS
    )
    return result.stdout.strip()


def sign_in_as_stock_app(jwt):
    """Sign in to Vault as role stock-app with jwt; return the response."""
    return requests.post(
        f"{VAULT_URL}/v1/auth/kubernetes/login",
        json={"role": "stock-app", "jwt": jwt},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )


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


def test_stock_app_vault_token_opens_only_its_own_path():
    """stock-app's Vault token opens its own path and nothing else."""
    response = sign_in_as_stock_app(service_account_token("stock-app", audience="vault"))
    assert response.status_code == 200
    headers = {"X-Vault-Token": response.json()["auth"]["client_token"]}

    own_path = f"{VAULT_URL}/v1/services/data/stock-app/{unique_key('e2e-own')}"
    written = requests.post(
        own_path, json={"data": {"value": SECRET_VALUE}}, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS
    )
    assert written.status_code == 200
    for other_path in ("services/data/another-service/key", "infra/data/key"):
        denied = requests.get(f"{VAULT_URL}/v1/{other_path}", headers=headers, timeout=REQUEST_TIMEOUT_SECONDS)
        assert denied.status_code == 403, other_path


def test_vault_rejects_tokens_not_issued_to_stock_app_for_vault():
    """Only stock-app's token for audience vault signs in as stock-app."""
    api_token = service_account_token("stock-app")
    other_account_token = service_account_token("traffic-generator", audience="vault")
    for jwt in (api_token, other_account_token):
        assert sign_in_as_stock_app(jwt).status_code == 403


def test_secret_write_read_roundtrip(contract):
    """A secret stored via POST /secret comes back via GET /secret/{key}."""
    key = unique_key("e2e-stock-app")
    assert write_secret(contract, key).status_code == 201

    read = read_secret(contract, key)
    assert read.status_code == 200
    assert read.json() == {"key": key, "value": SECRET_VALUE}


def test_reading_missing_secret_returns_not_found(contract):
    """GET /secret/{key} answers 404 for a key that was never written."""
    assert read_secret(contract, unique_key("e2e-missing")).status_code == 404


def test_invalid_secret_payload_is_rejected(contract):
    """An empty value or a key with a slash is rejected with 422."""
    for payload in ({"key": unique_key("e2e-empty"), "value": ""}, {"key": "a/b", "value": "x"}):
        assert post_secret(contract, payload).status_code == 422, payload


def test_secrets_work_again_after_vault_restarts(contract):
    """After a Vault restart, stock-app signs in again and secrets work."""
    old_key = unique_key("e2e-before-restart")
    assert write_secret(contract, old_key).status_code == 201

    restart_vault_container()
    # 404 instead of 200 (the old Vault) or 502 (no Vault yet): the new Vault answers and has lost the old secret
    wait_until(
        lambda: read_secret(contract, old_key).status_code == 404, VAULT_RESTART_TIMEOUT_SECONDS, "Vault to restart"
    )

    new_key = unique_key("e2e-after-restart")
    assert write_secret(contract, new_key).status_code == 201
    assert read_secret(contract, new_key).json() == {"key": new_key, "value": SECRET_VALUE}
