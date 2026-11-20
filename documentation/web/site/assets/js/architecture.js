import { appLinks, health, podsOf } from "./model.js";
import { num, nsColor } from "./util.js";

const W = 1328;
const H = 740;
const ROW = 52;

// Vertical lines run through corridors between the bands: x=224, x=640, x=880 and y=460, y=588..626.
/** Namespaces as bands, drawn behind the boxes. */
const GROUPS = [
  { x: 16, y: 16, w: 200, h: 424, label: "outside the cluster", color: nsColor("outside") },
  { x: 232, y: 16, w: 1080, h: 108, label: "envoy-gateway-system · entry", color: nsColor("envoy-gateway-system") },
  { x: 232, y: 148, w: 400, h: 300, label: "apps", color: nsColor("apps") },
  { x: 648, y: 148, w: 224, h: 152, label: "vault", color: nsColor("vault") },
  { x: 648, y: 316, w: 224, h: 132, label: "data", color: nsColor("data") },
  { x: 888, y: 148, w: 424, h: 136, label: "docs", color: nsColor("docs") },
  { x: 232, y: 472, w: 1080, h: 136, label: "monitoring · telemetry", color: nsColor("monitoring") },
  { x: 232, y: 640, w: 288, h: 92, label: "envoy-gateway-system · controller", color: nsColor("envoy-gateway-system") },
  { x: 536, y: 640, w: 776, h: 92, label: "kube-system · control plane", color: nsColor("kube-system") },
];

/** Where each known component sits: [x, y, width, namespace, height]. */
const PLACES = {
  browser: [32, 56, 168, "outside"],
  yahoo: [32, 356, 168, "outside"],
  envoy: [248, 56, 1048, "envoy-gateway-system"],
  "stock-ui": [248, 196, 176, "apps"],
  "traffic-generator": [440, 196, 176, "apps"],
  "stock-app": [344, 356, 176, "apps"],
  vault: [664, 196, 192, "vault"],
  timescaledb: [664, 356, 192, "data"],
  documentation: [904, 196, 200, "docs"],
  "otel-collector": [244, 512, 148, "monitoring"],
  tempo: [408, 512, 132, "monitoring"],
  grafana: [566, 512, 148, "monitoring"],
  prometheus: [806, 512, 148, "monitoring"],
  "node-exporter": [996, 512, 156, "monitoring"],
  alertmanager: [1164, 512, 132, "monitoring"],
  "gateway-helm": [248, 668, 200, "envoy-gateway-system"],
  "kube-apiserver": [552, 668, 200, "kube-system"],
  "kube-dns": [968, 668, 176, "kube-system"],
};

/** Subtitles for the boxes; the live map adds the ready count when there is more than one pod. */
const SUBS = {
  browser: "127.0.0.1:80, :443",
  yahoo: "internet · HTTPS",
  envoy: "Envoy proxy · NodePorts 30080, 30443 → :10080, :10443 · picks the HTTPRoute by Host header",
  "gateway-helm": "controller · xDS :18000",
  "stock-ui": "React · nginx :8080",
  "traffic-generator": "React · nginx :8080",
  "stock-app": "FastAPI :8000",
  vault: "Raft :8200",
  timescaledb: "PostgreSQL :5432",
  documentation: "Go · this site :8080",
  "otel-collector": "OTLP :4318",
  tempo: "traces :3200",
  grafana: "UI :3000",
  prometheus: "metrics :9090",
  alertmanager: "alerts :9093",
  "node-exporter": ":9100 per node",
  "kube-dns": "Service kube-dns :53",
  "kube-apiserver": "control-plane :6443",
};

const TITLES = { envoy: "shared-gateway", "gateway-helm": "Envoy Gateway", yahoo: "Yahoo Finance", browser: "Your browser", "kube-dns": "CoreDNS" };

/** PromQL behind the moving parts of the diagram. */
export const TRAFFIC_QUERIES = {
  stockRps: 'sum(rate(http_requests_total{job="stock-app"}[1m]))',
  dbTps: 'sum(rate(pg_stat_database_xact_commit{datname="stockdata"}[1m]))',
  vaultRps: "sum(rate(vault_core_handle_request_count[1m]))",
  providerRps: "sum(rate(stock_provider_requests_total[5m]))",
  spansIn: "sum(rate(otelcol_receiver_accepted_spans[1m]))",
  spansOut: "sum(rate(otelcol_exporter_sent_spans[1m]))",
  up: "up",
};

export const LAYERS = {
  requests: "Requests",
  telemetry: "Telemetry",
  control: "Control plane",
  all: "All",
};

const TELEMETRY_APPS = new Set(["prometheus", "alertmanager", "tempo", "otel-collector", "grafana"]);

function node(map, id) {
  const [x, y, w, namespace, h = ROW] = PLACES[id];
  const base = { id, x, y, w, h, color: nsColor(namespace), title: TITLES[id] || id, sub: SUBS[id], click: true };
  if (namespace === "outside") return { ...base, dashed: true };
  const pods = podsOf(map, id);
  if (!pods.length) return { ...base, off: true, sub: "not running" };
  const state = health(pods);
  if (!state.total) return { ...base, status: "ok", sub: "Job · completed" };
  const count = state.total > 1 || state.ready < state.total ? ` · ${state.ready}/${state.total}` : "";
  return { ...base, bus: id === "envoy", status: state.state, sub: SUBS[id] + count, tip: `${id}: ${state.ready} of ${state.total} pods ready${state.restarts ? `, ${state.restarts} restarts` : ""}` };
}

// Apps that store telemetry: whoever calls them is reading, except the writers pushing spans or alerts.
const STORES = new Set(["prometheus", "tempo", "alertmanager"]);
const WRITERS = new Set(["otel-collector", "prometheus"]);

/** The ends of link l as the data moves, which is not always the way the connection opens. */
export function dataEnds(l) {
  // Prometheus opens the scrape but the metrics flow to it; a watcher opens the API connection but objects flow to it.
  const pulled = l.kind === "scrape" || l.kind === "api" || (l.kind === "call" && STORES.has(l.to) && !WRITERS.has(l.from));
  return pulled ? { from: l.to, to: l.from } : { from: l.from, to: l.to };
}

const jobOf = (label) => (label.match(/\(job ([^)]+)\)/) || [])[1];

function scrapeHealth(up, job) {
  if (!up) return null;
  const series = up.filter((s) => s.metric.job === job);
  if (!series.length) return null;
  return series.every((s) => s.value[1] === "1");
}

// Edge per merged link, with its layer, label and live rate.
function liveEdges(map, m) {
  const rate = (name) => (m[name] && m[name].length ? Number(m[name][0].value[1]) : 0);
  const perSecond = (name, unit) => (m[name] ? ` · ${num(rate(name))} ${unit}` : "");
  return appLinks(map).map((l) => {
    const e = { ...dataEnds(l), tip: l.labels.join("\n") };
    if (l.kind === "gateway") {
      const host = l.labels[0];
      const busy = l.to === "stock-app";
      return { ...e, layer: "requests", color: nsColor("envoy-gateway-system"), label: busy ? host + perSecond("stockRps", "req/s") : host, flow: busy ? rate("stockRps") : 0, hot: busy && rate("stockRps") > 0.004, lt: 0.62 };
    }
    if (l.kind === "scrape") {
      const ok = scrapeHealth(m.up, jobOf(l.labels[0]));
      return { ...e, layer: "telemetry", dashed: true, color: ok === false ? "var(--bad)" : nsColor("monitoring"), flow: 0.2, tip: `${l.labels[0]}${ok === null ? "" : ok ? "\nup" : "\nDOWN"}` };
    }
    if (l.kind === "api") return { ...e, layer: "control", dashed: true, color: nsColor("kube-system") };
    return callEdge(e, l, map, m, rate, perSecond);
  });
}

// pg_stat_database counts commits per database, not per client, so the line includes TimescaleDB's own work.
const DB_TIP = "Commits in database stockdata: stock-app's queries (its readiness probe checks the database every 5 s) and TimescaleDB's job scheduler";

function callEdge(e, l, map, m, rate, perSecond) {
  const pods = podsOf(map, l.from);
  const fromNs = (pods[0] || {}).namespace;
  const target = l.labels[0];
  // A finished Job called once; the target's live rate belongs to its other callers.
  if (health(pods).done && !health(pods).total) return { ...e, layer: "requests", color: nsColor(fromNs), label: "ran once", flow: 0 };
  const known = {
    timescaledb: ["SQL" + perSecond("dbTps", "tx/s"), rate("dbTps")],
    vault: ["HTTP" + perSecond("vaultRps", "req/s"), rate("vaultRps")],
    "otel-collector": ["OTLP" + perSecond("spansIn", "spans/s"), rate("spansIn")],
    tempo: [l.from === "otel-collector" ? "OTLP" + perSecond("spansOut", "spans/s") : "TraceQL", l.from === "otel-collector" ? rate("spansOut") : 0],
    prometheus: [l.from === "documentation" ? "PromQL · this page" : "PromQL", 0],
    alertmanager: [l.from === "prometheus" ? "alerts" : "API", 0],
  }[l.to] || [target, 0];
  const telemetry = TELEMETRY_APPS.has(l.to) || l.from === "otel-collector";
  const tip = l.to === "timescaledb" ? DB_TIP : undefined;
  return { ...e, layer: telemetry ? "telemetry" : "requests", color: nsColor(fromNs), label: known[0], flow: known[1], hot: known[1] > 0.004, tip };
}

// Connections the API objects can't show: the browser, the internet and the controller's xDS stream.
function staticEdges(map, m) {
  const rps = m.stockRps && m.stockRps.length ? Number(m.stockRps[0].value[1]) : 0;
  const calls = m.providerRps && m.providerRps.length ? Number(m.providerRps[0].value[1]) * 60 : null;
  const edges = [
    { from: "browser", to: "envoy", layer: "requests", color: nsColor("outside"), label: ":80, :443", flow: rps, sides: ["r", "l"], ta: 0.5, tb: 0.35 },
    { from: "gateway-helm", to: "envoy", layer: "control", dashed: true, color: nsColor("envoy-gateway-system"), label: "xDS", tip: "routes and endpoints, streamed over gRPC" },
  ];
  if (podsOf(map, "stock-app").length) {
    edges.push({ from: "stock-app", to: "yahoo", layer: "requests", color: nsColor("apps"), label: calls === null ? "HTTPS" : `HTTPS · ${num(calls)}/min`, flow: calls ? calls / 60 : 0, hot: calls > 0, sides: ["l", "r"] });
  }
  return edges;
}

// Hand-picked attachment points and detours that keep the lines off other boxes.
const ROUTES = {
  "envoy|stock-app": { lt: 0.83 },
  "envoy|grafana": { lt: 0.08 },
  "envoy|prometheus": { lt: 0.08 },
  "stock-app|vault": { sides: ["r", "l"], ta: 0.25 },
  "stock-app|timescaledb": { sides: ["r", "l"], ta: 0.7 },
  "stock-app|otel-collector": { sides: ["b", "t"], ta: 0.15, lt: 0.35 },
  "stock-app|prometheus": { sides: ["b", "t"], ta: 0.75, tb: 0.08, via: [[476, 460], [818, 460]] },
  "timescaledb|prometheus": { sides: ["b", "t"], ta: 0.8, tb: 0.25 },
  "vault|prometheus": { sides: ["r", "t"], tb: 0.6, via: [[895, 222]] },
  "documentation|prometheus": { sides: ["b", "t"], ta: 0.3, tb: 0.95 },
  "prometheus|documentation": { sides: ["t", "b"], ta: 0.85, tb: 0.15 },
  "grafana|prometheus": { sides: ["r", "l"], ta: 0.72, tb: 0.72 },
  "prometheus|grafana": { sides: ["l", "r"], ta: 0.28, tb: 0.28 },
  "node-exporter|prometheus": { sides: ["l", "r"] },
  "prometheus|alertmanager": { sides: ["b", "b"], ta: 0.82, tb: 0.15, via: [[927.4, 578], [1183.8, 578]] },
  "alertmanager|prometheus": { sides: ["b", "b"], ta: 0.3, tb: 0.95, via: [[1203.6, 590], [946.6, 590]] },
  "alertmanager|grafana": { sides: ["t", "t"], ta: 0.15, tb: 0.85, via: [[1183.8, 494], [691.8, 494]] },
  "tempo|prometheus": { sides: ["b", "b"], ta: 0.75, tb: 0.6, via: [[507, 596], [895, 596]] },
  "otel-collector|prometheus": { sides: ["b", "b"], ta: 0.75, tb: 0.75, via: [[355, 602], [917, 602]] },
  "tempo|grafana": { sides: ["t", "t"], ta: 0.5, tb: 0.3, via: [[474, 496], [610, 496]] },
  "otel-collector|tempo": { sides: ["b", "b"], ta: 0.3, tb: 0.15, via: [[288.4, 588], [427.8, 588]] },
  "gateway-helm|envoy": { sides: ["l", "l"], ta: 0.5, tb: 0.69, via: [[224, 694], [224, 92]] },
  "kube-apiserver|gateway-helm": { sides: ["l", "r"] },
  "kube-apiserver|kube-dns": { sides: ["r", "l"] },
  "kube-apiserver|documentation": { sides: ["t", "b"], ta: 0.84, tb: 0.375, via: [[720, 620], [979, 620]] },
  "kube-apiserver|prometheus": { sides: ["t", "b"], ta: 0.64, tb: 0.3, via: [[680, 614], [850, 614]] },
  "kube-apiserver|otel-collector": { sides: ["t", "b"], ta: 0.24, tb: 0.5, via: [[600, 626], [318, 626]] },
  "kube-apiserver|vault": { sides: ["t", "r"], ta: 0.94, tb: 0.75, via: [[740, 490], [864, 490], [864, 235]] },
};

/** The diagram spec for one layer, from the live map and the latest Prometheus results m. */
export function architecture(map, m, layer, selected) {
  const nodes = Object.keys(PLACES).map((id) => node(map, id));
  const placed = new Set(Object.keys(PLACES));
  const edges = [...liveEdges(map, m), ...staticEdges(map, m)]
    .filter((e) => placed.has(e.from) && placed.has(e.to))
    .filter((e) => layer === "all" || e.layer === layer)
    .map((e) => ({ ...e, ...(ROUTES[`${e.from}|${e.to}`] || {}) }));
  return {
    w: W, h: H, groups: GROUPS, nodes, edges, selected,
    label: `Architecture of the cluster, ${LAYERS[layer]} layer`,
    notes: [{ x: 1296, y: 658, anchor: "end", text: "kube-proxy and kindnet run on every node: see the Cluster map" }],
  };
}

/** Workload apps running in the cluster that the layout has no place for, e.g. a component you just added. */
export function unplaced(map) {
  const system = new Set(map.system_namespaces);
  return [...new Set(map.pods.filter((p) => !system.has(p.namespace) && !PLACES[p.app]).map((p) => p.app))].sort();
}

export const isPlaced = (id) => Boolean(PLACES[id]);
