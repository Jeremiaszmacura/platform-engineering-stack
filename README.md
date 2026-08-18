# Platform Engineering Cluster Sample

A Kubernetes cluster for platform engineering practice, deployed locally with
`kind`. It runs the components you would expect in production — ingress,
metrics, dashboards, a secret store, a stateful database — so they can be
learned and experimented with somewhere nothing breaks.

## Documentation

**<https://jeremiaszmacura.github.io/devops-stack/>**

All documentation lives in that MkDocs site, built from `documentation/docs/`.
Component directories hold no prose: every `README.md` next to code is a stub
pointing at its page, so a fact is written down in exactly one place. The same
site is served from inside the cluster at <http://docs.localhost>.

## Deploy

```sh
./recreate-cluster.sh
```

One idempotent script: it recreates the cluster, installs ingress-nginx, builds
and loads every image, applies each component's manifests, and provisions the
Grafana dashboards.

## Components

| Component | Directory | Reachable at |
|---|---|---|
| [go-app](https://jeremiaszmacura.github.io/devops-stack/services/go-app/) | `go-app/` | http://go.localhost |
| [stock-app](https://jeremiaszmacura.github.io/devops-stack/services/stock-app/) | `stock-app/` | http://stock.localhost |
| [TimescaleDB](https://jeremiaszmacura.github.io/devops-stack/services/timescaledb/) | `timescaledb/` | in-cluster only |
| [frontend-app](https://jeremiaszmacura.github.io/devops-stack/services/frontend-app/) | `frontend-app/` | http://app.localhost |
| [stock-ui](https://jeremiaszmacura.github.io/devops-stack/services/stock-ui/) | `stock-ui/` | http://stock-ui.localhost |
| [NGINX](https://jeremiaszmacura.github.io/devops-stack/services/nginx/) | `nginx/` | http://nginx.localhost |
| [Vault](https://jeremiaszmacura.github.io/devops-stack/services/vault/) | `vault/` | http://vault.localhost |
| [Prometheus](https://jeremiaszmacura.github.io/devops-stack/services/prometheus/) | `monitoring/prometheus/` | http://prometheus.localhost |
| [Grafana](https://jeremiaszmacura.github.io/devops-stack/services/grafana/) | `monitoring/grafana/` | http://grafana.localhost |
| [Documentation](https://jeremiaszmacura.github.io/devops-stack/services/documentation/) | `documentation/` | http://docs.localhost |

## Development

```sh
make test-unit   # Go and Python unit suites, auto-discovered per service
make lint        # golangci-lint and the shared pre-commit hooks
make test-e2e    # black-box suite against a running cluster
```
