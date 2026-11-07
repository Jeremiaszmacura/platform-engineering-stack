"""Tests for the recorded-response provider, and for the recording it ships with."""

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from src.adapters.providers.fixture import (
    PROVIDER_NAME,
    RECORDING_PATH,
    FixtureMarketDataProvider,
    load_recording,
)
from src.domain.errors import ProviderError, SymbolNotFoundError

RECORDING = {
    "recordedAt": "2026-07-27T09:00:00+00:00",
    "recordedFrom": "yahoo",
    "window": {"start": "2026-06-01", "end": "2026-06-03"},
    "symbols": {
        "AAPL": {
            "instrument": {
                "symbol": "AAPL",
                "name": "Apple Inc.",
                "exchange": "NasdaqGS",
                "currency": "USD",
                "first_synced_date": None,
                "last_synced_date": None,
                "last_synced_at": None,
                "source": "yahoo",
            },
            "bars": [
                {
                    "symbol": "AAPL",
                    "interval": "1d",
                    "session_date": day,
                    "open": "201.5000",
                    "high": "203.1000",
                    "low": "200.9000",
                    "close": "202.4000",
                    "adj_close": "202.4000",
                    "volume": 41230100,
                }
                for day in ("2026-06-01", "2026-06-02", "2026-06-03")
            ],
        }
    },
}


def write_recording(directory, recording):
    """Write recording to a JSON file in directory and return its path."""
    path = Path(directory) / "market-data.json"
    path.write_text(json.dumps(recording), encoding="utf-8")
    return path


class FixtureProviderTestCase(unittest.TestCase):
    """Base fixture building a provider over a temporary recording."""

    def setUp(self):
        self._directory = tempfile.TemporaryDirectory()
        self.addCleanup(self._directory.cleanup)
        self.provider = FixtureMarketDataProvider(write_recording(self._directory.name, RECORDING))


class TestReplay(FixtureProviderTestCase):
    """Tests that the recording is served back faithfully."""

    def test_bars_are_clipped_to_the_requested_range(self):
        bars = self.provider.fetch_daily_bars("AAPL", date(2026, 6, 2), date(2026, 6, 3))

        self.assertEqual([bar.session_date for bar in bars], [date(2026, 6, 2), date(2026, 6, 3)])

    def test_range_outside_the_recorded_window_returns_no_bars(self):
        bars = self.provider.fetch_daily_bars("AAPL", date(2026, 7, 1), date(2026, 7, 31))

        self.assertEqual(bars, [])

    def test_bars_keep_the_recorded_prices(self):
        bar = self.provider.fetch_daily_bars("AAPL", date(2026, 6, 1), date(2026, 6, 1))[0]

        self.assertEqual(float(bar.close), 202.4)
        self.assertEqual(bar.volume, 41230100)

    def test_instrument_keeps_the_recorded_metadata(self):
        instrument = self.provider.fetch_instrument("AAPL")

        self.assertEqual(instrument.name, "Apple Inc.")
        self.assertEqual(instrument.exchange, "NasdaqGS")

    def test_instrument_reports_this_provider_as_its_source(self):
        """The prices are Yahoo's, but the service is replaying them from a file."""
        self.assertEqual(self.provider.fetch_instrument("AAPL").source, PROVIDER_NAME)


class TestUnrecordedSymbol(FixtureProviderTestCase):
    """Tests that an unrecorded symbol behaves like one the provider never heard of."""

    def test_fetching_bars_raises_symbol_not_found(self):
        with self.assertRaises(SymbolNotFoundError):
            self.provider.fetch_daily_bars("ZZNOSUCHZZ", date(2026, 6, 1), date(2026, 6, 3))

    def test_fetching_the_instrument_raises_symbol_not_found(self):
        with self.assertRaises(SymbolNotFoundError):
            self.provider.fetch_instrument("ZZNOSUCHZZ")


class TestUnusableRecording(unittest.TestCase):
    """Tests that a broken recording fails as a provider failure, not a crash."""

    def test_missing_recording_raises_provider_error(self):
        with self.assertRaises(ProviderError):
            FixtureMarketDataProvider(Path("/nonexistent/market-data.json"))

    def test_malformed_recording_raises_provider_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "market-data.json"
            path.write_text("{not json", encoding="utf-8")

            with self.assertRaises(ProviderError):
                FixtureMarketDataProvider(path)

    def test_recording_with_an_invalid_bar_raises_provider_error(self):
        broken = json.loads(json.dumps(RECORDING))
        broken["symbols"]["AAPL"]["bars"][0]["high"] = "1.0000"  # below open, low and close

        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ProviderError):
                FixtureMarketDataProvider(write_recording(directory, broken))


class TestCommittedRecording(unittest.TestCase):
    """Tests the recording that ships in the image (it is regenerated by hand)."""

    def test_it_loads_and_holds_bars(self):
        recorded = load_recording(RECORDING_PATH)

        self.assertTrue(recorded)
        for symbol, entry in recorded.items():
            with self.subTest(symbol=symbol):
                self.assertTrue(entry.bars)
                self.assertEqual(entry.instrument.symbol, symbol)

    def test_its_bars_are_ordered_and_free_of_weekends(self):
        for symbol, entry in load_recording(RECORDING_PATH).items():
            with self.subTest(symbol=symbol):
                sessions = [bar.session_date for bar in entry.bars]
                self.assertEqual(sessions, sorted(sessions))
                self.assertEqual(len(sessions), len(set(sessions)))
                self.assertFalse([session for session in sessions if session.weekday() >= 5])


if __name__ == "__main__":
    unittest.main()
