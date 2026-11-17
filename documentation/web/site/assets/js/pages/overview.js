import "../site.js";
import { $, esc, fill, nsColor, num, plural } from "../util.js";
import { onMap, watchQueries } from "../live.js";
import { graph } from "../diagram.js";
import { architecture, LAYERS, TRAFFIC_QUERIES, unplaced } from "../architecture.js";
import { brokenRoutes, components } from "../model.js";
import { specRows } from "../facts.js";
import { APPS, componentHref } from "../catalog.js";

const state = { map: null, metrics: {}, layer: "requests", selected: null };
const view = graph($("#arch"), (id) => {
  state.selected = id;
  draw();
});

const OUTSIDE = {
  browser: `<h3>Your browser</h3><p><code>*.localhost</code> resolves to <code>127.0.0.1</code>. Docker publishes host port 80 to
    the control-plane node's NodePort 30080, where kube-proxy hands the connection to the Envoy proxy. The JavaScript of
    stock-ui and traffic-generator runs here too, so their calls to <code>stock.localhost</code> come from your browser,
    not from their pods.</p><p><a href="networking.html#north-south">Follow it packet by packet →</a></p>`,
  yahoo: `<h3>Yahoo Finance</h3><p>stock-app asks it only for dates it has never stored. The call leaves the pod, is
    NATed to the node's IP and then by Docker to your machine's. With <code>STOCK_PROVIDER=fixture</code> stock-app replays
    recorded prices instead, which is what CI does.</p><p><a href="state.html#cache-aside">How the cache works →</a></p>`,
};

const HINT = `<p class="note">Select a box. Start with <b>stock-app</b> to see every connection a backend needs, or with
  <b>documentation</b> to see this site's own identity.</p>`;

function inspector() {
  const id = state.selected;
  if (!id) return fill("#arch-inspector", HINT);
  if (OUTSIDE[id]) return fill("#arch-inspector", OUTSIDE[id]);
  const info = APPS[id] || {};
  const pod = state.map.pods.find((p) => p.app === id);
  const href = componentHref(id, pod ? pod.namespace : "");
  fill("#arch-inspector", `<div><span class="eyebrow">${esc(info.purpose || "workload")}</span><h3>${esc(id)}</h3></div>
    <dl>${specRows(state.map, id, { up: state.metrics.up })}</dl>
    ${info.note ? `<p class="note">${esc(info.note)}</p>` : ""}
    ${href ? `<p><a href="${href}">All about ${esc(id)} →</a></p>` : ""}`);
}

function facts() {
  const { map, metrics } = state;
  const pods = map.pods.filter((p) => p.phase === "Running");
  const ready = pods.filter((p) => p.ready).length;
  const up = metrics.up ? `${metrics.up.filter((s) => s.value[1] === "1").length}/${metrics.up.length}` : "–";
  const rps = metrics.stockRps ? num(metrics.stockRps.length ? Number(metrics.stockRps[0].value[1]) : 0) : "–";
  fill("#facts", [
    ["cluster", map.context || "?"], ["Kubernetes", map.version], ["nodes", map.nodes.length],
    ["pods ready", `${ready}/${pods.length}`], ["routes accepted", `${map.routes.length - brokenRoutes(map).length}/${map.routes.length}`],
    ["scrape targets up", up], ["stock-app req/s", rps],
  ].map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join(""));
}

function extras() {
  const extra = unplaced(state.map);
  fill("#arch-extra", `Drawn from the live map (${esc(LAYERS[state.layer])} layer).` + (extra.length
    ? ` Also running, without a place in this drawing yet: ${extra.map((a) => `<a href="${componentHref(a)}">${esc(a)}</a>`).join(", ")}.`
    : ""));
}

function catalog() {
  fill("#catalog", components(state.map).map((c) => {
    const badge = c.health.total ? `<span class="badge ${c.health.state}"><i></i>${c.health.ready}/${c.health.total}</span>` : `<span class="badge ok"><i></i>done</span>`;
    return `<a class="comp" href="${componentHref(c.app)}" style="--c:${nsColor(c.namespace)}">
      <span class="top"><b>${esc(c.app)}</b>${badge}</span>
      <p>${esc((APPS[c.app] || {}).purpose || "A workload this guide doesn't describe yet.")}</p>
      <span class="ns" style="--c:${nsColor(c.namespace)}">${esc(c.namespace)} · ${esc(c.owner)} · ${plural(c.pods.length, "pod")}</span>
      ${c.hostnames.map((h) => `<span class="host">${esc(h)}</span>`).join("")}</a>`;
  }).join(""));
}

function draw() {
  if (!state.map) return;
  view.render(architecture(state.map, state.metrics, state.layer, state.selected));
  inspector();
  facts();
  extras();
}

fill("#layers", Object.entries(LAYERS).map(([id, label]) => `<button type="button" data-layer="${id}" aria-pressed="${id === state.layer}">${esc(label)}</button>`).join(""));
$("#layers").addEventListener("click", (ev) => {
  const button = ev.target.closest("[data-layer]");
  if (!button) return;
  state.layer = button.dataset.layer;
  $("#layers").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
  draw();
});

onMap((map) => {
  state.map = map;
  draw();
  catalog();
});
watchQueries(TRAFFIC_QUERIES, (results) => {
  state.metrics = results;
  draw();
});
