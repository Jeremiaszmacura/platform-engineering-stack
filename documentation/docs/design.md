# Design

## Traffic

Everything from your machine enters through ingress-nginx on host port 80 and is routed by host name
(`<component>.localhost`) to the component's Service. The frontends call stock-app cross-origin;
stock-app's Ingress enables CORS. Metrics and traces stay inside the cluster.

```mermaid
flowchart LR
    B[Browser] -->|"*.localhost :80"| IC[ingress-nginx]
    IC --> SUI[stock-ui] & TG[traffic-generator] & ST[stock-app] & CM[cluster-map] & OTHER["Vault · Prometheus · Grafana · docs"]
    ST --> TS[(TimescaleDB)]
    ST --> VA[Vault]
    PR[Prometheus] -.scrapes.-> ST & CM
    ST -.traces.-> TE[Tempo]
    CM & PR -.watch / list.-> API[Kubernetes API]
```

## Decisions

- **Ownership:** a resource owned by one component lives in `<component>/k8s/`; cluster-wide resources
  (kind config, namespaces, RBAC) live in `platform/` and are applied first.
- **Namespaces:** `apps` (stock-app, traffic-generator, stock-ui), `monitoring` (+ cluster-map), `vault`, `data`
  (TimescaleDB), `docs`. Every manifest sets its namespace; cross-namespace calls use `<service>.<namespace>`.
- **Least privilege:** each workload has its own ServiceAccount with no API token. Only Prometheus (service
  discovery) and cluster-map (the live map) get read-only API access; neither can read Secrets.
- **Metrics discovery:** a Service is scraped when annotated `prometheus.io/scrape: "true"` and
  `prometheus.io/job: <name>`, so new services need no Prometheus change.
- **Tracing:** stock-app traces every HTTP request with OpenTelemetry and sends it over OTLP to Tempo, which Grafana
  reads. The latency histogram's exemplars and every log line carry the trace id.
- **Secrets:** dev credentials live in one Secret per tool. Secrets can't cross namespaces, so the Vault token
  and the database password are declared in both namespaces that need them. Vault (dev mode) holds app secrets,
  one path per service (`services/<service>/`).
- **Stateful data:** TimescaleDB uses a PVC; it is empty after every `./recreate-cluster.sh`, which is fine
  because stock-app refills it from the provider.
- **API contract:** stock-app's `openapi.yaml` is the source of truth; its models are generated from it.
- **Dependency updates:** Renovate (`renovate.json`) opens update PRs daily. Minor, patch and digest updates
  auto-merge when CI is green (the e2e job deploys the whole cluster); majors and language runtimes
  (Python, Go, Node) wait for a human. Releases must be 3 days old; local `<component>:dev` images are ignored.

## Conventions

- Deployment and `app` label = component name; Service `<component>-service`; Ingress `<component>-ingress`.
- Every workload has requests/limits and a readiness probe; own images run as non-root; images are pinned.
- A config file a container reads (e.g. `prometheus.yml`) is a plain file in `k8s/`; a `kustomization.yaml` turns it
  into a ConfigMap, and `./recreate-cluster.sh` applies such directories with `kubectl apply -k`.
- `./recreate-cluster.sh` is the single entry point and stays idempotent.
