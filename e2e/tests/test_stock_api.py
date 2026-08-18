"""End-to-end tests of every stock-app endpoint, checked against its own contract.

Each response is validated with ``openapi-core`` against the document the
running service publishes at ``/openapi.json``, so these tests assert what the
service *promises* rather than a copy of that promise kept here. A response
that stops matching its declared schema fails, and so does one the service
honours but never published.

Two status codes are deliberately absent. 502 and 503 need the market data
provider or TimescaleDB to be unreachable, which a black-box test against a
healthy cluster cannot arrange; `stock-app/tests/test_routes.py` covers them
with both ports replaced.

Nothing here carries the ``external`` marker. Whether this module touches a
third-party API is decided by the cluster, not by the test run: deployed with
``STOCK_PROVIDER=fixture`` it replays a recording baked into the image and
reaches no network at all, which is how CI runs it. Deployed with
``STOCK_PROVIDER=yahoo`` the same tests exercise the real provider. See
[End-to-End Tests](../../documentation/docs/e2e-tests.md).
"""

from datetime import date, timedelta

import pytest
import requests
from openapi_core import OpenAPI
from openapi_core.contrib.requests import RequestsOpenAPIRequest, RequestsOpenAPIResponse
from openapi_core.exceptions import OpenAPIError

from cluster import REQUEST_TIMEOUT_SECONDS, STOCK_APP_URL

SYMBOL = "AAPL"
PROVIDER_TIMEOUT_SECONDS = 60

# A year-long window ending a week back: never future-dated, certain to hold
# trading sessions, and wide enough that it keeps overlapping the recorded
# window in `stock-app/fixtures/` for about a year before a re-record is due.
WINDOW_END = date.today() - timedelta(days=7)
WINDOW_START = WINDOW_END - timedelta(days=365)
WINDOW = {"start": WINDOW_START.isoformat(), "end": WINDOW_END.isoformat()}

MAX_RANGE_DAYS = 3650
BARS = f"/api/v1/instruments/{SYMBOL}/bars"
SUMMARY = f"/api/v1/instruments/{SYMBOL}/summary"


@pytest.fixture(scope="module")
def contract():
    """Return the OpenAPI document the running service publishes.

    Returns:
        The contract, ready to validate responses against.
    """
    response = requests.get(f"{STOCK_APP_URL}/openapi.json", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return OpenAPI.from_dict(response.json())


@pytest.fixture(scope="module")
def synced_window(contract):
    """Make sure the store holds ``WINDOW`` for ``SYMBOL`` before the tests that need it.

    Fetching once per module keeps the provider out of the individual tests, so
    each of them observes the same synced state whatever order they run in.

    Returns:
        The window the store is now known to cover.
    """
    call(contract, BARS, params=WINDOW, timeout=PROVIDER_TIMEOUT_SECONDS)
    return WINDOW


def call(contract, path, params=None, timeout=REQUEST_TIMEOUT_SECONDS):
    """GET an endpoint and assert the answer is one its declaration allows.

    Args:
        contract: The published contract to validate against.
        path: Path to request, relative to the ingress host.
        params: Query parameters, if any.
        timeout: Seconds to wait; raised for calls that may reach the provider.

    Returns:
        The response, once its status code, content type and body have been
        checked against the operation the contract declares for that path.
    """
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
    """GET /openapi.json serves the authored contract shipped in the image.

    Not routed through ``call``: FastAPI adds this endpoint and ``/docs``
    itself, so the contract neither declares nor should declare them.
    """
    response = requests.get(f"{STOCK_APP_URL}/openapi.json", timeout=REQUEST_TIMEOUT_SECONDS)

    assert response.status_code == 200
    document = response.json()
    assert document["info"]["title"] == "stock-app"
    assert "/api/v1/instruments/{symbol}/bars" in document["paths"]
    # Reusable parameters only exist in the authored file; a document derived
    # from the code would inline them, so this pins down which one is served.
    assert "Symbol" in document["components"]["parameters"]


def test_swagger_ui_renders_the_contract():
    """GET /docs serves the Swagger UI page that loads /openapi.json."""
    response = requests.get(f"{STOCK_APP_URL}/docs", timeout=REQUEST_TIMEOUT_SECONDS)

    assert response.status_code == 200
    assert "swagger-ui" in response.text
    assert "/openapi.json" in response.text


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
    """A weekend answers 404: the range is synced, it just holds no sessions.

    Taken from inside the synced window so the store answers on its own - this
    exercises the 404 branch of the summary endpoint, not the provider.
    """
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
