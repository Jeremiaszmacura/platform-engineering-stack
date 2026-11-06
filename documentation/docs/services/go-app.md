# go-app

Sample backend (Go, Gin) at http://go.localhost, used to generate traffic for the dashboards.
Endpoints: `/`, `/health`, `/error` (500), `/redirect` (302), `/metrics`, and `POST /secret` / `GET /secret/{key}`
(Vault path `services/go-app/`; 201/200, 404 missing, 422 invalid key or empty value, 502 Vault failed).

```sh
cd go-app
go test ./... && golangci-lint run
VAULT_TOKEN=root go run ./cmd/main.go    # http://localhost:8080
```
