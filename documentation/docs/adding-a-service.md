# Adding a Service

Copy an existing component (e.g. `go-app/`) and then:

1. **Code:** a `Dockerfile` (pinned base image, non-root). Go needs `go.mod`, Python needs `tox.ini` — the
   Makefile finds them. A Vite frontend goes into `FRONTENDS` in the `Makefile`.
2. **Kubernetes** (`my-service/k8s/`, namespace `apps`): Deployment `my-service`, Service `my-service-service`,
   Ingress `my-service-ingress` for `my-service.localhost`, ServiceAccount `my-service` with
   `automountServiceAccountToken: false`; requests/limits, readiness probe, non-root `securityContext`.
3. **Cluster script:** add it to `IMAGES`, `COMPONENTS` and `URLS` in `recreate-cluster.sh`.
4. **Metrics** (if any): annotate the Service with `prometheus.io/scrape: "true"` and `prometheus.io/job`;
   add a dashboard JSON with a fixed `uid` to `monitoring/grafana/ansible/dashboards/`.
5. **Tests and docs:** add the URL to `SERVICE_URLS` in `e2e/cluster.py`, e2e tests, a page in
   `documentation/docs/services/` (plus `mkdocs.yml` nav and the table in `index.md`), and a one-line README.
6. **Verify:** `make lint test-unit && ./recreate-cluster.sh && make test-e2e`.
