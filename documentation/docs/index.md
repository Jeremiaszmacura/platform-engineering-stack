# DevOps Practice Project

A local Kubernetes playground (`kind`, 3 nodes) for practicing platform
engineering: deploying services, exposing metrics, provisioning dashboards as
code, and observing traffic end to end.

**This site is the only documentation for the repository.** Component
directories hold no prose — every `README.md` next to code is a stub pointing
at its page here.

## Start here

| If you want to… | Read |
|---|---|
| Bring the whole cluster up | [Getting Started](getting-started.md) |
| Understand how the pieces fit together | [Design](design.md) |
| Know why resources are laid out the way they are | [Platform Decisions](platform-decisions.md) |
| Work on one component | [Services](services/index.md) |
| Follow traffic from an app to a dashboard | [Monitoring](monitoring.md) |
| Add a new component | [Adding a Service](adding-a-service.md) |
| Check something before pushing | [Validation Rules](validation-rules.md) |
| See what the black-box suite covers | [End-to-End Tests](e2e-tests.md) |

## The components

Ten of them, each with its own page under [Services](services/index.md):
[go-app](services/go-app.md) is the sample backend,
[stock-app](services/stock-app.md) is a real data service over
[TimescaleDB](services/timescaledb.md),
[frontend-app](services/frontend-app.md) drives traffic at them,
[NGINX](services/nginx.md) is an off-the-shelf workload monitored through an
exporter, [Vault](services/vault.md) holds the secrets,
[Prometheus](services/prometheus.md) and [Grafana](services/grafana.md) are the
observability pipeline, and [Documentation](services/documentation.md) serves
this site.

```sh
./recreate-cluster.sh
```
