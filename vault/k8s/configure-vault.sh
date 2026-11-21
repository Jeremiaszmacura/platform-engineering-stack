#!/bin/sh
# postStart hook (vault-statefulset.yaml): Vault starts sealed, so unseal it and apply its setup on every start.
# Each step can run again, so the next start finishes what a failed one left undone.
set -eu

SERVICE_ACCOUNT=/var/run/secrets/kubernetes.io/serviceaccount
SECRETS_API=https://kubernetes.default.svc/api/v1/namespaces/vault/secrets

# Wait up to 60s for command "$@" to succeed; return 1 if it never does.
wait_for() {
    waited=0
    until "$@" >/dev/null 2>&1; do
        if [ "$waited" -ge 60 ]; then
            echo "postStart: $* did not succeed within 60s"
            return 1
        fi
        sleep 2
        waited=$((waited + 2))
    done
}

# Succeed once the server answers, sealed (exit code 2) or not.
vault_answers() {
    vault status || [ $? -eq 2 ]
}

# Succeed once Vault is unsealed and active: only then does /v1/sys/health answer 200.
vault_active() {
    wget -q -O /dev/null "$VAULT_ADDR/v1/sys/health"
}

# Print string field $1 of the pretty-printed JSON on stdin.
json_field() {
    sed -n "s/^ *\"$1\": \"\(.*\)\",*$/\1/p"
}

# Call the Kubernetes API as Vault's ServiceAccount, trusting only the cluster's CA; the URL comes last in "$@".
kube_api() {
    SSL_CERT_FILE=$SERVICE_ACCOUNT/ca.crt wget -q -O - --header "Authorization: Bearer $(cat $SERVICE_ACCOUNT/token)" "$@"
}

# Create the Secret vault-unseal-key holding $unseal_key; with $1 = "?dryRun=All" only check that it can be created.
save_unseal_key() {
    kube_api --header "Content-Type: application/json" \
        --post-data "{\"metadata\":{\"name\":\"vault-unseal-key\",\"labels\":{\"app\":\"vault\"}},\"stringData\":{\"key\":\"$unseal_key\"}}" \
        "$SECRETS_API${1:-}" >/dev/null
}

# Print the unseal key from the Secret vault-unseal-key.
read_unseal_key() {
    secret=$(kube_api "$SECRETS_API/vault-unseal-key?pretty=true") || return 1
    echo "$secret" | json_field key | base64 -d
}

# Unseal with $unseal_key, then wait until Vault serves requests.
unseal() {
    vault operator unseal "$unseal_key" >/dev/null
    wait_for vault_active
}

# First start only. The dry run fails before init if the Secret is left over from earlier data or RBAC is missing.
initialize() {
    unseal_key=""
    save_unseal_key "?dryRun=All"
    init_output=$(vault operator init -key-shares=1 -key-threshold=1)
    unseal_key=$(echo "$init_output" | awk '/^Unseal Key 1:/ {print $NF}')
    wait_for save_unseal_key
    unseal
    VAULT_TOKEN=$(echo "$init_output" | awk '/^Initial Root Token:/ {print $NF}') vault token revoke -self
}

# Unless $VAULT_ROOT_TOKEN is valid, create it with a one-off root token made from the unseal key, then revoke that.
ensure_root_token() {
    if vault token lookup >/dev/null 2>&1; then
        return
    fi
    attempt=$(vault operator generate-root -init -format=json)
    nonce=$(echo "$attempt" | json_field nonce)
    encoded=$(vault operator generate-root -nonce="$nonce" -format=json "$unseal_key" | json_field encoded_token)
    one_off=$(vault operator generate-root -decode="$encoded" -otp="$(echo "$attempt" | json_field otp)")
    VAULT_TOKEN=$one_off vault token create -id="$VAULT_ROOT_TOKEN" -policy=root -orphan >/dev/null
    VAULT_TOKEN=$one_off vault token revoke -self
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

# Let ServiceAccount $1 in namespace $2 sign in, with the policy in $1-policy.hcl.
add_service_role() {
    vault policy write "$1" "/etc/vault/$1-policy.hcl"
    vault write "auth/kubernetes/role/$1" bound_service_account_names="$1" bound_service_account_namespaces="$2" \
        audience=vault token_policies="$1" token_ttl=1h
}

# Kubernetes keeps no hook output: send it to the container's log.
exec >/proc/1/fd/1 2>&1
export VAULT_ADDR=http://127.0.0.1:8200 VAULT_TOKEN="$VAULT_ROOT_TOKEN"

wait_for vault_answers
if vault operator init -status >/dev/null; then
    unseal_key=$(read_unseal_key)
    unseal
else
    initialize
fi
ensure_root_token
for mount in services infra; do
    enable_kv_mount "$mount"
done
enable_kubernetes_auth
add_service_role stock-app apps
add_service_role documentation docs
