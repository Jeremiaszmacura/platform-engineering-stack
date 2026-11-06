# Vault

HashiCorp Vault is the secret store for both backends. URL: http://vault.localhost (token `root`).

It runs in **dev mode** in the `vault` namespace: data is kept in memory (lost when the pod restarts),
it unseals itself, and the root token is `root`. Good for a playground, never for real use.
The token is stored in the Secret `vault-dev-token`, declared in `vault/k8s/vault-dev-token.yaml` for Vault
(namespace `vault`) and for its clients (namespace `apps`); everything reads it from there.
Clients reach Vault at `http://vault-service.vault:8200`.

## Where secrets go

The one-shot Job `vault-configure` creates two KV v2 mounts (safe to re-run):

```
services/              all service secrets
├── stock-app/<key>    only stock-app uses this path
└── go-app/<key>       only go-app uses this path
infra/                 reserved for future infrastructure secrets
```

Each backend gets its own path from `VAULT_SECRET_PATH`, so one backend can't read the other's
secrets (it answers 404). Both still log in with the root token today; the per-service paths
make it easy to give each service its own Vault policy later, e.g.:

```hcl
path "services/data/stock-app/*" {
  capabilities = ["create", "update", "read"]
}
```

## Try it

```bash
curl -X POST http://stock.localhost/secret \
  -H 'Content-Type: application/json' -d '{"key": "demo", "value": "hunter2"}'

curl http://stock.localhost/secret/demo    # 200 — same backend
curl http://go.localhost/secret/demo       # 404 — other backend's path
```

The endpoint contract is in [Design](../design.md#go-app-sample-contract).
stock-app uses [hvac](https://github.com/hvac/hvac); go-app uses a small stdlib client
on Vault's [KV v2 HTTP API](https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2).
