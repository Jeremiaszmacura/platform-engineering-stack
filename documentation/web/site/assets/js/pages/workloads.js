import "../site.js";
import { code, esc, fill, nsColor, nsTag, rows } from "../util.js";
import { onMap } from "../live.js";
import { graph, sequence } from "../diagram.js";
import { components, shortName } from "../model.js";

const KINDS = [
  ["Deployment", "Stateless, interchangeable pods with random names. A rollout replaces them gradually through a new ReplicaSet."],
  ["StatefulSet", "A stable name (<code>&lt;name&gt;-0</code>) and its own PVC that follows the pod. Pods start and stop in order."],
  ["DaemonSet", "Exactly one pod per node. node-exporter tolerates the control-plane taint so every node is covered."],
  ["Job", "Runs until it succeeds once, retrying on failure (<code>backoffLimit</code>). Finished pods stay as Succeeded."],
  ["Node", "Static pods: the kubelet starts them from files on the control-plane node, with no controller. They use host networking."],
];

function kinds(map) {
  const byOwner = (kind) => [...new Set(map.pods.filter((p) => p.owner === kind).map(shortName))].join(", ") || "none";
  rows("#kind-rows", KINDS, ([kind, why]) => `<tr><td><b>${kind === "Node" ? "Static pod" : kind}</b></td><td>${esc(byOwner(kind))}</td><td>${why}</td></tr>`, 3);
}

function probes(list) {
  rows("#probe-rows", list.filter((c) => c.health.total), (c) => {
    const all = [...new Set(c.pods.flatMap((p) => p.probes))];
    const of = (kind) => all.filter((p) => p.startsWith(kind)).map((p) => code(p.replace(`${kind}: `, ""))).join("<br>") || `<span class="muted">none</span>`;
    return `<tr><td>${code(c.app)} ${nsTag(c.namespace)}</td><td>${of("readiness")}</td><td>${of("liveness")}</td>
      <td class="num">${c.health.ready}/${c.health.total}</td><td class="num">${c.health.restarts ? `<span class="warn">${c.health.restarts}</span>` : 0}</td></tr>`;
  }, 5);
}

function images(list) {
  rows("#image-rows", list, (c) => {
    const local = c.images.every((i) => i.endsWith(":dev"));
    return `<tr><td>${code(c.app)}</td><td>${nsTag(c.namespace)}</td><td>${c.images.map(code).join("<br>")}</td>
      <td>${local ? "built locally, loaded into kind" : "pinned public image, pulled by the node"}</td></tr>`;
  }, 4);
}

function replicaCheck(list) {
  const scalable = list.filter((c) => ["Deployment", "StatefulSet"].includes(c.owner));
  const single = scalable.filter((c) => c.health.total === 1);
  const card = document.getElementById("replica-check");
  card.className = `finding ${single.length ? "live-bad" : "live-ok"}`;
  card.innerHTML = `<span class="sev">Live · availability</span><h3>${single.length} of ${scalable.length} components run a single pod</h3>
    <p>${single.map((c) => code(c.app)).join(" ")}. With no PodDisruptionBudget, <code>kubectl drain</code> takes each one down,
      and a pod pinned by a local volume can't move at all.</p>
    <p class="fix">Exercise: two replicas of traffic-generator, a PDB with <code>minAvailable: 1</code> and a topology
      spread across workers, then drain a worker and watch the map.</p>`;
  fill("#facts", [["components", list.length], ["single-pod", single.length], ["restarts", list.reduce((s, c) => s + c.health.restarts, 0)]]
    .map(([k, v]) => `<span>${esc(k)} <b>${esc(v)}</b></span>`).join(""));
}

graph(document.getElementById("probe-flow")).render({
  w: 1000, h: 196, label: "What a failing readiness or liveness probe does",
  nodes: [
    { id: "kubelet", x: 16, y: 72, w: 180, h: 52, title: "kubelet", sub: "runs the probes", color: nsColor("kube-system") },
    { id: "ready", x: 268, y: 16, w: 200, h: 52, title: "readiness fails", sub: "Ready condition: False", color: nsColor("apps") },
    { id: "live", x: 268, y: 128, w: 200, h: 52, title: "liveness fails", sub: "failureThreshold times", color: nsColor("apps") },
    { id: "eps", x: 540, y: 16, w: 210, h: 52, title: "EndpointSlice", sub: "endpoint marked not ready", color: nsColor("kube-system") },
    { id: "restart", x: 540, y: 128, w: 210, h: 52, title: "container restarted", sub: "same pod, restart count + 1", color: nsColor("kube-system") },
    { id: "proxy", x: 800, y: 16, w: 184, h: 52, title: "kube-proxy, Envoy", sub: "stop sending to it", color: nsColor("envoy-gateway-system") },
  ],
  edges: [
    { from: "kubelet", to: "ready", color: nsColor("kube-system"), sides: ["r", "l"] },
    { from: "kubelet", to: "live", color: nsColor("kube-system"), sides: ["r", "l"] },
    { from: "ready", to: "eps", color: nsColor("apps") },
    { from: "live", to: "restart", color: nsColor("apps") },
    { from: "eps", to: "proxy", color: nsColor("kube-system"), label: "watch" },
  ],
});

sequence(document.getElementById("startup-seq"), {
  label: "How stock-app's pod starts",
  actors: [
    { id: "sched", label: "kube-scheduler", sub: "control plane", color: nsColor("kube-system") },
    { id: "kubelet", label: "kubelet", sub: "on the chosen node", color: nsColor("kube-system") },
    { id: "init", label: "migrate", sub: "init container", color: nsColor("apps") },
    { id: "app", label: "stock-app", sub: "app container", color: nsColor("apps") },
    { id: "eps", label: "EndpointSlice", sub: "stock-app-service", color: nsColor("kube-system") },
  ],
  steps: [
    { from: "sched", to: "kubelet", label: "bind the pod to a node", note: "after filtering and scoring every node" },
    { from: "kubelet", to: "init", label: "start migrate", note: "image stock-app:dev, already on the node" },
    { from: "init", to: "init", label: "alembic upgrade head", note: "against timescaledb-service.data" },
    { from: "init", to: "kubelet", label: "exit 0", note: "non-zero: retried, the app never starts" },
    { from: "kubelet", to: "app", label: "start stock-app", note: "readOnlyRootFilesystem, non-root, all capabilities dropped" },
    { from: "kubelet", to: "app", label: "GET /health every 5 s", note: "after initialDelaySeconds: 10" },
    { from: "app", to: "kubelet", label: "200: the database answers" },
    { from: "kubelet", to: "eps", label: "pod Ready: its IP is added", note: "now kube-proxy and Envoy send traffic" },
  ],
});

graph(document.getElementById("config-flow")).render({
  w: 1100, h: 120, label: "How a config file change becomes new pods",
  nodes: [
    { id: "file", x: 16, y: 34, w: 190, h: 52, title: "edit a file", sub: "monitoring/grafana/k8s/…", color: nsColor("outside"), dashed: true },
    { id: "kustomize", x: 238, y: 34, w: 200, h: 52, title: "kubectl apply -k", sub: "configMapGenerator", color: nsColor("monitoring") },
    { id: "cm", x: 470, y: 34, w: 200, h: 52, title: "new ConfigMap name", sub: "grafana-datasources-5k8…", color: nsColor("monitoring") },
    { id: "rs", x: 702, y: 34, w: 180, h: 52, title: "new ReplicaSet", sub: "the pod template changed", color: nsColor("kube-system") },
    { id: "pods", x: 914, y: 34, w: 170, h: 52, title: "rolling update", sub: "new pod, then old one out", color: nsColor("monitoring") },
  ],
  edges: [["file", "kustomize", ""], ["kustomize", "cm", "hash of content"], ["cm", "rs", ""], ["rs", "pods", ""]]
    .map(([from, to, label]) => ({ from, to, label, color: nsColor("monitoring") })),
});

onMap((map) => {
  const list = components(map);
  kinds(map);
  probes(list);
  images(list);
  replicaCheck(list);
});
