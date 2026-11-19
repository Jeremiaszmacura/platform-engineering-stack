# Platform Engineering Stack

A small Kubernetes cluster that runs on your laptop, for learning platform engineering: a real stock-data service
(Python + TimescaleDB) with a chart UI, one Gateway (Envoy) for all incoming traffic, a secret store (Vault), and
observability: metrics (Prometheus), traces (OpenTelemetry and Tempo) and dashboards (Grafana).

## Start

Check the [prerequisites](https://jeremiaszmacura.github.io/platform-engineering-stack/#run), then run:

```sh
./recreate-cluster.sh
```

and open **http://docs.localhost**: the documentation, drawn live from your cluster. It shows how every component
works and connects, with diagrams, exercises and how to run, test and extend it.

Without a cluster, the same site shows a recorded snapshot: https://jeremiaszmacura.github.io/platform-engineering-stack/
