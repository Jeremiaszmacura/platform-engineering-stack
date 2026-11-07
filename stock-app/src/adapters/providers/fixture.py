"""Provider that replays a recorded Yahoo response (STOCK_PROVIDER=fixture, used by CI).

Bars outside the recorded window are not invented: such ranges return no bars.
"""

import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from src.domain.errors import ProviderError, SymbolNotFoundError
from src.domain.models import Instrument, PriceBar
from src.observability.metrics import ProviderOutcome, record_provider_call, register_provider

PROVIDER_NAME = "fixture"

# This module sits at src/adapters/providers/, so the recording at the service
# root is three directories up.
RECORDING_PATH = Path(__file__).resolve().parents[3] / "fixtures" / "market-data.json"

# Recorded anyway so both providers expose the same metric series.
REPLAY_DURATION_SECONDS = 0.0


@dataclass(frozen=True)
class RecordedSymbol:
    """One symbol's recorded instrument and bars (oldest first)."""

    instrument: Instrument
    bars: tuple[PriceBar, ...]


def load_recording(path: Path) -> dict[str, RecordedSymbol]:
    """Load a recording keyed by symbol; raise ProviderError if it is missing or malformed."""
    try:
        recording = json.loads(path.read_text(encoding="utf-8"))
        return {symbol: to_recorded_symbol(entry) for symbol, entry in recording["symbols"].items()}
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise ProviderError(f"unusable market data recording at {path}") from error


def to_recorded_symbol(entry: dict) -> RecordedSymbol:
    """Rebuild one symbol's recording, validating each bar and marking the source as "fixture"."""
    instrument = Instrument(**entry["instrument"]).model_copy(update={"source": PROVIDER_NAME})
    return RecordedSymbol(instrument=instrument, bars=tuple(PriceBar(**bar) for bar in entry["bars"]))


class FixtureMarketDataProvider:
    """Serves recorded bars instead of calling a market data API."""

    name = PROVIDER_NAME

    def __init__(self, recording_path: Path = RECORDING_PATH):
        """Load the recording; raise ProviderError if it is missing or malformed."""
        self._recorded = load_recording(recording_path)
        register_provider(self.name)

    def fetch_daily_bars(self, symbol: str, start: date, end: date) -> list[PriceBar]:
        """Return recorded bars for symbol within start..end; raise SymbolNotFoundError if not recorded."""
        recorded = self._lookup(symbol)
        return [bar for bar in recorded.bars if start <= bar.session_date <= end]

    def fetch_instrument(self, symbol: str) -> Instrument:
        """Return recorded metadata for symbol; raise SymbolNotFoundError if not recorded."""
        return self._lookup(symbol).instrument

    def _lookup(self, symbol: str) -> RecordedSymbol:
        """Return a symbol's recording and count it as a provider call."""
        recorded = self._recorded.get(symbol)
        if recorded is None:
            record_provider_call(self.name, ProviderOutcome.NOT_FOUND, REPLAY_DURATION_SECONDS)
            raise SymbolNotFoundError(symbol)
        record_provider_call(self.name, ProviderOutcome.SUCCESS, REPLAY_DURATION_SECONDS)
        return recorded
