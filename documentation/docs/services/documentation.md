# Documentation (MkDocs)

The site you are reading. It is a component like any other: built into an
image, deployed into the cluster, and reachable on its own ingress host — so
the documentation is always available next to the thing it documents, at the
same version.

| | |
|---|---|
| Directory | `documentation/` |
| Image | `mkdocs-documentation:dev` (built and `kind load`ed by `recreate-cluster.sh`) |
| Namespace | `docs` |
| Host | http://docs.localhost (redirects to `/devops-stack/`, see below) |
| Published at | <https://jeremiaszmacura.github.io/devops-stack/> |

!!! note "In-cluster URLs carry a `/devops-stack/` prefix"

    The container runs `mkdocs serve`, and the dev server mounts the site at
    the path component of `site_url` — which has to be `/devops-stack/` for
    GitHub Pages. So `http://docs.localhost/` redirects, and a deep link
    in-cluster is `http://docs.localhost/devops-stack/services/stock-app/`.

    Serving a `mkdocs build` output from a static web server instead would drop
    the prefix and stop using a development server in the cluster. Until then,
    prefer the published URLs above when linking from outside this site.

## Layout

| Path | Purpose |
|---|---|
| `mkdocs.yml` | Site configuration and the `nav` tree — a page is invisible until it is listed here |
| `docs/` | Every page in the site |
| `docs/services/` | One page per deployed component |
| `hooks/contracts.py` | Pulls service API contracts into the site at build time (see below) |
| `requirements.txt` | `mkdocs`, `mkdocs-material`, the Swagger UI tag plugin and the Markdown extensions |
| `Dockerfile` | Builds the static site and serves it |
| `k8s/` | Deployment, Service, Ingress, ServiceAccount |

## Rendering a service's API contract

[stock-app API](stock-app-api.md) renders `stock-app/openapi.yaml` through
Swagger UI. The file is **not** copied under `docs/`: `hooks/contracts.py`
reads it from the service's own directory and injects it into the built site,
so the contract the site shows and the one the service generates its models
from are the same file, not two that can drift.

Two consequences:

- This image is built from the **repository root**
  (`docker build -f documentation/Dockerfile .`) and mirrors the repo layout
  inside, so the hook resolves the same relative path locally and in the
  container. The root `.dockerignore` keeps `.tox`, `.venv` and `node_modules`
  out of that context.
- `docs.yml` rebuilds the published site when `stock-app/openapi.yaml` changes,
  not only when `documentation/**` does.

To render another service's contract, add one entry to `CONTRACTS` in
`hooks/contracts.py`, one `COPY` line to the `Dockerfile`, and a page holding
`<swagger-ui src="..."/>`. A missing contract fails the build rather than
producing a blank page.

## All documentation lives here

Component directories hold **no prose**. Every `README.md` next to code is a
stub pointing at its page under [Services](index.md), so a fact is written down
in exactly one place.

That includes the ones that are not deployed workloads: the end-to-end suite is
documented in [End-to-End Tests](../e2e-tests.md), cluster-scoped resources in
[Platform Decisions](../platform-decisions.md), and the checks to run before
pushing in [Validation Rules](../validation-rules.md).

The one exception is the repository's root `README.md`, which is the landing
page on GitHub and points here.

## Adding a page

1. Write the Markdown under `documentation/docs/`. A page about a deployed
   component goes in `docs/services/<component>.md`.
2. Add it to `nav:` in `mkdocs.yml` — MkDocs will not surface it otherwise.
3. Link it from wherever a reader would look for it, and link back out to
   related pages.
4. Build with `--strict` before pushing; a broken internal link fails the build.

## Writing conventions

- **Mermaid diagrams** work in fenced ```mermaid blocks, wired up through
  `pymdownx.superfences` in `mkdocs.yml`. They render on GitHub too.
- **Relative links between pages** (`../design.md`, `services/vault.md`) — never
  absolute site URLs, so the site works locally, in-cluster and on GitHub Pages.
- Tables over bullet lists when the content has more than one dimension.
- Say *why*, not only *what*. The manifests already record what.

## Build and preview locally

```sh
cd documentation
pip install -r requirements.txt
mkdocs serve            # http://127.0.0.1:8000, live reload
mkdocs build --strict   # what CI and the image build do — fails on a bad link
```

## Redeploy into a running cluster

From the repository root:

```sh
docker build -t mkdocs-documentation:dev ./documentation
kind load docker-image mkdocs-documentation:dev --name sample-cluster
kubectl rollout restart deployment mkdocs-deployment -n docs
```

The site is baked into the image, so editing Markdown always means a rebuild —
there is no volume mount to short-circuit it.
