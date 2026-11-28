"""Vault, its kubernetes auth, and stock-app's /secret endpoints (its keys live under services/stock-app/).

Every /secret response is validated against the /openapi.yaml stock-app publishes.

Keys are random because Vault keeps every secret until the cluster is recreated.
"""

import uuid

import requests

from cluster import REQUEST_TIMEOUT_SECONDS, STOCK_APP_URL, VAULT_TOKEN, VAULT_URL, kubectl, wait_until
from contract import conforming

SECRET_VALUE = "hunter2"  # nosec B105 - test value, not a credential
# Generous: a rerun within ten minutes meets the kubelet's growing restart delay (10s, 20s, 40s...).
VAULT_RESTART_TIMEOUT_SECONDS = 120
WORKLOAD_NAMESPACES = ("apps", "data", "docs", "monitoring", "vault")


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


def service_account_token(name, audience=None, namespace="apps"):
    """Return a 10-minute token for ServiceAccount name in namespace."""
    audience_args = ["--audience", audience] if audience else []
    return kubectl("create", "token", name, "-n", namespace, "--duration=10m", *audience_args)


def may(account, verb, resource):
    """Return whether ServiceAccount account ("namespace:name") may verb resource in namespace vault."""
    answer = kubectl(
        "auth", "can-i", verb, resource, "-n", "vault", f"--as=system:serviceaccount:{account}", check=False
    )
    return answer == "yes"


def sign_in_as_stock_app(jwt):
    """Sign in to Vault as role stock-app with jwt; return the response."""
    return sign_in("stock-app", jwt)


def sign_in(role, jwt):
    """Sign in to Vault as role with jwt; return the response."""
    return requests.post(
        f"{VAULT_URL}/v1/auth/kubernetes/login",
        json={"role": role, "jwt": jwt},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )


def assert_token_opens_only(token, own):
    """Assert Vault token can write under services/<own>/ and is denied another service's path and infra/."""
    headers = {"X-Vault-Token": token}
    key = unique_key("e2e-own")
    own_path = f"{VAULT_URL}/v1/services/data/{own}/{key}"
    written = requests.post(
        own_path, json={"data": {"value": SECRET_VALUE}}, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS
    )
    assert written.status_code == 200
    for other_path in ("services/data/another-service/key", "infra/data/key"):
        denied = requests.get(f"{VAULT_URL}/v1/{other_path}", headers=headers, timeout=REQUEST_TIMEOUT_SECONDS)
        assert denied.status_code == 403, other_path


def vault_restart_count():
    """Return how often the kubelet has restarted Vault's container."""
    return int(
        kubectl("get", "pod", "vault-0", "-n", "vault", "-o", "jsonpath={.status.containerStatuses[0].restartCount}")
    )


def restart_vault_container():
    """Stop Vault's main process and wait until the kubelet starts a new container, as after a crash or OOM kill."""
    restarts = vault_restart_count()
    kubectl("exec", "-n", "vault", "vault-0", "--", "kill", "1")
    wait_until(lambda: vault_restart_count() > restarts, VAULT_RESTART_TIMEOUT_SECONDS, "Vault's container to restart")


def vault_pod_uid():
    """Return the UID of pod vault-0, or "" while it doesn't exist."""
    return kubectl("get", "pod", "vault-0", "-n", "vault", "--ignore-not-found", "-o", "jsonpath={.metadata.uid}")


def replace_vault_pod():
    """Delete pod vault-0 and wait for its replacement, which the StatefulSet starts on the same PVC."""
    old_uid = vault_pod_uid()
    kubectl("delete", "pod", "vault-0", "-n", "vault", "--wait=false")
    wait_until(lambda: vault_pod_uid() not in ("", old_uid), VAULT_RESTART_TIMEOUT_SECONDS, "a new Vault pod")


def test_vault_is_initialized_and_unsealed():
    """Vault's health endpoint reports an initialized, unsealed server."""
    response = requests.get(f"{VAULT_URL}/v1/sys/health", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    health = response.json()
    assert health["initialized"] is True
    assert health["sealed"] is False


def test_only_vault_may_read_its_unseal_key():
    """The unseal key Secret exists, and of all workload ServiceAccounts only Vault's may read it, and nothing else."""
    assert kubectl("get", "secret", "vault-unseal-key", "-n", "vault", "-o", "name") == "secret/vault-unseal-key"
    accounts = kubectl(
        "get", "serviceaccounts", "-A", "-o", "jsonpath={range .items[*]}{.metadata.namespace}:{.metadata.name} {end}"
    )
    workload_accounts = [a for a in accounts.split() if a.split(":")[0] in WORKLOAD_NAMESPACES]
    assert [a for a in workload_accounts if may(a, "get", "secret/vault-unseal-key")] == ["vault:vault"]
    assert not may("vault:vault", "get", "secret/vault-root-token")
    assert not may("vault:vault", "list", "secrets")


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
    assert_token_opens_only(response.json()["auth"]["client_token"], "stock-app")


def test_documentation_vault_token_opens_only_its_own_path():
    """The documentation service's Vault token, which keeps the reader's GitHub token, opens only its own path."""
    jwt = service_account_token("documentation", audience="vault", namespace="docs")
    response = sign_in("documentation", jwt)
    assert response.status_code == 200
    assert_token_opens_only(response.json()["auth"]["client_token"], "documentation")
    assert sign_in("stock-app", jwt).status_code == 403


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


def test_secrets_survive_a_vault_restart(contract):
    """A secret written before Vault's container restarts is read back once its postStart hook has unsealed it."""
    key = unique_key("e2e-before-restart")
    assert write_secret(contract, key).status_code == 201

    restart_vault_container()
    wait_until(lambda: read_secret(contract, key).status_code == 200, VAULT_RESTART_TIMEOUT_SECONDS, "Vault to unseal")
    assert read_secret(contract, key).json() == {"key": key, "value": SECRET_VALUE}


def test_secrets_survive_a_new_vault_pod(contract):
    """A secret written before pod vault-0 is replaced is read back from the PVC once the new pod has unsealed."""
    key = unique_key("e2e-before-new-pod")
    assert write_secret(contract, key).status_code == 201

    replace_vault_pod()
    wait_until(lambda: read_secret(contract, key).status_code == 200, VAULT_RESTART_TIMEOUT_SECONDS, "Vault to unseal")
    assert read_secret(contract, key).json() == {"key": key, "value": SECRET_VALUE}
