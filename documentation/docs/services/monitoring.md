# Monitoring

Prometheus (http://prometheus.localhost) scrapes the apps' metrics, the OpenTelemetry Collector receives
stock-app's request traces and passes them to Tempo, and Grafana (http://grafana.localhost, `admin`/`admin`) shows
both. All of them run in namespace `monitoring`.

- **Scraping:** Services annotated `prometheus.io/scrape: "true"` + `prometheus.io/job: <name>` in namespaces
  `apps` and `monitoring` are discovered automatically, one target per pod (jobs: `stock-app`,
  `cluster-map`, `node-exporter`, plus `self`).
- **App metrics:** stock-app exposes `http_requests_total`, `http_request_duration_seconds`,
  `http_responses_by_status_total` (probes and scrapes excluded; those go to `monitoring_requests_total` by
  `endpoint` and `status_code`); stock-app adds `stock_*` metrics for its provider calls and cache hits.
- **Stock App dashboard:** HTTP traffic (availability and latency SLIs, request rate, p95 latency, 4XX/5XX
  rates, health checks) and the cache-aside pipeline.
- **Dashboards and datasources** are code in `monitoring/grafana/k8s/`: `dashboards/*.json` (fixed `uid`, queries
  filtered by `job`) and `datasources.yaml`. `kustomization.yaml` turns them into ConfigMaps that Grafana loads on
  every start, so a restarted pod gets them back. Provisioned dashboards are read-only in the UI: copy the JSON
  (*Export → Export as JSON*) into the file and apply it (see *Config changes*).
- **Grafana storage:** its SQLite database (logins, preferences) is on an `emptyDir`, so it survives a container
  restart but not a new pod. Memory limit 1Gi: Grafana 13 idles at about 330Mi.
- **Config changes:** `kubectl apply -k monitoring/<tool>/k8s` applies an edited config file. Grafana, Tempo and
  the Collector get a new pod, because their ConfigMap names carry a hash of the content (Grafana logs you out,
  Tempo loses its traces). Prometheus keeps running and reloads `prometheus.yml` within about two minutes; it skips
  a broken file (`prometheus_config_last_reload_successful` drops to 0), which then fails its next start.

## Tracing

Every stock-app HTTP request is one trace: the request span, its SQL queries, its Vault calls and its market
data provider calls. Open them in Grafana: the **Tracing** dashboard (rate and latency per route measured from
traces, and tables of recent, slow and failed requests), or **Explore → Tempo**. New to tracing? Start with
[Tracing](../tracing.md).

- **Instrumentation:** OpenTelemetry in stock-app (`src/observability/tracing.py`, wired in `src/main.py`); the
  core layers never import it. `/health` and `/metrics` are not traced.
- **Export:** OTLP over HTTP to `otel-collector-service.monitoring:4318`, set by the standard
  `OTEL_EXPORTER_OTLP_ENDPOINT`. Unset (unit tests, local runs), tracing is off. An incoming W3C `traceparent`
  header continues the caller's trace.
- **OpenTelemetry Collector** (`monitoring/otel-collector/`, the `otelcol-k8s` distribution) runs as one gateway
  Deployment. Its pipeline (`otel-collector.yaml`): `otlp` receiver → `memory_limiter` → `k8s_attributes` (adds
  `k8s.namespace.name`, `k8s.pod.name`, `k8s.deployment.name`, `k8s.node.name`) → `otlp_http` exporter to Tempo.
  `k8s_attributes` reads pods through a Role limited to namespace `apps` (`platform/rbac/otel-collector.yaml`).
- **Tempo** (`monitoring/tempo/`) runs as a single binary with local storage on an `emptyDir`, so traces are lost
  when the pod restarts. It has no Ingress: Grafana is its UI. Search finds a new trace after about 30 s; opening
  it by id works at once.
- **Metrics → traces:** the latency histogram carries the request's `trace_id` as an exemplar (Prometheus runs with
  `--enable-feature=exemplar-storage`). On the *p95 Latency* panel each dot opens its trace.
- **Logs → traces:** every log line inside a request has `trace_id=<id>`; paste it into Explore → Tempo.
