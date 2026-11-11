"""Cache-aside use case: serve price history from the store, fill gaps from a provider."""

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


def missing_range(
    coverage: Instrument | None, requested: DateRange, now: datetime, stale_after: timedelta
) -> DateRange | None:
    """Return the range to fetch from the provider, or None if the store covers the request.

    Decided from the sync ledger, not by counting bars (markets close on weekends and holidays).
    Missing parts on both ends are fetched as one range, so a request makes at most one provider call.
    The ledger is one window, so a fetch before it runs up to it; otherwise the gap would look synced.
    """
    if coverage is None or coverage.first_synced_date is None or coverage.last_synced_date is None:
        return requested

    if requested.start < coverage.first_synced_date:
        return DateRange(start=requested.start, end=max(requested.end, coverage.first_synced_date))

    # The last synced day can still change (intraday bar, later revisions); older days never do.
    beyond_synced = requested.end > coverage.last_synced_date
    at_unsettled_edge = requested.end == coverage.last_synced_date
    if beyond_synced or (at_unsettled_edge and is_stale(coverage.last_synced_at, now, stale_after)):
        return DateRange(start=coverage.last_synced_date, end=requested.end)

    return None


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
        normalized, source, instrument = self._ensure_coverage(symbol, requested)
        bars = self._repository.bars_in_range(normalized, Interval.DAY, requested.start, requested.end)
        return PriceHistory(
            symbol=normalized,
            interval=Interval.DAY,
            currency=instrument.currency,
            source=source,
            period=requested,
            bars=tuple(bars),
        )

    def get_price_summary(self, symbol: str, requested: DateRange) -> PriceSummary | None:
        """Return statistics for symbol over requested (None if no sessions), fetching missing bars first."""
        normalized, _, _ = self._ensure_coverage(symbol, requested)
        return self._repository.summarize(normalized, Interval.DAY, requested.start, requested.end)

    def list_instruments(self) -> list[Instrument]:
        """Return all stored instruments; raise RepositoryError if the store is down."""
        return self._repository.list_instruments()

    def _ensure_coverage(self, symbol: str, requested: DateRange) -> tuple[str, DataSource, Instrument]:
        """Fetch and store whatever the store lacks for requested.

        Returns the normalized symbol, the data source and the instrument with its updated ledger.
        """
        normalized = normalize_symbol(symbol)
        coverage = self._repository.get_instrument(normalized)
        fetch_range = missing_range(coverage, requested, utc_now(), self._stale_after)

        if fetch_range is None:
            record_cache_lookup(CacheOutcome.HIT)
            return normalized, DataSource.CACHE, coverage

        record_cache_lookup(CacheOutcome.MISS if coverage is None else CacheOutcome.REFRESH)
        metadata = self._provider.fetch_instrument(normalized)
        bars = self._provider.fetch_daily_bars(normalized, fetch_range.start, fetch_range.end)
        instrument = metadata if coverage is None else coverage.with_metadata(metadata)
        synced = instrument.with_coverage(fetch_range, utc_now())
        self._repository.save_bars(synced, bars)
        return normalized, DataSource.PROVIDER, synced
