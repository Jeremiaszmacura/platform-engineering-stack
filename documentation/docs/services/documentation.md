# Documentation

This site. Written in Markdown in `documentation/docs/`, built with MkDocs (Material theme).

- In the cluster: the image runs `mkdocs build --strict` once and serves the static site with non-root nginx
  at http://docs.localhost (namespace `docs`).
- Public copy: GitHub Pages at https://jeremiaszmacura.github.io/platform-engineering-stack/,
  published by `.github/workflows/docs.yml` on every push to `main` that touches `documentation/` or `stock-app/openapi.yaml`.
- The [stock-app API](stock-app-api.md) page renders `stock-app/openapi.yaml` with Swagger UI. The file is not
  copied into `docs/`: `documentation/hooks/contracts.py` adds it to the site at build time. That is why the
  image is built from the repository root (`docker build -f documentation/Dockerfile .`).

## Edit locally

```sh
cd documentation
pip install -r requirements.txt
mkdocs serve       # live preview at http://127.0.0.1:8000
```

To add a page, create the Markdown file and add it to `nav` in `mkdocs.yml`.
