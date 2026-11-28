"""End-to-end tests of the observability pipeline: traffic -> Prometheus -> Grafana."""

from functools import partial

import requests

from cluster import (
    GRAFANA_CREDENTIALS,
    GRAFANA_URL,
    JsonObject,
    METRICS_PIPELINE_TIMEOUT_SECONDS,
    PROMETHEUS_URL,
    REQUEST_TIMEOUT_SECONDS,
    STOCK_APP_URL,
    TARGETS_UP_TIMEOUT_SECONDS,
    query_prometheus_value,
    wait_until,
)

EXPECTED_PROMETHEUS_JOBS = {
    "self",
    "kubelet",
    "node-exporter",
    "stock-app",
    "documentation",
    "otel-collector",
    "tempo",
    "grafana",
    "vault",
    "timescaledb",
    "shared-gateway",
    "alertmanager",
}
EXPECTED_ALERT_RULES = {"Watchdog", "TargetDown", "SpansQueued", "SpansDropped"}
EXPECTED_DASHBOARD_TITLES = {
    "Infrastructure Overview",
    "Stock App Metrics",
    "Tracing",
}

# One node-exporter and one kubelet per kind node.
KIND_NODE_COUNT = 3
EXPECTED_TARGETS_PER_JOB = {"node-exporter": KIND_NODE_COUNT, "kubelet": KIND_NODE_COUNT}
KUBERNETES_TARGET_LABELS = {"namespace", "pod", "service", "node"}


def fetch_active_targets() -> list[JsonObject]:
    """Return Prometheus' active scrape targets."""
    response = requests.get(f"{PROMETHEUS_URL}/api/v1/targets", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()["data"]["activeTargets"]


def fetch_up_jobs() -> set[str]:
    """Return the jobs whose active targets are all up."""
    targets = fetch_active_targets()
    all_jobs = {target["labels"]["job"] for target in targets}
    down_jobs = {target["labels"]["job"] for target in targets if target["health"] != "up"}
    return all_jobs - down_jobs


def has_up_targets(job: str, expected: int) -> bool:
    """Return True if exactly expected targets of job are up."""
    targets = fetch_active_targets()
    return expected == sum(1 for target in targets if target["labels"]["job"] == job and target["health"] == "up")


def test_multi_instance_jobs_scrape_every_instance() -> None:
    """Every node is scraped as its own target."""
    for job, expected in EXPECTED_TARGETS_PER_JOB.items():
        wait_until(
            partial(has_up_targets, job, expected),
            TARGETS_UP_TIMEOUT_SECONDS,
            description=f"{expected} up targets for job {job}",
        )


def test_all_scrape_targets_are_up() -> None:
    """Every scrape job configured in Prometheus reports healthy targets."""
    wait_until(
        lambda: EXPECTED_PROMETHEUS_JOBS <= fetch_up_jobs(),
        TARGETS_UP_TIMEOUT_SECONDS,
        description=f"Prometheus jobs {sorted(EXPECTED_PROMETHEUS_JOBS)} to be up",
    )


def test_discovered_targets_name_their_kubernetes_source() -> None:
    """Every discovered target is labelled with its namespace, pod, Service and node."""
    discovered = [target for target in fetch_active_targets() if target["scrapePool"] == "kubernetes-services"]
    assert discovered, "no targets discovered from Kubernetes"
    for target in discovered:
        labels = target["labels"]
        missing = KUBERNETES_TARGET_LABELS - labels.keys()
        assert not missing, f"target {labels} has no {sorted(missing)} label"


def test_kubelet_reports_each_node_and_pod() -> None:
    """The kubelet job measures every node by name and every pod, which node-exporter can't on kind."""
    wait_until(
        lambda: query_prometheus_value('count(count by (node) (node_memory_working_set_bytes{job="kubelet"}))')
        == KIND_NODE_COUNT,
        TARGETS_UP_TIMEOUT_SECONDS,
        description=f"memory of {KIND_NODE_COUNT} nodes from the kubelet",
    )
    # A pod shows up in the kubelet's metrics a few seconds after its node does, so wait for it too.
    stock_app_memory = 'sum(pod_memory_working_set_bytes{job="kubelet", namespace="apps", pod=~"stock-app-.*"})'
    wait_until(
        lambda: query_prometheus_value(stock_app_memory) > 0,
        TARGETS_UP_TIMEOUT_SECONDS,
        description="memory of the stock-app pod from the kubelet",
    )


def test_alert_rules_are_loaded() -> None:
    """Prometheus evaluates the alert rules from alerts.yml."""
    response = requests.get(f"{PROMETHEUS_URL}/api/v1/rules", params={"type": "alert"}, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    names = {rule["name"] for group in response.json()["data"]["groups"] for rule in group["rules"]}
    assert EXPECTED_ALERT_RULES <= names


def test_backend_traffic_reaches_prometheus() -> None:
    """Requests to stock-app show up in Prometheus."""
    request_count = 5
    query = 'sum(http_requests_total{job="stock-app"})'
    baseline = query_prometheus_value(query)

    for _ in range(request_count):
        requests.get(f"{STOCK_APP_URL}/", timeout=REQUEST_TIMEOUT_SECONDS)

    wait_until(
        lambda: query_prometheus_value(query) >= baseline + request_count,
        METRICS_PIPELINE_TIMEOUT_SECONDS,
        description=f"Prometheus to scrape {request_count} new stock-app requests",
    )


def test_grafana_is_healthy() -> None:
    """Grafana's health API reports a working database."""
    response = requests.get(f"{GRAFANA_URL}/api/health", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert response.json()["database"] == "ok"


def test_grafana_has_prometheus_datasource() -> None:
    """Grafana is provisioned with a Prometheus datasource."""
    response = requests.get(f"{GRAFANA_URL}/api/datasources", auth=GRAFANA_CREDENTIALS, timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    datasource_types = {datasource["type"] for datasource in response.json()}
    assert "prometheus" in datasource_types


def test_grafana_dashboards_are_provisioned() -> None:
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
