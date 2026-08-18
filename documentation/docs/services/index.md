# Services

One page per deployed component. Each page covers what the component is, where
it runs, how to redeploy it into a running cluster, and how to run it on its
own during development.

**Component directories in the repository hold no prose.** Every `README.md`
next to the code is a stub pointing here, so there is exactly one place a fact
can be written down — and exactly one place it can go stale.

| Component | Directory | Namespace | Reachable at |
|---|---|---|---|
| [go-app](go-app.md) | `go-app/` | `apps` | http://go.localhost |
| [stock-app](stock-app.md) | `stock-app/` | `apps` | http://stock.localhost |
| [TimescaleDB](timescaledb.md) | `timescaledb/` | `data` | in-cluster only |
| [frontend-app](frontend-app.md) | `frontend-app/` | `apps` | http://app.localhost |
| [stock-ui](stock-ui.md) | `stock-ui/` | `apps` | http://stock-ui.localhost |
| [NGINX](nginx.md) | `nginx/` | `apps` | http://nginx.localhost |
| [Vault](vault.md) | `vault/` | `vault` | http://vault.localhost |
| [Prometheus](prometheus.md) | `monitoring/prometheus/` | `monitoring` | http://prometheus.localhost |
| [Grafana](grafana.md) | `monitoring/grafana/` | `monitoring` | http://grafana.localhost |
| [Documentation](documentation.md) | `documentation/` | `docs` | http://docs.localhost |

Everything is deployed by `./recreate-cluster.sh`; see
[Getting Started](../getting-started.md). How the pieces fit together is in
[Design](../design.md), and why resources are laid out the way they are is in
[Platform Decisions](../platform-decisions.md).

Adding a component? [Adding a Service](../adding-a-service.md) covers the
manifests, the test/lint discovery conventions, and where its documentation
page belongs.
