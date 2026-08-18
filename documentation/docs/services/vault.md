# Vault

HashiCorp Vault is the cluster's shared secret store. The sample backend
([go-app](go-app.md)) writes and reads secrets in it through its `/secret`
endpoints.

| | |
|---|---|
| Directory | `vault/` |
| Image | `hashicorp/vault:1.20` (public, pulled by the node) |
| Namespace | `vault` |
| Host | http://vault.localhost (UI and API, token `root`) |
| In-cluster DNS | `http://vault-service.vault:8200` |

Vault runs in **dev mode** (`vault server -dev`): in-memory storage (secrets
are lost on pod restart), auto-initialized and unsealed, root token fixed to
`root`. Fine for this playground, unsuitable for anything else.

## Secret path layout

A one-shot `vault-configure` Job (`vault/k8s/vault-configure-job.yaml`,
idempotent) enables two KV v2 mounts once Vault is reachable:

```
services/                      (KV v2 mount)
└── go-app/<key>       ← only go-app reads/writes here
infra/                         (KV v2 mount, reserved for future infra secrets)
```

(The `secret/` mount dev mode pre-creates is unused.) Each backend gets its
own path via `VAULT_SECRET_PATH`, so a second backend added later would never
be able to read this one's secrets — `GET /secret/{key}` answers 404 across
services.

go-app currently authenticates with the dev-mode root token; the per-service
path is what makes real scoping possible later — one Vault policy per
service, e.g.:

```hcl
# Policy "go-app" — grants access to go-app's path only
path "services/data/go-app/*" {
  capabilities = ["create", "update", "read"]
}
```

attached to a per-service token or Kubernetes-auth role instead of the root
token.

## How the backends use it

go-app's Deployment sets `VAULT_ADDR` (`http://vault-service.vault:8200` —
go-app runs in the `apps` namespace, Vault in `vault`),
`VAULT_TOKEN` (`root`), and `VAULT_SECRET_PATH`, and implements this endpoint
contract on top of Vault's
[KV v2 HTTP API](https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2)
(`/v1/services/data/<service>/<key>`):

- `POST /secret` `{"key", "value"}` — store a secret (`201`, `502` if Vault fails)
- `GET /secret/{key}` — read a secret (`200`, `404` if missing, `502` if Vault fails)

go-app uses a small stdlib HTTP client (`go-app/internal/vaultclient`). A
future Python backend implementing the same contract would likely use
[hvac](https://github.com/hvac/hvac).

## Trying it out

```bash
curl -X POST http://go.localhost/secret \
  -H 'Content-Type: application/json' -d '{"key": "demo", "value": "hunter2"}'

curl http://go.localhost/secret/demo   # 200
```

## Deployment & testing

`./recreate-cluster.sh` applies `vault/k8s/` (Deployment, Service, Ingress for
`vault.localhost`, `vault-configure` Job) before the backends and waits for
the Job to complete. `e2e/tests/test_vault_workflows.py` covers Vault health,
both mounts existing, and the write/read/404 contract.

## Redeploy into a running cluster

```sh
kubectl apply -f vault/k8s/
```

Restarting the pod empties the store — dev mode keeps everything in memory —
and the `vault-configure` Job has already run to completion, so re-create it
to get the mounts back:

```sh
kubectl delete job vault-configure -n vault
kubectl apply -f vault/k8s/vault-configure-job.yaml
```

## Not the single source of truth yet

Two credentials in this cluster still live in Kubernetes Secrets rather than
Vault — the TimescaleDB password, duplicated across the `data` and `apps`
namespaces (see [TimescaleDB](timescaledb.md)) and Grafana's admin login (see
[Grafana](grafana.md)). Moving them here would make every service depend on
Vault being up before it can start, which is a real trade-off rather than an
oversight; it is recorded in
[Platform Decisions](../platform-decisions.md).
