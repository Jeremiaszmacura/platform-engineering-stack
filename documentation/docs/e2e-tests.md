# End-to-End Tests

The `e2e/` directory contains a black-box pytest suite that verifies the
deployed cluster's workflows over HTTP — the same paths a user or Prometheus
would take. It never talks to pods or kubectl directly: every request goes
through the ingress on port 80, routed by `*.localhost` hostname, so the suite
runs identically on a developer machine and in CI.

## What is covered

| Suite | Workflow |
|---|---|
| `test_cluster_health.py` | Every component answers HTTP 200 on its ingress host |
| `test_backend_workflows.py` | Shared backend contract (`/`, `/health`, `/error`, `/redirect`, `/metrics`) on go-app, and traffic being counted in its metrics |
| `test_frontend.py` | frontend-app serves the UI, and the go-app ingress answers its cross-origin calls with CORS headers |
| `test_stock_ui.py` | stock-ui (Stock App) serves the UI, and the stock-app ingress answers its cross-origin calls with CORS headers |
| `test_monitoring_pipeline.py` | Prometheus targets up, generated traffic queryable in Prometheus, Grafana datasource and dashboards provisioned |
| `test_stock_api.py` | stock-app: every endpoint and every status code it can answer, each validated against the contract the running service publishes |
| `test_stock_workflows.py` | stock-app: the cache-aside pipeline through TimescaleDB — ledger, provider-versus-cache, and the counters that describe it |

Backend-contract tests run once per entry in `BACKENDS` via the parametrized
`backend` fixture — currently just go-app, but a second sample backend would
be covered automatically. stock-app is deliberately **not** part of that
fixture: it does not implement the shared backend contract. Eventual
consistency (scrape intervals, target discovery) is handled by polling with
timeouts, not sleeps.

### Endpoints tested against their own declaration

`test_stock_api.py` fetches `/openapi.json` from the running pod and validates
every response against it with
[openapi-core](https://openapi-core.readthedocs.io/) — status code, content
type and body. The tests therefore assert what the service *promises* rather
than a copy of that promise kept in the test file, and adding an operation to
`stock-app/openapi.yaml` extends them without editing a schema here. A response
that stops matching its declared shape fails with the offending value:

```text
Failed: GET / answered 200 in a shape the contract forbids: InvalidData:
Value {'service': 'stock-app'} not valid for schema of type object:
(<ValidationError: "'buildSha' is a required property">,)
```

`/openapi.json` and `/docs` are the two endpoints checked directly instead:
FastAPI adds them itself, so the contract does not declare them. 502 and 503
are not covered here at all — they need the provider or TimescaleDB to be
unreachable, which a black-box test against a healthy cluster cannot arrange,
so `stock-app/tests/test_routes.py` covers them with both ports replaced.

## Running with and without a third-party API

Only stock-app has an external dependency, and there are two ways to keep it
out of a test run.

**Deploy a different provider.** Which market data API the cluster talks to is
a deployment decision, so it is made at deploy time:

```sh
./recreate-cluster.sh                    # STOCK_PROVIDER=yahoo, the default
STOCK_PROVIDER=fixture ./recreate-cluster.sh   # replays a recording, no network
```

`fixture` replays a real Yahoo response captured into
`stock-app/fixtures/market-data.json` and baked into the image — see
[stock-app](services/stock-app.md#the-recorded-provider). This is what CI
deploys, and it is what lets `test_stock_api.py` cover the endpoints that
actually **return bars** on every pull request. Without it CI could only prove
that stock-app rejects bad requests.

**Deselect the marker.** `test_stock_workflows.py` drives the cache-aside
pipeline against a *live* provider by design: it deliberately asks for a window
nothing has synced yet, which a fixed recording cannot answer. Those tests
carry the `external` marker (registered in `e2e/pytest.ini`):

```sh
make test-e2e                                       # everything, against whatever is deployed
make test-e2e E2E_PYTEST_ARGS='-m "not external"'   # what CI runs
make test-e2e E2E_PYTEST_ARGS='-m external'         # just the live-provider pipeline
```

The two are independent, and the pairing matters: `-m "not external"` promises
no third-party call only when the cluster was deployed with
`STOCK_PROVIDER=fixture`, which is the pairing CI uses. Run it against a
`yahoo` deployment and the endpoint tests will reach Yahoo, harmlessly, from
your own IP.

The provider-touching tests are safe to re-run against a cluster that is
already warm. TimescaleDB's PVC outlives a pod restart, so a fixed date window
would be a cache hit on the second run and the cold path would silently stop
being tested. The `unsynced_period` fixture reads the sync ledger over the API
and picks a window starting before the earliest date already stored, which
forces a backward extension — a guaranteed provider call, whatever ran before.
`test_stock_api.py` wants the opposite and says so with its own
`synced_window` fixture: it needs bars to *exist*, so it fetches the window
once per module and the tests after it read from the store.

## Conventions

- **Black-box only.** Tests talk to the cluster exclusively over HTTP, never to
  pods or through kubectl. If a workflow cannot be observed from outside, it is
  not covered here.
- **Poll, never sleep.** Scrape intervals and target discovery are eventually
  consistent; `cluster.wait_until` retries with a timeout and fails with a
  message naming the condition.
- **Parametrize, do not duplicate.** Anything true of both sample backends runs
  through the `backend` fixture in `conftest.py`.
- **No `tox.ini` in `e2e/`, deliberately.** The root Makefile discovers
  unit-test suites by the presence of a `tox.ini`, and this suite must never run
  as part of `make test-unit` — it needs a live cluster.

## Running locally

```sh
./recreate-cluster.sh   # deploy the cluster first
make test-e2e
```

`make test-e2e` creates a virtualenv in `e2e/.venv`, installs pinned
dependencies, and runs pytest. To iterate on one file during development:

```sh
cd e2e && .venv/bin/pytest tests/test_stock_workflows.py -k cache
```

## Continuous integration

`.github/workflows/e2e.yaml` runs on pull requests, pushes to `main`, and
manual dispatch. The job installs kind and Ansible on the runner, executes
`./recreate-cluster.sh` to build images and deploy everything into a real kind
cluster, then runs `make test-e2e E2E_PYTEST_ARGS='-m "not external"'` as the
pass/fail gate. On failure it dumps pod status, recent events, deployment logs,
and the StatefulSet and PVC state in the `data` namespace.
