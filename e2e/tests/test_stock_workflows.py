"""End-to-end tests of the stock-app cache-aside workflow.

This module is about behaviour over time: what the sync ledger absorbs, what
reaches the provider, and what the counters say about it. The endpoints
themselves, and the shapes they answer in, are covered against the published
contract in ``test_stock_api.py``.

Tests marked ``external`` reach Yahoo Finance through the cluster. Yahoo
rate-limits datacenter IPs and CI runs the whole suite on every pull request,
so CI runs with ``-m "not external"``; everything unmarked here exercises the
service without a provider call.
"""

from dataclasses import dataclass
from datetime import date, timedelta

import pytest
import requests

from cluster import REQUEST_TIMEOUT_SECONDS, STOCK_APP_URL, read_counter

SYMBOL = "AAPL"
PERIOD_DAYS = 30
PROVIDER_TIMEOUT_SECONDS = 60


@dataclass(frozen=True)
class Period:
    """An inclusive session-date window to request.

    Attributes:
        start: First session date.
        end: Last session date.
    """

    start: date
    end: date

    @property
    def params(self):
        """Return the window as query parameters.

        Returns:
            A ``start``/``end`` mapping in ISO format.
        """
        return {"start": self.start.isoformat(), "end": self.end.isoformat()}


def bars_url(symbol):
    """Return the bars endpoint URL for a symbol.

    Args:
        symbol: Ticker symbol to request.

    Returns:
        The absolute URL of the symbol's bars endpoint.
    """
    return f"{STOCK_APP_URL}/api/v1/instruments/{symbol}/bars"


def summary_url(symbol):
    """Return the summary endpoint URL for a symbol.

    Args:
        symbol: Ticker symbol to request.

    Returns:
        The absolute URL of the symbol's summary endpoint.
    """
    return f"{STOCK_APP_URL}/api/v1/instruments/{symbol}/summary"


def fetch_metrics():
    """Return stock-app's /metrics payload in Prometheus text format.

    Returns:
        The raw Prometheus exposition text.
    """
    response = requests.get(f"{STOCK_APP_URL}/metrics", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.text


def fetch_ledger(symbol):
    """Return the stored sync ledger for a symbol, or None if it has none.

    Args:
        symbol: Ticker symbol to look up.

    Returns:
        The instrument entry from `/api/v1/instruments`, or None.
    """
    response = requests.get(f"{STOCK_APP_URL}/api/v1/instruments", timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return next((instrument for instrument in response.json() if instrument["symbol"] == symbol), None)


@pytest.fixture(scope="module")
def unsynced_period():
    """Return a window the store cannot already hold.

    The suite runs repeatedly against the same cluster and the TimescaleDB PVC
    outlives a pod restart, so a fixed window would be a cache hit on the
    second run and the cold path would silently stop being tested. Starting
    before the earliest date already synced forces a backward extension, which
    is a guaranteed provider call whatever ran before.

    Returns:
        A Period that the service must fetch from the provider.
    """
    ledger = fetch_ledger(SYMBOL)
    end = date.today() - timedelta(days=7)
    if ledger and ledger["firstSyncedDate"]:
        end = date.fromisoformat(ledger["firstSyncedDate"]) - timedelta(days=1)
    return Period(start=end - timedelta(days=PERIOD_DAYS), end=end)


@pytest.fixture(scope="module")
def cold_then_cached(unsynced_period):
    """Request an unsynced window, then immediately request it again.

    Both requests are made once per module so every test observes the same
    provider/cache pair whatever order they run in.

    Returns:
        The decoded bodies of the first and the second response.
    """
    first = requests.get(bars_url(SYMBOL), params=unsynced_period.params, timeout=PROVIDER_TIMEOUT_SECONDS)
    first.raise_for_status()
    second = requests.get(bars_url(SYMBOL), params=unsynced_period.params, timeout=PROVIDER_TIMEOUT_SECONDS)
    second.raise_for_status()
    return first.json(), second.json()


def test_metrics_expose_the_cache_aside_pipeline():
    """GET /metrics serves every stock-specific metric, even before any traffic."""
    metrics = fetch_metrics()
    for metric in (
        "stock_provider_requests_total",
        "stock_provider_request_duration_seconds",
        "stock_cache_lookups_total",
        "stock_bars_upserted_total",
        "stock_provider_rows_rejected_total",
    ):
        assert metric in metrics


def test_no_metric_is_labeled_by_symbol():
    """Symbols come from request paths, so they must never become label values."""
    assert "symbol=" not in fetch_metrics()


@pytest.mark.external
def test_cold_request_comes_from_the_provider(cold_then_cached):
    """The first request for a symbol fills the store from the provider."""
    cold, _ = cold_then_cached
    assert cold["source"] == "provider"
    assert cold["symbol"] == SYMBOL
    assert cold["interval"] == "1d"
    assert cold["count"] > 0


@pytest.mark.external
def test_repeat_request_is_served_from_cache(cold_then_cached):
    """An immediate repeat is served from the store with identical bars."""
    cold, cached = cold_then_cached
    assert cached["source"] == "cache"
    assert cached["bars"] == cold["bars"]


@pytest.mark.external
def test_cached_request_makes_no_provider_call(cold_then_cached, unsynced_period):
    """The cached path must not increment the provider call counter."""
    labels = {"provider": "yahoo", "outcome": "success"}
    before = read_counter(fetch_metrics(), "stock_provider_requests_total", labels)

    response = requests.get(bars_url(SYMBOL), params=unsynced_period.params, timeout=PROVIDER_TIMEOUT_SECONDS)

    assert response.json()["source"] == "cache"
    assert read_counter(fetch_metrics(), "stock_provider_requests_total", labels) == before


@pytest.mark.external
def test_cache_hits_are_counted(cold_then_cached, unsynced_period):
    """A cached request increments the cache hit counter."""
    labels = {"outcome": "hit"}
    before = read_counter(fetch_metrics(), "stock_cache_lookups_total", labels)

    requests.get(bars_url(SYMBOL), params=unsynced_period.params, timeout=PROVIDER_TIMEOUT_SECONDS)

    assert read_counter(fetch_metrics(), "stock_cache_lookups_total", labels) > before


@pytest.mark.external
def test_bars_are_ordered_and_internally_consistent(cold_then_cached):
    """Every returned bar satisfies the OHLC invariants and dates ascend."""
    cold, _ = cold_then_cached
    bars = cold["bars"]

    assert [bar["date"] for bar in bars] == sorted(bar["date"] for bar in bars)
    for bar in bars:
        assert bar["low"] <= bar["open"] <= bar["high"]
        assert bar["low"] <= bar["close"] <= bar["high"]
        assert bar["volume"] >= 0
        assert bar["adjClose"] is not None


@pytest.mark.external
def test_calendar_window_holds_fewer_bars_than_days(cold_then_cached):
    """Markets close on weekends, so a 30 day window cannot hold 30 sessions."""
    cold, _ = cold_then_cached
    assert cold["count"] < PERIOD_DAYS


@pytest.mark.external
def test_summary_agrees_with_the_bars_it_summarizes(cold_then_cached, unsynced_period):
    """The Timescale aggregates match the bars returned for the same period."""
    cold, _ = cold_then_cached
    bars = cold["bars"]

    response = requests.get(summary_url(SYMBOL), params=unsynced_period.params, timeout=PROVIDER_TIMEOUT_SECONDS)

    assert response.status_code == 200
    summary = response.json()
    assert summary["barCount"] == len(bars)
    assert summary["firstClose"] == pytest.approx(bars[0]["close"])
    assert summary["lastClose"] == pytest.approx(bars[-1]["close"])
    assert summary["periodHigh"] == pytest.approx(max(bar["high"] for bar in bars))
    assert summary["periodLow"] == pytest.approx(min(bar["low"] for bar in bars))


@pytest.mark.external
def test_fetched_symbol_appears_in_the_instrument_list(cold_then_cached, unsynced_period):
    """A synced symbol is listed with a window covering what was requested.

    The ledger is a union of every window ever fetched, so it may reach further
    than this run asked for; what it may never do is claim less.
    """
    ledger = fetch_ledger(SYMBOL)

    assert ledger is not None
    assert date.fromisoformat(ledger["firstSyncedDate"]) <= unsynced_period.start
    assert date.fromisoformat(ledger["lastSyncedDate"]) >= unsynced_period.end
    assert ledger["source"] == "yahoo"
