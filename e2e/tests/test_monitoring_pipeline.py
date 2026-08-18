"""End-to-end tests of the observability pipeline: traffic -> Prometheus -> Grafana."""

import requests

from cluster import (
    GRAFANA_CREDENTIALS,
    GRAFANA_URL,
    METRICS_PIPELINE_TIMEOUT_SECONDS,
    PROMETHEUS_URL,
    REQUEST_TIMEOUT_SECONDS,
    TARGETS_UP_TIMEOUT_SECONDS,
    query_prometheus_value,
    wait_until,
)

EXPECTED_PROMETHEUS_JOBS = {"self", "nginx-metrics", "node-exporter", "go-app", "stock-app"}
EXPECTED_DASHBOARD_TITLES = {
    "Go App Metrics",
    "Infrastructure Overview",
    "NGINX Monitoring",
    "Stock App Metrics",
}


def fetch_up_jobs():
    """Return the set of Prometheus scrape job names whose targets are all healthy.

    Returns:
        Job names where every active target reports health "up".
    """
    response = requests.get(f"{PROMETHEUS_URL}/api/v1/targets", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    targets = response.json()["data"]["activeTargets"]
    all_jobs = {target["labels"]["job"] for target in targets}
    down_jobs = {target["labels"]["job"] for target in targets if target["health"] != "up"}
    return all_jobs - down_jobs


def test_all_scrape_targets_are_up():
    """Every scrape job configured in Prometheus reports healthy targets."""
    wait_until(
        lambda: EXPECTED_PROMETHEUS_JOBS <= fetch_up_jobs(),
        TARGETS_UP_TIMEOUT_SECONDS,
        description=f"Prometheus jobs {sorted(EXPECTED_PROMETHEUS_JOBS)} to be up",
    )


def test_backend_traffic_reaches_prometheus(backend):
    """Requests sent to a backend show up as increased counters in Prometheus.

    This covers the whole pipeline: the app serves traffic, records it in its
    own /metrics, and Prometheus scrapes it into the time series database.
    """
    request_count = 5
    query = f'sum(http_requests_total{{job="{backend.prometheus_job}"}})'
    baseline = query_prometheus_value(query)

    for _ in range(request_count):
        requests.get(f"{backend.base_url}/", timeout=REQUEST_TIMEOUT_SECONDS)

    wait_until(
        lambda: query_prometheus_value(query) >= baseline + request_count,
        METRICS_PIPELINE_TIMEOUT_SECONDS,
        description=f"Prometheus to scrape {request_count} new {backend.name} requests",
    )


def test_grafana_is_healthy():
    """Grafana's health API reports a working database."""
    response = requests.get(f"{GRAFANA_URL}/api/health", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert response.json()["database"] == "ok"


def test_grafana_has_prometheus_datasource():
    """Grafana is provisioned with a Prometheus datasource."""
    response = requests.get(f"{GRAFANA_URL}/api/datasources", auth=GRAFANA_CREDENTIALS, timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    datasource_types = {datasource["type"] for datasource in response.json()}
    assert "prometheus" in datasource_types


def test_grafana_dashboards_are_provisioned():
    """All dashboards defined as code in the repository exist in Grafana."""
    response = requests.get(
        f"{GRAFANA_URL}/api/search",
        params={"type": "dash-db"},
        auth=GRAFANA_CREDENTIALS,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code == 200
    titles = {dashboard["title"] for dashboard in response.json()}
    assert EXPECTED_DASHBOARD_TITLES <= titles
