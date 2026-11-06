# Plan: Kubernetes manifest layout refactor — namespaces, ServiceAccounts, RBAC

Status: implemented 2026-07-19 (Phases 1+2; verified — full deploy + 40/40 e2e)
Date: 2026-07-19

Deviations from the plan as written:
- Fourth namespace `docs` for MkDocs (user decision); its SA is named `mkdocs`
  to match the component's own naming (mkdocs-deployment/mkdocs-service).
- Prometheus discovery is scoped to `namespaces: [apps, monitoring]` — the
  kube-dns Service in kube-system carries the same `prometheus.io/scrape`
  annotation and produced two permanently-down `:53` targets otherwise.
- `automountServiceAccountToken: false` is set on each ServiceAccount (single
  source) rather than repeated in every pod spec; pods inherit it (verified:
  pods have no token volume).
- No `prometheus.io/port` annotation/relabel: every scraped Service's target
  port already equals its metrics port, so the endpoint port is correct as-is.

## 1. Goal

Introduce per-service ServiceAccounts and RBAC, and reorganize the repository so
it is obvious which Kubernetes resources are **service-owned** and which are
**cluster/platform-owned**.

## 2. Research summary — where should resources live?

Industry patterns reviewed (Flux repository-structure guide, Argo CD best
practices, Red Hat GitOps directory structure):

- **Split by ownership, not by resource kind.** Namespaced resources owned by a
  single service (Deployment, Service, Ingress, ConfigMap, ServiceAccount,
  Role, RoleBinding) live *with that service*, so one PR changes code and
  manifests together. Cluster-scoped or shared resources (Namespaces,
  ClusterRoles, ClusterRoleBindings, ingress controller, cluster bootstrap
  config) live in a separate platform/infrastructure directory that is applied
  *first* (Flux's `apps/` vs `infrastructure/` split; Red Hat's Conway's-law
  argument: developers own app manifests, platform owners own cluster config).
- **Not adopted (YAGNI for a single-env kind playground):** Kustomize
  base/overlays, separate config repo, per-environment cluster directories,
  directories-grouped-by-resource-kind.

### Decision

Keep the existing self-contained `<component>/k8s/` directories for everything
namespaced and service-owned. Add one new top-level `platform/` directory for
everything cluster-scoped or shared. Rule of thumb to record in `design.md`:

> If deleting the service should delete the resource, it goes in the service's
> `k8s/` dir. If the resource outlives any single service (Namespace,
> ClusterRole, ingress controller, kind config), it goes in `platform/`.

## 3. Current state (context for a fresh session)

- Repo: `sample-cluster` — kind cluster (1 control-plane + 2 workers), deployed
  by idempotent `./recreate-cluster.sh` (kind delete/create → ingress-nginx
  pinned controller-v1.13.1 → docker build + kind load → `kubectl apply -f
  <component>/k8s/` in order Prometheus → Grafana → NGINX → Vault → python-app
  → go-app → frontend-app → documentation → waits → Ansible Grafana
  dashboards).
- **Everything runs in the `default` namespace. There are zero ServiceAccounts,
  Roles, ClusterRoles, or namespace declarations in the repo** (verified by
  grep). All pods use the `default` SA with its auto-mounted token.
- Components and their `k8s/` dirs:
  - `monitoring/prometheus/k8s/` — prometheus-deployment.yaml (Deployment+Service),
    prometheus-config.yaml (ConfigMap, **static scrape targets**:
    `nginx-exporter:9113`, `node-exporter:9100`, `python-app-service:8000`,
    `go-app-service:8080`), prometheus-ingress.yaml, node-exporter.yaml
    (DaemonSet hostNetwork/hostPID + Service)
  - `monitoring/grafana/k8s/` — grafana-deployment.yaml, grafana-ingress.yaml, secrets.yaml
  - `nginx/k8s/` — nginx-deployment.yaml, nginx-config.yaml, configmap.yaml,
    nginx-exporter.yaml, nginx-ingress.yaml
  - `vault/k8s/` — vault-deployment.yaml (contains `vault-service`),
    vault-configure-job.yaml (Job, idempotent KV mounts `services/` + `infra/`),
    vault-ingress.yaml
  - `python-app/k8s/`, `go-app/k8s/`, `frontend-app/k8s/`, `documentation/k8s/`
    — each Deployment(+Service) + Ingress
- Cross-namespace-sensitive references found by grep:
  - `VAULT_ADDR=http://vault-service:8200` in go-app/python-app Deployments and
    vault-configure Job (code defaults in `go-app/internal/vaultclient/client.go`
    and `python-app/src/vault_client.py` also say `http://vault-service:8200`,
    but in-cluster the env var always wins — leave code untouched)
  - Prometheus static targets (see above)
  - Grafana datasource: `prometheus_url: "http://prometheus:9090"` in
    `monitoring/grafana/ansible/setup-datasource.yaml`
- `recreate-cluster.sh` namespace-sensitive commands: `kubectl wait ...
  deployment --all`, `kubectl get pods --field-selector=...`,
  `kubectl wait ... job/vault-configure`.
- CI debug step in `.github/workflows/e2e.yaml` (lines 44–48): iterates
  `kubectl get deployments -o name` in the default namespace for logs.
- e2e tests (`e2e/`, `make test-e2e`) talk **only** to ingress hosts
  (`*.localhost`), never kubectl — unaffected by namespace moves.
- `kind-cluster.yaml` sits at repo root, referenced by `recreate-cluster.sh`
  (`kind create cluster --config kind-cluster.yaml`).

## 4. Target file structure

```
platform/                              # NEW — cluster-scoped / shared resources
├── README.md                          # ownership rule of thumb
├── kind-cluster.yaml                  # moved from repo root
├── namespaces.yaml                    # Namespaces: apps, monitoring, vault
└── rbac/
    └── prometheus.yaml                # ClusterRole + ClusterRoleBinding (Phase 2 only)

<component>/k8s/                       # unchanged location, extended contents
├── <component>-deployment.yaml        # + namespace, serviceAccountName,
│                                      #   automountServiceAccountToken: false
├── <component>-serviceaccount.yaml    # NEW — one SA per workload
└── <component>-ingress.yaml           # + namespace
```

Namespace assignment:

| Namespace    | Components |
|--------------|------------|
| `apps`       | python-app, go-app, frontend-app, nginx (+ exporter), documentation |
| `monitoring` | prometheus, grafana, node-exporter |
| `vault`      | vault, vault-configure job |

ServiceAccounts (one per workload, named after it): `python-app`, `go-app`,
`frontend-app`, `nginx`, `documentation`, `prometheus`, `grafana`,
`node-exporter`, `vault`, `vault-configure`. All get
`automountServiceAccountToken: false` — none of these workloads call the
Kubernetes API (exception: `prometheus` in Phase 2).

## 5. Implementation steps

### Phase 1 — layout + namespaces + ServiceAccounts (no-privilege baseline)

1. Create `platform/namespaces.yaml` (three Namespace objects) and
   `platform/README.md`; `git mv kind-cluster.yaml platform/`.
2. Add explicit `metadata.namespace` to **every** manifest in every
   `<component>/k8s/` dir (Deployments, Services, ConfigMaps, Secrets,
   Ingresses, Job, DaemonSet).
3. Add `<component>-serviceaccount.yaml` per component; set
   `serviceAccountName` + `automountServiceAccountToken: false` in each pod
   spec.
4. Fix cross-namespace DNS:
   - go-app/python-app Deployments: `VAULT_ADDR=http://vault-service.vault:8200`
     (vault-configure Job stays same-namespace, short name still valid — make
     it explicit anyway for consistency).
   - `prometheus-config.yaml` targets: `python-app-service.apps:8000`,
     `go-app-service.apps:8080`, `nginx-exporter.apps:9113`,
     `node-exporter.monitoring:9100`.
   - `setup-datasource.yaml`: `prometheus_url: "http://prometheus.monitoring:9090"`.
5. Update `recreate-cluster.sh`:
   - `kind create cluster --config platform/kind-cluster.yaml`
   - Apply `platform/namespaces.yaml` (and `platform/rbac/` if present) right
     after ingress-nginx install, before any component.
   - Namespace-aware waits: `kubectl wait --for=condition=available
     --timeout=300s deployment --all -n apps` (repeat for `monitoring`,
     `vault`), failed-pod check with `-A` (exclude `kube-system`/
     `local-path-storage` noise if needed), `kubectl wait ...
     job/vault-configure -n vault`.
6. Update CI debug step in `.github/workflows/e2e.yaml` to use `-A`
   (`kubectl get deployments -A` + `kubectl logs -n <ns>`).

### Phase 2 (optional — the real RBAC consumer)

Switch Prometheus from static targets to Kubernetes service discovery. This is
the only workload in the cluster with a genuine need for API permissions, so it
is the honest RBAC example; everything else correctly has zero permissions.

1. `platform/rbac/prometheus.yaml`: ClusterRole (`get/list/watch` on `nodes`,
   `services`, `endpoints`, `pods`; nonResourceURL `/metrics`) +
   ClusterRoleBinding to SA `prometheus` in `monitoring`.
2. Prometheus SA: remove `automountServiceAccountToken: false` (it needs the
   token).
3. `prometheus-config.yaml`: replace the four static jobs with one
   `kubernetes_sd_configs` (role: endpoints) job filtered on annotations;
   annotate each scrape-target Service with `prometheus.io/scrape: "true"` +
   `prometheus.io/port`. Bonus: new services are auto-discovered, matching the
   repo's `adding-a-service.md` auto-discovery convention.
4. Verify every existing Grafana dashboard query still matches the new job
   labels (relabel to keep `job` names identical: `self`, `nginx-metrics`,
   `node-exporter`, `python-app`, `go-app`).

## 6. Acceptance criteria

- [ ] `./recreate-cluster.sh` completes cleanly from scratch, twice in a row
      (idempotency preserved).
- [ ] `kubectl get all -n default` shows only the `kubernetes` Service —
      no workloads left in `default`.
- [ ] Every pod spec has a dedicated `serviceAccountName`;
      `automountServiceAccountToken: false` everywhere (except prometheus in
      Phase 2).
- [ ] `kubectl auth can-i list pods --as=system:serviceaccount:apps:go-app`
      returns `no` (spot-check least privilege).
- [ ] All eight ingress hosts respond (`*.localhost`).
- [ ] Secret round-trip works cross-namespace: `POST /secret` + `GET
      /secret/{key}` on both python.localhost and go.localhost.
- [ ] Grafana dashboards show live traffic (datasource + scrape targets fixed).
- [ ] Phase 2 only: Prometheus targets page shows all jobs `UP` via service
      discovery; dashboards unchanged.

## 7. Testing suite

1. `make test-unit` — unchanged code paths, must stay green.
2. `./recreate-cluster.sh && make test-e2e` — full black-box suite via ingress
   hosts (covers backend contract, Vault round-trip, CORS, traffic →
   Prometheus → Grafana pipeline).
3. Manual: `kubectl get pods -A`, `kubectl auth can-i` checks above, rerun
   `./recreate-cluster.sh` for idempotency.
4. CI: `.github/workflows/e2e.yaml` must pass (it runs the same flow on
   Ubuntu).

## 8. Security considerations

- Least privilege is the point: SAs exist per workload with **no** RoleBindings
  and no mounted tokens by default; permissions are added only where a real API
  consumer exists (Prometheus, Phase 2).
- Prometheus ClusterRole is read-only (`get/list/watch`) and enumerates only
  discovery resources — no secrets, no write verbs.
- Namespaces create the boundary that future work can build on: per-namespace
  NetworkPolicies and per-service Vault policies (the existing
  `services/<service>/` KV layout already anticipates this). **Do not add these
  now** — out of scope.
- Vault dev-mode root token in env vars is unchanged and out of scope for this
  refactor.

## 9. Documentation updates required (after implementation)

- `documentation/docs/design.md` — Deployment section (new `platform/` dir,
  apply order, namespace table), Conventions (ownership rule of thumb,
  SA-per-workload rule); routing map unchanged.
- `documentation/docs/adding-a-service.md` — new checklist items: namespace,
  ServiceAccount, (Phase 2) scrape annotations instead of static target.
- `documentation/docs/vault.md` — in-cluster DNS name change
  (`vault-service.vault:8200`).
- `documentation/docs/monitoring.md` — scrape target names (Phase 1) or
  service-discovery mechanism (Phase 2).
- Component `README.md`s that mention `kubectl apply` or service DNS.
- Root `README.md` if it references `kind-cluster.yaml` at the root.

## 10. Design alignment

- Keeps the design doc's core convention: "Each component directory is
  self-contained" — SAs and namespaced RBAC stay with the component.
- Keeps `recreate-cluster.sh` as the single idempotent entry point; `platform/`
  is just a new first apply step.
- YAGNI respected: no Kustomize/Helm, no overlays, no NetworkPolicies, no
  per-service namespaces, no Vault policy work — only what ServiceAccounts +
  RBAC actually require.

## Unresolved questions

1. Do Phase 2 (Prometheus service discovery + ClusterRole) now, or stay with
   static targets and no cluster RBAC yet?
2. Namespace granularity OK (`apps` / `monitoring` / `vault`), or do you want
   one namespace per service?
3. Move `kind-cluster.yaml` into `platform/`, or leave at repo root?
4. Should `documentation` (MkDocs) live in `apps` or `monitoring`… or a
   separate `docs` namespace? (Plan assumes `apps`.)
