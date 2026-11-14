"""cluster-map: the live page and its map of the cluster, built from the Kubernetes API."""

import requests

from cluster import CLUSTER_MAP_URL, REQUEST_TIMEOUT_SECONDS


def fetch_map():
    """Return the current cluster map JSON."""
    response = requests.get(f"{CLUSTER_MAP_URL}/api/map", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


def test_page_is_served():
    """GET / serves the cluster map page."""
    response = requests.get(CLUSTER_MAP_URL, timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert "Sample Cluster Anatomy" in response.text


def test_health_reports_synced_informers():
    """GET /health is healthy once the informers have synced."""
    response = requests.get(f"{CLUSTER_MAP_URL}/health", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_map_shows_running_workloads_on_three_nodes():
    """The map lists every node and the running workloads, including itself."""
    cluster_map = fetch_map()
    apps = {pod["app"] for pod in cluster_map["pods"] if pod["phase"] == "Running"}
    assert len(cluster_map["nodes"]) == 3
    assert {"cluster-map", "stock-app", "timescaledb", "prometheus", "envoy"} <= apps


def test_map_links_follow_routes_config_and_scraping():
    """Links come from HTTPRoutes, Service addresses in env and Prometheus annotations."""
    links = {(link["kind"], link["label"]) for link in fetch_map()["links"]}
    assert ("gateway", "cluster-map.localhost") in links
    assert ("call", "timescaledb-service.data:5432") in links
    assert any(kind == "scrape" and "job cluster-map" in label for kind, label in links)


def test_gateway_is_programmed_and_accepts_every_route():
    """The shared Gateway runs an Envoy proxy behind NodePort 30080 and has accepted every component's HTTPRoute."""
    cluster_map = fetch_map()
    gateway = next(g for g in cluster_map["gateways"] if g["name"] == "shared-gateway")
    proxy_service = next(s for s in cluster_map["services"] if s["id"] == gateway["proxy_service"])
    assert gateway["programmed"] is True
    assert gateway["proxy_pods"]
    assert proxy_service["node_ports"] == ["30080"]
    routes = {route["name"]: route["status"] for route in cluster_map["routes"]}
    assert routes["stock-app-route"] == "Accepted"
    assert set(routes.values()) == {"Accepted"}


def test_cluster_map_identity_is_read_only_without_secrets():
    """cluster-map's ServiceAccount has a token and read-only RBAC that never covers Secrets."""
    account = next(a for a in fetch_map()["service_accounts"] if a["name"] == "cluster-map")
    permissions = " ".join(account["permissions"])
    assert account["token_mounted"] is True
    assert "get,list,watch" in permissions
    assert "secrets" not in permissions
    assert "create" not in permissions and "delete" not in permissions
