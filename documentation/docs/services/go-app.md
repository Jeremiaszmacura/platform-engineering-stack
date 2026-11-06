# go-app

Sample backend written in Go with Gin. URL: http://go.localhost

- Implements the [sample backend contract](../design.md#go-app-sample-contract).
- Code: `cmd/main.go` (start), `internal/server` (router, graceful shutdown), `internal/handlers` (endpoints),
  `internal/appmetrics` (metrics middleware), `internal/vaultclient` (small stdlib Vault client).
- Config (env): `VAULT_ADDR`, `VAULT_TOKEN` (required), `VAULT_SECRET_PATH` (default `go-app`).

## Develop

```sh
cd go-app
go test ./...
golangci-lint run
VAULT_TOKEN=root go run ./cmd/main.go          # http://localhost:8080
```

## Redeploy into a running cluster

```sh
docker build -t go-app:dev ./go-app
kind load docker-image go-app:dev --name sample-cluster
kubectl rollout restart deployment go-app -n apps
```
