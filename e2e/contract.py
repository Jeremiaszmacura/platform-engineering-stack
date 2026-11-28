"""stock-app's published OpenAPI contract, which every e2e call to stock-app is checked against."""

import pytest
import requests
import yaml
from openapi_core import OpenAPI
from openapi_core.contrib.requests import RequestsOpenAPIRequest, RequestsOpenAPIResponse
from openapi_core.exceptions import OpenAPIError

from cluster import REQUEST_TIMEOUT_SECONDS, STOCK_APP_URL


def fetch_contract():
    """Return the contract the running service publishes at /openapi.yaml."""
    response = requests.get(f"{STOCK_APP_URL}/openapi.yaml", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return OpenAPI.from_dict(yaml.safe_load(response.text))


def conforming(contract, response):
    """Fail the test unless response's status, content type and body match the contract; return response."""
    try:
        contract.validate_response(RequestsOpenAPIRequest(response.request), RequestsOpenAPIResponse(response))
    except OpenAPIError as error:
        request = response.request
        pytest.fail(
            f"{request.method} {request.path_url} answered {response.status_code}"
            f" in a shape the contract forbids: {error}"
        )
    return response
