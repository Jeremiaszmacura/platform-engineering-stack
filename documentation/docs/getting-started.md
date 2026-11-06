# Getting Started

## You need

- Docker (kind runs the cluster nodes as containers)
- kind and kubectl
- Ansible (`ansible-playbook` sets up Grafana)
- Python 3.14 (e2e tests and stock-app development)
- Optional for development: Go 1.26, Node.js 24

## Start the cluster

```sh
./recreate-cluster.sh
```

It deletes any old `sample-cluster`, creates a new one, builds and loads the images,
deploys every component and sets up Grafana. Run it as often as you like.

stock-app fetches prices from Yahoo Finance by default. To work offline, deploy it with the
recorded provider instead (this is what CI does):

```sh
STOCK_PROVIDER=fixture ./recreate-cluster.sh
```

When it finishes, open:

- Stock charts: http://stock-ui.localhost
- Test traffic: http://app.localhost
- Grafana: http://grafana.localhost (login `admin` / `admin`)
- Vault: http://vault.localhost (token `root`)
- Docs: http://docs.localhost

`*.localhost` always points to your own machine, so no DNS or `/etc/hosts` setup is needed.

## Check that everything works

```sh
make help        # list all targets
make test-unit   # Go and Python unit tests
make lint        # linters and repo-wide checks
make test-e2e    # end-to-end tests against the running cluster
```

What to run after a given kind of change: [Validation Rules](validation-rules.md).
