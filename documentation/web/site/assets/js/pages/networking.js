import "../site.js";
import { code, esc, fill, nsColor, nsTag, rows } from "../util.js";
import { onMap } from "../live.js";
import { graph, journey, sequence } from "../diagram.js";
import { brokenRoutes, firstPod, nodeOf, nodeShort, routeTo, service } from "../model.js";

const incoming = journey(document.getElementById("journey-incoming"));
const inCluster = journey(document.getElementById("journey-in-cluster"));
const tree = graph(document.getElementById("gateway-tree"));
const planes = graph(document.getElementById("planes"));

const ip = (pod) => (pod ? pod.ip : "?");
const target = (svc, fallback) => (svc && svc.target_ports.length ? svc.target_ports[0] : fallback);

// How kindnet carries a packet from node a to a pod on node b.
function hop(a, b, source = "the sender's pod IP") {
  if (!a || !b) return "Routed between nodes by kindnet.";
  if (a.name === b.name) return `Both ends are on ${esc(nodeShort(a.name))}, so the packet never leaves the node: it crosses the node's bridge.`;
  return `${code(b.pod_cidr)} belongs to ${esc(nodeShort(b.name))}, so ${esc(nodeShort(a.name))}'s route table sends the packet to ${code(b.ip)}. No tunnel and no NAT on the way: the receiver sees ${source} as the source.`;
}

function ranges(map) {
  const api = service(map, "kubernetes", "default");
  const dns = service(map, "kube-dns", "kube-system");
  const prefixes = map.nodes.map((n) => n.ip.split(".").slice(0, 3).join("."));
  const nodeRange = prefixes.length && prefixes.every((p) => p === prefixes[0]) ? `${prefixes[0]}.x` : "per node";
  fill("#ranges", [
    ["Node IPs", nodeRange, "One per machine, from the network the nodes sit on: a VPC subnet on a cloud, here the Docker network kind creates (each node is a container). Set up by the infrastructure, not by Kubernetes.",
      map.nodes.map((n) => `${esc(nodeShort(n.name))} ${code(n.ip)}`)],
    ["Pod IPs", map.ranges.pods || "per node", "One per pod, handed out by the CNI plugin. Here <b>kindnet</b> gives each node a slice of a private range and adds routes between nodes; on EKS the AWS VPC CNI gives pods addresses from the VPC itself. Either way any pod reaches any other pod without NAT.",
      map.nodes.map((n) => `${esc(nodeShort(n.name))} ${code(n.pod_cidr)}`)],
    ["Service IPs", map.ranges.services || "unknown", "Virtual IPs the API server hands to Services from its service range. No interface owns them: <b>kube-proxy</b> rewrites packets sent to them into a real pod IP. This part works the same on every cluster.",
      [api && `API server ${code(api.cluster_ip + ":443")}`, dns && `CoreDNS ${code(dns.cluster_ip + ":53")}`].filter(Boolean)],
  ].map(([label, cidr, text, items]) => `<div class="range"><span class="eyebrow">${label}</span><span class="cidr">${esc(cidr)}</span>
    <p>${text}</p><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul></div>`).join(""));
}

function incomingJourney(map) {
  const proxyPod = map.pods.find((p) => map.gateways.some((g) => g.proxy_pods.includes(p.id)));
  const proxySvc = map.services.find((s) => map.gateways.some((g) => g.proxy_service === s.id));
  const entry = map.nodes.find((n) => n.roles.includes("control-plane"));
  const ui = firstPod(map, "stock-ui");
  const uiSvc = service(map, "stock-ui-service");
  const proxyNode = nodeOf(map, proxyPod);
  const nodePort = proxySvc && proxySvc.node_ports.length ? proxySvc.node_ports[0] : "30080";
  const envoyPort = target(proxySvc, "10080");
  const route = routeTo(map, "stock-ui-service");
  const snat = proxyNode && entry && proxyNode.name !== entry.name
    ? ` That pod runs on ${esc(nodeShort(proxyNode.name))}, so kube-proxy also SNATs the packet to this node's IP (<code>externalTrafficPolicy: Cluster</code>) and the reply comes back through here.`
    : " That pod runs on this node.";
  incoming.update({
    hops: [
      { title: "Your browser", sub: "stock-ui.localhost", color: nsColor("outside") },
      { title: "Docker", sub: `:80 → node :${nodePort}`, color: nsColor("outside") },
      { title: "kube-proxy", sub: `on ${nodeShort(entry?.name)}`, color: nsColor("kube-system") },
      { title: "Envoy proxy", sub: `${ip(proxyPod)}:${envoyPort}`, color: nsColor("envoy-gateway-system") },
      { title: "stock-ui pod", sub: `${ip(ui)}:${target(uiSvc, "8080")}`, color: nsColor("apps") },
    ],
    steps: [
      { at: 0, where: "your machine", text: "<code>*.localhost</code> resolves to <code>127.0.0.1</code> with no DNS setup. The browser connects to port 80 and sends <code>Host: stock-ui.localhost</code>." },
      { at: 0.5, where: "Docker", text: `<code>extraPortMappings</code> in <code>platform/kind-cluster.yaml</code> publish host port 80 to port ${code(nodePort)} of the ${entry ? `<b>${esc(nodeShort(entry.name))}</b> container (${code(entry.ip)})` : "control-plane container"}.` },
      { at: 2, where: `${nodeShort(entry?.name)} · iptables`, text: `${code(nodePort)} is the nodePort of Service ${code(proxySvc ? proxySvc.name : "shared-gateway-proxy")}. kube-proxy's <code>KUBE-NODEPORTS</code> rule DNATs the packet to a ready Envoy pod, ${code(ip(proxyPod) + ":" + envoyPort)}.${snat}` },
      { at: 2.5, where: "kindnet", text: hop(entry, proxyNode, "the node's IP (from the SNAT)") },
      { at: 3, where: "Envoy proxy", text: `Envoy Gateway maps privileged listener ports to port + 10000 (here 80 → ${code(envoyPort)}), so Envoy can run as non-root on any runtime. Envoy matches <code>Host: stock-ui.localhost</code> against the attached routes and picks ${code(route ? route.name : "stock-ui-route")}.` },
      { at: 3, where: "Envoy proxy", text: `It doesn't use the ClusterIP${uiSvc ? ` (${code(uiSvc.cluster_ip)})` : ""}: Envoy Gateway gave it the ready pod addresses from the Service's EndpointSlice, so Envoy connects straight to ${code(ip(ui) + ":" + target(uiSvc, "8080"))}, the Service's <code>targetPort</code>.` },
      { at: 3.5, where: "kindnet", text: hop(proxyNode, nodeOf(map, ui)) },
      { at: 4, where: "stock-ui pod", text: "nginx-unprivileged (uid 101) serves <code>index.html</code> and the JavaScript bundle. The response goes back the same way." },
    ],
  });
}

function inClusterJourney(map) {
  const api = firstPod(map, "stock-app");
  const db = firstPod(map, "timescaledb");
  const dbSvc = service(map, "timescaledb-service", "data");
  const dns = service(map, "kube-dns", "kube-system");
  const from = nodeOf(map, api);
  const to = nodeOf(map, db);
  inCluster.update({
    hops: [
      { title: "stock-app pod", sub: ip(api), color: nsColor("apps") },
      { title: "CoreDNS", sub: `${dns ? dns.cluster_ip : "?"}:53`, color: nsColor("kube-system") },
      { title: "kube-proxy", sub: `on ${nodeShort(from?.name)}`, color: nsColor("kube-system") },
      { title: "CNI: kindnet", sub: `${nodeShort(from?.name)} → ${nodeShort(to?.name)}`, color: nsColor("kube-system") },
      { title: "timescaledb-0", sub: `${ip(db)}:5432`, color: nsColor("data") },
    ],
    steps: [
      { at: 0, where: "stock-app pod", text: "The database driver connects to <code>STOCK_DB_HOST=timescaledb-service.data</code>, port 5432." },
      { at: 1, where: "resolver → CoreDNS", text: `The name has one dot, fewer than <code>ndots:5</code>, so the search list applies: <code>timescaledb-service.data.apps.svc.cluster.local</code> is NXDOMAIN, then <code>timescaledb-service.data.svc.cluster.local</code> answers ${code(dbSvc ? dbSvc.cluster_ip : "?")}. The query itself went to ${code(dns ? dns.cluster_ip : "?")}, also a Service IP.` },
      { at: 2, where: `${nodeShort(from?.name)} · iptables`, text: `The packet to ${code((dbSvc ? dbSvc.cluster_ip : "?") + ":5432")} leaves the pod. kube-proxy's NAT rules match the ClusterIP and DNAT it to a ready endpoint, ${code(ip(db) + ":5432")}. The packet never meets a "Service" box.` },
      { at: 3, where: "kindnet", text: hop(from, to) },
      { at: 4, where: "timescaledb-0", text: "PostgreSQL checks the password, which matches because <code>stock-app-secret</code> and <code>timescaledb-secret</code> hold the same value. The reply is un-NATed on the way back, so stock-app sees it come from the ClusterIP." },
    ],
  });
  fill("#iptables", `-A KUBE-SERVICES -d ${esc(dbSvc ? dbSvc.cluster_ip : "?")}/32 -p tcp --dport 5432 -j KUBE-SVC-&lt;hash&gt;   <span class="c"># match the ClusterIP</span>
-A KUBE-SVC-&lt;hash&gt; -j KUBE-SEP-&lt;hash&gt;                                      <span class="c"># pick an endpoint (one here)</span>
-A KUBE-SEP-&lt;hash&gt; -p tcp -j DNAT --to-destination ${esc(ip(db))}:5432           <span class="c"># rewrite to the pod</span>`);
}

const routeOk = (r) => r.accepted && r.status === "Accepted";
const backendName = (r, b) => (b.service.startsWith(r.namespace + "/") ? b.service.split("/")[1] : b.service);

function gatewayTree(map) {
  const g = map.gateways[0];
  const routes = map.routes;
  const h = Math.max(220, 70 + routes.length * 62);
  const mid = h / 2 - 26;
  const nodes = [];
  const edges = [];
  const ltr = { sides: ["r", "l"] };
  if (g) {
    const listener = g.listeners[0];
    nodes.push({ id: "class", x: 32, y: mid, w: 168, h: 52, title: g.class, sub: "GatewayClass", color: nsColor("envoy-gateway-system") });
    nodes.push({ id: "gw", x: 240, y: mid, w: 200, h: 52, title: g.name, sub: listener ? `Gateway · ${listener.protocol} :${listener.port} ${listener.hostname}` : "Gateway, no listener", color: nsColor("envoy-gateway-system"), status: g.programmed ? "ok" : "bad", tip: `${g.programmed ? "Programmed" : "NOT Programmed"}; routes from ${listener ? listener.allowed_routes : "?"}` });
    edges.push({ from: "class", to: "gw", color: nsColor("envoy-gateway-system"), ...ltr });
  }
  routes.forEach((r, i) => {
    const y = 48 + i * 62;
    const svc = r.backends[0];
    nodes.push({ id: `r-${r.id}`, x: 484, y, w: 232, h: 50, title: r.name, sub: `${r.hostnames.join(", ")}${r.filters.length ? " · " + r.filters.join(", ") : ""}`, color: nsColor(r.namespace), status: routeOk(r) ? "ok" : "bad", tip: r.status });
    edges.push({ from: "gw", to: `r-${r.id}`, color: routeOk(r) ? nsColor("envoy-gateway-system") : "var(--bad)", dashed: !r.accepted, ...ltr });
    if (svc) {
      const s = map.services.find((x) => x.id === svc.service);
      const ready = s ? `${s.pods.length} ready pod${s.pods.length === 1 ? "" : "s"}` : "Service not found";
      nodes.push({ id: `s-${r.id}`, x: 756, y, w: 228, h: 50, title: backendName(r, svc), sub: `${r.namespace} · ${ready}`, color: nsColor(r.namespace), status: s && s.pods.length ? "ok" : "bad" });
      edges.push({ from: `r-${r.id}`, to: `s-${r.id}`, color: nsColor(r.namespace), label: `:${svc.port}`, ...ltr });
    }
  });
  tree.render({
    w: 1000, h, nodes, edges, label: "Gateway API objects in the cluster",
    groups: [
      { x: 16, y: 16, w: 200, h: h - 32, label: "infrastructure provider", color: nsColor("envoy-gateway-system") },
      { x: 224, y: 16, w: 232, h: h - 32, label: "platform team", color: nsColor("envoy-gateway-system") },
      { x: 468, y: 16, w: 524, h: h - 32, label: "app teams: one route each", color: nsColor("apps") },
    ],
  });
}

function planesDiagram(map) {
  const controller = map.pods.find((p) => p.app === "gateway-helm");
  const proxy = map.pods.find((p) => map.gateways.some((g) => g.proxy_pods.includes(p.id)));
  planes.render({
    w: 1000, h: 236, label: "Control plane and data plane of the Gateway",
    groups: [
      { x: 16, y: 16, w: 968, h: 92, label: "control plane: config", color: nsColor("kube-system") },
      { x: 16, y: 128, w: 968, h: 92, label: "data plane: every request", color: nsColor("envoy-gateway-system") },
    ],
    nodes: [
      { id: "you", x: 32, y: 44, w: 176, h: 52, title: "You", sub: "kubectl apply -f route.yaml", color: nsColor("outside"), dashed: true },
      { id: "api", x: 300, y: 44, w: 176, h: 52, title: "kube-apiserver", sub: "stores the HTTPRoute", color: nsColor("kube-system") },
      { id: "ctl", x: 580, y: 44, w: 200, h: 52, title: "Envoy Gateway", sub: controller ? controller.ip : "controller", color: nsColor("envoy-gateway-system") },
      { id: "browser", x: 32, y: 156, w: 176, h: 52, title: "Your browser", sub: "Host: stock.localhost", color: nsColor("outside"), dashed: true },
      { id: "proxy", x: 580, y: 156, w: 200, h: 52, title: "Envoy proxy", sub: proxy ? `${proxy.ip}:10080` : "shared-gateway-proxy", color: nsColor("envoy-gateway-system") },
      { id: "pods", x: 820, y: 156, w: 148, h: 52, title: "app pods", sub: "ready pod IPs", color: nsColor("apps") },
    ],
    edges: [
      { from: "you", to: "api", color: nsColor("outside"), label: "HTTPRoute" },
      { from: "api", to: "ctl", color: nsColor("kube-system"), dashed: true, label: "object changes", tip: "Envoy Gateway watches the API; changes stream to it" },
      { from: "ctl", to: "proxy", color: nsColor("envoy-gateway-system"), dashed: true, label: "xDS · gRPC :18000" },
      { from: "browser", to: "proxy", color: nsColor("outside"), label: "HTTP via NodePort", flow: 0.3 },
      { from: "proxy", to: "pods", color: nsColor("apps"), label: "pod IPs", flow: 0.3 },
    ],
  });
}

function tables(map) {
  rows("#route-rows", map.routes, (r) => `<tr><td>${code(r.name)}</td><td>${nsTag(r.namespace)}</td>
    <td>${r.hostnames.map(code).join(" ")}</td><td>${r.backends.map((b) => code(`${backendName(r, b)}:${b.port}`)).join(" ")}</td>
    <td>${r.filters.length ? r.filters.map(code).join(" ") : `<span class="muted">none</span>`}</td>
    <td>${routeOk(r) ? `<span class="ok">Accepted</span>` : `<span class="bad">${esc(r.status)}</span>`}</td></tr>`, 6, "No HTTPRoutes in the cluster.");
  const system = new Set(map.system_namespaces);
  rows("#svc-rows", map.services.filter((s) => !system.has(s.namespace)), (s) => `<tr><td>${code(s.name)}</td><td>${nsTag(s.namespace)}</td>
    <td>${code(s.cluster_ip)}</td><td>${s.ports.map(code).join(" ")}</td><td>${code(s.dns)}</td>
    <td>${s.hostnames.length ? s.hostnames.map(code).join(" ") : `<span class="muted">none</span>`}</td><td class="num">${s.pods.length}</td></tr>`, 7);
  const dns = service(map, "kube-dns", "kube-system");
  fill("#resolv", `search apps.svc.cluster.local svc.cluster.local cluster.local
nameserver ${esc(dns ? dns.cluster_ip : "?")}      <span class="c"># CoreDNS, through its Service (kube-dns)</span>
options ndots:5            <span class="c"># names with fewer than 5 dots try the search list first</span>`);
  const broken = brokenRoutes(map);
  const check = document.getElementById("routes-check");
  check.className = `finding ${broken.length ? "live-bad" : "live-ok"}`;
  check.innerHTML = broken.length
    ? `<span class="sev">Live · broken routes</span><h3>${broken.length} of ${map.routes.length} HTTPRoutes are not fully working</h3>
       <p>${broken.map((r) => `${code(r.id)}: ${esc(r.status)}`).join("<br>")}</p>
       <p class="fix"><code>kubectl describe httproute &lt;name&gt; -n &lt;namespace&gt;</code> shows each condition with its message.</p>`
    : `<span class="sev">Live · checked</span><h3>The Gateway accepted all ${map.routes.length} HTTPRoutes</h3>
       <p>Every route is <code>Accepted</code> and its backend Service resolves. Apply the demo route under <i>Try it</i>
       and this card turns orange.</p>`;
}

sequence(document.getElementById("cors-seq"), {
  label: "CORS between stock-ui, Envoy and stock-app",
  actors: [
    { id: "b", label: "Browser", sub: "page from stock-ui.localhost", color: nsColor("outside") },
    { id: "e", label: "Envoy", sub: "stock-app-route · CORS filter", color: nsColor("envoy-gateway-system") },
    { id: "s", label: "stock-app", sub: "no CORS code", color: nsColor("apps") },
  ],
  steps: [
    { from: "b", to: "e", label: "OPTIONS /api/v1/instruments", note: "only for non-simple requests: Origin + Access-Control-Request-Method", dashed: true },
    { from: "e", to: "b", label: "200 Access-Control-Allow-Origin: http://stock-ui.localhost", note: "Envoy answers the preflight itself", dashed: true },
    { from: "b", to: "e", label: "GET /api/v1/instruments", note: "Origin: http://stock-ui.localhost" },
    { from: "e", to: "s", label: "GET /api/v1/instruments", note: "to a ready pod IP" },
    { from: "s", to: "e", label: "200 JSON" },
    { from: "e", to: "b", label: "200 JSON + Access-Control-Allow-Origin", note: "origin on the list: the page may read the response" },
    { from: "b", to: "b", label: "other origins get no header", note: "the browser hides the response" },
  ],
});

onMap((map) => {
  ranges(map);
  incomingJourney(map);
  inClusterJourney(map);
  gatewayTree(map);
  planesDiagram(map);
  tables(map);
});
