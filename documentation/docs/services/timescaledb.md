# TimescaleDB

PostgreSQL 17 with the TimescaleDB extension, holding the market data written
by [stock-app](stock-app.md). It is the only stateful workload in the cluster
and the only one with a PersistentVolumeClaim.

| | |
|---|---|
| Directory | `timescaledb/` |
| Image | `timescale/timescaledb:2.28.3-pg17` (public, pulled by the node — no `kind load`) |
| Namespace | `data` |
| In-cluster DNS | `timescaledb-service.data:5432` |
| Host | **none** — no Ingress; only HTTP services are published on `*.localhost` |
| Database / role | `stockdata` / `stockapp` |

It lives in its own namespace rather than in `apps` because the database
outlives any single consumer and has a different blast radius from the
services that query it — see [Platform Decisions](../platform-decisions.md).

## Manifests

| File | Purpose |
|---|---|
| `k8s/timescaledb-statefulset.yaml` | StatefulSet (1 replica) + `timescaledb-service`, with `volumeClaimTemplates` |
| `k8s/timescaledb-secret.yaml` | `POSTGRES_PASSWORD` |
| `k8s/timescaledb-serviceaccount.yaml` | Zero-privilege ServiceAccount |

A StatefulSet rather than a Deployment: it gives the pod a stable identity
(`timescaledb-0`) and binds it to the same volume across restarts, which a
Deployment's `Recreate` strategy does not guarantee.

## Storage

`volumeClaimTemplates` requests 2Gi from kind's default `standard`
StorageClass, producing the PVC `data-timescaledb-0`. It survives pod restarts
but **not** `kind delete cluster`, so the database is always cold after
`./recreate-cluster.sh` — stock-app refills it from its provider on demand.

That is acceptable precisely because the data is rebuildable. A component that
could not reconstruct its contents would need a different story.

`PGDATA` points at a *subdirectory* of the mount
(`/var/lib/postgresql/data/pgdata`) because `initdb` refuses to initialize a
directory that is itself a mount point — the mount arrives with a
`lost+found` in it and no longer looks empty.

## Health checks

Both probes run `pg_isready -U stockapp -d stockdata` as an `exec` check. An
HTTP probe is not an option, and `pg_isready` is the one command that
distinguishes "process is up" from "accepting connections", which is what
stock-app's Alembic initContainer is waiting for.

## Schema

Owned entirely by [stock-app](stock-app.md#schema): Alembic revisions in
`stock-app/migrations/`, applied by an initContainer on every rollout of that
Deployment. Nothing in `timescaledb/` creates a table.

## A psql shell

```sh
kubectl exec -it -n data statefulset/timescaledb -- psql -U stockapp -d stockdata
```

```sql
SELECT symbol, first_synced_date, last_synced_date, last_synced_at FROM instruments;
SELECT count(*) FROM price_bars;
SELECT hypertable_name, num_chunks FROM timescaledb_information.hypertables;
SELECT version_num FROM alembic_version;
```

## Redeploy into a running cluster

```sh
kubectl apply -f timescaledb/k8s/
kubectl rollout status statefulset/timescaledb -n data
```

To start from an empty database, delete the claim as well — a StatefulSet does
not remove it for you:

```sh
kubectl delete statefulset timescaledb -n data
kubectl delete pvc data-timescaledb-0 -n data
kubectl apply -f timescaledb/k8s/
kubectl rollout restart deployment stock-app -n apps   # re-runs the migration
```

## Credentials

`POSTGRES_PASSWORD` comes from the `timescaledb-secret` Secret. Kubernetes
Secrets are namespace-scoped and cannot be referenced across namespaces, so the
same literal also exists in `stock-app/k8s/stock-app-secret.yaml` (namespace
`apps`), and the two have to be edited together.

Both are base64, **not** encrypted — dev playground only. [Vault](vault.md) is
the eventual single source; the reason it is not one today is recorded in
[Platform Decisions](../platform-decisions.md).
