"""traffic-generator is served, and stock-app answers its cross-origin calls with CORS headers."""

import requests

from cluster import REQUEST_TIMEOUT_SECONDS, STOCK_APP_URL, TRAFFIC_GENERATOR_URL


def test_traffic_generator_serves_ui():
    """GET / serves the React single-page application."""
    response = requests.get(TRAFFIC_GENERATOR_URL, timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert response.headers["Content-Type"].startswith("text/html")


def test_backend_allows_traffic_generator_origin():
    """stock-app responses carry CORS headers allowing the traffic-generator origin."""
    response = requests.get(
        f"{STOCK_APP_URL}/health",
        headers={"Origin": TRAFFIC_GENERATOR_URL},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] in ("*", TRAFFIC_GENERATOR_URL)


def test_backend_answers_cors_preflight():
    """OPTIONS preflight from the traffic-generator origin is accepted by stock-app's ingress."""
    response = requests.options(
        f"{STOCK_APP_URL}/health",
        headers={"Origin": TRAFFIC_GENERATOR_URL, "Access-Control-Request-Method": "GET"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code in (200, 204)
    assert response.headers["Access-Control-Allow-Origin"] in ("*", TRAFFIC_GENERATOR_URL)
