# Platform Engineering Stack

A small Kubernetes cluster that runs on your laptop, for learning platform engineering.
It has a real stock-data service (Python + TimescaleDB) with a chart UI, a sample Go backend,
a test web page, Vault for secrets, and Prometheus + Grafana to watch the traffic.

## Start

You need Docker, kind, kubectl and Ansible. Then:

```sh
./recreate-cluster.sh
```

Open http://stock-ui.localhost for stock charts, or http://app.localhost to send test requests,
and watch the traffic at http://grafana.localhost (`admin` / `admin`).

## Learn more

- Docs: https://jeremiaszmacura.github.io/platform-engineering-stack/ (also at http://docs.localhost)
- Commands: `make help`
- Adding a component: [documentation/docs/adding-a-service.md](documentation/docs/adding-a-service.md)
