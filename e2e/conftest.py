"""Shared pytest fixtures for the end-to-end test suite."""

import pytest

from cluster import BACKENDS, CLUSTER_READY_TIMEOUT_SECONDS, SERVICE_URLS, service_responds, wait_until


@pytest.fixture(scope="session", autouse=True)
def cluster_ready():
    """Block until every cluster service answers on its host port.

    Fails the whole session fast with a clear message naming the unreachable
    service instead of letting every test time out individually.
    """
    for name, url in SERVICE_URLS.items():
        wait_until(
            lambda url=url: service_responds(url),
            CLUSTER_READY_TIMEOUT_SECONDS,
            description=f"{name} to respond at {url}",
        )


@pytest.fixture(params=BACKENDS, ids=lambda backend: backend.name)
def backend(request):
    """Run the requesting test once per sample backend (currently just go-app).

    Returns:
        The Backend under test.
    """
    return request.param
