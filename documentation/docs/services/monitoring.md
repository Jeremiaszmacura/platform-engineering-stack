# Monitoring

Apps expose metrics on `/metrics` → Prometheus collects them → Grafana shows them.
Everything runs inside the cluster; only the UIs are exposed:
http://prometheus.localhost and http://grafana.localhost (`admin` / `admin`).

## Prometheus

Config: `monitoring/prometheus/k8s/prometheus-config.yaml`. Default scrape every 15s; the sample apps every 5s.

| Job | How targets are found | What it measures |
|---|---|---|
| `python-app` | Service `python-app-service:8000` | FastAPI app metrics |
| `go-app` | Service `go-app-service:8080` | Gin app metrics + Go runtime |
| `nginx-metrics` | DNS on headless `nginx-metrics-service` (one target per nginx pod) | nginx connections and requests |
| `node-exporter` | DNS on headless `node-exporter-service` (one target per node) | Node CPU, memory, disk |
| `self` | `localhost:9090` | Prometheus itself |

node-exporter is a DaemonSet that also runs on the control-plane node, so all 3 nodes are covered.

## App metrics

Both backends record the same metrics:

- `http_requests_total{method, endpoint, status_code}` — request count
- `http_request_duration_seconds{method, endpoint}` — latency histogram
- `http_responses_by_status_total{status_class}` — 2XX/3XX/4XX/5XX count
- `monitoring_requests_total{endpoint, user_agent}` — hits on `/metrics` and `/health` only

`/metrics` and `/health` are left out of the first three, so probes and scrapes don't look like user traffic.
`endpoint` is the route template; unknown paths are labeled `unmatched` so bots can't create endless series.

## Grafana

Set up as code with Ansible (`monitoring/grafana/ansible/`), run at the end of `./recreate-cluster.sh`:

```sh
ansible-playbook monitoring/grafana/ansible/provision.yaml
```

- `setup-datasource.yaml` — creates the Prometheus datasource (uid `prometheus`), or updates it if it exists.
- `deploy-dashboards.yaml` — uploads every file in `dashboards/`: `python-app`, `go-app`, `nginx`, `infrastructure`.
- Shared settings (URL, dev login) are in `vars.yaml`.

### Change a dashboard

1. Edit it in the Grafana UI (or the JSON file).
2. Save the JSON model to `monitoring/grafana/ansible/dashboards/<name>.json`. Keep its fixed `uid`
   and filter every query by `job="<app>"` — both backends use the same metric names.
3. Re-run the playbook. Git is the source of truth: changes not saved to the repo are lost on the next cluster rebuild.
