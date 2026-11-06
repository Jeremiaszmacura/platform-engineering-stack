"""Smoke tests: every deployed component answers HTTP on its ingress host."""

import pytest
import requests

from cluster import REQUEST_TIMEOUT_SECONDS, SERVICE_URLS


@pytest.mark.parametrize("service_name", sorted(SERVICE_URLS))
def test_service_answers_http(service_name):
    """The service responds with HTTP 200 on its ingress host, following redirects."""
    response = requests.get(SERVICE_URLS[service_name], timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
