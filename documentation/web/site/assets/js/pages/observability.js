// Observability: live stock-app tiles, scrape targets, the scrape and trace pipelines, a waterfall and correlation.

import "../site.js";
import { code, esc, fill, nsColor, nsTag, num, rows } from "../util.js";
import { canQuery, onStatus, promLink, queryRange, watchQueries } from "../live.js";
import { graph } from "../diagram.js";
import { nodeShort } from "../model.js";

const TILES = [
  { key: "rps", label: "stock-app requests per second", unit: "req/s", promql: 'sum(rate(http_requests_total{job="stock-app"}[1m]))' },
  { key: "p95", label: "p95 latency", unit: "ms", scale: 1000, promql: 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="stock-app"}[1m])))' },
  { key: "errors", label: "5XX responses per second", unit: "/s", promql: 'sum(rate(http_responses_by_status_total{job="stock-app",status_class="5XX"}[1m])) or vector(0)' },
  { key: "hits", label: "cache hit ratio, last 15 min", unit: "%", scale: 100, promql: 'sum(increase(stock_cache_lookups_total{outcome="hit"}[15m])) / sum(increase(stock_cache_lookups_total[15m]))' },
  { key: "spans", label: "spans per second into the Collector", unit: "spans/s", promql: "sum(rate(otelcol_receiver_accepted_spans[1m]))" },
  { key: "db", label: "TimescaleDB transactions per second", unit: "tx/s", promql: 'sum(rate(pg_stat_database_xact_commit{datname="stockdata"}[1m]))' },
];

function sparkline(points) {
  if (points.length < 2) return "";
  const values = points.map(([, v]) => Number(v)).map((v) => (Number.isFinite(v) ? v : 0));
  const max = Math.max(...values, 1e-9);
  const x = (i) => (i / (values.length - 1)) * 200;
  const y = (v) => 28 - (v / max) * 26;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 200 30" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="${line} L200,30 L0,30 Z"/><path class="line" d="${line}"/></svg>`;
}

function tileHtml(tile, series) {
  const points = series && series.length ? series[0].values : [];
  const last = points.length ? Number(points[points.length - 1][1]) : null;
  const value = last === null || !Number.isFinite(last) ? "–" : num(last * (tile.scale || 1));
  return `<div class="tile"><span class="k">${esc(tile.label)}</span><span class="v">${value}<small>${esc(tile.unit)}</small></span>
    ${sparkline(points)}<details><summary>PromQL</summary><code>${esc(tile.promql)}</code>
    <a href="${esc(promLink(tile.promql))}">Open in Prometheus →</a></details></div>`;
}

async function refreshTiles() {
  if (!canQuery()) {
    fill("#tiles", TILES.map((t) => tileHtml(t, null)).join(""));
    fill("#pulse-status", "Live metrics need the running cluster behind this page.");
    return;
  }
  const results = await Promise.allSettled(TILES.map((t) => queryRange(t.promql, 15, 15)));
  // Keep an open "PromQL" disclosure open across refreshes.
  const open = new Set([...document.querySelectorAll("#tiles details[open]")].map((d) => d.closest(".tile").querySelector(".k").textContent));
  fill("#tiles", TILES.map((t, i) => tileHtml(t, results[i].status === "fulfilled" ? results[i].value : null)).join(""));
  document.querySelectorAll("#tiles .tile").forEach((el) => {
    if (open.has(el.querySelector(".k").textContent)) el.querySelector("details").open = true;
  });
  const failed = results.filter((r) => r.status === "rejected").length;
  fill("#pulse-status", failed ? `${failed} of ${TILES.length} queries failed: is Prometheus up?` : `Updated ${new Date().toLocaleTimeString()}, every 10 seconds.`);
}

function targetTable(up) {
  const series = (up || []).slice().sort((a, b) => (a.metric.job + a.metric.pod).localeCompare(b.metric.job + b.metric.pod));
  rows("#target-rows", series, (s) => `<tr><td>${code(s.metric.job)}</td><td>${s.metric.namespace ? nsTag(s.metric.namespace) : `<span class="muted">-</span>`}</td>
    <td>${esc(s.metric.pod || "-")}</td><td>${esc(s.metric.node ? nodeShort(s.metric.node) : "-")}</td><td><code>${esc(s.metric.instance)}</code></td>
    <td>${s.value[1] === "1" ? `<span class="ok">up</span>` : `<span class="bad">down</span>`}</td></tr>`, 6, up ? "No targets." : "Live targets need the running cluster.");
}

function scrapeFlow() {
  const step = (id, x, title, sub, ns) => ({ id, x, y: 40, w: 136, h: 52, title, sub, color: nsColor(ns) });
  graph(document.getElementById("scrape-flow")).render({
    w: 1100, h: 132, label: "How a Service becomes a scrape target",
    nodes: [
      step("ann", 16, "annotation", 'scrape: "true"', "apps"),
      step("api", 172, "kube-apiserver", "lists Endpoints", "kube-system"),
      step("sd", 328, "kubernetes_sd", "role: endpoints", "monitoring"),
      step("relabel", 484, "relabel", "keep · job · port", "monitoring"),
      step("scrape", 640, "scrape", "GET pod:port/path", "monitoring"),
      step("tsdb", 796, "TSDB", "in the pod", "monitoring"),
      step("grafana", 952, "Grafana", "PromQL", "monitoring"),
    ],
    edges: [["ann", "api", "kubectl apply"], ["sd", "api", "watch"], ["sd", "relabel", ""], ["relabel", "scrape", ""], ["scrape", "tsdb", "every 5 s"], ["grafana", "tsdb", "query"]]
      .map(([from, to, label]) => ({ from, to, label, color: nsColor("monitoring"), sides: from === "sd" && to === "api" ? ["l", "r"] : undefined, dashed: label === "watch", flow: label === "every 5 s" ? 0.2 : 0 })),
  });
}

function provisioning() {
  const box = (id, x, title, sub) => ({ id, x, y: 28, w: 200, h: 52, title, sub, color: nsColor("monitoring") });
  graph(document.getElementById("provisioning")).render({
    w: 1000, h: 108, label: "How Grafana gets its dashboards",
    nodes: [box("git", 16, "Files in Git", "dashboards/*.json · datasources.yaml"), box("cm", 272, "ConfigMaps", "kustomize configMapGenerator"),
      box("mount", 528, "Volumes in the pod", "/etc/grafana/provisioning"), box("grafana", 784, "Grafana", "loads them on every start")],
    edges: [["git", "cm", "kubectl apply -k"], ["cm", "mount", "mounted"], ["mount", "grafana", "provisioned"]]
      .map(([from, to, label]) => ({ from, to, label, color: nsColor("monitoring") })),
  });
}

function waterfall() {
  const spans = [
    ["GET /api/v1/instruments/{symbol}/bars", 0, 1440, "stock-app handles the request", 0],
    ["SELECT instruments", 2, 1, "is MSFT stored? no", 1],
    ["yahoo fetch_instrument", 5, 1083, "ask Yahoo who MSFT is", 1],
    ["yahoo fetch_daily_bars", 1092, 314, "ask Yahoo for the prices", 1],
    ["INSERT price_bars", 1410, 19, "store them in TimescaleDB", 1],
  ];
  const x0 = 300;
  const width = 520;
  const scale = width / 1440;
  const bars = spans.map(([name, start, ms, why, depth], i) => {
    const y = 20 + i * 34;
    const color = name.startsWith("yahoo") ? "var(--ns-outside)" : name.startsWith("GET") ? "var(--ns-apps)" : "var(--ns-data)";
    return `<text class="t" x="${16 + depth * 16}" y="${y + 13}">${esc(name)}</text>
      <rect x="${x0 + start * scale}" y="${y}" width="${Math.max(2, ms * scale)}" height="18" rx="3" fill="${color}"/>
      <text class="s" x="${x0 + (start + ms) * scale + 8}" y="${y + 13}">${ms} ms · ${esc(why)}</text>`;
  });
  fill("#waterfall", `<svg class="dg wf" viewBox="0 0 1100 196" role="img" aria-label="Trace waterfall of a cold stock-app request">
    <g class="nd">${bars.join("")}</g></svg>`);
}

const traceView = graph(document.getElementById("trace-flow"));

function traceFlow(m) {
  const rate = (name) => (m[name] && m[name].length ? Number(m[name][0].value[1]) : 0);
  const label = (name, unit) => (m[name] ? `${num(rate(name))} ${unit}` : unit);
  const stage = (id, x, title, sub) => ({ id, x, y: 92, w: 148, h: 52, title, sub, color: nsColor("monitoring") });
  traceView.render({
    w: 1110, h: 300, label: "The trace pipeline with live span rates",
    groups: [{ x: 242, y: 52, w: 672, h: 120, label: "otel-collector · monitoring", color: nsColor("monitoring") }],
    nodes: [
      { id: "app", x: 16, y: 92, w: 150, h: 52, title: "stock-app", sub: "OpenTelemetry SDK", color: nsColor("apps") },
      stage("recv", 258, "otlp", "receiver :4318"),
      stage("mem", 422, "memory_limiter", "processor"),
      stage("k8s", 586, "k8s_attributes", "processor"),
      stage("exp", 750, "otlp_http", "exporter"),
      { id: "tempo", x: 990, y: 92, w: 104, h: 52, title: "Tempo", sub: "stores", color: nsColor("monitoring") },
      { id: "grafana", x: 990, y: 224, w: 104, h: 52, title: "Grafana", sub: "shows", color: nsColor("monitoring") },
      { id: "api", x: 560, y: 224, w: 200, h: 52, title: "kube-apiserver", sub: "pods in apps (a Role)", color: nsColor("kube-system") },
    ],
    edges: [
      { from: "app", to: "recv", color: nsColor("apps"), label: label("spansIn", "spans/s"), flow: rate("spansIn"), hot: rate("spansIn") > 0 },
      { from: "recv", to: "mem", color: nsColor("monitoring") },
      { from: "mem", to: "k8s", color: nsColor("monitoring") },
      { from: "k8s", to: "exp", color: nsColor("monitoring") },
      { from: "exp", to: "tempo", color: nsColor("monitoring"), label: label("spansOut", "spans/s"), flow: rate("spansOut"), hot: rate("spansOut") > 0 },
      { from: "grafana", to: "tempo", color: nsColor("monitoring"), label: "TraceQL", sides: ["t", "b"] },
      { from: "k8s", to: "api", color: nsColor("kube-system"), dashed: true, label: "who is 10.244.x.y?", sides: ["b", "t"] },
    ],
  });
}

function correlation() {
  const box = (id, x, title, sub, ns) => ({ id, x, y: 40, w: 250, h: 52, title, sub, color: nsColor(ns) });
  graph(document.getElementById("correlation")).render({
    w: 1000, h: 132, label: "Metrics, traces and logs share the trace ID",
    nodes: [box("metric", 16, "p95 latency, a dot", "Prometheus: exemplar trace_id", "monitoring"),
      box("trace", 375, "the trace", "Tempo: every span, timed", "monitoring"),
      box("log", 734, "the log lines", "stdout: trace_id=4bf9…", "apps")],
    edges: [{ from: "metric", to: "trace", color: nsColor("monitoring"), label: "click the exemplar" },
      { from: "log", to: "trace", color: nsColor("apps"), label: "search by ID" }],
  });
}

scrapeFlow();
provisioning();
waterfall();
correlation();
traceFlow({});
watchQueries({ up: "up", spansIn: "sum(rate(otelcol_receiver_accepted_spans[1m]))", spansOut: "sum(rate(otelcol_exporter_sent_spans[1m]))" }, (m, error) => {
  targetTable(m.up);
  traceFlow(m);
  if (error) fill("#pulse-status", esc(error));
});
let tiles = false;
onStatus((status) => {
  if (tiles || status.source === "loading") return;
  tiles = true;
  refreshTiles();
  setInterval(refreshTiles, 10000);
});
