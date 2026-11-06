"""The authored OpenAPI contract, and serving it unchanged.

FastAPI can derive an OpenAPI document from the code, but here the document
comes first: ``models.py`` is generated from ``openapi.yaml``. Serving that
file itself means Swagger UI and any generated client see the contract rather
than a second description of the same API, which could drift from it.
"""

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI

# This module sits at src/adapters/inbound/http/, so the contract at the
# service root is four directories up. tests/test_openapi_contract.py fails if
# that stops being true.
CONTRACT_PATH = Path(__file__).resolve().parents[4] / "openapi.yaml"


@lru_cache(maxsize=1)
def load_contract() -> dict[str, Any]:
    """Return the parsed OpenAPI contract.

    Returns:
        The contract as a mapping, read once per process.

    Raises:
        FileNotFoundError: If the contract was not copied into the image.
    """
    with CONTRACT_PATH.open(encoding="utf-8") as contract:
        return yaml.safe_load(contract)


def serve_contract(app: FastAPI) -> None:
    """Serve the authored contract at ``/openapi.json`` instead of a derived one.

    Args:
        app: Application whose generated document is replaced.
    """
    app.openapi = load_contract
