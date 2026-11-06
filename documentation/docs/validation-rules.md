# Validation Rules

This project is developed with AI coding agents in the loop (see the root
`CLAUDE.md` and `.claude/` directory), so "run the tests" needs to be a
concrete, discoverable checklist rather than something an agent has to guess.
This page maps **kind of change → what must be run** before that change is
considered validated, so any agent (or human) can self-verify before calling
a task done instead of declaring success without evidence.

It complements, not replaces, two things that already exist:

- [Adding a Service](adding-a-service.md) — how new Go/Python services are
  auto-discovered by the Makefile.
- [End-to-End Tests](e2e-tests.md) — what the black-box `e2e/` suite covers
  and how to scope it.

## Automatic hooks

A subset of validation already runs without being asked, via Claude Code
hooks (`.claude/settings.json`, scripts in `.claude/hooks/`):

| Trigger | Runs automatically | Command |
|---|---|---|
| Any `.go` file edited this session | on Stop | `make tidy-go`, `make lint-go`, `make test-unit-go` |
| Any `.py` file or an `openapi.yaml` edited this session | on Stop | `make lint-python`, `make test-unit-python` |

These only cover unit-level checks scoped to the file's own service — they
never rebuild images, redeploy the cluster, or run the e2e suite. Everything
in the table below has to be run explicitly by whoever (or whatever) made the
change.

## Validation by change type

### Go service code

**Files:** `<service>/**/*.go`, `<service>/go.mod` (currently `go-app`; any
future directory containing a `go.mod`)

1. `make tidy-go` — keeps `go.mod`/`go.sum` minimal and consistent (also runs
   automatically, see above)
2. `make build-go`
3. `make lint-go`
4. `make test-unit-go`
5. If the change touches go-app's sample contract (`/`, `/health`,
   `/error`, `/redirect`, `/metrics`, `/secret`), also run `make test-e2e` —
   `test_backend_workflows.py` and `test_vault_workflows.py` exercise it.

### Python service code

**Files:** `<service>/src/**/*.py`, `<service>/tests/**/*.py` (`stock-app`)

1. `make lint-python` — black formatting and bandit security scan for every
   service; `stock-app` additionally enforces its hexagonal layering via
   `lint-imports` (import-linter), see [Design](design.md)
2. `make test-unit-python`
3. For `stock-app`, also run
   `E2E_PYTEST_ARGS='-k stock -m "not external"' make test-e2e`
   (`test_stock_api.py` — every endpoint against the published contract — and
   `test_stock_workflows.py` — metrics and the cache-aside pipeline)

### OpenAPI contract

**Files:** `stock-app/openapi.yaml`

The contract is the source of that service's HTTP models, so editing it is not
finished until they are regenerated (see [stock-app](services/stock-app.md)):

1. `cd stock-app && tox -e api` — regenerates
   `src/adapters/inbound/http/models.py`
2. `make lint-python` — regenerates into a temporary file and diffs, so it
   fails if step 1 was skipped
3. `make test-unit-python` — `test_openapi_contract.py` fails if the routes and
   the contract stop declaring the same operations
4. Adding, removing or renaming an operation is an API change: rebuild and
   reload the image, then
   `E2E_PYTEST_ARGS='-k stock -m "not external"' make test-e2e` —
   `test_stock_api.py` validates live responses against the contract the pod
   now publishes, so a stale image fails here
5. `mkdocs build --strict -f documentation/mkdocs.yml` — the published site
   renders this file, so a contract that no longer parses breaks the docs
   build too

### Frontend app code

**Files:** `frontend-app/**`, `stock-ui/**`

No Claude Code hook is wired for JS yet, so this has to be run manually, in
the directory of the app that changed (both are Vite builds, Node.js 24):

1. `npm ci && npm test` — stock-ui only: Vitest + React Testing Library
2. `npm run build` — production build into `dist/`; `make build-frontend`
   builds both apps, which is what `.github/workflows/frontend-qa.yaml` runs
3. The end-to-end suite for that app:
   - `frontend-app` → `E2E_PYTEST_ARGS='-k frontend' make test-e2e`
     (`test_frontend.py`)
   - `stock-ui` → `E2E_PYTEST_ARGS='-k stock_ui' make test-e2e`
     (`test_stock_ui.py`)

   Both check the same two things for their own app: the SPA is served, and
   the backend ingresses answer its cross-origin calls with CORS headers.

### Kubernetes manifests

**Files:** any `*/k8s/*.yaml`, `platform/**`

1. `kubectl apply --dry-run=client -f <file> -o yaml` against a live cluster
   context — the cheapest syntax/schema check, and the same idempotent-apply
   pattern used everywhere in this project (see Design → Conventions)
2. `./recreate-cluster.sh` — the real gate: applies everything and waits for
   rollout. Dry-run only checks shape, not scheduling, RBAC, or DNS, so a
   manifest change is not validated until it has actually rolled out.
3. `make test-e2e` — confirms the component is reachable end to end, not
   just that the manifest applied

`make lint-python` runs the repo-wide pre-commit hooks, so `check-yaml`
catches YAML syntax errors in every manifest; it does not know the Kubernetes
schema, which is what step 1 is for.

### Observability / monitoring changes

Two different delivery mechanisms, so two different paths:

- **Prometheus** (`monitoring/prometheus/k8s/prometheus-config.yaml`, or a
  `prometheus.io/scrape`/`prometheus.io/job` annotation on any Service):
  redeploy (`./recreate-cluster.sh`, or
  `kubectl apply -f monitoring/prometheus/k8s/`), then
  `E2E_PYTEST_ARGS='-k monitoring_pipeline' make test-e2e` —
  `test_monitoring_pipeline.py` checks the target actually shows up `up` in
  Prometheus.
- **Grafana dashboards** (`monitoring/grafana/ansible/dashboards/*.json`):
  validate JSON first (`python3 -m json.tool <file>` — a malformed file
  fails the Ansible upload silently otherwise), then
  `ansible-playbook monitoring/grafana/ansible/provision.yaml` (idempotent,
  safe to re-run on its own), then the same `test_monitoring_pipeline.py`
  run to confirm the dashboard is provisioned.
- A change to app-side instrumentation itself
  (`go-app/internal/appmetrics/prometheus.go`,
  `stock-app/src/observability/metrics.py`) is a Go/Python service change —
  follow that section first, then re-check that any dashboard reading the
  changed metric still resolves.

### Vault / secrets changes

**Files:** `vault/**`, or `VAULT_ADDR`/`VAULT_TOKEN`/`VAULT_SECRET_PATH`
wiring in any service Deployment

Run `./recreate-cluster.sh` (waits on the idempotent `vault-configure` Job),
then `E2E_PYTEST_ARGS='-k vault_workflows' make test-e2e` —
`test_vault_workflows.py` covers `POST /secret` / `GET /secret/{key}` on
go-app and stock-app, and that neither can read the other's secrets.

### Documentation changes

**Files:** `documentation/docs/**`, `documentation/mkdocs.yml`,
`documentation/hooks/**`

Run `mkdocs build --strict -f documentation/mkdocs.yml` (needs
`pip install -r documentation/requirements.txt`) — `--strict` turns broken
internal links and bad markdown-extension syntax into a build failure,
matching `.github/workflows/docs.yml`. A new page still needs to be added to
`nav:` in `mkdocs.yml` by hand — `--strict` does not fail on an orphaned page
that isn't linked from `nav`.

### CI workflow changes

**Files:** `.github/workflows/*.yaml`

No local runner is set up in this repo. At minimum, validate YAML syntax
(`python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" <file>`)
and check that the job calls existing `make` targets rather than inlining
commands the Makefile already defines — every workflow here
(`go-qa.yaml`, `python-qa.yaml`, `frontend-qa.yaml`, `e2e.yaml`) is a thin
wrapper around one. Full validation only happens once the change actually runs in
GitHub Actions on a pull request.

### Deployment script changes

**Files:** `recreate-cluster.sh`

`recreate-cluster.sh` must stay idempotent (see the root `CLAUDE.md`). Run
it twice in a row against the same cluster and confirm the second run makes
no unexpected changes and still ends healthy, then `make test-e2e`.

### Claude Code configuration changes

**Files:** `.claude/**`, `CLAUDE.md`

Validate `.claude/settings.json` is well-formed JSON
(`python3 -m json.tool .claude/settings.json`), then make a trivial edit to
a `.go` or `.py` file and confirm the expected hook actually fires — a wrong
`matcher` or path fails silently from the user's point of view.

## Summary

| Change type | Fast local check | Full validation |
|---|---|---|
| Go service | `make lint-go` + `make test-unit-go` (auto) | + `make test-e2e` |
| Python service | `make lint-python` + `make test-unit-python` (auto) | + `make test-e2e` |
| OpenAPI contract | `tox -e api` + `make lint-python` + `make test-unit-python` | + `make test-e2e` |
| Frontend | `npm test` (stock-ui) + `npm run build` | + `make test-e2e` |
| K8s manifests | `kubectl apply --dry-run=client` | `./recreate-cluster.sh` + `make test-e2e` |
| Monitoring/observability | JSON/YAML validate | redeploy + `make test-e2e` |
| Vault/secrets | — | `./recreate-cluster.sh` + `make test-e2e` |
| Docs | `mkdocs build --strict` | same |
| CI workflows | YAML syntax check | actual PR run |
| Deployment script | — | run twice + `make test-e2e` |
| Claude Code config | JSON validate | trigger the hook manually |

`make test-e2e` runs the whole suite against a freshly deployed cluster,
which is slow to repeat for every small change — scope it with
`E2E_PYTEST_ARGS='-k <keyword>'` as shown above, or see
[End-to-End Tests](e2e-tests.md) for the full list of suites and markers.
