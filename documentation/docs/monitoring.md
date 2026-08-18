# Monitoring

Traffic in the cluster is observed with the classic pipeline: applications expose
Prometheus metrics on `/metrics`, Prometheus scrapes them, Grafana visualizes
Prometheus data. Everything runs in-cluster; only the UIs are exposed through
the ingress (`http://prometheus.localhost`, `http://grafana.localhost`).

## Prometheus

Prometheus is deployed from `monitoring/prometheus/k8s/` (see
[Prometheus](services/prometheus.md)) with its scrape configuration in a
ConfigMap (`prometheus-config.yaml`). Targets are not
listed statically: Prometheus discovers them through the Kubernetes API
(`kubernetes_sd_configs`, `endpoints` role, limited to the `apps` and
`monitoring` namespaces) using two Service annotations:

- `prometheus.io/scrape: "true"` — opt the Service's endpoints into scraping
  (on `/metrics`)
- `prometheus.io/job: <name>` — the `job` label to report, keeping dashboard
  and e2e job names stable

API access is read-only, granted to the `prometheus` ServiceAccount by the
ClusterRole in `platform/rbac/prometheus.yaml`. Discovered targets are
scraped every 5s so dashboards react quickly to generated traffic; Prometheus
also scrapes itself statically as job `self`.

| Job | Annotated Service | What it measures |
|---|---|---|
| `go-app` | `go-app-service` (ns `apps`) | Gin backend HTTP metrics |
| `stock-app` | `stock-app-service` (ns `apps`) | Market data HTTP metrics plus the cache-aside pipeline |
| `nginx-metrics` | `nginx-exporter` (ns `apps`) | Standalone NGINX sample app (via `nginx-exporter` reading `stub_status`) |
| `node-exporter` | `node-exporter` (ns `monitoring`) | Node CPU/memory/disk, run as a DaemonSet on every cluster node |
| `self` | — (static `localhost:9090`) | Prometheus itself |

## Application metrics

The sample backend implements a Prometheus instrumentation middleware
(`go-app/internal/appmetrics/prometheus.go`):

- `http_requests_total{method, endpoint, status_code}` — request counter
- `http_request_duration_seconds{method, endpoint}` — latency histogram
- `http_responses_by_status_total{status_class}` — responses by 2XX/4XX/5XX class
- `monitoring_requests_total{endpoint, user_agent}` — `/metrics` and `/health`
  hits tracked separately, so probe/scrape noise stays out of the app metrics

The `endpoint` label always holds a *registered route path*; requests to
unknown paths are labeled with the constant `unmatched` to keep time-series
cardinality bounded (bot scans must not mint a new series per probed URL).
`stock-app` ships the same middleware, so its route paths keep their
`{symbol}` placeholder instead of expanding to one series per ticker.

## Stock data metrics

`stock-app` adds five metrics describing its cache-aside pipeline
(`stock-app/src/observability/metrics.py`):

| Metric | Labels | What it answers |
|---|---|---|
| `stock_provider_requests_total` | `provider`, `outcome` (`success`/`not_found`/`error`) | How often the upstream market data API is called, and how it went |
| `stock_provider_request_duration_seconds` | `provider` | How slow that upstream API is |
| `stock_cache_lookups_total` | `outcome` (`hit`/`miss`/`refresh`) | How much traffic the local store absorbs |
| `stock_bars_upserted_total` | `provider` | How much data has been ingested |
| `stock_provider_rows_rejected_total` | `provider`, `reason` (`validation`/`malformed`) | How much upstream data violates the domain invariants |

All five are created with zero-valued series at start-up, so a freshly rolled
pod does not leave dashboards querying metrics that do not exist yet.

**No metric is labeled by `symbol`.** Symbols arrive in request paths from
untrusted callers, so a symbol label would be an unbounded-cardinality denial
of service vector, not merely untidy.

## Grafana

Grafana closes the pipeline: it queries Prometheus over in-cluster DNS
(`http://prometheus.monitoring:9090`), registered as the default datasource by
Ansible rather than clicked in by hand. One dashboard file per component lives
in `monitoring/grafana/ansible/dashboards/` — `go-app`, `stock-app`, `nginx`,
`infrastructure` — and every one of them is re-uploaded at the end of
`./recreate-cluster.sh`.

The repository is the source of truth: a dashboard built in the UI and not
exported is gone the next time the cluster is recreated.

For the playbooks, the deployment commands, how to add a dashboard, and
troubleshooting, see [Grafana](services/grafana.md).
