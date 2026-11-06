"""Shared pytest fixtures for the end-to-end test suite."""

import pytest

from cluster import (
    BACKENDS,
    CLUSTER_READY_TIMEOUT_SECONDS,
    SECRET_BACKENDS,
    SERVICE_URLS,
    service_responds,
    wait_until,
)


@pytest.fixture(scope="session", autouse=True)
def cluster_ready():
    """Wait until every service answers, failing fast with the name of the one that doesn't."""
    for name, url in SERVICE_URLS.items():
        wait_until(
            lambda url=url: service_responds(url),
            CLUSTER_READY_TIMEOUT_SECONDS,
            description=f"{name} to respond at {url}",
        )


@pytest.fixture(params=BACKENDS, ids=lambda backend: backend.name)
def backend(request):
    """Run the test once per sample backend (go-app)."""
    return request.param


@pytest.fixture(params=SECRET_BACKENDS, ids=lambda backend: backend.name)
def secret_backend(request):
    """Run the test once per backend with /secret endpoints (go-app, stock-app)."""
    return request.param
