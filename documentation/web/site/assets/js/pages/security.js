import "../site.js";
import { code, esc, fill, mark, nsColor, nsTag, rows } from "../util.js";
import { onMap } from "../live.js";
import { graph, sequence } from "../diagram.js";
import { restricted, shortName } from "../model.js";

const rbac = graph(document.getElementById("rbac"));
const GRANT = /^(ClusterRole|Role) (\S+) \(([^)]+)\): (.*)$/;

// Every grant an identity has, parsed from the map's readable permission strings.
function grants(account) {
  return account.permissions.map((text) => {
    const [, kind, name, where, rules] = text.match(GRANT) || [null, "Role", text, "", ""];
    return { id: `${kind}/${where}/${name}`, kind, name, where, rules };
  });
}

function rbacDiagram(map) {
  const holders = map.service_accounts.filter((a) => a.token_mounted || a.permissions.length);
  const others = map.service_accounts.filter((a) => !holders.includes(a));
  const unique = new Map();
  holders.forEach((a) => grants(a).forEach((g) => unique.set(g.id, g)));
  const list = [...unique.values()];
  const rowY = (i) => 44 + i * 64;
  const h = Math.max(240, rowY(list.length) + (others.length ? 76 : 8));
  const nodes = [{ id: "api", x: 776, y: (h - 52) / 2, w: 200, h: 52, title: "kube-apiserver", sub: "authn: token · authz: RBAC", color: nsColor("kube-system") }];
  const edges = [];
  list.forEach((g, i) => {
    nodes.push({ id: g.id, x: 344, y: rowY(i), w: 300, h: 52, title: `${g.kind} ${g.name}`, sub: g.where, color: nsColor("kube-system"), tip: g.rules });
    edges.push({ from: g.id, to: "api", color: nsColor("kube-system"), label: g.rules.length > 26 ? g.rules.slice(0, 25) + "…" : g.rules, tip: g.rules, sides: ["r", "l"], lt: 0.1 });
  });
  holders.forEach((a) => {
    const mine = grants(a).map((g) => list.findIndex((x) => x.id === g.id));
    const y = mine.length ? mine.reduce((sum, i) => sum + rowY(i), 0) / mine.length : rowY(0);
    nodes.push({ id: `sa-${a.namespace}/${a.name}`, x: 32, y, w: 220, h: 52, title: a.name, sub: `${a.namespace} · ${a.token_mounted ? "token mounted" : "no token"}`, color: nsColor(a.namespace), status: a.token_mounted ? "warn" : "ok" });
    mine.forEach((i) => edges.push({ from: `sa-${a.namespace}/${a.name}`, to: list[i].id, color: nsColor(a.namespace), sides: ["r", "l"] }));
  });
  if (others.length) {
    nodes.push({ id: "others", x: 32, y: h - 68, w: 612, h: 52, title: `${others.length} more ServiceAccounts: no token, no permissions`, sub: others.map((a) => a.name).join(", "), color: nsColor("apps"), dashed: true, status: "ok" });
  }
  rbac.render({ w: 1000, h, nodes, edges, label: "Which ServiceAccounts may call the Kubernetes API" });
}

function accountTable(map) {
  const shortOf = (name, ns) => {
    const pod = map.pods.find((p) => p.name === name && p.namespace === ns);
    return pod ? shortName(pod) : name;
  };
  rows("#sa-rows", map.service_accounts, (a) => `<tr><td>${code(a.name)}</td><td>${nsTag(a.namespace)}</td>
    <td>${[...new Set(a.used_by.map((n) => shortOf(n, a.namespace)))].map(esc).join(", ")}</td><td>${code(a.automount)}</td>
    <td>${a.token_mounted ? `<span class="warn">mounted</span>` : `<span class="muted">none</span>`}</td>
    <td>${a.permissions.length ? a.permissions.map(esc).join("<br>") : `<span class="muted">none</span>`}</td></tr>`, 6);
}

function configTable(map) {
  rows("#config-rows", map.config, (c) => {
    const users = map.pods.filter((p) => p.namespace === c.namespace && c.used_by.includes(p.name));
    const how = [...new Set(users.flatMap((p) => (c.kind === "Secret" ? p.secrets : p.config_maps).filter((r) => r.split(" → ")[0].split("/")[0] === c.name)))];
    return `<tr><td>${code(c.name)}${c.kind === "ConfigMap" ? " <small class=\"muted\">ConfigMap</small>" : ""}</td><td>${nsTag(c.namespace)}</td>
      <td>${c.keys.map(code).join(" ")}</td><td>${[...new Set(users.map(shortName))].map(esc).join(", ")}</td><td>${how.map(esc).join("<br>")}</td></tr>`;
  }, 5);
}

function hardeningTable(map) {
  const shown = map.pods.filter((p) => !map.system_namespaces.includes(p.namespace) || p.namespace === "envoy-gateway-system")
    .sort((a, b) => Number(restricted(b)) - Number(restricted(a)) || a.namespace.localeCompare(b.namespace));
  rows("#hardening-rows", shown, (p) => {
    const h = p.hardening;
    const host = h.host_access.length ? `<span class="mark n">✗ ${esc(h.host_access.join(", "))}</span>` : `<span class="mark y">✓ none</span>`;
    const caps = h.added_capabilities.length ? `<br><small class="warn">adds ${esc(h.added_capabilities.join(", "))}</small>` : "";
    return `<tr><td>${code(shortName(p))}</td><td>${nsTag(p.namespace)}</td><td>${mark(h.non_root)}</td><td>${mark(h.no_privilege_escalation)}</td>
      <td>${mark(h.drops_all_capabilities)}${caps}</td><td>${mark(h.seccomp, "set", "unset")}</td><td>${host}</td>
      <td>${mark(h.read_only_root)}</td><td>${mark(h.limits)}</td><td>${mark(restricted(p), "passes", "fails")}</td></tr>`;
  }, 10);
  return shown;
}

function checks(map, pods) {
  const failing = pods.filter((p) => !restricted(p));
  const pss = document.getElementById("pss-check");
  pss.className = `finding ${failing.length ? "live-bad" : "live-ok"}`;
  pss.innerHTML = `<span class="sev">Live · pod security</span><h3>${failing.length} of ${pods.length} pods would fail the restricted profile</h3>
    <p>${failing.length ? failing.map((p) => code(shortName(p))).join(" ") : "Every pod passes."}</p>
    <p class="fix">Exercise: add <code>seccompProfile: {type: RuntimeDefault}</code> where it's missing, then enforce
      <code>restricted</code> on <code>apps</code> and <code>docs</code> with the namespace label, and <code>warn</code> on the rest.</p>`;
  const holders = map.service_accounts.filter((a) => a.token_mounted);
  const token = document.getElementById("token-check");
  token.className = "finding live-ok";
  token.innerHTML = `<span class="sev">Live · API tokens</span><h3>${holders.length} workload identities hold an API token</h3>
    <p>${holders.map((a) => code(`${a.namespace}/${a.name}`)).join(" ")}: each calls the API for a reason (service discovery,
      span metadata, this site, Vault's token checks and unseal key). Apart from Vault, which keeps its unseal key in a
      Secret, none may read Secrets or change anything.</p>
    <p class="fix">Exercise: list what each may do with <code>kubectl auth can-i --list --as=system:serviceaccount:&lt;ns&gt;:&lt;name&gt;</code>
      and remove a verb; see what breaks.</p>`;
  const netpol = document.getElementById("netpol-check");
  const policies = map.network_policies;
  netpol.className = `finding ${policies.length ? "live-ok" : "live-bad"}`;
  netpol.innerHTML = policies.length
    ? `<span class="sev">Live · network</span><h3>${policies.length} NetworkPolicies apply</h3><p>${policies.map(code).join(" ")}</p>
       <p class="fix"><code>kubectl describe networkpolicy -A</code> shows which pods each selects.</p>`
    : `<span class="sev">Live · network</span><h3>No NetworkPolicies: every pod can reach every pod</h3>
       <p>stock-ui, traffic-generator or this site could open <code>timescaledb-service.data:5432</code> or Vault. Apply the
       policy below and this card counts it within 5 seconds.</p>`;
  fill("#facts", [["ServiceAccounts with a token", `${holders.length}/${map.service_accounts.length}`],
    ["pods passing restricted", `${pods.length - failing.length}/${pods.length}`], ["NetworkPolicies", policies.length]]
    .map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join(""));
}

const actor = (id, label, sub, ns) => ({ id, label, sub, color: nsColor(ns) });

sequence(document.getElementById("informer-seq"), {
  label: "How the documentation service watches the API",
  actors: [actor("b", "Your browser", "this page", "outside"), actor("d", "documentation", "informer cache", "docs"), actor("a", "kube-apiserver", "RBAC: ClusterRole documentation", "kube-system")],
  steps: [
    { from: "d", to: "a", label: "LIST pods (and 12 more kinds)", note: "once, at start-up · Authorization: Bearer <ServiceAccount token>" },
    { from: "a", to: "d", label: "every pod + resourceVersion" },
    { from: "d", to: "a", label: "WATCH pods?resourceVersion=…", note: "one long-lived connection per kind" },
    { from: "a", to: "d", label: "ADDED · MODIFIED · DELETED events", note: "the cache follows the cluster within about a second", dashed: true },
    { from: "b", to: "d", label: "GET /api/map", note: "every 5 s, through the Gateway" },
    { from: "d", to: "a", label: "GET 2 ConfigMaps", note: "kube-proxy, prometheus-config · each request" },
    { from: "d", to: "d", label: "build the map from the cache", note: "no LIST per page view" },
    { from: "d", to: "b", label: "200 map JSON" },
  ],
});

sequence(document.getElementById("vault-seq"), {
  label: "How stock-app signs in to Vault with its ServiceAccount",
  width: 960,
  actors: [actor("u", "You", "curl", "outside"), actor("s", "stock-app", "ServiceAccount apps/stock-app", "apps"),
    actor("v", "Vault", "kubernetes auth method", "vault"), actor("a", "kube-apiserver", "TokenReview API", "kube-system")],
  steps: [
    { from: "u", to: "s", label: 'POST /secret {"key":"demo","value":"x"}' },
    { from: "s", to: "v", label: "POST /v1/auth/kubernetes/login", note: "role stock-app + the pod's token (audience vault)" },
    { from: "v", to: "a", label: "TokenReview: is this token genuine?", note: "with Vault's own token: system:auth-delegator" },
    { from: "a", to: "v", label: "yes: system:serviceaccount:apps:stock-app" },
    { from: "v", to: "s", label: "Vault token, TTL 1 h", note: "policy stock-app: services/stock-app/* only" },
    { from: "s", to: "v", label: "POST /v1/services/data/stock-app/demo", note: "X-Vault-Token: that token" },
    { from: "v", to: "s", label: "200, version 1", note: "any other path: 403" },
    { from: "s", to: "u", label: "201 Created" },
  ],
});

onMap((map) => {
  rbacDiagram(map);
  accountTable(map);
  configTable(map);
  checks(map, hardeningTable(map));
});
