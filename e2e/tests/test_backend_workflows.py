"""go-app's sample endpoints, through the ingress (runs once per entry in BACKENDS)."""

import requests

from cluster import REQUEST_TIMEOUT_SECONDS, fetch_metrics, read_counter


def test_home_returns_greeting(backend):
    """GET / returns a JSON greeting message."""
    response = requests.get(f"{backend.base_url}/", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert "message" in response.json()


def test_health_reports_healthy(backend):
    """GET /health returns a healthy status through the ingress."""
    response = requests.get(f"{backend.base_url}/health", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_error_returns_internal_server_error(backend):
    """GET /error simulates a server-side failure with HTTP 500."""
    response = requests.get(f"{backend.base_url}/error", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 500


def test_redirect_points_to_health(backend):
    """GET /redirect answers HTTP 302 with a Location header pointing at /health."""
    response = requests.get(f"{backend.base_url}/redirect", allow_redirects=False, timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 302
    assert response.headers["Location"] == "/health"


def test_redirect_workflow_lands_on_health(backend):
    """Following GET /redirect ends on the health endpoint reporting healthy."""
    response = requests.get(f"{backend.base_url}/redirect", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_metrics_exposes_prometheus_format(backend):
    """GET /metrics serves metrics in Prometheus text exposition format."""
    response = requests.get(f"{backend.base_url}/metrics", timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert response.headers["Content-Type"].startswith("text/plain")
    assert "monitoring_requests_total" in response.text


def test_traffic_is_counted_in_own_metrics(backend):
    """Hitting an application endpoint increments the backend's request counter."""
    labels = {"endpoint": "/error", "status_code": "500"}
    before = read_counter(fetch_metrics(backend), "http_requests_total", labels)

    requests.get(f"{backend.base_url}/error", timeout=REQUEST_TIMEOUT_SECONDS)

    after = read_counter(fetch_metrics(backend), "http_requests_total", labels)
    assert after == before + 1
