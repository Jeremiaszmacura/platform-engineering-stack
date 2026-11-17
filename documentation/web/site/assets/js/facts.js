// A component's live facts as definition-list rows: pods, Service, DNS, route, identity, config, metrics, links.

import { appLinks, nodeShort, podsOf, servicesOf } from "./model.js";
import { code, esc } from "./util.js";

const row = (label, html) => (html ? `<dt>${esc(label)}</dt><dd>${html}</dd>` : "");
const list = (items) => items.map(esc).join("<br>");
const unique = (items) => [...new Set(items)];

function podLine(p) {
  const ready = p.phase === "Succeeded" ? "completed" : p.ready ? "ready" : `<span class="warn">not ready</span>`;
  const restarts = p.restarts ? ` · <span class="warn">${p.restarts} restarts</span>` : "";
  return `${code(p.name)} on ${esc(nodeShort(p.node))} · ${esc(p.ip || p.phase)} · ${ready}${restarts}`;
}

function serviceLines(services) {
  return services.map((s) => `${code(s.name)} ${esc(s.type)} ${esc(s.cluster_ip)} · ${s.ports.map(esc).join(", ")}`).join("<br>");
}

function hostLines(services) {
  return services.flatMap((s) => s.hostnames.map((h) => `<a href="http://${esc(h)}">${esc(h)}</a>${s.cors ? " (CORS filter)" : ""}`)).join("<br>");
}

function identity(map, pods) {
  const p = pods[0];
  const account = map.service_accounts.find((a) => a.name === p.service_account && a.namespace === p.namespace);
  const token = p.token_mounted ? `<span class="warn">API token mounted</span>` : "no API token";
  const perms = account && account.permissions.length ? `<br>${list(account.permissions)}` : "";
  return `${code(p.service_account)} · ${token}${perms}`;
}

function metrics(services, up) {
  return services.filter((s) => s.scraped).map((s) => {
    const series = up ? up.filter((u) => u.metric.job === s.job) : [];
    const state = !series.length ? "" : series.every((u) => u.value[1] === "1") ? ` · <span class="ok">up</span>` : ` · <span class="bad">down</span>`;
    return `job ${code(s.job)} · :${esc(s.metrics_port)}${esc(s.metrics_path)}${state}`;
  }).join("<br>");
}

function connections(map, app, direction) {
  const mine = appLinks(map).filter((l) => (direction === "out" ? l.from === app : l.to === app));
  return mine.map((l) => `${code(direction === "out" ? l.to : l.from)} ${esc(l.kind)}: ${esc(l.labels[0])}${l.labels.length > 1 ? ` (+${l.labels.length - 1})` : ""}`).join("<br>");
}

/** Rows for a <dl> describing app; full adds images, config, volumes and probes. up is Prometheus' `up` result. */
export function specRows(map, app, { full = false, up = null } = {}) {
  const pods = podsOf(map, app);
  if (!pods.length) return row("Status", "No pods with this app label are running.");
  const services = servicesOf(map, pods);
  const all = (key) => unique(pods.flatMap((p) => p[key] || []));
  return [
    row("Namespace", esc(pods[0].namespace)),
    row("Controller", esc(pods[0].owner)),
    row("Pods", pods.map(podLine).join("<br>")),
    full ? row("Images", list(all("images"))) : "",
    row("Service", serviceLines(services)),
    row("DNS name", list(services.map((s) => s.dns))),
    row("Hostname", hostLines(services)),
    row("Identity", identity(map, pods)),
    full ? row("Secrets", list(all("secrets"))) : "",
    full ? row("ConfigMaps", list(all("config_maps"))) : "",
    full ? row("Volumes", list(all("volumes"))) : "",
    full ? row("Probes", list(all("probes"))) : "",
    row("Metrics", metrics(services, up)),
    row("Calls", connections(map, app, "out")),
    row("Called by", connections(map, app, "in")),
  ].join("");
}
