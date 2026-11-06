# Adding a Service

Checklist for a new component `my-service`. Copy an existing one (e.g. `go-app/`) as a start.

## 1. Code and image

- [ ] Create `my-service/` with the code and a `Dockerfile` (pinned base image, non-root user).
- [ ] Go: add `go.mod` — `make build`, `make test-unit-go` and `make lint-go` find it automatically.
- [ ] Python: add `tox.ini` (copy `python-app/tox.ini`), `requirements.txt`, `requirements-dev.txt`
      (`-r requirements.txt` + `-r ../requirements-dev.txt`) and `tests/test_*.py` —
      `make test-unit-python` and `make lint-python` find it automatically.

## 2. Kubernetes

- [ ] `my-service/k8s/` with a Deployment (`name` and `app` label = `my-service`), a Service
      `my-service-service` and an Ingress `my-service-ingress` for host `my-service.localhost`.
- [ ] Add resource requests/limits, a readiness probe and a non-root `securityContext`.

## 3. Cluster script

- [ ] In `recreate-cluster.sh`, add the image to `IMAGES` (if built locally), the `k8s/` directory to
      `COMPONENTS`, and the URL to `URLS`.

## 4. Monitoring (if it exposes `/metrics`)

- [ ] Add a scrape job in `monitoring/prometheus/k8s/prometheus-config.yaml`.
- [ ] Add a dashboard JSON in `monitoring/grafana/ansible/dashboards/` with a fixed `uid` and every query filtered by `job="my-service"`.

## 5. Tests and docs

- [ ] Add the URL to `SERVICE_URLS` in `e2e/cluster.py` and e2e tests for its workflows.
- [ ] Add `documentation/docs/services/my-service.md`, link it in `mkdocs.yml` and the table in `index.md`.
- [ ] Keep `my-service/README.md` to a one-line link to that page.

## 6. Verify

```sh
make lint && make test-unit
./recreate-cluster.sh && make test-e2e
```
