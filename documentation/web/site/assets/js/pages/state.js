import "../site.js";
import { code, esc, fill, nsColor, nsTag, num, rows } from "../util.js";
import { onMap, watchQueries } from "../live.js";
import { graph, sequence } from "../diagram.js";
import { nodeShort, shortName } from "../model.js";

const chain = graph(document.getElementById("pvc-chain"));

function pvcChain(map) {
  const volumes = map.volumes;
  const h = Math.max(120, 30 + volumes.length * 80);
  const nodes = [];
  const edges = [];
  volumes.forEach((v, i) => {
    const y = 34 + i * 80;
    const id = (part) => `${part}-${i}`;
    const color = nsColor(v.namespace);
    nodes.push(
      { id: id("pod"), x: 16, y, w: 150, h: 52, title: v.pods.join(", ") || "no pod", sub: `pod · ${v.namespace}`, color },
      { id: id("pvc"), x: 230, y, w: 196, h: 52, title: v.claim, sub: `PVC · ${v.capacity} · ${v.access_modes.join(",")}`, color },
      { id: id("sc"), x: 490, y, w: 170, h: 52, title: v.storage_class || "(none)", sub: "StorageClass", color: nsColor("kube-system") },
      { id: id("pv"), x: 724, y, w: 170, h: 52, title: v.volume ? v.volume.slice(0, 15) + "…" : "not bound", sub: "PersistentVolume", color: nsColor("kube-system"), tip: v.volume },
      { id: id("dir"), x: 958, y, w: 206, h: 52, title: `${nodeShort(v.node || "?")} node`, sub: "a directory inside it", color: nsColor("outside"), dashed: true, tip: v.path },
    );
    edges.push(
      { from: id("pod"), to: id("pvc"), color, label: "claims" },
      { from: id("pvc"), to: id("sc"), color, label: "class" },
      { from: id("sc"), to: id("pv"), color: nsColor("kube-system"), label: "creates" },
      { from: id("pv"), to: id("dir"), color: nsColor("kube-system"), label: "lives on" },
    );
  });
  chain.render({ w: 1180, h, nodes, edges, label: "PersistentVolumeClaims and where their data lives" });
  fill("#pvc-caption", volumes.length
    ? volumes.map((v) => `${code(v.claim)} is the directory ${code(v.path || "?")} on ${esc(nodeShort(v.node || "?"))}, which belongs to the node container: <code>kind delete cluster</code> removes it.`).join("<br>")
    : "No PersistentVolumeClaims in the cluster right now.");
}

function volumeTable(map) {
  const system = new Set(map.system_namespaces);
  const pods = map.pods.filter((p) => !system.has(p.namespace) && p.volumes.length);
  rows("#volume-rows", pods, (p) => `<tr><td>${code(shortName(p))}</td><td>${nsTag(p.namespace)}</td>
    <td>${p.volumes.map((v) => esc(v)).join("<br>")}</td></tr>`, 3);
}

// Three requests against one ledger: inside it, overlapping its end, and beyond it with a gap.
function windowDiagram() {
  const x = (day) => 150 + day * 18;
  const bar = (y, from, to, cls, text) => `<rect x="${x(from)}" y="${y}" width="${x(to) - x(from)}" height="16" rx="3" class="${cls}"/>
    <text class="s" x="${x(to) + 8}" y="${y + 12}">${esc(text)}</text>`;
  const rowsSvg = [
    ["already synced", [bar(14, 4, 20, "led", "first_synced_date … last_synced_date")]],
    ["inside it", [bar(48, 8, 16, "req", "served from TimescaleDB, no provider call")]],
    ["past its end", [bar(82, 14, 26, "req", ""), bar(82, 20, 26, "gap", "fetch only days 20–26")]],
    ["beyond, with a gap", [bar(116, 29, 35, "req", ""), bar(116, 20, 35, "gap", "fetch 20–35: the window stays one range")]],
  ].map(([label, parts], i) => `<text class="t" x="16" y="${26 + i * 34}">${esc(label)}</text>${parts.join("")}`);
  fill("#window", `<svg class="dg win" viewBox="0 0 1100 140" role="img" aria-label="How the synced window decides what to fetch">
    <style>.win .led{fill:var(--ns-data)}.win .req{fill:none;stroke:var(--ns-apps);stroke-width:2}.win .gap{fill:var(--ns-outside);opacity:.55}</style>
    <g class="nd">${rowsSvg.join("")}</g></svg>`);
}

function cacheTiles(m) {
  const value = (name) => (m[name] && m[name].length ? Number(m[name][0].value[1]) : null);
  const tile = (label, v, unit) => `<div class="tile"><span class="k">${esc(label)}</span><span class="v">${v === null ? "–" : num(v, 0)}<small>${esc(unit)}</small></span></div>`;
  fill("#cache-tiles", [
    tile("cache hits, last 15 min", value("hit"), "requests"),
    tile("misses: never seen before", value("miss"), "requests"),
    tile("refreshes: today's bar went stale", value("refresh"), "requests"),
    tile("calls to the provider", value("provider"), "calls"),
  ].join(""));
}

sequence(document.getElementById("cache-seq"), {
  label: "A cold request through stock-app's cache-aside",
  actors: [
    { id: "b", label: "Your browser", sub: "stock-ui chart", color: nsColor("outside") },
    { id: "s", label: "stock-app", sub: "PriceHistoryService", color: nsColor("apps") },
    { id: "d", label: "TimescaleDB", sub: "instruments + price_bars", color: nsColor("data") },
    { id: "y", label: "Yahoo Finance", sub: "or recorded fixtures", color: nsColor("outside") },
  ],
  steps: [
    { from: "b", to: "s", label: "GET /api/v1/instruments/MSFT/bars?start=…&end=…" },
    { from: "s", to: "d", label: "SELECT the synced window", note: "none: a miss" },
    { from: "s", to: "y", label: "fetch instrument + daily bars", note: "only the missing range, one call" },
    { from: "y", to: "s", label: "bars for the range" },
    { from: "s", to: "d", label: "INSERT bars, UPDATE the window", note: "one transaction" },
    { from: "s", to: "d", label: "SELECT bars in the requested range" },
    { from: "s", to: "b", label: '200 {"source": "provider", "bars": [...]}', note: "next time: \"cache\"" },
  ],
});

windowDiagram();
cacheTiles({});
onMap((map) => {
  pvcChain(map);
  volumeTable(map);
});
watchQueries({
  hit: 'sum(increase(stock_cache_lookups_total{outcome="hit"}[15m]))',
  miss: 'sum(increase(stock_cache_lookups_total{outcome="miss"}[15m]))',
  refresh: 'sum(increase(stock_cache_lookups_total{outcome="refresh"}[15m]))',
  provider: "sum(increase(stock_provider_requests_total[15m]))",
}, cacheTiles, 10000);
