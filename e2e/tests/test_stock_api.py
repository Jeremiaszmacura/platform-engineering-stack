"""Every stock-app endpoint, each response validated against the /openapi.yaml the pod publishes.

502/503 need a broken provider or database and are covered by stock-app/tests/test_routes.py.
Not marked external: with STOCK_PROVIDER=fixture (as in CI) no network is used.
"""

from datetime import date, timedelta

import pytest
import requests
import yaml
from openapi_core import OpenAPI
from openapi_core.contrib.requests import RequestsOpenAPIRequest, RequestsOpenAPIResponse
from openapi_core.exceptions import OpenAPIError

from cluster import REQUEST_TIMEOUT_SECONDS, STOCK_APP_URL

SYMBOL = "AAPL"
PROVIDER_TIMEOUT_SECONDS = 60

# A year ending a week ago: has sessions and overlaps the fixture recording.
WINDOW_END = date.today() - timedelta(days=7)
WINDOW_START = WINDOW_END - timedelta(days=365)
WINDOW = {"start": WINDOW_START.isoformat(), "end": WINDOW_END.isoformat()}

MAX_RANGE_DAYS = 3650
BARS = f"/api/v1/instruments/{SYMBOL}/bars"
SUMMARY = f"/api/v1/instruments/{SYMBOL}/summary"


@pytest.fixture(scope="module")
def contract():
    """Return the contract the running service publishes."""
    response = requests.get(f"{STOCK_APP_URL}/openapi.yaml", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return OpenAPI.from_dict(yaml.safe_load(response.text))


@pytest.fixture(scope="module")
def synced_window(contract):
    """Sync WINDOW for SYMBOL once per module, so the tests read from the store."""
    call(contract, BARS, params=WINDOW, timeout=PROVIDER_TIMEOUT_SECONDS)
    return WINDOW


def call(contract, path, params=None, timeout=REQUEST_TIMEOUT_SECONDS):
    """GET path and assert status, content type and body match the contract; return the response."""
    response = requests.get(f"{STOCK_APP_URL}{path}", params=params, timeout=timeout)
    try:
        contract.validate_response(RequestsOpenAPIRequest(response.request), RequestsOpenAPIResponse(response))
    except OpenAPIError as error:
        pytest.fail(f"GET {path} answered {response.status_code} in a shape the contract forbids: {error}")
    return response


def test_service_identity(contract):
    """GET / names the service."""
    response = call(contract, "/")

    assert response.status_code == 200
    assert response.json() == {"service": "stock-app"}


def test_health_reports_a_reachable_database(contract):
    """GET /health confirms the service reached TimescaleDB."""
    response = call(contract, "/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy", "database": "reachable"}


def test_metrics_are_served_in_prometheus_format(contract):
    """GET /metrics answers in the text exposition format Prometheus scrapes."""
    response = call(contract, "/metrics")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain")
    assert "# HELP" in response.text


def test_instruments_are_listed(contract):
    """GET /api/v1/instruments answers with a list, empty or not."""
    response = call(contract, "/api/v1/instruments")

    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_contract_is_published():
    """GET /openapi.yaml serves the authored contract."""
    response = requests.get(f"{STOCK_APP_URL}/openapi.yaml", timeout=REQUEST_TIMEOUT_SECONDS)

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/yaml")
    document = yaml.safe_load(response.text)
    assert document["info"]["title"] == "stock-app"
    assert "/api/v1/instruments/{symbol}/bars" in document["paths"]
    # Only the authored file has reusable parameters; a derived document would inline them.
    assert "Symbol" in document["components"]["parameters"]


def test_swagger_ui_renders_the_contract():
    """GET /docs serves the Swagger UI page that loads /openapi.yaml."""
    response = requests.get(f"{STOCK_APP_URL}/docs", timeout=REQUEST_TIMEOUT_SECONDS)

    assert response.status_code == 200
    assert "swagger-ui" in response.text
    assert "/openapi.yaml" in response.text


INVALID_WINDOWS = [
    pytest.param({}, id="no-range"),
    pytest.param({"start": WINDOW_START.isoformat()}, id="missing-end"),
    pytest.param({"end": WINDOW_END.isoformat()}, id="missing-start"),
    pytest.param({"start": WINDOW_END.isoformat(), "end": WINDOW_START.isoformat()}, id="inverted"),
    pytest.param(
        {"start": WINDOW_START.isoformat(), "end": (date.today() + timedelta(days=1)).isoformat()},
        id="future-end",
    ),
    pytest.param(
        {"start": (WINDOW_END - timedelta(days=MAX_RANGE_DAYS + 1)).isoformat(), "end": WINDOW_END.isoformat()},
        id="too-long",
    ),
    pytest.param({"start": "yesterday", "end": "today"}, id="malformed-dates"),
]


@pytest.mark.parametrize("path", [BARS, SUMMARY], ids=["bars", "summary"])
@pytest.mark.parametrize("params", INVALID_WINDOWS)
def test_invalid_window_is_rejected_before_the_provider_is_called(contract, path, params):
    """Every window rule answers 422 on both windowed endpoints, without a provider call."""
    response = call(contract, path, params=params)

    assert response.status_code == 422
    assert set(response.json()) == {"detail"}


@pytest.mark.parametrize("endpoint", ["bars", "summary"])
def test_symbol_outside_the_allowed_alphabet_is_rejected(contract, endpoint):
    """A symbol that could not be a ticker never reaches the provider."""
    response = call(contract, f"/api/v1/instruments/AA;DROP/{endpoint}", params=WINDOW)

    assert response.status_code == 422
    assert set(response.json()) == {"detail"}


def test_bars_are_served_for_the_requested_window(contract, synced_window):
    """GET /bars answers 200 with the window it was asked for."""
    response = call(contract, BARS, params=synced_window, timeout=PROVIDER_TIMEOUT_SECONDS)

    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == SYMBOL
    assert body["interval"] == "1d"
    assert body["range"] == synced_window
    assert body["count"] == len(body["bars"])
    assert body["count"] > 0


def test_summary_is_served_for_the_requested_window(contract, synced_window):
    """GET /summary answers 200 with statistics over the same window."""
    response = call(contract, SUMMARY, params=synced_window, timeout=PROVIDER_TIMEOUT_SECONDS)

    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == SYMBOL
    assert body["range"] == synced_window
    assert body["barCount"] > 0
    assert body["periodLow"] <= body["periodHigh"]


def test_window_without_trading_sessions_is_not_found(contract, synced_window):
    """A weekend inside the synced window answers 404 from the store, without the provider."""
    saturday = WINDOW_START + timedelta(days=(5 - WINDOW_START.weekday()) % 7)
    weekend = {"start": saturday.isoformat(), "end": (saturday + timedelta(days=1)).isoformat()}

    response = call(contract, SUMMARY, params=weekend, timeout=PROVIDER_TIMEOUT_SECONDS)

    assert response.status_code == 404
    assert set(response.json()) == {"detail"}


def test_unknown_symbol_is_not_found(contract):
    """A well-formed symbol the provider does not know answers 404."""
    response = call(contract, "/api/v1/instruments/ZZNOSUCHZZ/bars", params=WINDOW, timeout=PROVIDER_TIMEOUT_SECONDS)

    assert response.status_code == 404
    assert set(response.json()) == {"detail"}
