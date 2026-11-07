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
