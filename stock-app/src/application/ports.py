"""Ports used by the application layer (typing.Protocol, so adapters and fakes don't inherit)."""

from collections.abc import Sequence
from datetime import date
from typing import Protocol

from src.domain.models import Instrument, Interval, PriceBar, PriceSummary


class MarketDataProvider(Protocol):
    """A market data source; name labels metrics and stored rows."""

    name: str

    def fetch_daily_bars(self, symbol: str, start: date, end: date) -> list[PriceBar]:
        """Return validated bars for symbol within start..end, oldest first; raise ProviderError on failure."""
        ...

    def fetch_instrument(self, symbol: str) -> Instrument:
        """Return metadata for symbol; raise SymbolNotFoundError or ProviderError."""
        ...


class SecretStore(Protocol):
    """The cluster's secret store, scoped to this service's path."""

    def write_secret(self, key: str, value: str) -> None:
        """Store value under key; raise SecretStoreError on failure."""
        ...

    def read_secret(self, key: str) -> str:
        """Return the value under key; raise SecretNotFoundError or SecretStoreError."""
        ...


class PriceBarRepository(Protocol):
    """The local store of instruments and price bars."""

    def get_instrument(self, symbol: str) -> Instrument | None:
        """Return the stored instrument with its sync ledger, or None if never synced."""
        ...

    def list_instruments(self) -> list[Instrument]:
        """Return all stored instruments, ordered by symbol."""
        ...

    def bars_in_range(self, symbol: str, interval: Interval, start: date, end: date) -> list[PriceBar]:
        """Return stored bars for symbol within start..end, oldest first."""
        ...

    def save_bars(self, instrument: Instrument, bars: Sequence[PriceBar]) -> int:
        """Upsert the instrument and its bars in one transaction; return the number of bars written."""
        ...

    def summarize(self, symbol: str, interval: Interval, start: date, end: date) -> PriceSummary | None:
        """Return statistics for the stored bars within start..end, or None if there are none."""
        ...

    def check_health(self) -> bool:
        """Return True if the store answers a trivial query; never raises (readiness probe)."""
        ...
