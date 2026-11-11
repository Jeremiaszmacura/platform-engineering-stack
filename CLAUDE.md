# Project rules

Programming rules live in `.claude/rules/`: `clean-code.md` always applies, `go.md` loads only when working on Go files.

## Project

- `recreate-cluster.sh` is the single entry point that deploys the kind cluster. It must stay idempotent: running it again must not break anything.
- Each top-level directory is one cluster component. Its Kubernetes manifests live in `<component>/k8s/`; cluster-scoped resources (namespaces, RBAC, kind config) live in `platform/`.
- stock-app is the real backend: it serves daily stock prices (OHLCV bars) from TimescaleDB, fetching missing data from a market data provider. stock-ui is the web UI that charts that data.
- cluster-map (Go) serves a live, interactive map of the cluster for learning Kubernetes; it reads the API with its own read-only ServiceAccount.
- traffic-generator is a simple UI that simulates traffic to stock-app (bursts of concurrent requests) for observability and testing, and shows the results. Backend traffic is scraped by Prometheus and shown in Grafana.
- Grafana dashboards live in `monitoring/grafana/ansible/dashboards/`, one JSON file per dashboard, each with a fixed `uid`.
- Documentation lives in MkDocs (`documentation/docs/`). Keep it short, clear and up to date. Every component has one page in `documentation/docs/services/`; component READMEs only link to it.
- When adding a component, follow `documentation/docs/adding-a-service.md`.
- Before modifying the project's source code, always read and follow the service design described in @documentation/docs/design.md. If the design is unclear, ask for clarification before proceeding.

## Planning

- At the end of each plan, provide a list of any unresolved questions that need answers. Keep the questions extremely concise.

## Debugging

- When you encounter an error or a failing test, resolve it in a separate subagent rather than in the main context. Prepare all the context needed to reproduce and understand the issue, then spawn a subagent to investigate and propose a fix.
- The subagent should propose a fix. If the proposed fix is not aligned with the architectural decisions, programming rules, or best practices, the main agent should reject it and provide feedback. The subagent should then propose a new fix.
