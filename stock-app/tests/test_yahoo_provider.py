"""Tests for the Yahoo adapter's DataFrame cleaning and mapping.

yfinance is replaced by a stub, so no test here reaches the network.
"""

import unittest
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pandas as pd
from yfinance.exceptions import YFPricesMissingError, YFTickerMissingError

from src.adapters.providers.yahoo import YahooMarketDataProvider
from src.domain.errors import ProviderError, SymbolNotFoundError
from src.observability.metrics import PROVIDER_REQUESTS, ROWS_REJECTED

EXCHANGE_TIMEZONE = "America/New_York"

INFO = {"symbol": "AAPL", "longName": "Apple Inc.", "fullExchangeName": "NasdaqGS", "currency": "USD"}


def build_frame(rows, timestamps, timezone=EXCHANGE_TIMEZONE):
    """Build a yfinance-shaped price history frame.

    Args:
        rows: One mapping of column name to value per row.
        timestamps: Naive timestamp strings, localized to the exchange timezone.
        timezone: Exchange timezone the index is localized to.

    Returns:
        A DataFrame indexed like ``Ticker.history()`` output.
    """
    index = pd.DatetimeIndex(pd.to_datetime(timestamps)).tz_localize(timezone)
    return pd.DataFrame(rows, index=index)


def build_row(close=105.0, **overrides):
    """Build one valid OHLCV row.

    Args:
        close: Closing price, also used as the adjusted close.
        **overrides: Column values replacing the valid defaults.

    Returns:
        A column-to-value mapping.
    """
    row = {"Open": 100.0, "High": 110.0, "Low": 90.0, "Close": close, "Adj Close": close, "Volume": 1000}
    row.update(overrides)
    return row


class StubTicker:
    """Stand-in for yfinance.Ticker returning canned data.

    Attributes:
        frame: Frame returned by history().
        info: Mapping returned by get_info().
        history_error: Exception history() raises instead of answering.
        info_error: Exception get_info() raises instead of answering.
        history_kwargs: Keyword arguments the last history() call received.
    """

    frame = None
    info = INFO
    history_error = None
    info_error = None
    history_kwargs = None

    def __init__(self, symbol):
        """Record the symbol the caller asked for."""
        self.symbol = symbol

    def history(self, **kwargs):
        """Return the canned frame, or raise the configured error."""
        StubTicker.history_kwargs = kwargs
        if StubTicker.history_error is not None:
            raise StubTicker.history_error
        return StubTicker.frame

    def get_info(self):
        """Return the canned info mapping, or raise the configured error."""
        if StubTicker.info_error is not None:
            raise StubTicker.info_error
        return StubTicker.info


class YahooProviderTestCase(unittest.TestCase):
    """Base fixture patching yfinance out of the adapter."""

    def setUp(self):
        StubTicker.frame = build_frame([build_row()], ["2026-06-25 00:00:00"])
        StubTicker.info = INFO
        StubTicker.history_error = None
        StubTicker.info_error = None
        StubTicker.history_kwargs = None
        patcher = patch("src.adapters.providers.yahoo.yf.Ticker", StubTicker)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.provider = YahooMarketDataProvider()

    def fetch(self, start=date(2026, 6, 1), end=date(2026, 6, 30)):
        """Fetch daily bars over a range using the stubbed ticker."""
        return self.provider.fetch_daily_bars("AAPL", start, end)

    @staticmethod
    def rejected(reason):
        """Return the current value of the rejection counter for a reason."""
        return ROWS_REJECTED.labels(provider="yahoo", reason=reason)._value.get()

    @staticmethod
    def provider_calls(outcome):
        """Return the current value of the provider call counter for an outcome."""
        return PROVIDER_REQUESTS.labels(provider="yahoo", outcome=outcome)._value.get()


class TestFetchDailyBars(YahooProviderTestCase):
    """Tests for turning a provider frame into domain bars."""

    def test_maps_all_columns(self):
        bars = self.fetch()

        self.assertEqual(len(bars), 1)
        bar = bars[0]
        self.assertEqual(bar.symbol, "AAPL")
        self.assertEqual(bar.session_date, date(2026, 6, 25))
        self.assertEqual(bar.open, Decimal("100.0000"))
        self.assertEqual(bar.high, Decimal("110.0000"))
        self.assertEqual(bar.low, Decimal("90.0000"))
        self.assertEqual(bar.close, Decimal("105.0000"))
        self.assertEqual(bar.adj_close, Decimal("105.0000"))
        self.assertEqual(bar.volume, 1000)

    def test_requests_unadjusted_prices_over_an_inclusive_range(self):
        self.fetch(start=date(2026, 6, 1), end=date(2026, 6, 30))

        kwargs = StubTicker.history_kwargs
        self.assertIs(kwargs["auto_adjust"], False)
        self.assertIs(kwargs["actions"], False)
        self.assertEqual(kwargs["start"], date(2026, 6, 1))
        self.assertEqual(kwargs["end"], date(2026, 7, 1), "yfinance treats end as exclusive")

    def test_session_date_uses_the_exchange_calendar_not_utc(self):
        """A 20:00 New York session belongs to that day, not the next UTC day."""
        StubTicker.frame = build_frame([build_row()], ["2026-06-25 20:00:00"])

        self.assertEqual(self.fetch()[0].session_date, date(2026, 6, 25))

    def test_holiday_rows_without_prices_are_dropped(self):
        StubTicker.frame = build_frame(
            [build_row(), {"Open": None, "High": None, "Low": None, "Close": None, "Adj Close": None, "Volume": 0}],
            ["2026-06-25 00:00:00", "2026-06-26 00:00:00"],
        )

        self.assertEqual([bar.session_date for bar in self.fetch()], [date(2026, 6, 25)])

    def test_duplicate_sessions_keep_the_last_value(self):
        StubTicker.frame = build_frame(
            [build_row(close=100.0), build_row(close=107.0)],
            ["2026-06-25 00:00:00", "2026-06-25 00:00:00"],
        )

        bars = self.fetch()

        self.assertEqual(len(bars), 1)
        self.assertEqual(bars[0].close, Decimal("107.0000"))

    def test_rows_are_sorted_chronologically(self):
        StubTicker.frame = build_frame(
            [build_row(), build_row(), build_row()],
            ["2026-06-26 00:00:00", "2026-06-24 00:00:00", "2026-06-25 00:00:00"],
        )

        sessions = [bar.session_date for bar in self.fetch()]

        self.assertEqual(sessions, sorted(sessions))

    def test_prices_are_rounded_to_four_decimals(self):
        StubTicker.frame = build_frame([build_row(close=105.123456)], ["2026-06-25 00:00:00"])

        self.assertEqual(self.fetch()[0].close, Decimal("105.1235"))

    def test_missing_adj_close_column_leaves_the_field_empty(self):
        row = build_row()
        del row["Adj Close"]
        StubTicker.frame = build_frame([row], ["2026-06-25 00:00:00"])

        self.assertIsNone(self.fetch()[0].adj_close)

    def test_nan_adj_close_leaves_the_field_empty(self):
        StubTicker.frame = build_frame([build_row(**{"Adj Close": float("nan")})], ["2026-06-25 00:00:00"])

        self.assertIsNone(self.fetch()[0].adj_close)

    def test_row_violating_an_invariant_is_counted_not_raised(self):
        StubTicker.frame = build_frame(
            [build_row(), build_row(Volume=-5)],
            ["2026-06-25 00:00:00", "2026-06-26 00:00:00"],
        )
        before = self.rejected("validation")

        bars = self.fetch()

        self.assertEqual([bar.session_date for bar in bars], [date(2026, 6, 25)])
        self.assertEqual(self.rejected("validation"), before + 1)

    def test_nan_volume_is_counted_as_a_rejection(self):
        StubTicker.frame = build_frame([build_row(Volume=float("nan"))], ["2026-06-25 00:00:00"])
        before = self.rejected("validation")

        self.assertEqual(self.fetch(), [])
        self.assertEqual(self.rejected("validation"), before + 1)

    def test_unparseable_session_date_is_counted_as_a_rejection(self):
        frame = build_frame([build_row(), build_row()], ["2026-06-25 00:00:00", "2026-06-26 00:00:00"])
        frame.index = pd.DatetimeIndex([frame.index[0], pd.NaT])
        StubTicker.frame = frame
        before = self.rejected("malformed")

        bars = self.fetch()

        self.assertEqual(len(bars), 1)
        self.assertEqual(self.rejected("malformed"), before + 1)

    def test_empty_frame_yields_no_bars(self):
        StubTicker.frame = pd.DataFrame()

        self.assertEqual(self.fetch(), [])

    def test_range_without_prices_yields_no_bars(self):
        StubTicker.history_error = YFPricesMissingError("AAPL", "no data")

        self.assertEqual(self.fetch(), [])

    def test_unknown_symbol_raises_symbol_not_found(self):
        StubTicker.history_error = YFTickerMissingError("NOSUCH", "missing")
        before = self.provider_calls("not_found")

        with self.assertRaises(SymbolNotFoundError):
            self.fetch()
        self.assertEqual(self.provider_calls("not_found"), before + 1)

    def test_transport_failure_raises_provider_error(self):
        StubTicker.history_error = ConnectionError("connection reset")
        before = self.provider_calls("error")

        with self.assertRaises(ProviderError):
            self.fetch()
        self.assertEqual(self.provider_calls("error"), before + 1)

    def test_successful_call_is_counted(self):
        before = self.provider_calls("success")

        self.fetch()

        self.assertEqual(self.provider_calls("success"), before + 1)


class TestFetchInstrument(YahooProviderTestCase):
    """Tests for instrument metadata lookup."""

    def test_maps_descriptive_fields(self):
        instrument = self.provider.fetch_instrument("AAPL")

        self.assertEqual(instrument.symbol, "AAPL")
        self.assertEqual(instrument.name, "Apple Inc.")
        self.assertEqual(instrument.exchange, "NasdaqGS")
        self.assertEqual(instrument.currency, "USD")
        self.assertEqual(instrument.source, "yahoo")

    def test_leaves_the_sync_ledger_empty(self):
        instrument = self.provider.fetch_instrument("AAPL")

        self.assertIsNone(instrument.first_synced_date)
        self.assertIsNone(instrument.last_synced_date)
        self.assertIsNone(instrument.last_synced_at)

    def test_empty_info_raises_symbol_not_found(self):
        StubTicker.info = {}

        with self.assertRaises(SymbolNotFoundError):
            self.provider.fetch_instrument("NOSUCH")

    def test_missing_ticker_raises_symbol_not_found(self):
        StubTicker.info_error = YFTickerMissingError("NOSUCH", "missing")

        with self.assertRaises(SymbolNotFoundError):
            self.provider.fetch_instrument("NOSUCH")

    def test_transport_failure_raises_provider_error(self):
        StubTicker.info_error = ConnectionError("connection reset")

        with self.assertRaises(ProviderError):
            self.provider.fetch_instrument("AAPL")


if __name__ == "__main__":
    unittest.main()
