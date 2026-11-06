# Repository cleanup — found and changed (2026-11-06)

Review of `main` before adding new services. `feature/stock-app-migration` was **not** merged.

## Bugs

| ID | Found | Changed |
|---|---|---|
| B1 | Python dashboard also counted go-app traffic (no `job` filter). | Every app query is filtered by `job`. |
| B2 | node-exporter scraped through one Service → random node each time; control-plane not covered. | Headless Service + DNS discovery: one target per node; runs on all 3 nodes. |
| B3 | nginx-exporter read a random nginx pod each time; docs called it a "sidecar" but it wasn't. | Exporter is now a real sidecar; each pod scraped separately. |
| B4 | nginx "HTTP Response Codes" panel was always empty (no such label). | Panel removed; other panels sum the pods. |
| B5 | Panel "Total HTTP Requests (Including Monitoring)" was wrong; filters did nothing. | Renamed to "Total App Requests"; dead filters removed. |
| B6 | Docs link (README, `mkdocs.yml`) gave 404. | Points to `/platform-engineering-stack/`. |
| B7 | `recreate-cluster.sh` accepted 503 as "ready", skipped 3 hosts, flagged the finished Vault job pod as failed. | `curl -f`, checks all 8 URLs, ignores completed Job pods. |
| B8 | Backends disagreed on bad input (400 vs 422, empty value, `/` in key); Python crashed (500) on a secret without `value`. | Both: 422 for bad input, same key rule, 502 for a broken secret. |

## Removed (unused)

| ID | Found | Changed |
|---|---|---|
| U1 | `nginx/k8s/configmap.yaml` (`ENV: prod`) never read. | Deleted. |
| U2 | Fake "prod" Ansible playbook and scripts. | Deleted; one `provision.yaml` entry point. |
| U3 | Unused frontend packages, missing favicon. | Gone with the Vite migration (C8). |
| U4 | Leftover local folders `stock-app/`, `documentation/hooks/` (caches only). | Deleted locally (they were never tracked). |
| U5 | Copy-pasted `.dockerignore` files. | Rewritten per folder. |

## Docs

| ID | Found | Changed |
|---|---|---|
| E1 | `documentation/README.md` was a template that claimed the MIT license. | Short pointer to the docs. |
| E2 | `platform-decisions.md` pointed to a folder that doesn't exist. | Rewritten to match the repo. |
| E3 | Vault e2e tests missing from the e2e docs. | Listed. |
| E4 | Grafana Ansible README was stale. | Short pointer to the docs. |
| E5 | No docs page per component; READMEs out of date. | New `docs/services/*.md` pages; READMEs only link to them. |
| E6 | "Adding a Service" covered only the Makefile and had a wrong claim. | Full checklist (code, k8s, script, monitoring, tests, docs). |
| E7 | Four different project names. | "Platform Engineering Stack" everywhere. |
| E8 | Typos and wrong claims in READMEs and `design.md`. | Fixed while rewriting. |

## CI and tooling

| ID | Found | Changed |
|---|---|---|
| C1 | Go unit tests never ran in CI. | `go-qa.yaml` runs lint + tests. |
| C2 | `make lint-go` used `--fix` (rewrote files, hid problems in CI). | Lint only reports. |
| C3 | golangci-lint installed by piping a script from `master`. | `go install …@v2.10.1`. |
| C4 | Python CI misnamed and ran twice per PR. | `python-qa.yaml`: PRs + `main` only. |
| C5 | Python 3.9/3.12/3.13/3.14 mixed; docs deps unpinned; docs served by a dev server. | 3.14 everywhere; pinned deps; static site on nginx. |
| C6 | pre-commit: duplicated hook, old versions, YAML/JSON never checked. | Runs on the whole repo; versions bumped. |
| C7 | Makefile had a fake `format` target and an incomplete help. | `make help` is the default and complete. |
| C8 | Frontend on deprecated Create React App + EOL Node 18, no lockfile, not built in CI. | Vite + React 19, Node 24, `package-lock.json`, `frontend-qa.yaml`. |

## Code and Kubernetes

| ID | Found | Changed |
|---|---|---|
| G1 | `:latest` and untagged images. | All images pinned. |
| G2 | Go 1.20 and old deps: 31 known vulnerabilities reachable. | Go 1.26.10 + updated deps: 0 reachable. Reproducible Docker build. |
| G3 | No resource limits, few probes, everything as root. | Requests/limits + probes on all; our images and most others run non-root. |
| G4 | Mixed names/labels (`*-pod`, `*-deployment`, `prometheus`). | Deployment/label = component, `<name>-service`, `<name>-ingress`. |
| G5 | python-app wrote log files inside the container. | Logs to stdout only. |
| G6 | Go handlers untestable and untested; Gin in debug mode. | Small interface + table tests; `GIN_MODE=release`; metric vars private. |
| G7 | Missing Python docstrings; `time.time()` for latency. | Added; `perf_counter()`. |
| G8 | Grafana datasource never updated after creation; dashboards had no `uid`. | Create-or-update; fixed `uid` per dashboard and datasource. |
| G9 | Dev passwords copied in many files. | One Secret each (`grafana-admin-secret`, `vault-dev-token`) + Ansible `vars.yaml`; no token default in code. |
| G10 | Claude tooling broken: `go-idiomatist` agent didn't load, deep-review script missing, Go rules cut off. | Fixed agent header, added `go_signal.sh`, completed the rules. |
| G11 | Root `CLAUDE.md` duplicated `.claude/` rules; a self-contradicting rule; naming drift. | Root file keeps project rules only; wording fixed; names aligned. |

## Not verified locally

Docker was not running, so the cluster itself was checked only by CI's e2e job (real kind cluster).
