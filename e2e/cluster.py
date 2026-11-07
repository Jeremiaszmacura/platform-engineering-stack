"""Service catalog and helpers for the e2e suite (everything is reached through ingress on *.localhost)."""

import time
from dataclasses import dataclass

import requests

REQUEST_TIMEOUT_SECONDS = 10
CLUSTER_READY_TIMEOUT_SECONDS = 60
TARGETS_UP_TIMEOUT_SECONDS = 90
METRICS_PIPELINE_TIMEOUT_SECONDS = 60
POLL_INTERVAL_SECONDS = 2

FRONTEND_URL = "http://app.localhost"
STOCK_UI_URL = "http://stock-ui.localhost"
PROMETHEUS_URL = "http://prometheus.localhost"
GRAFANA_URL = "http://grafana.localhost"
VAULT_URL = "http://vault.localhost"

GRAFANA_CREDENTIALS = ("admin", "admin")
VAULT_TOKEN = "root"  # nosec B105 - dev-mode root token


@dataclass(frozen=True)
class Backend:
    """A backend: name (test id), ingress URL and Prometheus job."""

    name: str
    base_url: str
    prometheus_job: str


BACKENDS = (Backend(name="go-app", base_url="http://go.localhost", prometheus_job="go-app"),)

# Not in BACKENDS: stock-app has no /error or /redirect.
STOCK_APP_URL = "http://stock.localhost"

# Both backends expose the same /secret contract, each under its own Vault path.
SECRET_BACKENDS = BACKENDS + (Backend(name="stock-app", base_url=STOCK_APP_URL, prometheus_job="stock-app"),)

SERVICE_URLS = {
    "go-app": "http://go.localhost",
    "stock-app": STOCK_APP_URL,
    "frontend-app": FRONTEND_URL,
    "stock-ui": STOCK_UI_URL,
    "prometheus": PROMETHEUS_URL,
    "grafana": GRAFANA_URL,
    "documentation": "http://docs.localhost",
    "vault": VAULT_URL,
}


def wait_until(check, timeout_seconds, description):
    """Poll check() until it is truthy (connection errors count as not yet); fail with description on timeout."""
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
    """Return True if a GET to url answers below 500."""
    response = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
    return response.status_code < 500


def fetch_metrics(backend):
    """Return the backend's /metrics text."""
    response = requests.get(f"{backend.base_url}/metrics", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.text


def read_counter(metrics_text, metric_name, required_labels):
    """Sum the samples of a counter that carry all required_labels (matched one by one, as label order varies)."""
    total = 0.0
    for line in metrics_text.splitlines():
        if not line.startswith(metric_name + "{"):
            continue
        if all(f'{name}="{value}"' in line for name, value in required_labels.items()):
            total += float(line.rsplit(" ", 1)[1])
    return total


def query_prometheus_value(promql):
    """Return the value of an instant PromQL query, or 0.0 if it has no result."""
    response = requests.get(f"{PROMETHEUS_URL}/api/v1/query", params={"query": promql}, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    result = response.json()["data"]["result"]
    if not result:
        return 0.0
    return float(result[0]["value"][1])
