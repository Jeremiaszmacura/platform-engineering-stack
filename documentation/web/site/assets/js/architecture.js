import { appLinks, health, podsOf } from "./model.js";
import { num, nsColor } from "./util.js";

const W = 1200;
const H = 740;
const ROW = 52;

// Vertical lines run through corridors between the bands: x=224, x=640, x=880 and y=460, y=588..626.
/** Namespaces as bands, drawn behind the boxes. */
const GROUPS = [
  { x: 16, y: 16, w: 200, h: 424, label: "outside the cluster", color: nsColor("outside") },
  { x: 232, y: 16, w: 952, h: 108, label: "envoy-gateway-system · entry", color: nsColor("envoy-gateway-system") },
  { x: 232, y: 148, w: 400, h: 300, label: "apps", color: nsColor("apps") },
  { x: 648, y: 148, w: 224, h: 152, label: "vault", color: nsColor("vault") },
  { x: 648, y: 316, w: 224, h: 132, label: "data", color: nsColor("data") },
  { x: 888, y: 148, w: 296, h: 136, label: "docs", color: nsColor("docs") },
  { x: 232, y: 472, w: 952, h: 136, label: "monitoring · telemetry", color: nsColor("monitoring") },
  { x: 232, y: 640, w: 288, h: 92, label: "envoy-gateway-system · controller", color: nsColor("envoy-gateway-system") },
  { x: 536, y: 640, w: 648, h: 92, label: "kube-system · control plane", color: nsColor("kube-system") },
];

/** Where each known component sits: [x, y, width, namespace, height]. */
const PLACES = {
  browser: [32, 56, 168, "outside"],
  yahoo: [32, 356, 168, "outside"],
  envoy: [248, 56, 920, "envoy-gateway-system"],
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
  "node-exporter": [1004, 512, 164, "monitoring"],
  "gateway-helm": [248, 668, 200, "envoy-gateway-system"],
  "kube-apiserver": [552, 668, 200, "kube-system"],
  "kube-dns": [968, 668, 176, "kube-system"],
};

/** Subtitles for the boxes; the live map adds the ready count when there is more than one pod. */
const SUBS = {
  browser: "*.localhost → 127.0.0.1:80",
  yahoo: "internet · HTTPS",
  envoy: "Envoy proxy · NodePort 30080 → :10080 · picks the HTTPRoute by Host header",
  "gateway-helm": "controller · xDS :18000",
  "stock-ui": "React · nginx :8080",
  "traffic-generator": "React · nginx :8080",
  "stock-app": "FastAPI :8000",
  vault: "dev mode :8200",
  timescaledb: "PostgreSQL :5432",
  documentation: "Go · this site :8080",
  "otel-collector": "OTLP :4318",
  tempo: "traces :3200",
  grafana: "UI :3000",
  prometheus: "metrics :9090",
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

const TELEMETRY_APPS = new Set(["prometheus", "tempo", "otel-collector", "grafana"]);

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
    const e = { from: l.from, to: l.to, tip: l.labels.join("\n") };
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
  }[l.to] || [target, 0];
  const telemetry = TELEMETRY_APPS.has(l.to) || l.from === "otel-collector";
  return { ...e, layer: telemetry ? "telemetry" : "requests", color: nsColor(fromNs), label: known[0], flow: known[1], hot: known[1] > 0.004 };
}

// Connections the API objects can't show: the browser, the internet and the controller's xDS stream.
function staticEdges(map, m) {
  const rps = m.stockRps && m.stockRps.length ? Number(m.stockRps[0].value[1]) : 0;
  const calls = m.providerRps && m.providerRps.length ? Number(m.providerRps[0].value[1]) * 60 : null;
  const edges = [
    { from: "browser", to: "envoy", layer: "requests", color: nsColor("outside"), label: ":80", flow: rps, sides: ["r", "l"], ta: 0.5, tb: 0.35 },
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
  "prometheus|stock-app": { sides: ["t", "b"], ta: 0.08, tb: 0.75, via: [[818, 460], [476, 460]] },
  "prometheus|timescaledb": { sides: ["t", "b"], ta: 0.25, tb: 0.8 },
  "prometheus|vault": { sides: ["t", "r"], ta: 0.6, via: [[895, 222]] },
  "prometheus|documentation": { sides: ["t", "b"], ta: 0.95, tb: 0.3 },
  "documentation|prometheus": { sides: ["b", "t"], ta: 0.15, tb: 0.85 },
  "prometheus|grafana": { sides: ["l", "r"], ta: 0.72, tb: 0.72 },
  "grafana|prometheus": { sides: ["r", "l"], ta: 0.28, tb: 0.28 },
  "prometheus|node-exporter": { sides: ["r", "l"] },
  "prometheus|tempo": { sides: ["b", "b"], ta: 0.6, tb: 0.75, via: [[895, 596], [507, 596]] },
  "prometheus|otel-collector": { sides: ["b", "b"], ta: 0.75, tb: 0.75, via: [[917, 602], [355, 602]] },
  "grafana|tempo": { sides: ["t", "t"], ta: 0.3, tb: 0.5, via: [[610, 496], [474, 496]] },
  "otel-collector|tempo": { sides: ["b", "b"], ta: 0.3, tb: 0.15, via: [[288.4, 588], [427.8, 588]] },
  "gateway-helm|envoy": { sides: ["l", "l"], ta: 0.5, tb: 0.69, via: [[224, 694], [224, 92]] },
  "gateway-helm|kube-apiserver": { sides: ["r", "l"] },
  "kube-dns|kube-apiserver": { sides: ["l", "r"] },
  "documentation|kube-apiserver": { sides: ["b", "t"], ta: 0.375, tb: 0.84, via: [[979, 620], [720, 620]] },
  "prometheus|kube-apiserver": { sides: ["b", "t"], ta: 0.3, tb: 0.64, via: [[850, 614], [680, 614]] },
  "otel-collector|kube-apiserver": { sides: ["b", "t"], ta: 0.5, tb: 0.24, via: [[318, 626], [600, 626]] },
  "vault|kube-apiserver": { sides: ["r", "t"], ta: 0.75, tb: 0.94, via: [[864, 235], [864, 490], [740, 490]] },
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
    notes: [{ x: 1168, y: 658, anchor: "end", text: "kube-proxy and kindnet run on every node: see the Cluster map" }],
  };
}

/** Workload apps running in the cluster that the layout has no place for, e.g. a component you just added. */
export function unplaced(map) {
  const system = new Set(map.system_namespaces);
  return [...new Set(map.pods.filter((p) => !system.has(p.namespace) && !PLACES[p.app]).map((p) => p.app))].sort();
}

export const isPlaced = (id) => Boolean(PLACES[id]);
