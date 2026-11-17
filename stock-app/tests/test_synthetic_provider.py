"""Tests for the provider that generates prices (STOCK_PROVIDER=synthetic)."""

import unittest
from datetime import date, timedelta

from prometheus_client import REGISTRY

from src.adapters.providers.synthetic import (
    CATALOG,
    FIRST_SESSION,
    PROVIDER_NAME,
    SyntheticMarketDataProvider,
    generate_bars,
)
from src.domain.errors import SymbolNotFoundError
from src.domain.models import utc_today

AAPL = CATALOG["AAPL"]


def provider_calls(outcome):
    """Return how many synthetic provider calls ended with outcome so far."""
    labels = {"provider": PROVIDER_NAME, "outcome": outcome}
    return REGISTRY.get_sample_value("stock_provider_requests_total", labels) or 0


class TestGeneratedBars(unittest.TestCase):
    """Tests the generated walk: deterministic, weekdays only and valid."""

    def test_a_date_gets_the_same_bar_in_any_range(self):
        narrow = generate_bars(AAPL, date(2026, 1, 1), date(2026, 6, 30))
        wide = {bar.session_date: bar for bar in generate_bars(AAPL, date(2025, 6, 1), date(2026, 11, 1))}

        self.assertTrue(narrow)
        self.assertEqual(narrow, [wide[bar.session_date] for bar in narrow])

    def test_bars_are_weekdays_within_the_range_oldest_first(self):
        start, end = date(2026, 3, 1), date(2026, 3, 31)

        sessions = [bar.session_date for bar in generate_bars(AAPL, start, end)]

        self.assertEqual(len(sessions), 22)
        self.assertEqual(sessions, sorted(sessions))
        self.assertTrue(all(start <= session <= end and session.weekday() < 5 for session in sessions))

    def test_range_before_the_first_session_has_no_bars(self):
        self.assertEqual(generate_bars(AAPL, date(1999, 1, 1), FIRST_SESSION - timedelta(days=1)), [])

    def test_every_symbol_walks_to_today_within_the_bar_invariants(self):
        """PriceBar rejects inconsistent OHLC values, so generating the whole walk is the check."""
        for listing in CATALOG.values():
            with self.subTest(symbol=listing.symbol):
                bars = generate_bars(listing, FIRST_SESSION, utc_today())

                self.assertTrue(all(bar.adj_close == bar.close for bar in bars))

    def test_symbols_follow_different_walks(self):
        day = date(2026, 6, 1)
        closes = {generate_bars(listing, day, day)[0].close for listing in CATALOG.values()}

        self.assertEqual(len(closes), len(CATALOG))


class TestProvider(unittest.TestCase):
    """Tests the provider around the walk."""

    def setUp(self):
        self.provider = SyntheticMarketDataProvider()

    def test_no_bar_is_dated_after_today(self):
        today = utc_today()

        bars = self.provider.fetch_daily_bars("AAPL", today - timedelta(days=14), today + timedelta(days=30))

        self.assertTrue(bars)
        self.assertLessEqual(bars[-1].session_date, today)

    def test_instrument_comes_from_the_catalog(self):
        instrument = self.provider.fetch_instrument("MSFT")

        self.assertEqual(instrument.name, "Microsoft Corporation")
        self.assertEqual(instrument.currency, "USD")
        self.assertEqual(instrument.source, PROVIDER_NAME)

    def test_unknown_symbol_raises_symbol_not_found(self):
        with self.assertRaises(SymbolNotFoundError):
            self.provider.fetch_daily_bars("ZZNOSUCHZZ", date(2026, 6, 1), date(2026, 6, 3))
        with self.assertRaises(SymbolNotFoundError):
            self.provider.fetch_instrument("ZZNOSUCHZZ")

    def test_calls_are_counted_by_outcome(self):
        success, not_found = provider_calls("success"), provider_calls("not_found")

        self.provider.fetch_instrument("AAPL")
        with self.assertRaises(SymbolNotFoundError):
            self.provider.fetch_instrument("ZZNOSUCHZZ")

        self.assertEqual(provider_calls("success"), success + 1)
        self.assertEqual(provider_calls("not_found"), not_found + 1)


if __name__ == "__main__":
    unittest.main()
