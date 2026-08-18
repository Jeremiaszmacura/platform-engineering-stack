# Adding a New Service

This project auto-discovers Go and Python services from the repo root `Makefile` —
no Makefile changes are needed when you add a new one. Follow the conventions
below so `make test`, `make lint`, and the Claude Code hooks pick it up correctly.

## Go services

A directory is discovered as a Go service if it contains a `go.mod`.

1. Create the service directory with its own `go.mod`.
2. That's it — `make build`, `make test-unit-go`, and `make lint-go` will find it
   automatically via `GO_SERVICES` in the root `Makefile`.

`make lint-go` runs `golangci-lint run --fix` inside each service directory;
`make test-unit-go` runs `go test ./...` inside each; `make tidy-go` runs
`go mod tidy` inside each. No shared config to copy.

## Python services

A directory is discovered as a Python service if it contains a `tox.ini`.

Lint rules and dev-tool versions are centralized at the repo root so they don't
get duplicated or drift per service:

- `/.pre-commit-config.yaml` — shared black/bandit/hygiene hooks
- `/requirements-dev.txt` — pinned `coverage`, `pre_commit`, `tox` versions

To add a new Python service:

1. Create the service directory with:
   - `requirements.txt` — the service's own runtime dependencies
   - `requirements-dev.txt` containing exactly:
     ```
     -r requirements.txt
     -r ../requirements-dev.txt
     ```
   - `tox.ini` — copy an existing service's `tox.ini` (e.g. `stock-app/tox.ini`)
     unchanged; it already points at `../.pre-commit-config.yaml`. Add a command
     to its `pre-commit` env only for a check the shared config cannot express,
     as `stock-app` does with `lint-imports` for its architecture contracts and
     a `datamodel-codegen` diff for its [OpenAPI contract](services/stock-app.md)
   - `tests/` with an `__init__.py` and `test_*.py` files (unittest discovery
     requires the `__init__.py` or tests silently won't be found)
   - `.coveragerc` if you need custom coverage `omit` paths — this one stays
     per-service since it's path-specific
2. Add the new directory name to the `files:` regex at the top of the root
   `.pre-commit-config.yaml`, e.g. `files: ^(stock-app|your-new-service)/`.
   This is the **only** shared-config edit required.

Do not create a per-service `.pre-commit-config.yaml` — it would run
`pre-commit run --all-files` scoped to the whole repo by default, since
pre-commit always resolves paths from the git root regardless of cwd. Scoping
must happen via the `files:` regex in the shared root config.

## Kubernetes manifests

Each service owns its manifests in `<service>/k8s/`; cluster-scoped resources
live in `platform/` (see [Platform Decisions](platform-decisions.md)). A new
service needs:

1. `<service>-deployment.yaml` — Deployment + Service in `namespace: apps`,
   with `serviceAccountName: <service>` in the pod spec.
2. `<service>-serviceaccount.yaml` — a dedicated ServiceAccount with
   `automountServiceAccountToken: false` (workloads get no Kubernetes API
   access by default; see [Platform Decisions](platform-decisions.md)).
3. `<service>-ingress.yaml` — an Ingress with host `<service>.localhost`.
4. To be scraped by Prometheus, annotate the Service — no Prometheus config
   change needed, targets are discovered through the Kubernetes API:

    ```yaml
    annotations:
      prometheus.io/scrape: "true"
      prometheus.io/job: <service>
    ```

5. Add a `kubectl apply -f <service>/k8s/` step (and the image build/load
   lines) in `recreate-cluster.sh`.

## Documentation

Documentation for a new component does **not** go in its `README.md`. All
documentation in this repository lives in the MkDocs site, so a fact is written
down in exactly one place:

1. Write `documentation/docs/services/<service>.md`. Existing pages are the
   template: a one-line purpose, a fact table (directory, image, namespace,
   host, Prometheus job), what the manifests do, how to redeploy into a running
   cluster, and how to run it on its own.
2. Add it to the `Services` section of `nav:` in `documentation/mkdocs.yml` —
   MkDocs will not surface a page that is not in the nav.
3. Add a row to the table in `documentation/docs/services/index.md` and to the
   component table in [Design](design.md).
4. Leave a stub `README.md` in the component directory pointing at the page, so
   someone browsing the repository on GitHub still finds it.
5. Build with `mkdocs build --strict` (CI does this on every push touching
   `documentation/`); a broken internal link fails the build.

See [Documentation](services/documentation.md) for the site's conventions.

## Verifying

```sh
make lint          # lint-go + lint-python across all discovered services
make test-unit      # test-unit-go + test-unit-python across all discovered services
```

Both commands stop at the first failing service (`||` chained), so during
local development it can help to run the language-specific target for just
the service you're working on, e.g. `cd your-service && tox -e tests`.
