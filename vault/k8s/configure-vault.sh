#!/bin/sh
# postStart hook (vault-deployment.yaml): dev mode starts empty, so set up mounts and auth on every start.
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

# Let pods sign in with their ServiceAccount token; Vault checks it with its own mounted token.
enable_kubernetes_auth() {
    if vault auth list | grep -q "^kubernetes/"; then
        echo "postStart: kubernetes auth already enabled"
    else
        vault auth enable kubernetes
    fi
    vault write auth/kubernetes/config kubernetes_host=https://kubernetes.default.svc
}

# Let ServiceAccount $1 in apps sign in, with the policy in $1-policy.hcl.
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
