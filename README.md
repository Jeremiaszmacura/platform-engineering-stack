# Platform Engineering Stack

A small Kubernetes cluster that runs on your laptop, for learning platform engineering.
It has two sample backends (Python, Go), a test web page, nginx, Vault for secrets,
and Prometheus + Grafana to watch the traffic.

## Start

You need Docker, kind, kubectl and Ansible. Then:

```sh
./recreate-cluster.sh
```

Open http://app.localhost, send some requests, and watch them at http://grafana.localhost (`admin` / `admin`).

## Learn more

- Docs: https://jeremiaszmacura.github.io/platform-engineering-stack/ (also at http://docs.localhost)
- Commands: `make help`
- Adding a component: [documentation/docs/adding-a-service.md](documentation/docs/adding-a-service.md)
- Latest cleanup — what was found and what changed: [plans/repo-review-findings.md](plans/repo-review-findings.md)
