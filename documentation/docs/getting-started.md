# Getting Started

This guide helps you deploy the local Kubernetes cluster with all its
applications.

## Prerequisites

Before you begin, ensure you have the following installed:

- Docker (kind runs the cluster nodes as containers)
- kind (local Kubernetes cluster)
- kubectl (for interacting with the cluster)
- Ansible (`ansible-playbook` provisions the Grafana datasource and dashboards during deployment)
- Python 3.13 or higher and pip (for running the end-to-end test suite)

## Run local Kubernetes cluster with all applications

```sh
./recreate-cluster.sh
```

When the script finishes, every service is reachable through the ingress on
`*.localhost` hostnames — see the routing map in [Design](design.md). Key entry
points:

- Stock App (price charts): http://stock-ui.localhost
- API tester UI: http://app.localhost
- Grafana: http://grafana.localhost
- Stock data API: http://stock.localhost (Swagger UI at `/docs`)
- Vault UI: http://vault.localhost (token `root`)
- Documentation: http://docs.localhost
