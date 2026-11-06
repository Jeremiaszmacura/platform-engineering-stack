"""Ports the use case depends on, as structural protocols.

They are ``typing.Protocol`` rather than abstract base classes so test fakes
need no inheritance and adapters need no import of this module.
"""

from collections.abc import Sequence
from datetime import date
from typing import Protocol

from src.domain.models import Instrument, Interval, PriceBar, PriceSummary


class MarketDataProvider(Protocol):
    """An external source of market data.

    Attributes:
        name: Short provider name, used as a metric label and as the ``source``
            recorded on every stored row.
    """

    name: str

    def fetch_daily_bars(self, symbol: str, start: date, end: date) -> list[PriceBar]:
        """Return the provider's daily bars for a symbol over an inclusive range.

        Args:
            symbol: Normalized ticker symbol.
            start: First session date to fetch.
            end: Last session date to fetch.

        Returns:
            Validated bars in ascending session-date order; empty when the
            range contains no trading sessions.

        Raises:
            ProviderError: If the provider is unreachable or returns garbage.
        """
        ...

    def fetch_instrument(self, symbol: str) -> Instrument:
        """Return the provider's metadata for a symbol.

        Args:
            symbol: Normalized ticker symbol.

        Returns:
            The instrument with descriptive fields filled in and an empty
            sync ledger.

        Raises:
            SymbolNotFoundError: If the provider does not know the symbol.
            ProviderError: If the provider is unreachable or returns garbage.
        """
        ...


class SecretStore(Protocol):
    """The cluster's secret store, scoped to this service's own path.

    Nothing in the market data flow uses it: it exists so the service can hold
    a provider API key without it entering a manifest or an image, and it backs
    the ``/secret`` endpoints the platform demonstrates that with.
    """

    def write_secret(self, key: str, value: str) -> None:
        """Store a value under a key, replacing whatever was there.

        Args:
            key: Key within this service's path.
            value: Value to store.

        Raises:
            SecretStoreError: If the store is unreachable or rejects the write.
        """
        ...

    def read_secret(self, key: str) -> str:
        """Return the value stored under a key.

        Args:
            key: Key within this service's path.

        Returns:
            The stored value.

        Raises:
            SecretNotFoundError: If nothing is stored under the key.
            SecretStoreError: If the store is unreachable or rejects the read.
        """
        ...


class PriceBarRepository(Protocol):
    """The local store of instruments and price bars."""

    def get_instrument(self, symbol: str) -> Instrument | None:
        """Return the stored instrument and its sync ledger, or None if unknown.

        Args:
            symbol: Normalized ticker symbol.

        Returns:
            The stored instrument, or None when it has never been synced.
        """
        ...

    def list_instruments(self) -> list[Instrument]:
        """Return every stored instrument, ordered by symbol.

        Returns:
            All instruments known locally, with their sync ledgers.
        """
        ...

    def bars_in_range(self, symbol: str, interval: Interval, start: date, end: date) -> list[PriceBar]:
        """Return stored bars for a symbol over an inclusive session-date range.

        Args:
            symbol: Normalized ticker symbol.
            interval: Bar interval.
            start: First session date to return.
            end: Last session date to return.

        Returns:
            Bars in ascending session-date order.
        """
        ...

    def save_bars(self, instrument: Instrument, bars: Sequence[PriceBar]) -> int:
        """Upsert an instrument and its bars in a single transaction.

        The instrument is written first because bars reference it.

        Args:
            instrument: Instrument with its updated sync ledger.
            bars: Bars to upsert; may be empty when a range held no sessions.

        Returns:
            The number of bars written.
        """
        ...

    def summarize(self, symbol: str, interval: Interval, start: date, end: date) -> PriceSummary | None:
        """Return aggregate statistics over the stored bars in a range.

        Args:
            symbol: Normalized ticker symbol.
            interval: Bar interval.
            start: First session date to include.
            end: Last session date to include.

        Returns:
            The summary, or None when the range holds no bars.
        """
        ...

    def check_health(self) -> bool:
        """Return True when the store answers a trivial query.

        Backs the readiness probe, so it must not raise.
        """
        ...
