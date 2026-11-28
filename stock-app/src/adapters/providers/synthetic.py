"""Provider that generates prices instead of fetching them (STOCK_PROVIDER=synthetic, used by CI and offline runs).

Each symbol's prices are a random walk seeded by the symbol, so a date always gets the same bar, whatever range
asks for it and in any process. Nothing is recorded, so nothing expires. The prices are not real market data.
"""

import math
import random
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, timedelta

from src.domain.errors import SymbolNotFoundError
from src.domain.models import Instrument, Interval, PriceBar, utc_today
from src.observability.metrics import ProviderOutcome, record_provider_call, register_provider

PROVIDER_NAME = "synthetic"

# Every walk starts here, so stock-app's longest window (ten years) is always covered.
FIRST_SESSION = date(2000, 1, 3)
EXCHANGE = "NasdaqGS"
CURRENCY = "USD"

# About 8% growth and 24% volatility a year, over 252 sessions.
DAILY_DRIFT = 0.0003
DAILY_VOLATILITY = 0.015
OVERNIGHT_VOLATILITY = 0.005
MAX_WICK = 0.01
SATURDAY = 5

# Generation is local and takes milliseconds; recorded so both providers expose the same metric series.
GENERATION_DURATION_SECONDS = 0.0


@dataclass(frozen=True)
class SyntheticListing:
    """A symbol the synthetic provider knows, with the price and volume its walk starts from."""

    symbol: str
    name: str
    first_close: float
    average_volume: int

    def to_instrument(self) -> Instrument:
        """Return the listing's metadata, marked as coming from this provider."""
        return Instrument(
            symbol=self.symbol, name=self.name, exchange=EXCHANGE, currency=CURRENCY, source=PROVIDER_NAME
        )


# stock-ui's starter tickers, so its Markets view works without a network. The starting prices put the 2026
# prices near the real ones; the paths are not real.
CATALOG = {
    listing.symbol: listing
    for listing in (
        SyntheticListing("AAPL", "Apple Inc.", first_close=42.0, average_volume=55_000_000),
        SyntheticListing("MSFT", "Microsoft Corporation", first_close=10.0, average_volume=22_000_000),
        SyntheticListing("NVDA", "NVIDIA Corporation", first_close=10.5, average_volume=240_000_000),
        SyntheticListing("AMZN", "Amazon.com, Inc.", first_close=18.0, average_volume=45_000_000),
        SyntheticListing("GOOGL", "Alphabet Inc.", first_close=60.0, average_volume=30_000_000),
    )
}


@dataclass(frozen=True)
class SessionPrices:
    """One generated session, before it becomes a validated PriceBar."""

    open: float
    high: float
    low: float
    close: float
    volume: int

    def to_bar(self, symbol: str, session_date: date) -> PriceBar:
        """Return the session as a daily bar; there are no dividends or splits, so adj_close equals close."""
        return PriceBar(
            symbol=symbol,
            interval=Interval.DAY,
            session_date=session_date,
            open=self.open,
            high=self.high,
            low=self.low,
            close=self.close,
            adj_close=self.close,
            volume=self.volume,
        )


def weekdays(start: date, end: date) -> Iterator[date]:
    """Yield every Monday to Friday within start..end (holidays are not modelled)."""
    day = start
    while day <= end:
        if day.weekday() < SATURDAY:
            yield day
        day += timedelta(days=1)


def unit_shock(rng: random.Random) -> float:
    """Return a zero-mean, unit-variance shock.

    Built on random(), the one sequence Python keeps stable across versions, so a Python upgrade keeps the bars.
    """
    return (rng.random() - 0.5) * math.sqrt(12)


def next_session(rng: random.Random, previous_close: float, average_volume: int) -> SessionPrices:
    """Return the session that follows previous_close, always drawing the same number of values from rng."""
    open_price = previous_close * math.exp(OVERNIGHT_VOLATILITY * unit_shock(rng))
    close = open_price * math.exp(DAILY_DRIFT + DAILY_VOLATILITY * unit_shock(rng))
    high = max(open_price, close) * (1 + MAX_WICK * rng.random())
    low = min(open_price, close) * (1 - MAX_WICK * rng.random())
    volume = round(average_volume * (0.5 + rng.random()))
    return SessionPrices(open=open_price, high=high, low=low, close=close, volume=volume)


def generate_bars(listing: SyntheticListing, start: date, end: date) -> list[PriceBar]:
    """Return the listing's bars within start..end, oldest first.

    The walk always starts at FIRST_SESSION, so a date gets the same bar whatever range asks for it.
    """
    rng = random.Random(listing.symbol)
    close = listing.first_close
    bars = []
    for session_date in weekdays(FIRST_SESSION, end):
        session = next_session(rng, close, listing.average_volume)
        close = session.close
        if session_date >= start:
            bars.append(session.to_bar(listing.symbol, session_date))
    return bars


class SyntheticMarketDataProvider:
    """Generates bars for the symbols in CATALOG instead of calling a market data API."""

    name = PROVIDER_NAME

    def __init__(self) -> None:
        """Create the provider and register its metric label combinations."""
        register_provider(self.name)

    def fetch_daily_bars(self, symbol: str, start: date, end: date) -> list[PriceBar]:
        """Return generated bars for symbol within start..end, none after today; raise SymbolNotFoundError."""
        return generate_bars(self._lookup(symbol), start, min(end, utc_today()))

    def fetch_instrument(self, symbol: str) -> Instrument:
        """Return metadata for symbol; raise SymbolNotFoundError if it is not in CATALOG."""
        return self._lookup(symbol).to_instrument()

    def _lookup(self, symbol: str) -> SyntheticListing:
        """Return the symbol's listing and count it as a provider call."""
        listing = CATALOG.get(symbol)
        if listing is None:
            record_provider_call(self.name, ProviderOutcome.NOT_FOUND, GENERATION_DURATION_SECONDS)
            raise SymbolNotFoundError(symbol)
        record_provider_call(self.name, ProviderOutcome.SUCCESS, GENERATION_DURATION_SECONDS)
        return listing
