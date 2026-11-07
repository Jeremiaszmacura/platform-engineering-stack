"""Tests for the cache-aside use case, with in-memory fakes for both ports."""

import unittest
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from src.application.price_history import PriceHistoryService, missing_range
from src.domain.errors import ProviderError, SymbolNotFoundError
from src.domain.models import DataSource, DateRange, Instrument, Interval, PriceBar

STALE_AFTER = timedelta(hours=1)
NOW = datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc)

JUNE = DateRange(start=date(2026, 6, 1), end=date(2026, 6, 30))


def build_bar(session_date: date, symbol: str = "AAPL") -> PriceBar:
    """Return a valid bar for session_date."""
    return PriceBar(
        symbol=symbol,
        interval=Interval.DAY,
        session_date=session_date,
        open=Decimal("100"),
        high=Decimal("110"),
        low=Decimal("90"),
        close=Decimal("105"),
        adj_close=Decimal("105"),
        volume=1000,
    )


def build_coverage(first: date, last: date, synced_at: datetime) -> Instrument:
    """Return an instrument whose sync ledger spans first..last."""
    return Instrument(
        symbol="AAPL",
        currency="USD",
        source="fake",
        first_synced_date=first,
        last_synced_date=last,
        last_synced_at=synced_at,
    )


class FakeProvider:
    """In-memory provider that serves preset bars, records requested ranges and can raise error."""

    name = "fake"

    def __init__(self, bars=(), error=None):
        """Create the fake with known bars and an optional error to raise."""
        self.bars = list(bars)
        self.calls = []
        self.error = error

    def fetch_daily_bars(self, symbol, start, end):
        """Return the known bars that fall inside the requested range."""
        self.calls.append(DateRange(start=start, end=end))
        if self.error is not None:
            raise self.error
        return [bar for bar in self.bars if start <= bar.session_date <= end]

    def fetch_instrument(self, symbol):
        """Return metadata for the symbol."""
        if self.error is not None:
            raise self.error
        return Instrument(symbol=symbol, name="Apple Inc.", exchange="NMS", currency="USD", source=self.name)


class FakeRepository:
    """In-memory repository keyed by symbol and session date."""

    def __init__(self):
        """Create an empty store."""
        self.instruments = {}
        self.bars = {}

    def get_instrument(self, symbol):
        """Return the stored instrument, or None."""
        return self.instruments.get(symbol)

    def list_instruments(self):
        """Return every stored instrument, ordered by symbol."""
        return [self.instruments[symbol] for symbol in sorted(self.instruments)]

    def bars_in_range(self, symbol, interval, start, end):
        """Return stored bars inside the range, in ascending date order."""
        stored = self.bars.get(symbol, {})
        return [stored[session] for session in sorted(stored) if start <= session <= end]

    def save_bars(self, instrument, bars):
        """Upsert the instrument and its bars."""
        self.instruments[instrument.symbol] = instrument
        stored = self.bars.setdefault(instrument.symbol, {})
        for bar in bars:
            stored[bar.session_date] = bar
        return len(bars)

    def summarize(self, symbol, interval, start, end):
        """Not exercised by these tests."""
        raise NotImplementedError

    def check_health(self):
        """Report the in-memory store as always reachable."""
        return True


class TestMissingRange(unittest.TestCase):
    """Tests for the pure cache-completeness decision."""

    def test_unknown_instrument_fetches_the_whole_range(self):
        self.assertEqual(missing_range(None, JUNE, NOW, STALE_AFTER), JUNE)

    def test_instrument_without_a_ledger_fetches_the_whole_range(self):
        coverage = Instrument(symbol="AAPL", source="fake")
        self.assertEqual(missing_range(coverage, JUNE, NOW, STALE_AFTER), JUNE)

    def test_range_inside_the_synced_window_is_a_cache_hit(self):
        coverage = build_coverage(date(2026, 1, 1), date(2026, 7, 20), NOW)
        self.assertIsNone(missing_range(coverage, JUNE, NOW, STALE_AFTER))

    def test_start_before_the_window_widens_to_one_contiguous_fetch(self):
        coverage = build_coverage(date(2026, 6, 10), date(2026, 7, 20), NOW)
        self.assertEqual(missing_range(coverage, JUNE, NOW, STALE_AFTER), JUNE)

    def test_end_beyond_the_window_fetches_only_the_tail(self):
        coverage = build_coverage(date(2026, 1, 1), date(2026, 6, 10), NOW)

        fetched = missing_range(coverage, JUNE, NOW, STALE_AFTER)

        self.assertEqual(fetched, DateRange(start=date(2026, 6, 10), end=date(2026, 6, 30)))

    def test_stale_unsettled_edge_is_refetched(self):
        coverage = build_coverage(date(2026, 1, 1), JUNE.end, NOW - timedelta(hours=2))

        fetched = missing_range(coverage, JUNE, NOW, STALE_AFTER)

        self.assertEqual(fetched, DateRange(start=JUNE.end, end=JUNE.end))

    def test_fresh_unsettled_edge_is_not_refetched(self):
        coverage = build_coverage(date(2026, 1, 1), JUNE.end, NOW - timedelta(minutes=5))
        self.assertIsNone(missing_range(coverage, JUNE, NOW, STALE_AFTER))

    def test_never_synced_edge_is_treated_as_stale(self):
        coverage = Instrument(
            symbol="AAPL",
            source="fake",
            first_synced_date=date(2026, 1, 1),
            last_synced_date=JUNE.end,
            last_synced_at=None,
        )
        self.assertIsNotNone(missing_range(coverage, JUNE, NOW, STALE_AFTER))


class TestPriceHistoryService(unittest.TestCase):
    """Tests for the use case against in-memory fakes."""

    def setUp(self):
        self.bars = [build_bar(date(2026, 6, day)) for day in (1, 2, 3, 30)]
        self.provider = FakeProvider(bars=self.bars)
        self.repository = FakeRepository()
        self.service = PriceHistoryService(self.provider, self.repository, STALE_AFTER)

    def test_full_miss_fetches_and_stores(self):
        history = self.service.get_price_history("aapl", JUNE)

        self.assertEqual(history.source, DataSource.PROVIDER)
        self.assertEqual(history.symbol, "AAPL")
        self.assertEqual(history.currency, "USD")
        self.assertEqual(len(history.bars), 4)
        self.assertEqual(self.provider.calls, [JUNE])

    def test_repeat_request_is_served_from_cache(self):
        first = self.service.get_price_history("AAPL", JUNE)
        second = self.service.get_price_history("AAPL", JUNE)

        self.assertEqual(second.source, DataSource.CACHE)
        self.assertEqual(len(self.provider.calls), 1)
        self.assertEqual(first.bars, second.bars)

    def test_window_with_no_sessions_at_its_edges_is_not_refetched(self):
        """A holiday or weekend edge must not make the window look incomplete."""
        holiday_window = DateRange(start=date(2026, 6, 6), end=date(2026, 6, 7))

        self.service.get_price_history("AAPL", holiday_window)
        history = self.service.get_price_history("AAPL", holiday_window)

        self.assertEqual(history.source, DataSource.CACHE)
        self.assertEqual(history.bars, ())
        self.assertEqual(len(self.provider.calls), 1)

    def test_backward_extension_refetches_the_whole_window(self):
        self.service.get_price_history("AAPL", DateRange(start=date(2026, 6, 10), end=date(2026, 6, 30)))
        widened = DateRange(start=date(2026, 6, 1), end=date(2026, 6, 30))

        history = self.service.get_price_history("AAPL", widened)

        self.assertEqual(history.source, DataSource.PROVIDER)
        self.assertEqual(self.provider.calls[-1], widened)

    def test_stale_tail_refetches_only_the_tail(self):
        self.service.get_price_history("AAPL", JUNE)
        stored = self.repository.instruments["AAPL"]
        self.repository.instruments["AAPL"] = stored.model_copy(
            update={"last_synced_at": stored.last_synced_at - timedelta(hours=2)}
        )

        history = self.service.get_price_history("AAPL", JUNE)

        self.assertEqual(history.source, DataSource.PROVIDER)
        self.assertEqual(self.provider.calls[-1], DateRange(start=JUNE.end, end=JUNE.end))

    def test_unknown_symbol_propagates(self):
        self.provider.error = SymbolNotFoundError("NOSUCH")
        with self.assertRaises(SymbolNotFoundError):
            self.service.get_price_history("NOSUCH", JUNE)

    def test_provider_failure_propagates(self):
        self.provider.error = ProviderError("upstream down")
        with self.assertRaises(ProviderError):
            self.service.get_price_history("AAPL", JUNE)

    def test_invalid_symbol_is_rejected_before_any_port_is_called(self):
        with self.assertRaises(ValueError):
            self.service.get_price_history("AA PL", JUNE)
        self.assertEqual(self.provider.calls, [])

    def test_metadata_is_kept_when_the_tail_is_refreshed(self):
        self.service.get_price_history("AAPL", JUNE)
        self.service.get_price_history("AAPL", DateRange(start=date(2026, 5, 1), end=date(2026, 6, 30)))

        stored = self.repository.instruments["AAPL"]
        self.assertEqual(stored.name, "Apple Inc.")
        self.assertEqual(stored.first_synced_date, date(2026, 5, 1))
        self.assertEqual(stored.last_synced_date, date(2026, 6, 30))

    def test_list_instruments_returns_the_stored_ledger(self):
        self.service.get_price_history("AAPL", JUNE)

        instruments = self.service.list_instruments()

        self.assertEqual([instrument.symbol for instrument in instruments], ["AAPL"])


if __name__ == "__main__":
    unittest.main()
