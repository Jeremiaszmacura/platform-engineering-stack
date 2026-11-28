"""documentation: the site, its live map of the cluster built from the Kubernetes API, and its Prometheus proxy."""

import pytest
import requests

from cluster import DOCS_URL, REQUEST_TIMEOUT_SECONDS, JsonObject

PAGES = {
    "": "Overview",
    "map.html": "Cluster map",
    "networking.html": "Networking",
    "security.html": "Identity &amp; secrets",
    "observability.html": "Observability",
    "state.html": "State &amp; storage",
    "workloads.html": "Workloads",
    "components.html": "Components",
    "delivery.html": "Build &amp; ship",
    "design.html": "Design decisions",
}


def fetch_map() -> JsonObject:
    """Return the current cluster map JSON."""
    response = requests.get(f"{DOCS_URL}/api/map", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


@pytest.mark.parametrize("page", sorted(PAGES))
def test_every_page_is_served(page: str) -> None:
    """Each page of the site is served with its title."""
    response = requests.get(f"{DOCS_URL}/{page}", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert f"<title>{PAGES[page]} · Platform Engineering Stack</title>" in response.text


@pytest.mark.parametrize(
    ("path", "content_type"),
    [
        ("assets/js/site.js", "javascript"),
        ("assets/site.css", "text/css"),
        ("assets/snapshot.json", "application/json"),
    ],
)
def test_shared_assets_are_served(path: str, content_type: str) -> None:
    """The pages' shared script, stylesheet and offline snapshot are served with the right type."""
    response = requests.get(f"{DOCS_URL}/{path}", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert content_type in response.headers["Content-Type"]


def test_asset_directories_are_not_listed() -> None:
    """The file server answers 404 for a directory instead of listing it."""
    response = requests.get(f"{DOCS_URL}/assets/", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 404


def test_health_reports_synced_informers() -> None:
    """GET /health is healthy once the informers have synced."""
    response = requests.get(f"{DOCS_URL}/health", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_map_shows_ready_workloads_on_three_nodes() -> None:
    """The map lists every node and the running workloads, including itself, ready."""
    cluster_map = fetch_map()
    ready_apps = {pod["app"] for pod in cluster_map["pods"] if pod["phase"] == "Running" and pod["ready"]}
    assert len(cluster_map["nodes"]) == 3
    assert {"documentation", "stock-app", "timescaledb", "prometheus", "envoy"} <= ready_apps


def test_map_links_follow_routes_config_and_scraping() -> None:
    """Links come from HTTPRoutes, Service addresses in env and references, and Prometheus annotations."""
    links = {(link["kind"], link["label"]) for link in fetch_map()["links"]}
    assert ("gateway", "docs.localhost") in links
    assert ("call", "timescaledb-service.data:5432") in links
    assert ("call", "prometheus-service.monitoring:9090") in links  # this site's Prometheus proxy
    assert ("call", "tempo-service:4318") in links  # the Collector's exporter, from REFERENCES
    assert any(kind == "scrape" and "job documentation" in label for kind, label in links)


def test_gateway_is_programmed_and_accepts_every_route() -> None:
    """The shared Gateway runs an Envoy proxy behind NodePorts 30080 (HTTP) and 30443 (HTTPS) and has accepted every
    component's HTTPRoute."""
    cluster_map = fetch_map()
    gateway = next(g for g in cluster_map["gateways"] if g["name"] == "shared-gateway")
    proxy_service = next(s for s in cluster_map["services"] if s["id"] == gateway["proxy_service"])
    assert gateway["programmed"] is True
    assert gateway["proxy_pods"]
    assert proxy_service["node_ports"] == ["30080", "30443"]
    assert [listener["port"] for listener in gateway["listeners"]] == [80, 443]
    routes = {route["name"]: route["status"] for route in cluster_map["routes"]}
    assert routes["documentation-route"] == "Accepted"
    assert set(routes.values()) == {"Accepted"}


def test_documentation_identity_is_read_only_without_secrets() -> None:
    """The site's ServiceAccount has a token and read-only RBAC that never covers Secrets."""
    account = next(a for a in fetch_map()["service_accounts"] if a["name"] == "documentation")
    permissions = " ".join(account["permissions"])
    assert account["namespace"] == "docs"
    assert account["token_mounted"] is True
    assert "get,list,watch" in permissions
    assert "secrets" not in permissions
    assert "create" not in permissions and "delete" not in permissions


def test_documentation_shows_that_vault_reads_only_its_unseal_key() -> None:
    """The map names the one Secret Vault may read, so the site never shows it reading every Secret."""
    account = next(a for a in fetch_map()["service_accounts"] if a["name"] == "vault")
    assert 'Role vault-unseal-key (in vault): create secrets; get secrets "vault-unseal-key"' in account["permissions"]


def test_documentation_pod_passes_the_restricted_profile() -> None:
    """The site's own pod is the hardening example: non-root, no escalation, no capabilities, seccomp, limits."""
    pod = next(p for p in fetch_map()["pods"] if p["app"] == "documentation" and p["phase"] == "Running")
    hardening = pod["hardening"]
    assert hardening["non_root"] and hardening["no_privilege_escalation"] and hardening["drops_all_capabilities"]
    assert hardening["seccomp"] and hardening["read_only_root"] and hardening["limits"]
    assert hardening["host_access"] == [] and hardening["added_capabilities"] == []


def test_prometheus_queries_are_proxied() -> None:
    """Instant and range PromQL queries reach Prometheus through the site."""
    instant = requests.get(
        f"{DOCS_URL}/api/prometheus/api/v1/query", params={"query": "up"}, timeout=REQUEST_TIMEOUT_SECONDS
    )
    assert instant.status_code == 200
    jobs = {series["metric"]["job"] for series in instant.json()["data"]["result"]}
    assert "documentation" in jobs
    ranged = requests.get(
        f"{DOCS_URL}/api/prometheus/api/v1/query_range",
        params={"query": "sum(up)", "start": "0", "end": "60", "step": "15"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert ranged.status_code == 200
    assert ranged.json()["status"] == "success"


def test_only_read_queries_are_proxied() -> None:
    """The proxy exposes the two query endpoints and nothing else of Prometheus' API."""
    config = requests.get(f"{DOCS_URL}/api/prometheus/api/v1/status/config", timeout=REQUEST_TIMEOUT_SECONDS)
    assert config.status_code == 404
    post = requests.post(
        f"{DOCS_URL}/api/prometheus/api/v1/query", data={"query": "up"}, timeout=REQUEST_TIMEOUT_SECONDS
    )
    assert post.status_code == 405


def comments_configured() -> bool:
    """Return whether the documentation service has a GitHub App for comments."""
    response = requests.get(f"{DOCS_URL}/api/github/status", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert set(response.json()) == {"configured"}
    return response.json()["configured"]


@pytest.mark.parametrize(("method", "path"), [("POST", "/api/comments"), ("DELETE", "/api/comments/1")])
def test_comment_api_needs_the_browser_that_signed_in(method: str, path: str) -> None:
    """Without the session cookie of the browser that signed in, no comment issue is created or closed."""
    response = requests.request(
        method,
        f"{DOCS_URL}{path}",
        json={"title": "t", "body": "b"},
        headers={"Origin": DOCS_URL},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code == (401 if comments_configured() else 503)


@pytest.mark.parametrize(("method", "path"), [("POST", "/api/comments"), ("DELETE", "/api/comments/1")])
def test_comment_api_refuses_other_sites(method: str, path: str) -> None:
    """Another site's page can't create or close comment issues through the reader's browser."""
    response = requests.request(
        method,
        f"{DOCS_URL}{path}",
        json={"title": "t", "body": "b"},
        headers={"Origin": "https://attacker.example"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code == 403
