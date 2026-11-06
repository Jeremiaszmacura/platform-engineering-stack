"""Tests for the domain invariants every stored bar must satisfy."""

import unittest
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from pydantic import ValidationError

from src.domain.models import DateRange, Instrument, Interval, PriceBar, normalize_symbol, utc_today

SESSION = date(2026, 6, 25)


def build_bar(**overrides) -> PriceBar:
    """Return a valid bar with the given fields overridden."""
    fields = {
        "symbol": "AAPL",
        "interval": Interval.DAY,
        "session_date": SESSION,
        "open": Decimal("201.5"),
        "high": Decimal("203.1"),
        "low": Decimal("200.9"),
        "close": Decimal("202.4"),
        "adj_close": Decimal("202.4"),
        "volume": 41230100,
    }
    fields.update(overrides)
    return PriceBar(**fields)


class TestNormalizeSymbol(unittest.TestCase):
    """Tests for symbol normalization."""

    def test_strips_and_uppercases(self):
        self.assertEqual(normalize_symbol("  aapl \n"), "AAPL")

    def test_accepts_dots_and_dashes(self):
        self.assertEqual(normalize_symbol("brk-b"), "BRK-B")
        self.assertEqual(normalize_symbol("bmw.de"), "BMW.DE")

    def test_rejects_empty_symbol(self):
        with self.assertRaises(ValueError):
            normalize_symbol("   ")

    def test_rejects_illegal_characters(self):
        for value in ["AA PL", "AA/PL", "../etc", "AA;DROP", "AA%00"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize_symbol(value)

    def test_rejects_overlong_symbol(self):
        with self.assertRaises(ValueError):
            normalize_symbol("A" * 17)


class TestPriceBar(unittest.TestCase):
    """Tests for the PriceBar validation rules."""

    def test_symbol_is_normalized(self):
        self.assertEqual(build_bar(symbol=" aapl ").symbol, "AAPL")

    def test_invalid_symbol_is_rejected(self):
        with self.assertRaises(ValidationError):
            build_bar(symbol="AA PL")

    def test_prices_are_quantized_to_four_decimals(self):
        bar = build_bar(open=Decimal("201.567891"), high=Decimal("203.1"), low=Decimal("200.9"))
        self.assertEqual(bar.open, Decimal("201.5679"))
        self.assertEqual(bar.open.as_tuple().exponent, -4)

    def test_adj_close_is_quantized(self):
        self.assertEqual(build_bar(adj_close=Decimal("202.44444")).adj_close, Decimal("202.4444"))

    def test_adj_close_may_be_absent(self):
        self.assertIsNone(build_bar(adj_close=None).adj_close)

    def test_float_prices_are_accepted(self):
        self.assertEqual(build_bar(open=201.5).open, Decimal("201.5000"))

    def test_zero_price_is_rejected(self):
        with self.assertRaises(ValidationError):
            build_bar(low=Decimal("0"))

    def test_negative_price_is_rejected(self):
        with self.assertRaises(ValidationError):
            build_bar(low=Decimal("-1"))

    def test_nan_price_is_rejected(self):
        with self.assertRaises(ValidationError):
            build_bar(open=float("nan"))

    def test_zero_volume_is_accepted(self):
        self.assertEqual(build_bar(volume=0).volume, 0)

    def test_negative_volume_is_rejected(self):
        with self.assertRaises(ValidationError):
            build_bar(volume=-1)

    def test_high_below_low_is_rejected(self):
        with self.assertRaises(ValidationError):
            build_bar(high=Decimal("100"), low=Decimal("200"), open=Decimal("150"), close=Decimal("150"))

    def test_low_above_open_is_rejected(self):
        with self.assertRaises(ValidationError):
            build_bar(low=Decimal("202.0"), open=Decimal("201.5"))

    def test_high_below_close_is_rejected(self):
        with self.assertRaises(ValidationError):
            build_bar(high=Decimal("202.0"), close=Decimal("202.4"))

    def test_future_session_date_is_rejected(self):
        with self.assertRaises(ValidationError):
            build_bar(session_date=utc_today() + timedelta(days=30))

    def test_session_date_one_day_ahead_of_utc_is_accepted(self):
        """Exchanges east of UTC open on a date that is still tomorrow in UTC."""
        self.assertIsNotNone(build_bar(session_date=utc_today() + timedelta(days=1)))

    def test_bar_is_immutable(self):
        with self.assertRaises(ValidationError):
            build_bar().symbol = "MSFT"


class TestDateRange(unittest.TestCase):
    """Tests for the inclusive session-date range."""

    def test_single_day_range_is_valid(self):
        self.assertEqual(DateRange(start=SESSION, end=SESSION).start, SESSION)

    def test_inverted_range_is_rejected(self):
        with self.assertRaises(ValidationError):
            DateRange(start=date(2026, 6, 30), end=date(2026, 6, 1))


class TestInstrument(unittest.TestCase):
    """Tests for the instrument sync ledger."""

    def setUp(self):
        self.synced_at = datetime(2026, 7, 25, 10, 0, tzinfo=timezone.utc)
        self.instrument = Instrument(symbol="AAPL", currency="USD", source="yahoo")

    def test_coverage_starts_from_the_first_synced_range(self):
        updated = self.instrument.with_coverage(
            DateRange(start=date(2026, 6, 1), end=date(2026, 6, 30)), self.synced_at
        )
        self.assertEqual(updated.first_synced_date, date(2026, 6, 1))
        self.assertEqual(updated.last_synced_date, date(2026, 6, 30))
        self.assertEqual(updated.last_synced_at, self.synced_at)

    def test_coverage_widens_in_both_directions(self):
        first = self.instrument.with_coverage(DateRange(start=date(2026, 6, 1), end=date(2026, 6, 30)), self.synced_at)
        later = first.with_coverage(DateRange(start=date(2026, 5, 1), end=date(2026, 7, 20)), self.synced_at)
        self.assertEqual(later.first_synced_date, date(2026, 5, 1))
        self.assertEqual(later.last_synced_date, date(2026, 7, 20))

    def test_coverage_never_shrinks(self):
        wide = self.instrument.with_coverage(DateRange(start=date(2026, 1, 1), end=date(2026, 7, 1)), self.synced_at)
        narrow = wide.with_coverage(DateRange(start=date(2026, 3, 1), end=date(2026, 4, 1)), self.synced_at)
        self.assertEqual(narrow.first_synced_date, date(2026, 1, 1))
        self.assertEqual(narrow.last_synced_date, date(2026, 7, 1))

    def test_metadata_is_refreshed_without_losing_the_ledger(self):
        stored = self.instrument.with_coverage(DateRange(start=date(2026, 6, 1), end=date(2026, 6, 30)), self.synced_at)
        fresh = Instrument(symbol="AAPL", name="Apple Inc.", exchange="NMS", currency="USD", source="yahoo")

        merged = stored.with_metadata(fresh)

        self.assertEqual(merged.name, "Apple Inc.")
        self.assertEqual(merged.exchange, "NMS")
        self.assertEqual(merged.first_synced_date, date(2026, 6, 1))
        self.assertEqual(merged.last_synced_date, date(2026, 6, 30))


if __name__ == "__main__":
    unittest.main()
