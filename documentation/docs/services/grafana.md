# Grafana

Dashboards over [Prometheus](prometheus.md) data. Both the datasource and every
dashboard are provisioned as code with Ansible, so a recreated cluster comes
back with the same views — nothing is clicked together by hand and kept only in
Grafana's database.

| | |
|---|---|
| Directory | `monitoring/grafana/` |
| Image | `grafana/grafana:latest` (public, pulled by the node) |
| Namespace | `monitoring` |
| Host | http://grafana.localhost |
| Login | `admin` / `admin`, from the `grafana-admin-secret` Secret |

## Manifests

| File | Purpose |
|---|---|
| `k8s/grafana-deployment.yaml` | Deployment + `grafana-service` on 3000; admin credentials injected as `GF_SECURITY_ADMIN_*` |
| `k8s/secrets.yaml` | `grafana-admin-secret` — base64, **not** encrypted, dev playground only |
| `k8s/grafana-ingress.yaml` | Ingress for `grafana.localhost` |
| `k8s/grafana-serviceaccount.yaml` | Zero-privilege ServiceAccount |

## Provisioning with Ansible

`recreate-cluster.sh` runs `deploy-dev.yaml` at the end of every cluster
creation. The playbooks talk to Grafana's HTTP API over the ingress, so they
need no cluster access — only a reachable `http://grafana.localhost`.

```
monitoring/grafana/ansible/
├── deploy-dev.yaml           # imports both playbooks with env=dev
├── deploy-prod.yaml          # same, env=prod
├── deploy-to-dev.sh          # wrapper
├── deploy-to-prod.sh         # wrapper, prompts for a typed "yes" first
├── setup-datasource.yaml     # registers Prometheus as the default datasource
├── deploy-dashboards.yaml    # uploads every dashboards/*.json
└── dashboards/
    ├── go-app.json
    ├── stock-app.json
    ├── nginx.json
    └── infrastructure.json
```

Both playbooks are idempotent — dashboards are uploaded with
`"overwrite": true` — so they can be re-run at any time:

```sh
ansible-playbook monitoring/grafana/ansible/deploy-dev.yaml   # or ./deploy-to-dev.sh
ansible-playbook monitoring/grafana/ansible/setup-datasource.yaml   # datasource only
ansible-playbook monitoring/grafana/ansible/deploy-dashboards.yaml  # dashboards only
```

`deploy-prod.yaml` exists to demonstrate the environment split; it points at the
same URL today, and `deploy-to-prod.sh` gates it behind a typed confirmation.

## Adding or changing a dashboard

1. Edit it in the Grafana UI, or edit the JSON directly.
2. Export the dashboard model to
   `monitoring/grafana/ansible/dashboards/<name>.json` — one dashboard per file,
   wrapped as `{"dashboard": {...}, "overwrite": true}` with `"id": null`.
3. Re-run the playbook above.

The repository is the source of truth. A dashboard built in the UI and not
exported is gone the next time the cluster is recreated. The e2e suite enforces
this: `test_grafana_dashboards_are_provisioned` asserts every expected title
exists after deployment.

## Redeploy into a running cluster

```sh
kubectl apply -f monitoring/grafana/k8s/
kubectl rollout restart deployment grafana-deployment -n monitoring
ansible-playbook monitoring/grafana/ansible/deploy-dev.yaml   # re-provision after the restart
```

The restart wipes Grafana's in-pod SQLite database, so the datasource and
dashboards have to be pushed again — which is exactly why they live in Git.

## Troubleshooting

| Symptom | Check |
|---|---|
| Playbook cannot connect | `curl -s http://grafana.localhost/api/health` — the pod may still be starting |
| Dashboard missing after deploy | JSON is valid (`python3 -m json.tool < file`) and wrapped with `"overwrite": true` |
| Panels empty | The query's `job` label matches a real Prometheus job — see [Monitoring](../monitoring.md) |
| Import errors | `kubectl logs deployment/grafana-deployment -n monitoring` |

Ansible itself is a prerequisite of `recreate-cluster.sh`; see
[Getting Started](../getting-started.md).
