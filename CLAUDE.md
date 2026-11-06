# Project rules

General and programming rules live in `.claude/CLAUDE.md` (with `.claude/shared/`).

- `recreate-cluster.sh` is the single entry point that deploys the kind cluster. It must stay idempotent: running it again must not break anything.
- Each top-level directory is one cluster component. Its Kubernetes manifests live in `<component>/k8s/`.
- python-app and go-app are sample backends with the same HTTP contract. Their traffic is scraped by Prometheus and shown in Grafana.
- frontend-app is a simple UI that sends test requests to the backends and shows the results.
- Grafana dashboards live in `monitoring/grafana/ansible/dashboards/`, one JSON file per dashboard, each with a fixed `uid`.
- Documentation lives in MkDocs (`documentation/docs/`). Keep it short, clear and up to date. Every component has one page in `documentation/docs/services/`; component READMEs only link to it.
- When adding a component, follow `documentation/docs/adding-a-service.md`.
