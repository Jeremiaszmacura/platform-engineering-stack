"""Tests for the HTTP surface, with both ports replaced through dependency overrides."""

import unittest
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi.testclient import TestClient

from src.adapters.inbound.http.deps import get_price_history_service, get_repository, get_secret_store
from src.adapters.inbound.http.params import MAX_RANGE_DAYS
from src.domain.errors import (
    ProviderError,
    RepositoryError,
    SecretNotFoundError,
    SecretStoreError,
    SymbolNotFoundError,
)
from src.domain.models import DataSource, DateRange, Instrument, Interval, PriceBar, PriceHistory, PriceSummary
from src.main import app

PERIOD = DateRange(start=date(2026, 6, 25), end=date(2026, 6, 26))
BARS_URL = "/api/v1/instruments/AAPL/bars"
SUMMARY_URL = "/api/v1/instruments/AAPL/summary"
PERIOD_PARAMS = {"start": "2026-06-25", "end": "2026-06-26"}

INSTRUMENT = Instrument(
    symbol="AAPL",
    name="Apple Inc.",
    exchange="NasdaqGS",
    currency="USD",
    first_synced_date=date(2026, 6, 1),
    last_synced_date=date(2026, 6, 30),
    last_synced_at=datetime(2026, 7, 25, 10, 0, tzinfo=timezone.utc),
    source="yahoo",
)

BAR = PriceBar(
    symbol="AAPL",
    interval=Interval.DAY,
    session_date=date(2026, 6, 25),
    open=Decimal("201.5"),
    high=Decimal("203.1"),
    low=Decimal("200.9"),
    close=Decimal("202.4"),
    adj_close=Decimal("202.4"),
    volume=41230100,
)

SUMMARY = PriceSummary(
    symbol="AAPL",
    interval=Interval.DAY,
    period=PERIOD,
    first_close=Decimal("201.0"),
    last_close=Decimal("202.4"),
    period_high=Decimal("203.1"),
    period_low=Decimal("200.9"),
    average_volume=Decimal("41230100"),
    bar_count=2,
)


class FakeService:
    """Fake PriceHistoryService returning canned results or raising error."""

    def __init__(self, error=None, summary=SUMMARY):
        """Create the fake with an optional error and the summary to return."""
        self.error = error
        self.summary = summary

    def get_price_history(self, symbol, period):
        """Return a canned price history."""
        self._fail_if_configured()
        return PriceHistory(
            symbol="AAPL",
            interval=Interval.DAY,
            currency="USD",
            source=DataSource.PROVIDER,
            period=period,
            bars=(BAR,),
        )

    def get_price_summary(self, symbol, period):
        """Return a canned summary."""
        self._fail_if_configured()
        return self.summary

    def list_instruments(self):
        """Return a canned instrument list."""
        self._fail_if_configured()
        return [INSTRUMENT]

    def _fail_if_configured(self):
        """Raise the configured error, if any."""
        if self.error is not None:
            raise self.error


class FakeRepository:
    """Fake repository for the health route."""

    def __init__(self, healthy=True):
        """Create the fake; healthy is what check_health() returns."""
        self.healthy = healthy

    def check_health(self):
        """Report the configured health."""
        return self.healthy


class FakeSecretStore:
    """In-memory secret store that can raise error."""

    def __init__(self, error=None):
        """Create the fake with an optional error to raise."""
        self.stored = {}
        self.error = error

    def write_secret(self, key, value):
        """Record a write."""
        self._fail_if_configured()
        self.stored[key] = value

    def read_secret(self, key):
        """Return a recorded write, or raise when there is none."""
        self._fail_if_configured()
        if key not in self.stored:
            raise SecretNotFoundError(key)
        return self.stored[key]

    def _fail_if_configured(self):
        """Raise the configured error, if any."""
        if self.error is not None:
            raise self.error


class RouteTestCase(unittest.TestCase):
    """Base fixture wiring fakes into the application."""

    def setUp(self):
        self.service = FakeService()
        self.repository = FakeRepository()
        self.secrets = FakeSecretStore()
        app.dependency_overrides[get_price_history_service] = lambda: self.service
        app.dependency_overrides[get_repository] = lambda: self.repository
        app.dependency_overrides[get_secret_store] = lambda: self.secrets
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()


class TestServiceRoutes(RouteTestCase):
    """Tests for the root, health and metrics routes."""

    def test_root_identifies_the_service(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"service": "stock-app"})

    def test_health_reports_a_reachable_database(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["database"], "reachable")

    def test_health_reports_503_when_the_database_is_unreachable(self):
        self.repository.healthy = False

        response = self.client.get("/health")

        self.assertEqual(response.status_code, 503)

    def test_metrics_are_exposed(self):
        response = self.client.get("/metrics")

        self.assertEqual(response.status_code, 200)
        self.assertIn("stock_cache_lookups_total", response.text)


class TestBarsEndpoint(RouteTestCase):
    """Tests for the cache-aside bars endpoint."""

    def test_returns_bars_with_camel_case_keys(self):
        response = self.client.get(BARS_URL, params=PERIOD_PARAMS)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["symbol"], "AAPL")
        self.assertEqual(body["interval"], "1d")
        self.assertEqual(body["currency"], "USD")
        self.assertEqual(body["source"], "provider")
        self.assertEqual(body["range"], {"start": "2026-06-25", "end": "2026-06-26"})
        self.assertEqual(body["count"], 1)
        self.assertEqual(
            body["bars"],
            [
                {
                    "date": "2026-06-25",
                    "open": 201.5,
                    "high": 203.1,
                    "low": 200.9,
                    "close": 202.4,
                    "adjClose": 202.4,
                    "volume": 41230100,
                }
            ],
        )

    def test_prices_are_json_numbers(self):
        bar = self.client.get(BARS_URL, params=PERIOD_PARAMS).json()["bars"][0]

        for field in ("open", "high", "low", "close", "adjClose"):
            with self.subTest(field=field):
                self.assertIsInstance(bar[field], float)

    def test_unknown_symbol_returns_404(self):
        self.service.error = SymbolNotFoundError("NOSUCH")

        response = self.client.get("/api/v1/instruments/NOSUCH/bars", params=PERIOD_PARAMS)

        self.assertEqual(response.status_code, 404)

    def test_provider_failure_returns_502(self):
        self.service.error = ProviderError("upstream down")

        self.assertEqual(self.client.get(BARS_URL, params=PERIOD_PARAMS).status_code, 502)

    def test_store_failure_returns_503(self):
        self.service.error = RepositoryError("database down")

        self.assertEqual(self.client.get(BARS_URL, params=PERIOD_PARAMS).status_code, 503)

    def test_missing_start_returns_422(self):
        self.assertEqual(self.client.get(BARS_URL, params={"end": "2026-06-26"}).status_code, 422)

    def test_missing_end_returns_422(self):
        self.assertEqual(self.client.get(BARS_URL, params={"start": "2026-06-25"}).status_code, 422)

    def test_inverted_range_returns_422(self):
        params = {"start": "2026-06-26", "end": "2026-06-25"}

        self.assertEqual(self.client.get(BARS_URL, params=params).status_code, 422)

    def test_future_end_returns_422(self):
        tomorrow = datetime.now(timezone.utc).date() + timedelta(days=1)
        params = {"start": "2026-06-25", "end": tomorrow.isoformat()}

        self.assertEqual(self.client.get(BARS_URL, params=params).status_code, 422)

    def test_overlong_range_returns_422(self):
        end = date(2026, 6, 25)
        params = {"start": (end - timedelta(days=MAX_RANGE_DAYS + 1)).isoformat(), "end": end.isoformat()}

        self.assertEqual(self.client.get(BARS_URL, params=params).status_code, 422)

    def test_longest_allowed_range_is_accepted(self):
        end = date(2026, 6, 25)
        params = {"start": (end - timedelta(days=MAX_RANGE_DAYS)).isoformat(), "end": end.isoformat()}

        self.assertEqual(self.client.get(BARS_URL, params=params).status_code, 200)

    def test_malformed_date_returns_422(self):
        self.assertEqual(self.client.get(BARS_URL, params={"start": "yesterday", "end": "today"}).status_code, 422)

    def test_symbol_outside_the_allowed_alphabet_returns_422(self):
        response = self.client.get("/api/v1/instruments/AA;DROP/bars", params=PERIOD_PARAMS)

        self.assertEqual(response.status_code, 422)


class TestSecretEndpoints(RouteTestCase):
    """Tests for the Vault-backed secret endpoints."""

    def test_storing_a_secret_answers_201_without_echoing_the_value(self):
        response = self.client.post("/secret", json={"key": "api-token", "value": "s3cret"})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"key": "api-token", "status": "stored"})

    def test_a_stored_secret_reads_back(self):
        self.client.post("/secret", json={"key": "api-token", "value": "s3cret"})

        response = self.client.get("/secret/api-token")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"key": "api-token", "value": "s3cret"})

    def test_reading_a_missing_secret_returns_404(self):
        response = self.client.get("/secret/never-written")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "secret not found"})

    def test_a_failing_store_returns_502(self):
        self.secrets.error = SecretStoreError("vault down")

        response = self.client.post("/secret", json={"key": "api-token", "value": "s3cret"})

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json(), {"detail": "secret store request failed"})

    def test_a_key_outside_the_allowed_alphabet_returns_422(self):
        """The key becomes part of a Vault path, so the alphabet is restricted."""
        self.assertEqual(self.client.get("/secret/api$token").status_code, 422)

    def test_a_traversal_attempt_never_reaches_the_store(self):
        """An encoded separator is decoded before routing, so no route matches at all."""
        response = self.client.get("/secret/..%2Fother-service%2Ftoken")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.secrets.stored, {})

    def test_a_missing_value_returns_422(self):
        self.assertEqual(self.client.post("/secret", json={"key": "api-token"}).status_code, 422)

    def test_an_empty_value_returns_422(self):
        self.assertEqual(self.client.post("/secret", json={"key": "k", "value": ""}).status_code, 422)


class TestErrorShape(RouteTestCase):
    """Tests that every failure, including both kinds of 422, uses the contract's ErrorResponse."""

    def test_a_rejected_schema_answers_one_detail_string(self):
        body = self.client.get(BARS_URL, params={"end": "2026-06-26"}).json()

        self.assertEqual(body, {"detail": "start: Field required"})

    def test_a_broken_cross_parameter_rule_answers_one_detail_string(self):
        body = self.client.get(BARS_URL, params={"start": "2026-06-26", "end": "2026-06-25"}).json()

        self.assertEqual(body, {"detail": "start must not be after end"})

    def test_a_domain_error_answers_one_detail_string(self):
        self.service.error = ProviderError("upstream down")

        body = self.client.get(BARS_URL, params=PERIOD_PARAMS).json()

        self.assertEqual(body, {"detail": "market data provider request failed"})


class TestSummaryEndpoint(RouteTestCase):
    """Tests for the period summary endpoint."""

    def test_returns_summary_with_camel_case_keys(self):
        response = self.client.get(SUMMARY_URL, params=PERIOD_PARAMS)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "symbol": "AAPL",
                "interval": "1d",
                "range": {"start": "2026-06-25", "end": "2026-06-26"},
                "barCount": 2,
                "firstClose": 201.0,
                "lastClose": 202.4,
                "periodHigh": 203.1,
                "periodLow": 200.9,
                "averageVolume": 41230100.0,
            },
        )

    def test_period_without_bars_returns_404(self):
        self.service.summary = None

        self.assertEqual(self.client.get(SUMMARY_URL, params=PERIOD_PARAMS).status_code, 404)


class TestInstrumentsEndpoint(RouteTestCase):
    """Tests for the instrument listing used by the front end picker."""

    def test_lists_instruments_with_their_synced_window(self):
        response = self.client.get("/api/v1/instruments")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            [
                {
                    "symbol": "AAPL",
                    "name": "Apple Inc.",
                    "exchange": "NasdaqGS",
                    "currency": "USD",
                    "firstSyncedDate": "2026-06-01",
                    "lastSyncedDate": "2026-06-30",
                    "lastSyncedAt": "2026-07-25T10:00:00Z",
                    "source": "yahoo",
                }
            ],
        )

    def test_store_failure_returns_503(self):
        self.service.error = RepositoryError("database down")

        self.assertEqual(self.client.get("/api/v1/instruments").status_code, 503)


if __name__ == "__main__":
    unittest.main()
