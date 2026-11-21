# Project rules

Programming rules live in `.claude/rules/`: `clean-code.md` always applies, `go.md` loads only when working on Go files.

## Project

- `recreate-cluster.sh` is the single entry point that deploys the kind cluster. It must stay idempotent: running it again must not break anything.
- Each top-level directory is one cluster component. Its Kubernetes manifests live in `<component>/k8s/`; cluster-scoped resources (namespaces, RBAC, kind config) live in `platform/`.
- stock-app is the real backend: it serves daily stock prices (OHLCV bars) from TimescaleDB, fetching missing data from a market data provider. stock-ui is the web UI that charts that data.
- documentation (Go) serves the interactive documentation site at docs.localhost with its live data: a map of the cluster read from the Kubernetes API with its own read-only ServiceAccount, and read-only PromQL proxied to Prometheus. It also creates and closes the site's comment issues on GitHub in the signed-in reader's name (token in Vault).
- traffic-generator is a simple UI that simulates traffic to stock-app (bursts of concurrent requests) for observability and testing, and shows the results. Backend traffic is scraped by Prometheus and shown in Grafana.
- Grafana dashboards live in `monitoring/grafana/k8s/dashboards/`, one JSON file per dashboard, each with a fixed `uid`.
- All documentation is the site in `documentation/web/site/`: hand-written HTML pages, shared JS and CSS, no build step. Keep it short, clear and up to date; write each fact on one page and link to it from the others. Every component has a section on `components.html`. No other Markdown docs: the root README only points to the site.
- Review comments on the docs site are GitHub issues labelled `docs-feedback` (`gh issue list --label docs-feedback`); each names the file and quotes the text. Fix them in a PR with `Fixes #N`.
- When adding a component, follow "Add a component" in `documentation/web/site/delivery.html`.
- Before modifying the project's source code, always read and follow the design decisions in @documentation/web/site/design.html. If the design is unclear, ask for clarification before proceeding.

## Planning

- At the end of each plan, provide a list of any unresolved questions that need answers. Keep the questions extremely concise.
