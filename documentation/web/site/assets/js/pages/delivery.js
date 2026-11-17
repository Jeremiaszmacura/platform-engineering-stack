import "../site.js";
import { esc, fill, nsColor } from "../util.js";
import { onMap } from "../live.js";
import { graph } from "../diagram.js";
import { brokenRoutes, components, podsOf } from "../model.js";

const NAMESPACES = ["apps", "data", "vault", "monitoring", "docs"];

// Each step of recreate-cluster.sh, with a check of what it should have left in the cluster.
const STEPS = [
  { title: "Recreate the kind cluster", what: "<code>kind delete cluster</code>, then <code>kind create cluster --config platform/kind-cluster.yaml</code>: one control-plane and two workers, host port 80 mapped to NodePort 30080.",
    check: (m) => [m.nodes.length === 3, `${m.nodes.length} nodes, Kubernetes ${m.version}`] },
  { title: "Install Envoy Gateway", what: "<code>kubectl apply --server-side -k platform/envoy-gateway</code>: the Gateway API CRDs and the controller, early so it starts while images build. Server-side because the CRDs are too large for client-side apply.",
    check: (m) => { const pods = podsOf(m, "gateway-helm").filter((p) => p.ready); return [pods.length > 0, pods.length ? "controller ready" : "controller not ready"]; } },
  { title: "Namespaces and RBAC", what: "<code>platform/namespaces.yaml</code> and <code>platform/rbac/</code>: they must exist before any component refers to them.",
    check: (m) => { const found = NAMESPACES.filter((ns) => m.pods.some((p) => p.namespace === ns)); return [found.length === NAMESPACES.length, `workloads in ${found.join(", ")}`]; } },
  { title: "Build and load the images", what: "<code>docker build</code> and <code>kind load docker-image</code> for stock-app, traffic-generator, stock-ui and documentation.",
    check: (m) => { const local = [...new Set(m.pods.flatMap((p) => p.images || []).filter((i) => i.endsWith(":dev")))]; return [local.length >= 4, local.join(", ") || "no local images running"]; } },
  { title: "Create the shared Gateway", what: "Waits for the controller, applies <code>platform/gateway/</code> and waits until the Gateway is <code>Programmed</code>: its Envoy proxy runs.",
    check: (m) => { const g = m.gateways[0]; return [Boolean(g && g.programmed), g ? `${g.name} ${g.programmed ? "Programmed" : "not Programmed"}` : "no Gateway"]; } },
  { title: "Deploy the components", what: "Monitoring first, then Vault and TimescaleDB (waiting for the database), then stock-app, traffic-generator, stock-ui and this site. A directory with a <code>kustomization.yaml</code> is applied with <code>-k</code>.",
    check: (m) => { const list = components(m); return [list.length >= 10, `${list.length} components running`]; } },
  { title: "Wait for rollouts", what: "<code>kubectl rollout status</code> for every Deployment, StatefulSet and DaemonSet, so a crashing new pod fails the run even while an old one still serves.",
    check: (m) => { const list = components(m); const bad = list.filter((c) => c.health.state !== "ok"); return [!bad.length, bad.length ? `not ready: ${bad.map((c) => c.app).join(", ")}` : "every workload ready"]; } },
  { title: "Check every URL", what: "Polls each <code>*.localhost</code> URL through the Gateway until it answers, then prints them.",
    check: (m) => { const broken = brokenRoutes(m); return [!broken.length, broken.length ? `${broken.length} routes not accepted` : `${m.routes.length} routes accepted`]; } },
];

function pipeline(map) {
  fill("#pipeline-steps", STEPS.map((s) => {
    const [ok, detail] = s.check(map);
    return `<li><div><span class="where">${ok ? `<span class="ok">✓</span>` : `<span class="warn">✗</span>`} ${esc(detail)}</span>
      <b>${esc(s.title)}.</b> ${s.what}</div></li>`;
  }).join(""));
}

function pipelineFlow() {
  const box = (id, x, y, title, sub, ns) => ({ id, x, y, w: 196, h: 52, title, sub, color: nsColor(ns) });
  const names = [
    ["kind", "kind cluster", "3 nodes", "outside"], ["eg", "Envoy Gateway", "CRDs + controller", "envoy-gateway-system"],
    ["platform", "namespaces, RBAC", "platform/", "kube-system"], ["images", "4 images", "build + kind load", "outside"],
    ["gateway", "shared Gateway", "wait: Programmed", "envoy-gateway-system"], ["apps", "components", "in dependency order", "apps"],
    ["wait", "rollouts", "rollout status", "kube-system"], ["urls", "*.localhost", "every URL answers", "outside"],
  ];
  const nodes = names.map(([id, title, sub, ns], i) => box(id, 16 + (i % 4) * 270, i < 4 ? 30 : 128, title, sub, ns));
  const edges = names.slice(1).map(([id], i) => ({ from: names[i][0], to: id, color: nsColor("outside"), sides: i === 3 ? ["b", "t"] : ["r", "l"] }));
  edges[3].via = [[924, 104], [114, 104]];
  graph(document.getElementById("pipeline-flow")).render({ w: 1100, h: 200, nodes, edges, label: "The steps of recreate-cluster.sh" });
}

function ciFlow() {
  const box = (id, x, y, title, sub, ns, w = 200) => ({ id, x, y, w, h: 52, title, sub, color: nsColor(ns) });
  graph(document.getElementById("ci-flow")).render({
    w: 1100, h: 330, label: "CI workflows",
    groups: [{ x: 300, y: 16, w: 520, h: 300, label: "on every pull request and on main", color: nsColor("apps") }],
    nodes: [
      box("pr", 16, 140, "pull request", "you, or Renovate", "outside"),
      box("go", 316, 44, "go-qa", "golangci-lint, go test", "apps", 240),
      box("py", 316, 110, "python-qa", "pre-commit, tox tests", "apps", 240),
      box("fe", 316, 176, "frontend-qa", "build, Vitest, node --test", "apps", 240),
      box("e2e", 316, 242, "e2e", "kind + synthetic prices + pytest", "apps", 240),
      box("restart", 572, 242, "restart the proxy", "*.localhost still answers", "envoy-gateway-system", 232),
      box("main", 872, 140, "merge to main", "auto for minor and patch", "outside"),
      box("pages", 872, 242, "deploy-documentation", "GitHub Pages: web/site", "docs"),
    ],
    edges: [
      ...["go", "py", "fe", "e2e"].map((to) => ({ from: "pr", to, color: nsColor("outside"), sides: ["r", "l"] })),
      { from: "e2e", to: "restart", color: nsColor("apps"), label: "then" },
      ...["go", "py", "fe"].map((from) => ({ from, to: "main", color: nsColor("apps"), sides: ["r", "l"] })),
      { from: "restart", to: "main", color: nsColor("apps"), sides: ["r", "l"] },
      { from: "main", to: "pages", color: nsColor("docs"), label: "if the site changed" },
    ],
  });
}

pipelineFlow();
ciFlow();
// The steps read well without data too; the live checks replace them once the map arrives.
fill("#pipeline-steps", STEPS.map((s) => `<li><div><b>${esc(s.title)}.</b> ${s.what}</div></li>`).join(""));
onMap(pipeline);
