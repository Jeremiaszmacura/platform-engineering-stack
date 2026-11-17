// Pure functions over the /api/map document: no DOM and no fetch, so documentation/web/test can test them.

/** "sample-cluster-worker2" -> "worker2". */
export const nodeShort = (name) => ((name || "").match(/(control-plane|worker\d*)$/) || [name || "?"])[0];

/** A pod's name without the hashes its controller added: "stock-app-7d9f8-x2k4p" -> "stock-app". */
export function shortName(pod) {
  if (pod.owner === "Node") return pod.name.replace(`-${pod.node}`, "");
  if (pod.owner === "Deployment") return pod.name.replace(/-[a-z0-9]{6,10}-[a-z0-9]{5}$/, "");
  if (pod.owner === "DaemonSet" || pod.owner === "Job") return pod.name.replace(/-[a-z0-9]{5}$/, "");
  return pod.name;
}

/** kube-system static pods and DaemonSets (kube-proxy, kindnet, ...), which run once per node. */
export const isNodeAgent = (pod) =>
  pod.namespace === "kube-system" && ["Node", "DaemonSet"].includes(pod.owner) && pod.app !== "kube-apiserver";

const isDoneJob = (pod) => pod.owner === "Job" && pod.phase === "Succeeded";

/** How healthy a set of pods is: ok (all ready), warn (some), bad (none), none (no pods). */
export function health(pods) {
  const serving = pods.filter((p) => !isDoneJob(p));
  const ready = serving.filter((p) => p.phase === "Running" && p.ready !== false).length;
  const restarts = pods.reduce((sum, p) => sum + (p.restarts || 0), 0);
  let state = "none";
  if (pods.length && !serving.length) state = "ok";
  else if (serving.length) state = ready === serving.length ? "ok" : ready ? "warn" : "bad";
  return { total: serving.length, ready, restarts, state, done: pods.length - serving.length };
}

/** Pods with this app label, optionally only in one namespace. */
export const podsOf = (map, app, namespace) =>
  map.pods.filter((p) => p.app === app && (!namespace || p.namespace === namespace));

/** The first running pod of an app, preferring a ready one. */
export function firstPod(map, app) {
  const pods = podsOf(map, app).filter((p) => p.phase === "Running");
  return pods.find((p) => p.ready !== false) || pods[0] || null;
}

/** A Service by name, optionally in one namespace. */
export const service = (map, name, namespace) =>
  map.services.find((s) => s.name === name && (!namespace || s.namespace === namespace)) || null;

/** The Services that select any of these pods. */
export const servicesOf = (map, pods) => {
  const ids = new Set(pods.map((p) => p.id));
  return map.services.filter((s) => s.pods.some((id) => ids.has(id)));
};

/** The HTTPRoute that sends traffic to a Service name, or null. */
export const routeTo = (map, serviceName) =>
  map.routes.find((r) => r.backends.some((b) => b.service.endsWith("/" + serviceName))) || null;

/** Every workload component (outside the system namespaces), one per app label, with its live facts. */
export function components(map) {
  const system = new Set(map.system_namespaces);
  const byApp = new Map();
  for (const pod of map.pods) {
    if (system.has(pod.namespace)) continue;
    const key = `${pod.namespace}/${pod.app}`;
    if (!byApp.has(key)) byApp.set(key, { app: pod.app, namespace: pod.namespace, pods: [] });
    byApp.get(key).pods.push(pod);
  }
  return [...byApp.values()]
    .map((c) => {
      const services = servicesOf(map, c.pods);
      return {
        ...c,
        health: health(c.pods),
        owner: c.pods[0].owner,
        services,
        hostnames: [...new Set(services.flatMap((s) => s.hostnames))],
        jobs: [...new Set(services.filter((s) => s.scraped).map((s) => s.job))],
        images: [...new Set(c.pods.flatMap((p) => p.images || []))],
        serviceAccount: c.pods[0].service_account,
      };
    })
    .sort((a, b) => (a.namespace + a.app).localeCompare(b.namespace + b.app));
}

/** Pod links merged per pair of apps: one edge per (from, to, kind), with every label it carried. */
export function appLinks(map) {
  const appById = new Map(map.pods.map((p) => [p.id, p.app]));
  const edges = new Map();
  for (const link of map.links) {
    const from = appById.get(link.source);
    const to = appById.get(link.target);
    if (!from || !to || from === to) continue;
    const key = `${from}|${to}|${link.kind}`;
    if (!edges.has(key)) edges.set(key, { from, to, kind: link.kind, labels: [] });
    const edge = edges.get(key);
    if (!edge.labels.includes(link.label)) edge.labels.push(link.label);
  }
  return [...edges.values()];
}

/** HTTPRoutes the Gateway has not fully accepted. */
export const brokenRoutes = (map) => map.routes.filter((r) => !(r.accepted && r.status === "Accepted"));

// The restricted profile allows adding only this capability back.
const ALLOWED_ADDED = new Set(["NET_BIND_SERVICE"]);

/** Whether a pod passes the checks of the Pod Security Standards' restricted profile that the map reports. */
export function restricted(pod) {
  const h = pod.hardening;
  if (!h) return false;
  return h.non_root && h.no_privilege_escalation && h.drops_all_capabilities && h.seccomp &&
    h.host_access.length === 0 && h.added_capabilities.every((c) => ALLOWED_ADDED.has(c));
}

/** The node a pod runs on, or null. */
export const nodeOf = (map, pod) => (pod ? map.nodes.find((n) => n.name === pod.node) || null : null);
