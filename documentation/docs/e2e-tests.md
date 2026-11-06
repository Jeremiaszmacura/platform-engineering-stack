# End-to-End Tests

`e2e/` holds pytest tests that check the running cluster from the outside, only over HTTP
through the ingress (like a user or Prometheus would). They never use kubectl.

| File | Checks |
|---|---|
| `test_cluster_health.py` | Every component answers 200 on its URL |
| `test_backend_workflows.py` | The shared backend contract on both backends; requests show up in each app's metrics |
| `test_vault_workflows.py` | Vault is up, mounts exist, secret write/read/404/422, backends can't read each other's secrets |
| `test_frontend.py` | The UI is served; backends answer the frontend's cross-origin calls (CORS) |
| `test_monitoring_pipeline.py` | All scrape jobs up, every node and nginx pod scraped separately, traffic reaches Prometheus, Grafana datasource and dashboards exist |

Tests for "both backends" run twice through the `backend` fixture.
Slow things (scrapes, target discovery) are polled with a timeout, never with fixed sleeps.

## Run

```sh
./recreate-cluster.sh
make test-e2e      # creates e2e/.venv, installs pinned deps, runs pytest
```

## CI

`.github/workflows/e2e.yaml` runs on every pull request and push to `main`: it creates a real kind
cluster with `./recreate-cluster.sh`, runs `make test-e2e`, and prints pod status and logs on failure.

There is no `tox.ini` in `e2e/` on purpose: these tests need a live cluster, so `make test-unit` must not pick them up.
