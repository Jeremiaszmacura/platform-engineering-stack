# cluster-map

Live, interactive map of the cluster at http://cluster-map.localhost (Go, namespace `monitoring`), for learning how
the pieces fit together: where each pod runs, how traffic enters through the Gateway, who calls whom, Services and
DNS names, request paths,
ServiceAccounts and RBAC, Secrets and storage, plus live checks for weak spots.

- **How it reads the cluster:** client-go informers (plus the Gateway API's generated informers for Gateways and
  HTTPRoutes) LIST each object kind once, then keep a WATCH open, so an in-memory copy follows the cluster. `GET /api/map` builds the map from that copy; the page polls it every 5s.
- **Identity:** its own ServiceAccount, with a token mounted on purpose, and a read-only ClusterRole
  (`platform/rbac/cluster-map.yaml`). No access to Secrets: their names and keys come from pod specs. Two Roles
  limited by `resourceNames` allow reading the `kube-proxy` and `prometheus-config` ConfigMaps.
- **Endpoints:** `/` (page), `/api/map` (JSON), `/health` (ready once informers have synced), `/metrics`.
- **Code:** `internal/topology` turns API objects into the map (pure, unit-tested), `internal/cluster` holds the
  informers, `internal/server` the HTTP routes, `web/index.html` the page (embedded in the binary).

Exposing cluster internals without login is fine on a laptop cluster, never on a real one.

```sh
cd cluster-map
go test ./... && golangci-lint run
go run .    # outside the cluster it uses your kubeconfig: http://localhost:8080
```
