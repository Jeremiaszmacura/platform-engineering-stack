# Monitoring

Apps expose metrics on `/metrics` → Prometheus collects them → Grafana shows them.
Everything runs inside the cluster (namespace `monitoring`); only the UIs are exposed:
http://prometheus.localhost and http://grafana.localhost (`admin` / `admin`).

## Prometheus

Config: `monitoring/prometheus/k8s/prometheus-config.yaml`. Prometheus scrapes itself as job `self`;
every other target is found through the Kubernetes API (`kubernetes_sd_configs`, `endpoints` role,
namespaces `apps` and `monitoring`) and scraped every 5s. A Service opts in with two annotations:

```yaml
annotations:
  prometheus.io/scrape: "true"   # scrape this Service's endpoints on /metrics
  prometheus.io/job: go-app      # the job label to report
```

Each endpoint of the Service (every pod, or every node for node-exporter) becomes its own target.
Read-only API access comes from the `prometheus` ServiceAccount and the ClusterRole in `platform/rbac/prometheus.yaml`.

| Job | Annotated Service | What it measures |
|---|---|---|
| `stock-app` | `stock-app-service` (`apps`) | HTTP metrics + the cache-aside pipeline |
| `go-app` | `go-app-service` (`apps`) | Gin app metrics + Go runtime |
| `nginx-metrics` | `nginx-metrics-service` (`apps`, one target per nginx pod) | nginx connections and requests |
| `node-exporter` | `node-exporter-service` (`monitoring`, one target per node) | Node CPU, memory, disk |
| `self` | static `localhost:9090` | Prometheus itself |

node-exporter is a DaemonSet that also runs on the control-plane node, so all 3 nodes are covered.

## App metrics

Both backends record the same HTTP metrics:

- `http_requests_total{method, endpoint, status_code}` — request count
- `http_request_duration_seconds{method, endpoint}` — latency histogram
- `http_responses_by_status_total{status_class}` — 2XX/3XX/4XX/5XX count
- `monitoring_requests_total{endpoint, user_agent}` — hits on `/metrics` and `/health` only

`/metrics` and `/health` are left out of the first three, so probes and scrapes don't look like user traffic.
`endpoint` is the route template (stock-app keeps `{symbol}`); unknown paths are labeled `unmatched` so bots can't create endless series.

stock-app adds metrics for its cache-aside pipeline (`stock-app/src/observability/metrics.py`):

| Metric | Labels | Answers |
|---|---|---|
| `stock_provider_requests_total` | `provider`, `outcome` | How often the market data API is called, and how it went |
| `stock_provider_request_duration_seconds` | `provider` | How slow that API is |
| `stock_cache_lookups_total` | `outcome` (`hit`/`miss`/`refresh`) | How much traffic the database absorbs |
| `stock_bars_upserted_total` | `provider` | How much data was stored |
| `stock_provider_rows_rejected_total` | `provider`, `reason` | How much provider data broke the domain rules |

No metric is labeled by symbol: symbols come from untrusted request paths and would create unbounded series.

## Grafana

Set up as code with Ansible (`monitoring/grafana/ansible/`), run at the end of `./recreate-cluster.sh`:

```sh
ansible-playbook monitoring/grafana/ansible/provision.yaml
```

- `setup-datasource.yaml` — creates the Prometheus datasource (uid `prometheus`), or updates it if it exists.
- `deploy-dashboards.yaml` — uploads every file in `dashboards/`: `stock-app`, `go-app`, `nginx`, `infrastructure`.
- Shared settings (URL, dev login) are in `vars.yaml`.

### Change a dashboard

1. Edit it in the Grafana UI (or the JSON file).
2. Save the JSON model to `monitoring/grafana/ansible/dashboards/<name>.json`. Keep its fixed `uid`
   and filter every query by `job="<app>"` — both backends use the same HTTP metric names.
3. Re-run the playbook. Git is the source of truth: changes not saved to the repo are lost on the next cluster rebuild.
