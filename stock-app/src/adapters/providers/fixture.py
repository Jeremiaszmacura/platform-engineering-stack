"""Replay of a recorded provider response, so the cluster can run with no third-party API.

Satisfies the same ``MarketDataProvider`` port as the Yahoo adapter, reading
bars that ``tools/record_market_data.py`` captured from a real Yahoo call
instead of making one. Selected with ``STOCK_PROVIDER=fixture``, which is how
CI deploys the service: Yahoo rate-limits datacenter IPs, so an end-to-end test
that returns actual bars has to get them from somewhere else.

The recording holds real prices on the real session dates they occurred on. It
is clipped to the requested range and never extrapolated, so a range outside
the recorded window answers with no bars - the same answer a live provider
gives for a market that was shut.
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

# Replaying costs no measurable time. The duration is still recorded so both
# providers report the same series and dashboards need no special case.
REPLAY_DURATION_SECONDS = 0.0


@dataclass(frozen=True)
class RecordedSymbol:
    """One symbol's recorded provider response.

    Attributes:
        instrument: Metadata the recorded provider reported for the symbol.
        bars: Recorded bars, in ascending session-date order.
    """

    instrument: Instrument
    bars: tuple[PriceBar, ...]


def load_recording(path: Path) -> dict[str, RecordedSymbol]:
    """Read a recording and turn it back into domain objects.

    Args:
        path: JSON recording written by ``tools/record_market_data.py``.

    Returns:
        Every recorded symbol, keyed by ticker.

    Raises:
        ProviderError: If the recording is missing, unreadable or malformed.
    """
    try:
        recording = json.loads(path.read_text(encoding="utf-8"))
        return {symbol: to_recorded_symbol(entry) for symbol, entry in recording["symbols"].items()}
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise ProviderError(f"unusable market data recording at {path}") from error


def to_recorded_symbol(entry: dict) -> RecordedSymbol:
    """Rebuild one symbol's recording, validating every bar on the way in.

    The instrument's source is rewritten to this provider. The prices really
    are Yahoo's, but the service really is replaying them from a file, and
    ``/api/v1/instruments`` should not claim to have just called an API.

    Args:
        entry: One symbol's entry in the recording.

    Returns:
        The recorded instrument and its bars.
    """
    instrument = Instrument(**entry["instrument"]).model_copy(update={"source": PROVIDER_NAME})
    return RecordedSymbol(instrument=instrument, bars=tuple(PriceBar(**bar) for bar in entry["bars"]))


class FixtureMarketDataProvider:
    """Serves recorded bars instead of calling a market data API.

    Attributes:
        name: Provider name recorded on stored rows and used as a metric label.
    """

    name = PROVIDER_NAME

    def __init__(self, recording_path: Path = RECORDING_PATH):
        """Load the recording and register the provider's metric label combinations.

        Args:
            recording_path: Recording to replay.

        Raises:
            ProviderError: If the recording is missing, unreadable or malformed.
        """
        self._recorded = load_recording(recording_path)
        register_provider(self.name)

    def fetch_daily_bars(self, symbol: str, start: date, end: date) -> list[PriceBar]:
        """Return the recorded bars for a symbol that fall inside an inclusive range.

        Args:
            symbol: Normalized ticker symbol.
            start: First session date to return.
            end: Last session date to return.

        Returns:
            The recorded bars in the range, in ascending session-date order;
            empty when the range lies outside the recorded window.

        Raises:
            SymbolNotFoundError: If the symbol was never recorded.
        """
        recorded = self._lookup(symbol)
        return [bar for bar in recorded.bars if start <= bar.session_date <= end]

    def fetch_instrument(self, symbol: str) -> Instrument:
        """Return the recorded metadata for a symbol.

        Args:
            symbol: Normalized ticker symbol.

        Returns:
            The instrument with descriptive fields filled in and an empty
            sync ledger.

        Raises:
            SymbolNotFoundError: If the symbol was never recorded.
        """
        return self._lookup(symbol).instrument

    def _lookup(self, symbol: str) -> RecordedSymbol:
        """Return a symbol's recording, counting the lookup as a provider call.

        Args:
            symbol: Normalized ticker symbol.

        Returns:
            The recorded instrument and bars.

        Raises:
            SymbolNotFoundError: If the symbol was never recorded.
        """
        recorded = self._recorded.get(symbol)
        if recorded is None:
            record_provider_call(self.name, ProviderOutcome.NOT_FOUND, REPLAY_DURATION_SECONDS)
            raise SymbolNotFoundError(symbol)
        record_provider_call(self.name, ProviderOutcome.SUCCESS, REPLAY_DURATION_SECONDS)
        return recorded
