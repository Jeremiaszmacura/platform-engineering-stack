"""End-to-end tests of Stock App: serving the UI and reaching stock-app from it.

Stock App is served from its own host and calls stock-app on *its* host, so
every price it draws is a cross-origin request. The stock-app Ingress must
therefore answer requests carrying this origin with CORS headers — without
them the interface loads and then shows nothing but errors.
"""

import requests

from cluster import REQUEST_TIMEOUT_SECONDS, STOCK_APP_URL, STOCK_UI_URL


def test_stock_ui_serves_ui():
    """GET / serves the React single-page application."""
    response = requests.get(STOCK_UI_URL, timeout=REQUEST_TIMEOUT_SECONDS)
    assert response.status_code == 200
    assert response.headers["Content-Type"].startswith("text/html")


def test_stock_app_allows_stock_ui_origin():
    """stock-app responses carry CORS headers allowing the Stock App origin."""
    response = requests.get(
        f"{STOCK_APP_URL}/api/v1/instruments",
        headers={"Origin": STOCK_UI_URL},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] in ("*", STOCK_UI_URL)


def test_stock_app_answers_cors_preflight():
    """OPTIONS preflight from the Stock App origin is accepted by the stock-app ingress."""
    response = requests.options(
        f"{STOCK_APP_URL}/api/v1/instruments",
        headers={"Origin": STOCK_UI_URL, "Access-Control-Request-Method": "GET"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    assert response.status_code in (200, 204)
    assert response.headers["Access-Control-Allow-Origin"] in ("*", STOCK_UI_URL)
