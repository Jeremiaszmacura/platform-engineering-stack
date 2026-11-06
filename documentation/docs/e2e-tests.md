# End-to-End Tests

`e2e/` holds pytest tests that check the running cluster from the outside, only over HTTP
through the ingress (like a user or Prometheus would). They never use kubectl.

| File | Checks |
|---|---|
| `test_cluster_health.py` | Every component answers 200 on its URL |
| `test_backend_workflows.py` | go-app's sample contract; requests show up in its metrics |
| `test_vault_workflows.py` | Vault is up, mounts exist, secret write/read/404/422 on go-app and stock-app, backends can't read each other's secrets |
| `test_frontend.py` | frontend-app is served; go-app answers its cross-origin calls (CORS) |
| `test_stock_ui.py` | stock-ui is served; stock-app answers its cross-origin calls (CORS) |
| `test_stock_api.py` | Every stock-app endpoint and status code, each response validated against the `/openapi.yaml` the running pod publishes |
| `test_stock_workflows.py` | stock-app's cache-aside pipeline: provider on a cold window, cache on a repeat, and the metrics that count it (marker `external`) |
| `test_monitoring_pipeline.py` | All scrape jobs up, every node and nginx pod scraped separately, traffic reaches Prometheus, Grafana datasource and dashboards exist |

Fixtures in `conftest.py` run a test once per backend: `backend` for go-app's sample contract,
`secret_backend` for the `/secret` endpoints (go-app and stock-app).
Slow things (scrapes, target discovery) are polled with a timeout, never with fixed sleeps.

## Run

```sh
./recreate-cluster.sh
make test-e2e      # creates e2e/.venv, installs pinned deps, runs pytest
```

## stock-app and the market data provider

stock-app is the only component that calls a third-party API. Two switches keep it out of a run:

- **Deploy the recorded provider:** `STOCK_PROVIDER=fixture ./recreate-cluster.sh` replays a real Yahoo
  response baked into the image (`stock-app/fixtures/market-data.json`), so `test_stock_api.py` gets real bars offline.
- **Skip the live-provider tests:** `test_stock_workflows.py` must ask for a window nothing has synced yet,
  which a recording cannot answer, so it is marked `external`:

```sh
make test-e2e E2E_PYTEST_ARGS='-m "not external"'   # what CI runs
make test-e2e E2E_PYTEST_ARGS='-m external'         # only the live-provider pipeline
```

`-m "not external"` avoids every third-party call only together with `STOCK_PROVIDER=fixture`.

## CI

`.github/workflows/e2e.yaml` runs on every pull request and push to `main`: it creates a real kind
cluster with `STOCK_PROVIDER=fixture ./recreate-cluster.sh`, runs `make test-e2e E2E_PYTEST_ARGS='-m "not external"'`,
and prints pod status, events and logs (plus the TimescaleDB StatefulSet and PVC) on failure.

There is no `tox.ini` in `e2e/` on purpose: these tests need a live cluster, so `make test-unit` must not pick them up.
