"""Cache-aside use case: serve price history from the store, fill gaps from a provider."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from src.application.ports import MarketDataProvider, PriceBarRepository
from src.domain.models import DataSource, DateRange, Instrument, Interval, PriceHistory, PriceSummary, normalize_symbol
from src.observability.metrics import CacheOutcome, record_cache_lookup


def utc_now() -> datetime:
    """Return the current instant in UTC."""
    return datetime.now(timezone.utc)


def is_stale(last_synced_at: datetime | None, now: datetime, stale_after: timedelta) -> bool:
    """Return True if the last provider call is older than stale_after (or never happened)."""
    if last_synced_at is None:
        return True
    return now - last_synced_at > stale_after


def missing_range(stored: Instrument, requested: DateRange, now: datetime, stale_after: timedelta) -> DateRange | None:
    """Return the range to fetch from the provider, or None if the store covers the request.

    Decided from the sync ledger, not by counting bars (markets close on weekends and holidays).
    Missing parts on both ends are fetched as one range, so a request makes at most one call for bars.
    The ledger is one window, so a fetch before it runs up to it; otherwise the gap would look synced.
    """
    if stored.first_synced_date is None or stored.last_synced_date is None:
        return requested

    if requested.start < stored.first_synced_date:
        return DateRange(start=requested.start, end=max(requested.end, stored.first_synced_date))

    # The last synced day can still change (intraday bar, later revisions); older days never do.
    beyond_synced = requested.end > stored.last_synced_date
    at_unsettled_edge = requested.end == stored.last_synced_date
    if beyond_synced or (at_unsettled_edge and is_stale(stored.last_synced_at, now, stale_after)):
        return DateRange(start=stored.last_synced_date, end=requested.end)

    return None


@dataclass(frozen=True)
class SyncedInstrument:
    """An instrument whose sync ledger covers a request, and where the request's bars come from."""

    instrument: Instrument
    source: DataSource


class PriceHistoryService:
    """Serves price history and summaries, filling the store from the provider on demand."""

    def __init__(self, provider: MarketDataProvider, repository: PriceBarRepository, stale_after: timedelta):
        """Wire the use case to its ports."""
        self._provider = provider
        self._repository = repository
        self._stale_after = stale_after

    def get_price_history(self, symbol: str, requested: DateRange) -> PriceHistory:
        """Return the bars for symbol over requested, fetching missing ones first.

        Raises SymbolNotFoundError, ProviderError or RepositoryError.
        """
        normalized = normalize_symbol(symbol)
        synced = self._sync(normalized, requested)
        bars = self._repository.bars_in_range(normalized, Interval.DAY, requested.start, requested.end)
        return PriceHistory(
            symbol=normalized,
            interval=Interval.DAY,
            currency=synced.instrument.currency,
            source=synced.source,
            period=requested,
            bars=tuple(bars),
        )

    def get_price_summary(self, symbol: str, requested: DateRange) -> PriceSummary | None:
        """Return statistics for symbol over requested (None if no sessions), fetching missing bars first."""
        normalized = normalize_symbol(symbol)
        self._sync(normalized, requested)
        return self._repository.summarize(normalized, Interval.DAY, requested.start, requested.end)

    def list_instruments(self) -> list[Instrument]:
        """Return all stored instruments; raise RepositoryError if the store is down."""
        return self._repository.list_instruments()

    def _sync(self, symbol: str, requested: DateRange) -> SyncedInstrument:
        """Fetch and store whatever the store lacks of requested for symbol, which is already normalized."""
        stored_instrument = self._repository.get_instrument(symbol)
        if stored_instrument is None:
            record_cache_lookup(CacheOutcome.MISS)
            return self._fetch(self._provider.fetch_instrument(symbol), requested)

        fetch_range = missing_range(stored_instrument, requested, utc_now(), self._stale_after)
        if fetch_range is None:
            record_cache_lookup(CacheOutcome.HIT)
            return SyncedInstrument(stored_instrument, DataSource.CACHE)

        record_cache_lookup(CacheOutcome.REFRESH)
        metadata = self._provider.fetch_instrument(symbol)
        return self._fetch(stored_instrument.with_metadata(metadata), fetch_range)

    def _fetch(self, instrument: Instrument, fetch_range: DateRange) -> SyncedInstrument:
        """Fetch the bars over fetch_range, store them and extend the instrument's sync ledger."""
        bars = self._provider.fetch_daily_bars(instrument.symbol, fetch_range.start, fetch_range.end)
        synced = instrument.with_coverage(fetch_range, utc_now())
        self._repository.save_bars(synced, bars)
        return SyncedInstrument(synced, DataSource.PROVIDER)
