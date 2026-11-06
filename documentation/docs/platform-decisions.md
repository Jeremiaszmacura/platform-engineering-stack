# Platform Decisions

Short records of how the cluster is organized and why.

## Where Kubernetes files live

- A resource that belongs to one component (Deployment, Service, Ingress, ConfigMap, Secret, ServiceAccount)
  lives in that component's `k8s/` directory. **Why:** the owner of a component can see and change everything about it in one place.
- Cluster-wide setup (the kind config, the ingress controller) lives at the repo root and in `recreate-cluster.sh`.
- All workloads run in the `default` namespace. **Why:** one small learning cluster; namespaces can come when they are needed.

## How Prometheus finds targets

- One-replica apps are scraped by Service name (`static_configs`).
- Multi-instance targets (node-exporter on every node, nginx-exporter in every nginx pod) are found with DNS
  on a headless Service (`dns_sd_configs`). **Why:** scraping a normal Service hits a random pod each time and mixes the numbers.
  DNS discovery needs no extra Kubernetes permissions.

## Images

- Third-party images are pinned to an exact version; base images to a minor line (e.g. `golang:1.26-alpine`) so they get security patches.
- Our own images run as a non-root user.

## Secrets

- Dev credentials are kept in one Kubernetes Secret per tool and referenced from everywhere else.
  They are fine only because this is a local playground.
