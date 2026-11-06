# The Refactor Explained — a CKA-Style Walkthrough

This document explains every change made in the "namespaces + ServiceAccounts +
RBAC" refactor (2026-07-19), written for someone studying for the Kubernetes
administrator certification. Each section covers *what* changed in this repo,
*which Kubernetes concept* is behind it, and *why the old approach was
removed*. All file paths are real — open them side by side with this doc.

---

## 1. The starting point (what was "wrong")

Before the refactor, the cluster worked, but it used three defaults that real
clusters never should:

1. **Everything ran in the `default` namespace.** No isolation, no way to
   scope permissions, name collisions waiting to happen.
2. **Every pod ran as the `default` ServiceAccount** of that namespace, and
   Kubernetes *auto-mounted an API token* into every container at
   `/var/run/secrets/kubernetes.io/serviceaccount/`. None of our apps talk to
   the Kubernetes API — yet each one carried credentials to it. If any app got
   compromised, the attacker got a valid API identity for free.
3. **There was zero RBAC of our own.** Nothing was granted, but also nothing
   was *deliberately* denied or scoped.

The refactor fixes all three and reorganizes the repo so it's obvious who owns
which resource.

---

## 2. Namespaces — carving up one cluster

### What changed

`platform/namespaces.yaml` (new) creates four namespaces, and **every**
manifest in the repo now declares its namespace explicitly in `metadata`:

| Namespace    | Workloads |
|--------------|-----------|
| `apps`       | python-app, go-app, frontend-app, nginx, nginx-exporter |
| `monitoring` | prometheus, grafana, node-exporter |
| `vault`      | vault, vault-configure Job |
| `docs`       | mkdocs |

### The concept

A **namespace** is a virtual sub-cluster for *namespaced* resources
(Deployments, Services, ConfigMaps, Secrets, ServiceAccounts, Roles,
Ingresses…). Some resources are **cluster-scoped** and live outside any
namespace: Nodes, Namespaces themselves, ClusterRoles, ClusterRoleBindings,
PersistentVolumes, StorageClasses. You can check which is which — a command
worth memorizing for the exam:

```sh
kubectl api-resources --namespaced=true    # namespaced kinds
kubectl api-resources --namespaced=false   # cluster-scoped kinds
```

Namespaces matter for three things:

- **Scoping permissions**: a `Role`/`RoleBinding` only has meaning *within* a
  namespace. With everything in `default`, per-service RBAC is impossible to
  express — this refactor is what makes RBAC meaningful at all.
- **Scoping names**: two Services called `web` can coexist in different
  namespaces.
- **Policy boundaries**: NetworkPolicies, ResourceQuotas, and LimitRanges are
  all applied per namespace (none used here yet, but the boundary now exists).

### Why the namespace is written into every manifest

We could have kept manifests namespace-less and applied them with
`kubectl apply -n apps -f …`. We deliberately did not: an explicit
`metadata.namespace` means the YAML is the full truth, and `kubectl apply -f`
gives the same result no matter what your current kubectl context/namespace
is. On the exam and in production, manifests that depend on "whatever
namespace I happen to be in" are a classic source of resources landing in the
wrong place.

---

## 3. Networking after the change — the part that actually *broke* things

Introducing namespaces changes **DNS names**, and that rippled through the
whole repo. This is the most instructive part of the refactor.

### How Service DNS works

CoreDNS (running in `kube-system`) gives every Service a DNS record:

```
<service>.<namespace>.svc.cluster.local
```

Inside a pod, `/etc/resolv.conf` has *search domains* based on the pod's own
namespace, e.g. for a pod in `apps`:

```
search apps.svc.cluster.local svc.cluster.local cluster.local
```

That search list is why a bare name like `vault-service` used to work: every
pod and every Service was in `default`, so `vault-service` expanded to
`vault-service.default.svc.cluster.local` and resolved. The moment python-app
moved to `apps` and Vault moved to `vault`, the bare name expands to
`vault-service.apps.svc.cluster.local` — **which does not exist**. Cross-
namespace calls must qualify the namespace:

```
http://vault-service.vault:8200       # <service>.<namespace> is enough
```

(`.svc.cluster.local` is optional — the search list completes it.)

### Every DNS reference that had to change

| File | Before | After | Why |
|---|---|---|---|
| `python-app/k8s/python-app-deployment.yaml`, `go-app/k8s/go-app-deployment.yaml` (`VAULT_ADDR`) | `http://vault-service:8200` | `http://vault-service.vault:8200` | caller in `apps`, Vault in `vault` |
| `vault/k8s/vault-configure-job.yaml` (`VAULT_ADDR`) | `http://vault-service:8200` | `http://vault-service.vault:8200` | same namespace, so the short name still worked — qualified anyway for consistency |
| `monitoring/grafana/ansible/setup-datasource.yaml` | `http://prometheus:9090` | `http://prometheus.monitoring:9090` | Grafana resolves the datasource URL from inside its pod in `monitoring`; qualified form works from anywhere |
| `monitoring/prometheus/k8s/prometheus-config.yaml` | `python-app-service:8000` etc. | *(deleted entirely — see §6)* | static targets replaced by service discovery |

### What did *not* change

The ingress path is untouched, because it never depended on namespaces:

```
browser → *.localhost → 127.0.0.1:80
        → kind port mapping (host :80 → control-plane node :80)
        → ingress-nginx controller pod
        → matches Host header against Ingress resources
        → Service (ClusterIP) → kube-proxy → pod
```

Two details worth understanding:

- An **Ingress is a namespaced resource** and can only route to Services *in
  its own namespace*. That's why each component keeps its own Ingress in its
  own `k8s/` dir and namespace (e.g. `grafana-ingress` is in `monitoring`).
  The ingress-nginx *controller* is cluster-wide: it watches Ingresses in all
  namespaces (that's part of its own RBAC, installed by its manifest).
- **kube-proxy and ClusterIPs are cluster-wide.** A ClusterIP is reachable
  from any namespace; namespaces are *not* a network boundary. Only a
  NetworkPolicy creates actual traffic restrictions — we have none, so
  frontend→backend, backends→Vault, and Prometheus→everything all work across
  namespaces with no extra configuration.

The e2e suite needed **zero changes**: it talks only to `*.localhost` ingress
hosts, which is exactly why black-box tests through a stable entry point are
resilient to internal refactors.

---

## 4. ServiceAccounts — giving every workload an identity (with no power)

### What changed

Every workload got its own ServiceAccount, defined next to its Deployment
(e.g. `go-app/k8s/go-app-serviceaccount.yaml`), and referenced via
`serviceAccountName` in the pod spec:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: go-app
  namespace: apps
automountServiceAccountToken: false
```

### The concept

A **ServiceAccount (SA)** is a pod's identity toward the Kubernetes API.
Every namespace has a `default` SA; any pod that doesn't specify one uses it.
Kubernetes then mounts a **projected token volume** (`kube-api-access-…`) into
the container with a signed JWT, the cluster CA, and the namespace — enough to
call the API server as `system:serviceaccount:<namespace>:<name>`.

Two decisions to understand:

1. **One SA per workload, even with zero permissions.** An SA with no
   RoleBindings can do (almost) nothing, so why bother? Because identity is a
   prerequisite for everything else: when go-app later needs a permission (or
   a Vault Kubernetes-auth role, or a NetworkPolicy keyed on labels), the
   identity already exists and is owned by the service. It also makes audit
   logs attributable — you see `system:serviceaccount:apps:go-app`, not
   `default`.

2. **`automountServiceAccountToken: false`** — set on the SA itself. Our apps
   never call the Kubernetes API, so they should not carry API credentials.
   This field exists at two levels, and the precedence matters (exam
   material): the *pod spec* field overrides the *SA* field. We set it once on
   the SA (single source of truth); pods inherit it. Verify it worked:

   ```sh
   kubectl get pod -n apps -l app=go-app -o jsonpath='{.items[0].spec.volumes}'
   # → empty: no kube-api-access volume, no token in the container
   ```

The one exception is `prometheus` (in
`monitoring/prometheus/k8s/prometheus-serviceaccount.yaml`): it genuinely
calls the API for service discovery, so its token *is* mounted — and scoped by
RBAC, next section.

---

## 5. RBAC — the four objects and how they connect

### What changed

Exactly one grant exists in the whole repo: `platform/rbac/prometheus.yaml`.

```yaml
kind: ClusterRole            # cluster-scoped: rules valid across all namespaces
metadata:
  name: prometheus
rules:
  - apiGroups: [""]                          # "" = the core API group
    resources: [nodes, services, endpoints, pods]
    verbs: [get, list, watch]                # read-only
  - nonResourceURLs: ["/metrics"]            # raw API-server paths (not objects)
    verbs: [get]
---
kind: ClusterRoleBinding     # attaches the role to an identity, cluster-wide
subjects:
  - kind: ServiceAccount
    name: prometheus
    namespace: monitoring    # bindings must pin the SA's namespace
roleRef:
  kind: ClusterRole
  name: prometheus
```

### The concept — the RBAC matrix

RBAC has four objects; the certification expects you to know when each is
right:

| | Role (namespaced) | ClusterRole (cluster-scoped) |
|---|---|---|
| **RoleBinding** (namespaced) | permissions in one namespace | reuse a ClusterRole's rules, but *limited to the binding's namespace* |
| **ClusterRoleBinding** | — (invalid) | permissions everywhere |

Why Prometheus needs **ClusterRole + ClusterRoleBinding**: it must list and
watch Endpoints/Services/Pods in *multiple* namespaces (`apps` and
`monitoring`). A Role can't span namespaces. (The stricter alternative — one
ClusterRole reused by a RoleBinding in each scraped namespace — is a good
exercise; we kept the simple canonical form.)

Why these exact rules:

- `get/list/watch` on `endpoints, services, pods` — service discovery reads
  and watches these objects. `nodes` covers node-level discovery.
- `nonResourceURLs: ["/metrics"]` — not a Kubernetes object but a literal URL
  path on the API server, only grantable in a ClusterRole.
- **No write verbs, no `secrets`.** Monitoring must never be an escalation
  path; a compromised Prometheus can enumerate the cluster but change nothing.

### Placement — why the grant is in `platform/` but the SA is not

The **ServiceAccount stays with the component** (it *is* the app's identity —
delete prometheus, delete its SA). The **ClusterRole/ClusterRoleBinding are
cluster-scoped** — they don't belong to any namespace and affect the whole
cluster, so they live in `platform/rbac/`, applied by cluster-admin before any
component. That split is the ownership rule of the whole refactor (§8).

### How to test RBAC (exam bread-and-butter)

`kubectl auth can-i` with impersonation:

```sh
kubectl auth can-i list pods      --as=system:serviceaccount:apps:go-app             # no
kubectl auth can-i list endpoints --as=system:serviceaccount:monitoring:prometheus   # yes
kubectl auth can-i create pods    --as=system:serviceaccount:monitoring:prometheus   # no
kubectl auth can-i get secrets -n monitoring --as=system:serviceaccount:monitoring:grafana  # no
```

Note what "no" means for go-app: not *denied by a rule* — RBAC is
**default-deny, additive-only**. There are no "deny rules"; an identity can do
only what some binding grants it. go-app has no bindings, therefore nothing.

---

## 6. Prometheus: static targets → Kubernetes service discovery

### What was deleted, and why

The old `prometheus-config.yaml` hard-coded four targets:

```yaml
- targets: ['python-app-service:8000']   # …and go-app, nginx-exporter, node-exporter
```

Two problems. First, every new service required editing Prometheus config —
exactly the kind of central bottleneck the repo's "auto-discovery" convention
(see `adding-a-service.md`) tries to avoid. Second, a subtle correctness bug:
scraping through a *Service DNS name* means each scrape goes to the ClusterIP,
and kube-proxy picks **one random backing pod**. For node-exporter (a
DaemonSet with one pod per worker) Prometheus was effectively scraping *a
coin-flip of the two nodes* each interval, interleaving two nodes' metrics
into one time series.

### What replaced it

```yaml
- job_name: 'kubernetes-services'
  scrape_interval: 5s
  kubernetes_sd_configs:
    - role: endpoints
      namespaces:
        names: [apps, monitoring]
  relabel_configs:
    - source_labels: [__meta_kubernetes_service_annotation_prometheus_io_scrape]
      action: keep
      regex: "true"
    - source_labels: [__meta_kubernetes_service_annotation_prometheus_io_job]
      action: replace
      target_label: job
```

How it works, step by step:

1. **`role: endpoints`** — Prometheus watches the API (using its SA token +
   the RBAC above) and creates one candidate scrape target per *endpoint
   address*, i.e. per ready pod behind each Service. This fixes the DaemonSet
   bug: both node-exporter pods become separate targets with distinct
   `instance` labels.
2. **`keep` relabel** — discovery sees *every* Service's endpoints; the filter
   drops everything not annotated `prometheus.io/scrape: "true"`. Opting in
   happens on the Service (e.g. `python-app/k8s/python-app-deployment.yaml`):

   ```yaml
   annotations:
     prometheus.io/scrape: "true"
     prometheus.io/job: python-app
   ```

3. **`job` relabel** — the `prometheus.io/job` annotation overwrites the job
   label, so dashboards and the e2e suite keep the historic names
   (`python-app`, `go-app`, `nginx-metrics`, `node-exporter`). Without this,
   every Grafana query filtering `job="go-app"` would silently return nothing.
4. **The namespace allow-list** was added after testing: kubeadm annotates the
   `kube-dns` Service in `kube-system` with the *same* `prometheus.io/scrape`
   annotation, and discovery happily produced two permanently-down `:53`
   targets. Lesson: annotation conventions are shared cluster-wide — scope
   your discovery. (A takeaway for the exam mindset: after any change,
   *inspect actual state* — here, `/api/v1/targets` — don't trust the config.)

The `self` job (`localhost:9090`) stays static — Prometheus scraping itself
needs no discovery. Payment for all this: Prometheus is the single workload
with API credentials, which is precisely why §5's grant is read-only.

---

## 7. What happened to the deploy script and CI

Namespaces break any `kubectl` command that silently assumed `default`.
Changes in `recreate-cluster.sh`:

- **Apply order**: `platform/namespaces.yaml` + `platform/rbac/` are applied
  right after the ingress controller, *before any component* — you cannot
  create a resource in a namespace that doesn't exist yet. (The
  ClusterRoleBinding can be created before the SA it names: RBAC references
  are by name, not by object existence.)
- `kubectl wait deployment --all` waited in `default` only — now it loops over
  the four namespaces with `-n`.
- `kubectl wait job/vault-configure` → `-n vault`.
- The "failed pods" check got two fixes: `-A` (all namespaces), and the field
  selector now also excludes `status.phase!=Succeeded`. This fixed a
  pre-existing bug: a completed Job pod (vault-configure) has phase
  `Succeeded`, which is `!= Running`, so the old check reported it as a
  failure. Pod phases (`Pending / Running / Succeeded / Failed / Unknown`) are
  exam material — `Succeeded` is the *normal* end state for Job pods.
- `kind create cluster --config platform/kind-cluster.yaml` — moved file (§8).

`.github/workflows/e2e.yaml`'s failure-debug step similarly iterates the four
namespaces to collect logs instead of reading `default`.

---

## 8. The repo layout rule (the platform-engineering part)

The organizing principle, now recorded in `documentation/docs/platform-decisions.md`:

> **If deleting the service should delete the resource, it lives in that
> service's `k8s/` directory. If the resource outlives any single service, it
> lives in `platform/`.**

So the split is by **ownership**, not by resource kind:

```
platform/                          ← "cluster admin" owns this
├── kind-cluster.yaml              ← moved from repo root: it defines the cluster itself
├── namespaces.yaml                ← namespaces outlive every service
└── rbac/prometheus.yaml           ← cluster-scoped grant

<component>/k8s/                   ← the service team owns this
├── *-deployment.yaml              ← now with namespace + serviceAccountName
├── *-serviceaccount.yaml          ← identity lives WITH the service
└── *-ingress.yaml
```

Why not one big `manifests/` directory, or directories per resource kind
(`deployments/`, `services/`…)? Because layout should mirror *who changes
what together*: an app change and its manifest change belong in one review, in
one place, while namespace or RBAC changes are cluster-admin decisions with
cluster-wide blast radius and deserve their own location and review path. This
is the same reasoning as the Flux `apps/` vs `infrastructure/` split and Red
Hat's Conway's-law GitOps layout, scaled down to a one-cluster playground.

Note the deliberate asymmetry from §5: Prometheus's *ServiceAccount* is in
`monitoring/prometheus/k8s/`, but its *ClusterRole* is in `platform/rbac/` —
identity is service-owned, cluster-wide power is admin-owned.

---

## 9. Verifying the whole thing — commands worth practicing

Everything below was actually run after the refactor; each is a useful reflex
for cluster administration:

```sh
# Where does everything run? Is default empty?
kubectl get pods -A
kubectl get all -n default                      # only the kubernetes Service

# Namespaced vs cluster-scoped
kubectl api-resources --namespaced=false

# RBAC: who can do what (impersonation)
kubectl auth can-i list pods --as=system:serviceaccount:apps:go-app

# Is a token mounted? (empty volumes = no API credentials in the pod)
kubectl get pod -n apps -l app=go-app -o jsonpath='{.items[0].spec.volumes}'

# DNS from inside a pod (cross-namespace resolution)
kubectl exec -n apps deploy/python-app-deployment -- \
  python3 -c "import socket; print(socket.gethostbyname('vault-service.vault'))"

# What did Prometheus actually discover?
curl -s http://prometheus.localhost/api/v1/targets | python3 -m json.tool | grep -E '"job"|health'

# Idempotency: re-apply must say "unchanged", never error
kubectl apply -f platform/namespaces.yaml -f platform/rbac/
```

Final state after the refactor: 4 namespaces, 11 ServiceAccounts, 1 read-only
ClusterRole+Binding, 6 Prometheus targets all UP, `default` namespace empty,
and 40/40 e2e tests passing.

---

## 10. What was intentionally *not* done (and would be the next lessons)

- **NetworkPolicies** — namespaces are now in place as the boundary, but all
  traffic is still allowed. Next step: default-deny per namespace + explicit
  allows (frontend→backends, backends→Vault, Prometheus→everything).
- **Vault per-service auth** — both backends still use the dev root token. The
  `services/<service>/` path layout plus per-service SAs make Vault's
  Kubernetes auth method (one policy per SA) the natural follow-up.
- **ResourceQuotas / LimitRanges** — per-namespace resource governance.
- **Namespaced Roles** — nothing needs one yet; the first workload that needs
  API access *within* one namespace should get a Role + RoleBinding in its own
  `k8s/` dir, not a ClusterRole.

Each of these builds directly on what this refactor put in place: identity
(ServiceAccounts) + boundaries (namespaces) + explicit grants (RBAC).
