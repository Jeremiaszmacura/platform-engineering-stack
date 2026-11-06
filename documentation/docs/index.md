# Platform Engineering Stack

A small Kubernetes cluster that runs on your laptop, for learning platform engineering.
One script builds everything; you then send traffic and watch it in Grafana.

## What runs in the cluster

| Component | What it does | URL |
|---|---|---|
| [frontend-app](services/frontend-app.md) | Web page that sends test requests to the backends | http://app.localhost |
| [python-app](services/python-app.md) | Sample backend (FastAPI) | http://python.localhost |
| [go-app](services/go-app.md) | Sample backend (Gin) | http://go.localhost |
| [nginx](services/nginx.md) | Sample web server | http://nginx.localhost |
| [Vault](services/vault.md) | Secret store used by both backends | http://vault.localhost |
| [Prometheus](services/monitoring.md) | Collects metrics | http://prometheus.localhost |
| [Grafana](services/monitoring.md) | Shows metrics on dashboards | http://grafana.localhost |
| [Documentation](services/documentation.md) | This site | http://docs.localhost |

## Typical flow

1. `./recreate-cluster.sh` — create the cluster ([Getting Started](getting-started.md)).
2. Open http://app.localhost and send requests to a backend.
3. Watch the traffic on the dashboards at http://grafana.localhost.

How it fits together: [Design](design.md). Adding something new: [Adding a Service](adding-a-service.md).
