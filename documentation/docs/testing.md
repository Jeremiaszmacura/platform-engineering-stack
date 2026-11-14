# Testing

| Command | What it runs |
|---|---|
| `make test-unit` | Go (`go test`) and Python (`tox -e tests`) unit tests, found by `go.mod` / `tox.ini` |
| `make lint` | golangci-lint, and pre-commit (black, bandit, YAML/JSON checks), stock-app's import rules and API-model drift check |
| `make build-frontend` / `make test-unit-frontend` | Build both frontends / run stock-ui's Vitest tests |
| `make test-e2e` | pytest in `e2e/` against the running cluster, over HTTP only |
| `cd documentation && mkdocs build --strict` | Docs build (fails on broken links) |

## End-to-end tests

They need a cluster (`./recreate-cluster.sh`) and cover: every URL answers, the cluster map and its RBAC, Vault secrets,
CORS for the frontends, every stock-app endpoint validated against its published
`/openapi.yaml`, the cache-aside flow, the Prometheus/Grafana pipeline, and request traces in Tempo.

stock-app calls Yahoo Finance by default. To test without it, deploy with `STOCK_PROVIDER=fixture` and skip the
tests that need a live provider:

```sh
make test-e2e E2E_PYTEST_ARGS='-m "not external"'   # what CI runs
make test-e2e E2E_PYTEST_ARGS='-k stock'            # scope with -k
```

## CI

Every pull request runs `go-qa`, `python-qa`, `frontend-qa`, `docs` and `e2e`
(a real kind cluster with `STOCK_PROVIDER=fixture`, then `-m "not external"`, then a restart of ingress-nginx
that must keep `*.localhost` answering).

## What to run after a change

| Change | Run |
|---|---|
| Go / Python code | `make lint test-unit` (Claude Code hooks do this automatically) |
| `stock-app/openapi.yaml` | `cd stock-app && tox -e api`, then `make lint test-unit` |
| Frontend | `make build-frontend test-unit-frontend` |
| Manifests, `recreate-cluster.sh`, monitoring, Vault | `./recreate-cluster.sh && make test-e2e` |
| Docs | `mkdocs build --strict` |
