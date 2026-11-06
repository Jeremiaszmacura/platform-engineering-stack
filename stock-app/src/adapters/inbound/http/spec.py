"""Serve the authored openapi.yaml unchanged instead of a document derived from the code."""

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, Response
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse

# Service root is four levels up; tests/test_openapi_contract.py checks it.
CONTRACT_PATH = Path(__file__).resolve().parents[4] / "openapi.yaml"

CONTRACT_URL = "/openapi.yaml"
SWAGGER_UI_URL = "/docs"
# Registered for YAML by RFC 9512.
YAML_MEDIA_TYPE = "application/yaml"


@lru_cache(maxsize=1)
def read_contract() -> str:
    """Return the contract file text (cached)."""
    return CONTRACT_PATH.read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def load_contract() -> dict[str, Any]:
    """Return the parsed contract (cached)."""
    return yaml.safe_load(read_contract())


def serve_contract(app: FastAPI) -> None:
    """Add /openapi.yaml and /docs (Swagger UI) to an app created with openapi_url=None."""

    @app.get(CONTRACT_URL, include_in_schema=False)
    def contract() -> Response:
        """Return the contract file unchanged."""
        return Response(read_contract(), media_type=YAML_MEDIA_TYPE)

    @app.get(SWAGGER_UI_URL, include_in_schema=False)
    def swagger_ui() -> HTMLResponse:
        """Return the Swagger UI page, which loads the contract from ``/openapi.yaml``."""
        return get_swagger_ui_html(openapi_url=CONTRACT_URL, title=f"{app.title} - Swagger UI")
