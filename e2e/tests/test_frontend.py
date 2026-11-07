"""frontend-app is served, and the backends answer its cross-origin calls with CORS headers."""

import requests

from cluster import FRONTEND_URL, REQUEST_TIMEOUT_SECONDS


def test_frontend_serves_ui():
    """GET / serves the React single-page application."""
    response = requests.get(FRONTEND_URL, timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert response.headers["Content-Type"].startswith("text/html")


def test_backend_allows_frontend_origin(backend):
    """Backend responses carry CORS headers allowing the frontend origin."""
    response = requests.get(
        f"{backend.base_url}/health",
        headers={"Origin": FRONTEND_URL},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] in ("*", FRONTEND_URL)


def test_backend_answers_cors_preflight(backend):
    """OPTIONS preflight from the frontend origin is accepted by the backend ingress."""
    response = requests.options(
        f"{backend.base_url}/health",
        headers={"Origin": FRONTEND_URL, "Access-Control-Request-Method": "GET"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code in (200, 204)
    assert response.headers["Access-Control-Allow-Origin"] in ("*", FRONTEND_URL)
