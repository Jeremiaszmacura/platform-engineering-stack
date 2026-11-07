# Documentation

This MkDocs site (`documentation/docs/`). In the cluster it is built once and served by nginx at
http://docs.localhost; `.github/workflows/docs.yml` publishes it to GitHub Pages
(https://jeremiaszmacura.github.io/platform-engineering-stack/). The image is built from the repository root
because the [stock-app API](stock-app-api.md) page reads `stock-app/openapi.yaml`.

```sh
cd documentation
pip install -r requirements.txt
mkdocs serve    # http://127.0.0.1:8000; new pages must be added to nav in mkdocs.yml
```

## Cluster map

`documentation/cluster-map/` is an interactive page for learning how the cluster fits together: where each pod
runs, Services and DNS names, request paths, ServiceAccounts and RBAC, Secrets and storage. `make cluster-map` reads
the running cluster with kubectl (no extra Python packages) and writes `data.js` next to the page (git-ignored);
then open `documentation/cluster-map/index.html` in a browser. Rerun it after `./recreate-cluster.sh`. The parsing
code is in `model.py`, tested with `cd documentation/cluster-map && tox -e tests`.
