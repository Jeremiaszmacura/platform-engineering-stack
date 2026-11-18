#!/bin/sh
# postStart hook of the Vault container (vault-deployment.yaml). Dev mode keeps everything in memory, so every
# container start begins empty; this sets up again what the apps rely on: the KV v2 mounts, and the kubernetes auth
# method with a policy and a role per service. Every step is safe to repeat.
set -eu

# Wait up to 60s for the server, which starts alongside this hook; return 1 if it never answers.
wait_for_vault() {
    waited=0
    until vault status >/dev/null 2>&1; do
        if [ "$waited" -ge 60 ]; then
            echo "postStart: Vault did not answer within 60s"
            return 1
        fi
        sleep 2
        waited=$((waited + 2))
    done
}

# Enable a KV v2 secrets engine at path $1, unless one is mounted there already.
enable_kv_mount() {
    if vault secrets list | grep -q "^$1/"; then
        echo "postStart: KV mount $1/ already enabled"
    else
        vault secrets enable -path="$1" kv-v2
    fi
}

# Let pods sign in with their ServiceAccount token. Given no reviewer token or CA, Vault checks each pod's token with
# the API's TokenReview using its own mounted ServiceAccount token and CA.
enable_kubernetes_auth() {
    if vault auth list | grep -q "^kubernetes/"; then
        echo "postStart: kubernetes auth already enabled"
    else
        vault auth enable kubernetes
    fi
    vault write auth/kubernetes/config kubernetes_host=https://kubernetes.default.svc
}

# Let ServiceAccount $1 in namespace apps sign in with a token for audience "vault", and get a 1-hour Vault token
# carrying only the policy in $1-policy.hcl.
add_service_role() {
    vault policy write "$1" "/vault/hooks/$1-policy.hcl"
    vault write "auth/kubernetes/role/$1" bound_service_account_names="$1" bound_service_account_namespaces=apps \
        audience=vault token_policies="$1" token_ttl=1h
}

# Kubernetes keeps no hook output: send it to the container's log.
exec >/proc/1/fd/1 2>&1
export VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN="$VAULT_DEV_ROOT_TOKEN_ID"

wait_for_vault
for mount in services infra; do
    enable_kv_mount "$mount"
done
enable_kubernetes_auth
add_service_role stock-app
