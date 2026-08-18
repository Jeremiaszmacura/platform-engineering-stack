# Platform Engineering Decisions

This page records the architectural decisions for the platform engineering,
related to cluster configuration, deployment and management.

## Repository layout

Resources are split by **ownership**, not by resource kind:

* Cluster-scoped and shared resources live in the `platform/` directory: the
  kind cluster definition, Namespaces, and cluster-wide RBAC
  (ClusterRole/ClusterRoleBinding). `recreate-cluster.sh` applies `platform/`
  before any component.
* Namespaced resources owned by one component (Deployments, Services,
  Ingresses, ConfigMaps, ServiceAccounts, DaemonSets, Jobs) live in that
  component's `k8s/` directory, next to the code they deploy.

Rule of thumb: **if deleting the service should delete the resource, it lives
with the service; if the resource outlives any single service, it lives in
`platform/`.**

`platform/` therefore holds exactly three things:

| File | Purpose |
|---|---|
| `kind-cluster.yaml` | kind cluster definition (3 nodes, host port 80 → ingress) |
| `namespaces.yaml` | Namespaces: `apps`, `monitoring`, `vault`, `docs`, `data` |
| `rbac/prometheus.yaml` | Read-only ClusterRole + binding for Prometheus service discovery |

`recreate-cluster.sh` applies all of it before any component, so namespaces and
cluster-scoped RBAC exist by the time the first Deployment lands.

## Namespaces

One namespace per concern — `apps`, `monitoring`, `vault`, `docs`, `data` —
declared in `platform/namespaces.yaml`. Every manifest sets
`metadata.namespace` explicitly, so `kubectl apply -f` never depends on the
current kubectl context. Cross-namespace calls use namespace-qualified service
DNS (e.g. `http://vault-service.vault:8200`,
`timescaledb-service.data:5432`).

`data` holds stateful backing stores rather than the applications that use
them. TimescaleDB lives there while its client `stock-app` lives in `apps`:
the database outlives any one consumer, has a different blast radius, and is
the only workload in the cluster with a PersistentVolumeClaim.

## Rules for placing K8s resources

### ServiceAccounts

- Every workload runs under its own ServiceAccount, named after the workload
  and defined in the owning component's `k8s/` directory, next to that
  component's Deployment.
- Default posture is zero privilege: no Role or ClusterRole bindings, and
  `automountServiceAccountToken: false` so no API token is mounted. API access
  is added only for a real consumer — currently only Prometheus, which needs
  read-only discovery access for `kubernetes_sd_configs`.
- **Strict constraint:** never mix application-level ServiceAccounts into
  `platform/`. An application's identity is part of that application; keeping
  it in the platform directory hides who owns it and couples application
  changes to cluster-admin changes. Only the *cluster-scoped grant* — the
  ClusterRole and its ClusterRoleBinding — lives in `platform/rbac/`, while
  the ServiceAccount it binds stays with its component
  (`monitoring/prometheus/k8s/`).

### RBAC

- Namespaced Roles/RoleBindings (none needed today) would live with the
  component that consumes them.
- ClusterRoles/ClusterRoleBindings live in `platform/rbac/`, one file per
  consumer (e.g. `prometheus.yaml`), read-only unless a write need is proven.

### Stateful workloads

TimescaleDB is the only StatefulSet in the cluster. It is deployed from
`timescaledb/k8s/` like any other component — the ownership rule is about
*who owns the resource*, not about which controller manages it.

- `volumeClaimTemplates` requests 2Gi from kind's default `standard`
  StorageClass, producing the PVC `data-timescaledb-0`. It survives pod
  restarts but **not** `kind delete cluster`, so the database is always cold
  after `./recreate-cluster.sh`. That is acceptable here because `stock-app`
  refills it from its upstream provider on demand; a component that could not
  rebuild its data would need a different story.
- `PGDATA` points at a subdirectory of the mount rather than the mount point
  itself, because `initdb` refuses to initialize a directory it does not own.
- The database has **no Ingress**. Only HTTP services are published on
  `*.localhost`; everything else stays on cluster-internal DNS.

### Cross-namespace secrets

Kubernetes Secrets are namespace-scoped and cannot be referenced from another
namespace. The database password therefore exists as two manifests holding the
same literal — one in `data` for the server
(`timescaledb/k8s/timescaledb-secret.yaml`), one in `apps` for the client
(`stock-app/k8s/stock-app-secret.yaml`).

The alternatives are worse for a playground: an operator to replicate secrets,
or moving both to Vault, which would make every service depend on Vault being
up before it can start. Both READMEs point at the duplicate, and Vault remains
the eventual single source of truth.
