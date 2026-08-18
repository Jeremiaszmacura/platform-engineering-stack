# Prometheus

Scrapes every `/metrics` endpoint in the cluster and stores the series
[Grafana](grafana.md) queries. How discovery works and what each job measures
is on the [Monitoring](../monitoring.md) page; this page covers the component
itself.

| | |
|---|---|
| Directory | `monitoring/prometheus/` |
| Image | `prom/prometheus:latest` (public, pulled by the node) |
| Namespace | `monitoring` |
| Host | http://prometheus.localhost |

## Manifests

| File | Purpose |
|---|---|
| `prometheus-deployment.yaml` | Deployment + `prometheus` Service on 9090 |
| `prometheus-config.yaml` | ConfigMap holding `prometheus.yml` — the only scrape configuration |
| `node-exporter.yaml` | DaemonSet + annotated Service for per-node metrics |
| `prometheus-ingress.yaml` | Ingress for `prometheus.localhost` |
| `prometheus-serviceaccount.yaml` | ServiceAccount — **the one exception** to the no-token rule |

The cluster-scoped grant lives apart from the ServiceAccount, in
`platform/rbac/prometheus.yaml`: a read-only ClusterRole over nodes, services,
endpoints and pods, plus `/metrics`. Prometheus is the only workload in the
cluster that mounts an API token, and it needs one because
`kubernetes_sd_configs` asks the API server which endpoints exist. See
[Platform Decisions](../platform-decisions.md).

## Two kinds of target

**Cluster metrics** come from `node-exporter`, a DaemonSet — one pod per node,
each reporting its host's CPU, memory, disk and network. A DaemonSet rather
than a Deployment because the point is coverage of every node, not a replica
count.

**Application metrics** come from anything that serves Prometheus text format
on `/metrics` and whose Service carries the two opt-in annotations. Adding a
service therefore needs no edit here — see
[Adding a Service](../adding-a-service.md).

## Storage

None configured: the default local, in-pod TSDB. History dies with the pod,
which is the right trade for a playground that is recreated from scratch. Any
dashboard meant to survive belongs in
`monitoring/grafana/ansible/dashboards/`, not in the database.

## Redeploy into a running cluster

```sh
kubectl apply -f monitoring/prometheus/k8s/
kubectl rollout restart deployment prometheus -n monitoring
```

The restart is what picks up an edited `prometheus-config.yaml` — the config
is mounted from a ConfigMap and Prometheus is not started with a reload
sidecar.

Useful checks:

```sh
curl -s http://prometheus.localhost/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health}'
curl -s 'http://prometheus.localhost/api/v1/query?query=up' | jq
```
