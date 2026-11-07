"""frontend-app is served, and stock-app answers its cross-origin calls with CORS headers."""

import requests

from cluster import FRONTEND_URL, REQUEST_TIMEOUT_SECONDS, STOCK_APP_URL


def test_frontend_serves_ui():
    """GET / serves the React single-page application."""
    response = requests.get(FRONTEND_URL, timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert response.headers["Content-Type"].startswith("text/html")


def test_backend_allows_frontend_origin():
    """stock-app responses carry CORS headers allowing the frontend origin."""
    response = requests.get(
        f"{STOCK_APP_URL}/health",
        headers={"Origin": FRONTEND_URL},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] in ("*", FRONTEND_URL)


def test_backend_answers_cors_preflight():
    """OPTIONS preflight from the frontend origin is accepted by stock-app's ingress."""
    response = requests.options(
        f"{STOCK_APP_URL}/health",
        headers={"Origin": FRONTEND_URL, "Access-Control-Request-Method": "GET"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code in (200, 204)
    assert response.headers["Access-Control-Allow-Origin"] in ("*", FRONTEND_URL)
