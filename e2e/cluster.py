"""Catalog of cluster services and shared helpers for the end-to-end test suite.

Every service is reachable from the host through the ingress-nginx controller
on port 80, routed by hostname. The ``*.localhost`` names resolve to loopback
on both developer machines and CI runners, so no DNS setup is needed.
"""

import time
from dataclasses import dataclass

import requests

REQUEST_TIMEOUT_SECONDS = 10
CLUSTER_READY_TIMEOUT_SECONDS = 60
TARGETS_UP_TIMEOUT_SECONDS = 90
METRICS_PIPELINE_TIMEOUT_SECONDS = 60
POLL_INTERVAL_SECONDS = 2

FRONTEND_URL = "http://app.localhost"
PROMETHEUS_URL = "http://prometheus.localhost"
GRAFANA_URL = "http://grafana.localhost"
VAULT_URL = "http://vault.localhost"

GRAFANA_CREDENTIALS = ("admin", "admin")
VAULT_TOKEN = "root"  # nosec B105 - dev-mode root token


@dataclass(frozen=True)
class Backend:
    """A sample backend application deployed in the cluster.

    Attributes:
        name: Component name, used as the pytest parametrization id.
        base_url: Ingress host URL of the backend.
        prometheus_job: Prometheus scrape job name for the backend.
    """

    name: str
    base_url: str
    prometheus_job: str


BACKENDS = (
    Backend(name="python-app", base_url="http://python.localhost", prometheus_job="python-app"),
    Backend(name="go-app", base_url="http://go.localhost", prometheus_job="go-app"),
)

SERVICE_URLS = {
    **{backend.name: backend.base_url for backend in BACKENDS},
    "frontend-app": FRONTEND_URL,
    "prometheus": PROMETHEUS_URL,
    "grafana": GRAFANA_URL,
    "nginx": "http://nginx.localhost",
    "documentation": "http://docs.localhost",
    "vault": VAULT_URL,
}


def wait_until(check, timeout_seconds, description):
    """Poll a condition until it holds or the timeout expires.

    Args:
        check: Zero-argument callable returning a truthy value once the condition
            holds. Connection errors are treated as "not ready yet" and retried.
        timeout_seconds: Maximum time to keep polling.
        description: Human-readable condition description used in the failure message.

    Raises:
        AssertionError: If the condition does not hold before the timeout expires.
    """
    deadline = time.monotonic() + timeout_seconds
    last_error = None
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except requests.RequestException as error:
            last_error = error
        time.sleep(POLL_INTERVAL_SECONDS)
    detail = f" (last error: {last_error})" if last_error else ""
    raise AssertionError(f"timed out after {timeout_seconds}s waiting for {description}{detail}")


def service_responds(url):
    """Return True when a GET to the URL yields any non-5xx HTTP response.

    Args:
        url: URL to probe.

    Returns:
        True if the service answered with a status code below 500.
    """
    response = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
    return response.status_code < 500


def fetch_metrics(backend):
    """Return a backend's /metrics payload in Prometheus text format.

    Args:
        backend: Backend to fetch metrics from.

    Returns:
        The raw Prometheus exposition text.
    """
    response = requests.get(f"{backend.base_url}/metrics", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.text


def read_counter(metrics_text, metric_name, required_labels):
    """Sum the samples of a counter in Prometheus text format matching all given labels.

    Label order differs between client libraries, so labels are matched as
    individual ``label="value"`` substrings rather than as a whole label set.

    Args:
        metrics_text: Prometheus exposition text to search.
        metric_name: Counter name, e.g. ``http_requests_total``.
        required_labels: Label name/value pairs a sample must carry to be counted.

    Returns:
        The sum of all matching sample values, 0.0 when none match.
    """
    total = 0.0
    for line in metrics_text.splitlines():
        if not line.startswith(metric_name + "{"):
            continue
        if all(f'{name}="{value}"' in line for name, value in required_labels.items()):
            total += float(line.rsplit(" ", 1)[1])
    return total


def query_prometheus_value(promql):
    """Run an instant PromQL query against Prometheus and return its scalar result.

    Args:
        promql: Instant query expected to yield at most one sample, e.g. a sum().

    Returns:
        The sample value as a float, or 0.0 when the result set is empty.
    """
    response = requests.get(f"{PROMETHEUS_URL}/api/v1/query", params={"query": promql}, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    result = response.json()["data"]["result"]
    if not result:
        return 0.0
    return float(result[0]["value"][1])
