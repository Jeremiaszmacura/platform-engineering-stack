# Platform Engineering Stack

A small Kubernetes (`kind`) cluster that runs on your laptop, for learning platform engineering:
deploy services, collect metrics, build dashboards, keep secrets, run a stateful database.

## Components

| Component | Purpose | URL |
|---|---|---|
| [stock-app](services/stock-app.md) | Real backend: daily stock prices, cached in TimescaleDB | http://stock.localhost |
| [TimescaleDB](services/timescaledb.md) | stock-app's database | in-cluster only |
| [stock-ui](services/stock-ui.md) | Charts stock-app's prices | http://stock-ui.localhost |
| [cluster-map](services/cluster-map.md) | Live map of the cluster, for learning Kubernetes | http://cluster-map.localhost |
| [traffic-generator](services/traffic-generator.md) | Simulates traffic to the backends, for observability and testing | http://traffic-generator.localhost |
| [Vault](services/vault.md) | Secret store for the backends | http://vault.localhost (token `root`) |
| [Monitoring](services/monitoring.md) | Prometheus, OpenTelemetry Collector + Tempo (request traces), Grafana | http://prometheus.localhost, http://grafana.localhost (`admin`/`admin`) |
| [Documentation](services/documentation.md) | This site | http://docs.localhost |

## Run

Needs Docker, kind, kubectl and Python 3.14 (Go 1.26 and Node.js 24 for development).

```sh
./recreate-cluster.sh                          # (re)create the cluster with everything
STOCK_PROVIDER=fixture ./recreate-cluster.sh   # same, but stock-app replays recorded prices (offline, used by CI)
```

`*.localhost` resolves to your machine, so no DNS setup is needed.

## Test

```sh
make test-unit   # Go and Python unit tests
make lint        # linters + repo-wide pre-commit hooks
make test-e2e    # end-to-end tests against the running cluster
```

More in [Testing](testing.md). How it fits together: [Design](design.md).
