# Monitoring

Prometheus (http://prometheus.localhost) scrapes the apps; Grafana (http://grafana.localhost, `admin`/`admin`)
shows them. Both run in namespace `monitoring`.

- **Scraping:** Services annotated `prometheus.io/scrape: "true"` + `prometheus.io/job: <name>` in namespaces
  `apps` and `monitoring` are discovered automatically, one target per pod (jobs: `stock-app`,
  `cluster-map`, `node-exporter`, plus `self`).
- **App metrics:** stock-app exposes `http_requests_total`, `http_request_duration_seconds`,
  `http_responses_by_status_total` (probes and scrapes excluded; those go to `monitoring_requests_total` by
  `endpoint` and `status_code`); stock-app adds `stock_*` metrics for its provider calls and cache hits.
- **Stock App dashboard:** HTTP traffic (availability and latency SLIs, request rate, p95 latency, 4XX/5XX
  rates, health checks) and the cache-aside pipeline.
- **Dashboards** are code: `monitoring/grafana/ansible/dashboards/*.json` (fixed `uid`, queries filtered by `job`),
  uploaded with the datasource by `ansible-playbook monitoring/grafana/ansible/provision.yaml` at the end of
  `./recreate-cluster.sh`. Save UI changes back to the JSON file, or they are lost on the next rebuild.
