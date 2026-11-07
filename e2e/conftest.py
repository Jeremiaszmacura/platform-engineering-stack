"""Shared pytest fixtures for the end-to-end test suite."""

import pytest

from cluster import CLUSTER_READY_TIMEOUT_SECONDS, SERVICE_URLS, service_responds, wait_until


@pytest.fixture(scope="session", autouse=True)
def cluster_ready():
    """Wait until every service answers, failing fast with the name of the one that doesn't."""
    for name, url in SERVICE_URLS.items():
        wait_until(
            lambda url=url: service_responds(url),
            CLUSTER_READY_TIMEOUT_SECONDS,
            description=f"{name} to respond at {url}",
        )
