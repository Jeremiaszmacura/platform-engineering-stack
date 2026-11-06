# Documentation

This site. Written in Markdown in `documentation/docs/`, built with MkDocs (Material theme).

- In the cluster: the image runs `mkdocs build` once and serves the static site with non-root nginx at http://docs.localhost.
- Public copy: GitHub Pages at https://jeremiaszmacura.github.io/platform-engineering-stack/,
  published by `.github/workflows/docs.yml` on every push to `main` that touches `documentation/`.

## Edit locally

```sh
cd documentation
pip install -r requirements.txt
mkdocs serve       # live preview at http://127.0.0.1:8000
```

To add a page, create the Markdown file and add it to `nav` in `mkdocs.yml`.
