# TimescaleDB

PostgreSQL 17 + TimescaleDB, stock-app's database. StatefulSet with a 2Gi PVC in namespace `data`,
reachable only inside the cluster at `timescaledb-service.data:5432` (database `stockdata`, user `stockapp`).

- The schema is created by stock-app's Alembic migrations (`stock-app/migrations/`), run by its init container.
- Data survives pod restarts but not `./recreate-cluster.sh`; stock-app refetches what it needs.
- The password Secret exists twice (`data` and `apps` namespaces) because Secrets can't cross namespaces.

```sh
kubectl exec -it timescaledb-0 -n data -- psql -U stockapp -d stockdata
```
