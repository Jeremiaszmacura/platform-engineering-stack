# stock-app

Serves daily stock prices (OHLCV bars) at http://stock.localhost/api/v1 — FastAPI + TimescaleDB, namespace `apps`.

| Endpoint | Returns |
|---|---|
| `GET /api/v1/instruments` | Symbols stored locally and the date window synced for each |
| `GET /api/v1/instruments/{symbol}/bars?start=&end=` | Daily bars for the window |
| `GET /api/v1/instruments/{symbol}/summary?start=&end=` | High, low, first and last close for the window |
| `POST /secret`, `GET /secret/{key}` | Secrets in Vault under `services/stock-app/` |
| `GET /health`, `/metrics`, `/openapi.yaml`, `/docs` | Readiness (checks the DB), Prometheus metrics, the contract, Swagger UI |

## Key ideas

- **Cache-aside:** a request is answered from TimescaleDB; only the part of the window never requested before
  is fetched from the provider (at most one call per request). The `instruments` table records which date
  window was *requested*, not which bars came back, because weekends and holidays have no bars.
- **Contract-first:** `openapi.yaml` is the API definition. The models in `src/adapters/inbound/http/models.py`
  are generated from it (`tox -e api`); `make lint` fails if they drift. Rendered: [stock-app API](stock-app-api.md).
- **Hexagonal layout:** `adapters → application → domain`; `src/main.py` is the only place adapters are built.
  The import rule is checked by `lint-imports` (`.importlinter`).
- **Providers** (`STOCK_PROVIDER`): `yahoo` (default, live) or `fixture` (replays
  `fixtures/market-data.json`, used by CI; re-record with `tox -e record`). No metric is labeled by symbol.

## Run and test

```sh
cd stock-app
tox -e tests                         # unit tests, no database or network needed
tox -e pre-commit                    # lint, import rules, model drift
docker build -t stock-app:dev . && kind load docker-image stock-app:dev --name sample-cluster
kubectl rollout restart deployment stock-app -n apps    # migrations run in an init container
```
