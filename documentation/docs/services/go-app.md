# go-app

A Gin backend implementing the
[shared sample-backend endpoint contract](../design.md#sample-backends-go-app),
so the [frontend](frontend-app.md) can point at it and any future sample
backend that implements the same contract interchangeably. It stores secrets
in the shared [Vault](vault.md).

| | |
|---|---|
| Directory | `go-app/` |
| Image | `go-app:dev` (built and `kind load`ed by `recreate-cluster.sh`) |
| Namespace | `apps` |
| Host | http://go.localhost |
| Prometheus job | `go-app` |

## Layout

| Path | Contents |
|---|---|
| `cmd/main.go` | Entry point |
| `internal/server/` | Router construction and middleware wiring |
| `internal/handlers/` | One file per endpoint |
| `internal/appmetrics/` | Prometheus middleware and metric definitions |
| `internal/vaultclient/` | KV v2 client built on the standard library, behind the `/secret` endpoints |

The Dockerfile runs `go mod tidy` rather than `go mod download`, so a new
dependency does not need a committed `go.sum` to build.

## Metrics

Four series, labeled by `job` so a panel can query other services using the
same instrumentation pattern (e.g. `stock-app`) alongside it:

- `http_requests_total{method, endpoint, status_code}`
- `http_request_duration_seconds{method, endpoint}`
- `http_responses_by_status_total{status_class}`
- `monitoring_requests_total{endpoint, user_agent}`

Prometheus needs no configuration for this — it discovers the target from the
Service annotations. See [Monitoring](../monitoring.md).

## Redeploy into a running cluster

From the repository root:

```sh
docker build -t go-app:dev ./go-app
kind load docker-image go-app:dev --name sample-cluster
kubectl rollout restart deployment go-app-deployment -n apps
```

## Run it on its own

```sh
cd go-app
go mod tidy
go run cmd/main.go     # http://localhost:8080
```

Or in a container:

```sh
docker build -t go-app:dev ./go-app
docker run -p 8080:8080 go-app:dev
```

## Tests

```sh
cd go-app && go test ./...
make test-unit-go      # every Go service
make lint-go           # golangci-lint --fix
make tidy-go           # go mod tidy
```
