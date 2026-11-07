# Project rules

General and programming rules live in `.claude/CLAUDE.md` (with `.claude/shared/`).

- `recreate-cluster.sh` is the single entry point that deploys the kind cluster. It must stay idempotent: running it again must not break anything.
- Each top-level directory is one cluster component. Its Kubernetes manifests live in `<component>/k8s/`; cluster-scoped resources (namespaces, RBAC, kind config) live in `platform/`.
- stock-app is the real backend: it serves daily stock prices (OHLCV bars) from TimescaleDB, fetching missing data from a market data provider. stock-ui is the web UI that charts that data.
- go-app is a sample backend with simple endpoints for cluster testing.
- frontend-app is a simple UI that sends test requests to the backends and shows the results. Backend traffic is scraped by Prometheus and shown in Grafana.
- Grafana dashboards live in `monitoring/grafana/ansible/dashboards/`, one JSON file per dashboard, each with a fixed `uid`.
- Documentation lives in MkDocs (`documentation/docs/`). Keep it short, clear and up to date. Every component has one page in `documentation/docs/services/`; component READMEs only link to it.
- When adding a component, follow `documentation/docs/adding-a-service.md`.
