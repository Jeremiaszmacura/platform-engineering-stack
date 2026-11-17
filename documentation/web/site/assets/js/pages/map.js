// Cluster map: nodes as columns, pods as chips, wires to whoever a pod talks to, and an inspector.

import "../site.js";
import { $, $$, esc, fill, nsColor, rows } from "../util.js";
import { onMap } from "../live.js";
import { isNodeAgent, nodeShort, servicesOf, shortName } from "../model.js";
import { APPS, componentHref } from "../catalog.js";

const state = { map: null, selected: null, seen: null, started: false };

const row = (label, value) => (value && value.length ? `<dt>${label}</dt><dd>${Array.isArray(value) ? value.map(esc).join("<br>") : esc(value)}</dd>` : "");
const domId = (pod) => `chip-${pod.id.replace(/[^a-z0-9-]/gi, "-")}`;
const podById = (id) => state.map.pods.find((p) => p.id === id);

function legend(map) {
  const system = new Set(map.system_namespaces);
  const namespaces = [...new Set(map.pods.map((p) => p.namespace).filter((ns) => !system.has(ns)))].sort();
  fill("#legend", ["envoy-gateway-system", ...namespaces].map((ns) => `<span><i style="--c:${nsColor(ns)}"></i>${esc(ns)}</span>`).join("")
    + `<span><i style="--c:var(--ns-system)"></i>kube-system and other system namespaces</span>`);
}

function chip(pod, fresh) {
  const classes = ["chip", pod.host_network && "hostnet", pod.phase === "Succeeded" && "done",
    pod.phase === "Running" && !pod.ready && "unready", fresh && "fresh"].filter(Boolean).join(" ");
  return `<button class="${classes}" id="${domId(pod)}" data-id="${esc(pod.id)}" style="--c:${nsColor(pod.namespace)}" aria-pressed="false" type="button">
    ${esc(shortName(pod))}<span class="sub">${esc(pod.ip || pod.phase)}${pod.restarts ? ` · ${pod.restarts}↻` : ""}</span></button>`;
}

function nodesHtml(map, freshIds) {
  const system = new Set(map.system_namespaces);
  const order = (p) => [system.has(p.namespace) ? 0 : 1, p.namespace, shortName(p)].join("/");
  const drawn = map.pods.filter((p) => !isNodeAgent(p)).sort((a, b) => order(a).localeCompare(order(b)));
  const entry = map.nodes.find((n) => n.roles.includes("control-plane"));
  return map.nodes.map((n) => `<div class="node">
    <header><h3>${esc(nodeShort(n.name))}</h3><span class="mono">${esc(n.ip)} · pods ${esc(n.pod_cidr)}</span>
      ${n.taints.length ? `<span class="mono">taint ${esc(n.taints.join(", "))}</span>` : ""}
      ${entry && n.name === entry.name ? `<span class="mono">host :80 lands here (Docker port mapping)</span>` : ""}</header>
    <div class="chips">${drawn.filter((p) => p.node === n.name).map((p) => chip(p, freshIds.has(p.id))).join("")}</div>
    <div class="sys-row">${esc(n.agents.join(" · ") || "no node agents")}</div></div>`).join("");
}

function hostbar(map) {
  const proxy = map.services.find((s) => map.gateways.some((g) => g.proxy_service === s.id));
  const entry = map.nodes.find((n) => n.roles.includes("control-plane"));
  fill("#hostbar-port", entry && proxy && proxy.node_ports.length
    ? `Docker publishes :80 → ${esc(nodeShort(entry.name))} container :${esc(proxy.node_ports[0])} (NodePort of ${esc(proxy.name)})`
    : "No Gateway proxy Service with a NodePort found");
}

function inspector(id) {
  const map = state.map;
  const p = podById(id);
  const outs = map.links.filter((l) => l.source === id);
  const ins = map.links.filter((l) => l.target === id);
  const account = map.service_accounts.find((a) => a.name === p.service_account && a.namespace === p.namespace);
  const services = servicesOf(map, [p]);
  const links = (title, items, key) => (items.length ? `<div class="links"><span class="eyebrow">${title}</span>${items.map((l) => {
    const other = podById(l[key]);
    return `<div><b class="mono">${esc(other ? shortName(other) : l[key])}</b><br>${esc(l.label)}</div>`;
  }).join("")}</div>` : "");
  const note = APPS[p.app] && APPS[p.app].note;
  fill("#inspector", `<div><span class="ns" style="--c:${nsColor(p.namespace)}">${esc(p.namespace)}</span><h3>${esc(shortName(p))}</h3>
      <span class="eyebrow">${esc(p.owner)} · ${esc(p.phase)}${p.phase === "Running" ? (p.ready ? " · ready" : " · not ready") : ""}</span></div>
    <dl>${row("Pod", p.name)}${row("Pod IP", p.ip + (p.host_network ? " (host network)" : ""))}${row("Node", nodeShort(p.node))}
      ${row("Restarts", p.restarts ? String(p.restarts) : "")}
      ${row("Service", services.map((s) => `${s.name} ${s.cluster_ip} ${s.ports.join(", ")}`))}
      ${row("Hostnames", services.flatMap((s) => s.hostnames.map((h) => h + (s.cors ? " (CORS)" : ""))))}
      ${row("Identity", `${p.service_account} (${p.token_mounted ? "API token mounted" : "no API token"})`)}
      ${row("RBAC", account ? account.permissions : [])}
      ${row("Secrets", p.secrets)}${row("ConfigMaps", p.config_maps)}${row("Volumes", p.volumes)}${row("Probes", p.probes)}
      ${row("Images", p.images)}</dl>
    ${links("Calls", outs, "target")}${links("Called by", ins, "source")}
    ${note ? `<p class="note">${esc(note)}</p>` : ""}
    ${componentHref(p.app, p.namespace) && APPS[p.app] ? `<p><a href="${componentHref(p.app, p.namespace)}">All about ${esc(p.app)} →</a></p>` : ""}`);
}

function wires(id) {
  const svg = $("#wires");
  const box = $("#map-canvas").getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  if (!id) return (svg.innerHTML = "");
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
  };
  const chipOf = (podId) => document.getElementById(domId({ id: podId }));
  const line = (from, to, dashed) => {
    const a = chipOf(from);
    const b = chipOf(to);
    if (!a || !b || a === b) return "";
    const p1 = center(a);
    const p2 = center(b);
    const color = getComputedStyle(a).getPropertyValue("--c").trim();
    const mid = { x: (p1.x + p2.x) / 2, y: Math.min(p1.y, p2.y) - 30 };
    return `<path d="M${p1.x},${p1.y} Q${mid.x},${mid.y} ${p2.x},${p2.y}" fill="none" stroke="${color}" stroke-width="1.8"
      ${dashed ? 'stroke-dasharray="5 4"' : ""} stroke-linecap="round" opacity="0.85"/><circle cx="${p2.x}" cy="${p2.y}" r="3.5" fill="${color}"/>`;
  };
  svg.innerHTML = state.map.links.filter((l) => l.source === id).map((l) => line(id, l.target, false)).join("")
    + state.map.links.filter((l) => l.target === id).map((l) => line(l.source, id, true)).join("");
}

function select(id) {
  state.selected = id && podById(id) ? id : null;
  const canvas = $("#map-canvas");
  $$(".chip").forEach((c) => {
    c.classList.remove("lit");
    c.setAttribute("aria-pressed", "false");
  });
  if (!state.selected) {
    canvas.classList.remove("focus");
    fill("#inspector", `<p class="note">Select a pod. Start with <b>shared-gateway-proxy</b> to see every route into the
      cluster, or <b>documentation</b> to see this site's own identity and the API it reads.</p>`);
    return wires(null);
  }
  const near = new Set([state.selected]);
  state.map.links.forEach((l) => {
    if (l.source === state.selected) near.add(l.target);
    if (l.target === state.selected) near.add(l.source);
  });
  canvas.classList.add("focus");
  near.forEach((podId) => document.getElementById(domId({ id: podId }))?.classList.add("lit"));
  document.getElementById(domId({ id: state.selected }))?.setAttribute("aria-pressed", "true");
  inspector(state.selected);
  wires(state.selected);
}

function nodeTable(map) {
  const system = new Set(map.system_namespaces);
  rows("#node-rows", map.nodes, (n) => `<tr><td>${esc(nodeShort(n.name))}</td><td>${esc(n.roles.join(", ") || "worker")}</td>
    <td><code>${esc(n.ip)}</code></td><td><code>${esc(n.pod_cidr)}</code></td>
    <td class="num">${map.pods.filter((p) => p.node === n.name && !system.has(p.namespace) && p.phase === "Running").length}</td>
    <td>${n.taints.length ? n.taints.map(esc).join("<br>") : `<span class="muted">none</span>`}</td></tr>`, 6);
  const volume = map.volumes.find((v) => v.pods.some((p) => p.startsWith("timescaledb")));
  if (volume && volume.node) fill("#db-node", `<b>${esc(nodeShort(volume.node))}</b>`);
}

function render(map) {
  state.map = map;
  const ids = new Set(map.pods.map((p) => p.id));
  const fresh = state.seen ? new Set([...ids].filter((id) => !state.seen.has(id))) : new Set();
  state.seen = ids;
  const running = map.pods.filter((p) => p.phase === "Running");
  fill("#facts", [["nodes", map.nodes.length], ["pods", map.pods.length], ["running", running.length],
    ["not ready", running.filter((p) => !p.ready).length], ["restarts", map.pods.reduce((s, p) => s + (p.restarts || 0), 0)]]
    .map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join(""));
  legend(map);
  hostbar(map);
  fill("#nodes", nodesHtml(map, fresh));
  nodeTable(map);
  if (!state.started) {
    state.started = true;
    const proxy = map.pods.find((p) => map.gateways.some((g) => g.proxy_pods.includes(p.id)));
    state.selected = proxy ? proxy.id : null;
  }
  select(state.selected);
}

$("#nodes").addEventListener("click", (ev) => {
  const target = ev.target.closest(".chip");
  if (target) select(state.selected === target.dataset.id ? null : target.dataset.id);
});
let resizeTimer;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.map && select(state.selected), 120);
});
onMap(render);
