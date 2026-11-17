#!/bin/sh
# postStart hook of the Vault container (vault-deployment.yaml). Dev mode keeps everything in memory, so every
# container start begins without the KV v2 mounts the apps use; this enables them. Mounts that exist are skipped.
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

# Kubernetes keeps no hook output: send it to the container's log.
exec >/proc/1/fd/1 2>&1
export VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN="$VAULT_DEV_ROOT_TOKEN_ID"

wait_for_vault
for mount in services infra; do
    enable_kv_mount "$mount"
done
