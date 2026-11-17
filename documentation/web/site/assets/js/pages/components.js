import "../site.js";
import { $$, esc, nsColor } from "../util.js";
import { onMap, watchQueries } from "../live.js";
import { graph } from "../diagram.js";
import { health, podsOf } from "../model.js";
import { specRows } from "../facts.js";

const state = { map: null, up: null };

function sheets() {
  if (!state.map) return;
  for (const dl of $$("dl.spec[data-app]")) {
    dl.innerHTML = `<dt>app</dt><dd><code>${esc(dl.dataset.app)}</code></dd>${specRows(state.map, dl.dataset.app, { full: true, up: state.up })}`;
  }
  for (const section of $$("section.chapter[id]")) {
    const h = health(podsOf(state.map, section.id));
    const title = section.querySelector("h2");
    title.querySelector(".badge")?.remove();
    if (h.total || h.done) {
      title.insertAdjacentHTML("beforeend", ` <span class="badge ${h.state}"><i></i>${h.total ? `${h.ready}/${h.total} ready` : "completed"}</span>`);
    }
  }
}

const layer = (id, x, y, title, sub) => ({ id, x, y, w: 210, h: 52, title, sub, color: nsColor("apps") });

graph(document.getElementById("hexagon")).render({
  w: 1000, h: 300, label: "stock-app's hexagonal architecture",
  groups: [
    { x: 16, y: 16, w: 230, h: 268, label: "inbound adapters", color: nsColor("apps") },
    { x: 262, y: 16, w: 230, h: 268, label: "application", color: nsColor("apps") },
    { x: 508, y: 16, w: 230, h: 268, label: "domain", color: nsColor("apps") },
    { x: 754, y: 16, w: 230, h: 268, label: "outbound adapters", color: nsColor("apps") },
  ],
  nodes: [
    layer("http", 26, 124, "HTTP routes", "FastAPI · generated models"),
    layer("service", 272, 70, "PriceHistoryService", "application/price_history.py"),
    layer("ports", 272, 180, "ports", "typing.Protocol, no imports out"),
    layer("domain", 518, 124, "models, errors", "pure Python, no I/O"),
    layer("repo", 764, 48, "TimescaleDB repository", "adapters/persistence"),
    layer("provider", 764, 124, "Yahoo · synthetic", "adapters/providers, traced"),
    layer("vault", 764, 200, "Vault secret store", "adapters/secrets · hvac"),
  ],
  // Arrows are imports. Outbound adapters satisfy the ports structurally (Protocols), so they never import them.
  edges: [
    ["http", "service", "calls"], ["http", "ports", ""], ["service", "ports", "uses"], ["service", "domain", ""], ["ports", "domain", ""],
    ["repo", "domain", ""], ["provider", "domain", "imports"], ["vault", "domain", ""],
  ].map(([from, to, label]) => ({ from, to, label, color: nsColor("apps") })),
});

onMap((map) => {
  state.map = map;
  sheets();
});
watchQueries({ up: "up" }, (m) => {
  state.up = m.up || null;
  sheets();
}, 10000);
