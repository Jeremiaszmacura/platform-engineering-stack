# Platform Decisions

Short records of how the cluster is organized and why.

## Where Kubernetes files live

- A resource that belongs to one component (Deployment, StatefulSet, Service, Ingress, ConfigMap, Secret,
  ServiceAccount, Job) lives in that component's `k8s/` directory. **Why:** the owner of a component can see
  and change everything about it in one place.
- Resources that outlive any single component live in `platform/`, applied by `recreate-cluster.sh` before
  any component:

| File | Purpose |
|---|---|
| `kind-cluster.yaml` | kind cluster (3 nodes, host port 80 → ingress) |
| `namespaces.yaml` | Namespaces `apps`, `monitoring`, `vault`, `docs`, `data` |
| `rbac/prometheus.yaml` | Read-only ClusterRole + binding for Prometheus service discovery |

Rule of thumb: if deleting the component should delete the resource, it lives with the component.

## Namespaces

- One namespace per concern: `apps`, `monitoring`, `vault`, `docs`, `data`. **Why:** each group has its own
  blast radius, and Prometheus discovery can be limited to the namespaces that hold our apps.
- Every manifest sets `metadata.namespace`, so `kubectl apply -f` never depends on the current context.
- `data` holds stateful backing stores, not the apps that use them: TimescaleDB lives there, its client
  stock-app lives in `apps`.

## Service accounts and RBAC

- Every workload runs under its own ServiceAccount (in its component's `k8s/`) with
  `automountServiceAccountToken: false`. **Why:** zero privilege by default; nothing can call the Kubernetes API.
- The only exception is Prometheus: it mounts its token because discovery asks the API which endpoints exist.
  The cluster-scoped grant (ClusterRole + ClusterRoleBinding) lives in `platform/rbac/`, the ServiceAccount
  stays with Prometheus.

## How Prometheus finds targets

- Prometheus uses Kubernetes service discovery (`endpoints` role) in the `apps` and `monitoring` namespaces.
  A Service opts in with two annotations: `prometheus.io/scrape: "true"` and `prometheus.io/job: <job name>`.
  **Why:** adding a service needs no Prometheus change, and each endpoint (every pod, every node) is
  scraped as its own target, so multi-pod numbers are never mixed.
- Only `apps` and `monitoring` are watched: kube-system components carry the same annotation.

## Stateful workloads

- TimescaleDB is a StatefulSet with a 2Gi PVC (`data-timescaledb-0`). It survives pod restarts but not
  `./recreate-cluster.sh`. **Why that is fine:** stock-app refills it from the provider on demand.
- The database has no Ingress; only HTTP services get a `*.localhost` host.

## Images

- Third-party images are pinned to an exact version; base images to a minor line (e.g. `golang:1.26-alpine`) so they get security patches.
- Our own images run as a non-root user.

## Secrets

- Dev credentials are kept in one Kubernetes Secret per tool and referenced from everywhere else.
  They are fine only because this is a local playground.
- Secrets cannot be read across namespaces, so a credential needed on both sides is declared twice in one
  place: `vault-dev-token` in `vault` and `apps` (`vault/k8s/vault-dev-token.yaml`), and the database password
  in `data` (`timescaledb/k8s/`) and `apps` (`stock-app/k8s/`). Vault is the eventual single source.
