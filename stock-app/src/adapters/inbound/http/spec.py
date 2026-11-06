"""The authored OpenAPI contract, and serving it unchanged.

FastAPI can derive an OpenAPI document from the code, but here the document
comes first: ``models.py`` is generated from ``openapi.yaml``. Serving that
file itself, as YAML, means Swagger UI and any generated client see the
contract rather than a second description of the same API, which could drift
from it.
"""

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, Response
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse

# This module sits at src/adapters/inbound/http/, so the contract at the
# service root is four directories up. tests/test_openapi_contract.py fails if
# that stops being true.
CONTRACT_PATH = Path(__file__).resolve().parents[4] / "openapi.yaml"

CONTRACT_URL = "/openapi.yaml"
SWAGGER_UI_URL = "/docs"
# Registered for YAML by RFC 9512.
YAML_MEDIA_TYPE = "application/yaml"


@lru_cache(maxsize=1)
def read_contract() -> str:
    """Return the contract file exactly as authored.

    Returns:
        The YAML text, read once per process.

    Raises:
        FileNotFoundError: If the contract was not copied into the image.
    """
    return CONTRACT_PATH.read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def load_contract() -> dict[str, Any]:
    """Return the parsed OpenAPI contract.

    Returns:
        The contract as a mapping, parsed once per process.
    """
    return yaml.safe_load(read_contract())


def serve_contract(app: FastAPI) -> None:
    """Serve the authored contract as YAML at ``/openapi.yaml``, and Swagger UI for it at ``/docs``.

    The app must be created with ``openapi_url=None``, so FastAPI does not also
    publish a JSON document derived from the code. Neither route is part of the
    contract, so both are left out of the schema.

    Args:
        app: Application to add the two routes to.
    """

    @app.get(CONTRACT_URL, include_in_schema=False)
    def contract() -> Response:
        """Return the contract file unchanged."""
        return Response(read_contract(), media_type=YAML_MEDIA_TYPE)

    @app.get(SWAGGER_UI_URL, include_in_schema=False)
    def swagger_ui() -> HTMLResponse:
        """Return the Swagger UI page, which loads the contract from ``/openapi.yaml``."""
        return get_swagger_ui_html(openapi_url=CONTRACT_URL, title=f"{app.title} - Swagger UI")
