export const APPS = {
  "stock-app": {
    purpose: "The real backend: daily stock prices, cached in TimescaleDB",
    note: "Answers from TimescaleDB and fetches the dates it has not synced from Yahoo Finance, over the internet (pod → node SNAT → Docker → your machine). Readiness probe only: /health checks the database, and a database outage must not restart the app.",
  },
  "stock-ui": {
    purpose: "Charts stock-app's prices in your browser",
    note: "Serves static files only. Your browser runs the JavaScript and calls http://stock.localhost itself, cross-origin, through the Gateway. The pod never calls the backend.",
  },
  "traffic-generator": {
    purpose: "Fires bursts of requests at stock-app",
    note: "Static files, like stock-ui: your browser sends the requests, so this pod has no outgoing connections.",
  },
  timescaledb: {
    purpose: "PostgreSQL with TimescaleDB: stock-app's database",
    note: "A StatefulSet pinned to the node that holds its local-path volume. A postgres_exporter sidecar turns its statistics into metrics on port 9187.",
  },
  vault: {
    purpose: "Secret store, in dev mode",
    note: "In memory and auto-unsealed. Apps sign in with their ServiceAccount token (kubernetes auth method), and Vault checks it with the API's TokenReview. A restart loses every secret; a postStart hook sets up the KV mounts, the auth method and the policies again before the pod is ready.",
  },
  prometheus: {
    purpose: "Finds and scrapes metrics",
    note: "Asks the API which endpoints exist, keeps those whose Service is annotated prometheus.io/scrape=\"true\", and scrapes every pod directly, every 5 seconds.",
  },
  grafana: {
    purpose: "Dashboards for metrics and traces",
    note: "Datasource access mode is \"proxy\": the Grafana server runs the queries, not your browser. Datasources and dashboards are files from ConfigMaps, loaded on every start.",
  },
  "otel-collector": {
    purpose: "Receives traces, adds pod names, forwards them to Tempo",
    note: "One central Collector (gateway mode). It looks up each sender's pod IP in the API, which needs read access to pods in apps.",
  },
  tempo: {
    purpose: "Stores request traces",
    note: "Single binary with local storage on an emptyDir: traces survive a container restart, not a new pod. Grafana is its UI.",
  },
  "node-exporter": {
    purpose: "Node metrics, one pod per node",
    note: "A DaemonSet on hostNetwork, so its endpoint IPs are the node IPs. Prometheus scrapes each node as its own target.",
  },
  documentation: {
    purpose: "This site, drawn live from the cluster",
    note: "Informers keep a watched copy of the API objects in memory; each /api/map request turns that copy into the map. It also forwards read-only PromQL to Prometheus for the live traffic numbers.",
  },
  envoy: {
    purpose: "The Gateway's data plane: every request from your browser",
    note: "Matches the Host header against the attached HTTPRoutes and proxies straight to ready pod IPs from the backend Service's EndpointSlice, skipping the ClusterIP. Its routing table arrives from Envoy Gateway over xDS, not from a file.",
  },
  "gateway-helm": {
    purpose: "Envoy Gateway: the Gateway's control plane",
    note: "Watches Gateways, HTTPRoutes, Services and EndpointSlices, translates them into Envoy configuration and streams it to the proxies over xDS (port 18000). No request passes through it.",
  },
  certgen: {
    purpose: "One-shot Job of the Envoy Gateway install",
    note: "Creates the TLS certificates the controller and the proxies use for their xDS connection.",
  },
  "kube-dns": {
    purpose: "CoreDNS: every pod's nameserver",
    note: "Answers <service>.<namespace>.svc.cluster.local with the Service's ClusterIP.",
  },
  "kube-apiserver": {
    purpose: "The Kubernetes API",
    note: "Every kubectl command, controller, Prometheus discovery and this site talk to it. Only identities with RBAC permissions get answers.",
  },
  "local-path-provisioner": {
    purpose: "Creates volumes for PVCs",
    note: "Backs the default StorageClass \"standard\": for a new PVC it creates a directory on the node the pod was scheduled to.",
  },
};

// Apps documented in another app's section of the Components page.
const SECTION_OF = { envoy: "platform", "gateway-helm": "platform", certgen: "platform" };

/** The link to an app's section on the Components page; kube-system internals have none, so null. */
export const componentHref = (app, namespace = "") =>
  namespace === "kube-system" || namespace === "local-path-storage" ? null : `components.html#${SECTION_OF[app] || app}`;
