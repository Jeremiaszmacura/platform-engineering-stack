# End-to-End Tests

Black-box tests that exercise the running cluster over HTTP, the same way a
user (or Prometheus) would. See [`documentation/docs/e2e-tests.md`](../documentation/docs/e2e-tests.md) for what each test file covers.

## Running

The suite expects the cluster to be up and reachable through the ingress on
port 80 (`*.localhost` hostnames resolve to loopback without any DNS setup):

```sh
./recreate-cluster.sh   # once, to (re)create the cluster
make test-e2e           # from the repository root
```

`make test-e2e` creates `e2e/.venv`, installs the pinned dependencies, and runs
pytest. To run tests directly during development:

```sh
cd e2e && .venv/bin/pytest tests/test_frontend.py
```

## Conventions

- Tests are black-box only: they talk to the cluster exclusively over HTTP,
  never to pods or kubectl.
- Eventual consistency (Prometheus scrapes, target discovery) is handled by
  polling with `cluster.wait_until`, never with bare sleeps.
- Tests that apply to several backends are parametrized via the `backend` and `secret_backend` fixtures
  in `conftest.py` instead of being duplicated.
- There is intentionally no `tox.ini` here: the root Makefile discovers unit-test
  suites by `tox.ini`, and this suite must not run as part of `make test-unit`
  because it needs a live cluster.
