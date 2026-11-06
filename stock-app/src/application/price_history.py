"""Cache-aside use case: serve price history from the store, fill gaps from a provider."""

from datetime import datetime, timedelta, timezone

from src.application.ports import MarketDataProvider, PriceBarRepository
from src.domain.models import DataSource, DateRange, Instrument, Interval, PriceHistory, PriceSummary, normalize_symbol
from src.observability.metrics import CacheOutcome, record_cache_lookup


def utc_now() -> datetime:
    """Return the current instant in UTC."""
    return datetime.now(timezone.utc)


def is_stale(last_synced_at: datetime | None, now: datetime, stale_after: timedelta) -> bool:
    """Return True when the last provider call is older than the staleness window.

    Args:
        last_synced_at: When the provider was last called, or None if never.
        now: Current instant.
        stale_after: How long a sync stays fresh.

    Returns:
        True when the trailing edge should be refetched.
    """
    if last_synced_at is None:
        return True
    return now - last_synced_at > stale_after


def missing_range(
    coverage: Instrument | None, requested: DateRange, now: datetime, stale_after: timedelta
) -> DateRange | None:
    """Return the range that must be fetched from the provider, or None if fully cached.

    Cache completeness cannot be decided by counting rows: markets close on
    weekends and holidays, so a 30-day window holds about 21 bars and the exact
    number varies by exchange. The decision is made from the sync ledger, which
    records how far the provider has been queried, never how many bars to
    expect.

    When both ends of the requested range are missing, the whole range is
    returned rather than a list of gaps, so a request costs at most one
    provider call.

    Args:
        coverage: Stored instrument with its sync ledger, or None if unknown.
        requested: Session-date range the caller asked for.
        now: Current instant, used for the staleness check.
        stale_after: How long a sync stays fresh before the trailing edge is
            refetched.

    Returns:
        The range to fetch, or None when the store already covers the request.
    """
    if coverage is None or coverage.first_synced_date is None or coverage.last_synced_date is None:
        return requested

    if requested.start < coverage.first_synced_date:
        return requested

    # The most recent synced day is unsettled: today's bar moves intraday and
    # closes get revised by later splits and dividends. Anything strictly
    # older is immutable and always served from the store.
    beyond_synced = requested.end > coverage.last_synced_date
    at_unsettled_edge = requested.end == coverage.last_synced_date
    if beyond_synced or (at_unsettled_edge and is_stale(coverage.last_synced_at, now, stale_after)):
        return DateRange(start=coverage.last_synced_date, end=requested.end)

    return None


class PriceHistoryService:
    """Serves price history and summaries, filling the store from a provider on demand.

    Both collaborators are injected as ports, so the service can be exercised
    without a database or a network.

    Attributes:
        _provider: Market data provider used to fill gaps.
        _repository: Local store of instruments and bars.
        _stale_after: How long a sync stays fresh before the trailing edge is
            refetched.
    """

    def __init__(self, provider: MarketDataProvider, repository: PriceBarRepository, stale_after: timedelta):
        """Wire the use case to its ports.

        Args:
            provider: Market data provider used to fill gaps.
            repository: Local store of instruments and bars.
            stale_after: How long a sync stays fresh.
        """
        self._provider = provider
        self._repository = repository
        self._stale_after = stale_after

    def get_price_history(self, symbol: str, requested: DateRange) -> PriceHistory:
        """Return the bars for a symbol over a range, fetching them if needed.

        Args:
            symbol: Ticker symbol in any case.
            requested: Inclusive session-date range.

        Returns:
            The bars held for the range, with the source they were served from.

        Raises:
            SymbolNotFoundError: If the provider does not know the symbol.
            ProviderError: If a needed provider call fails.
            RepositoryError: If the store is unreachable.
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
        """Return aggregate statistics for a symbol over a range, fetching bars if needed.

        Args:
            symbol: Ticker symbol in any case.
            requested: Inclusive session-date range.

        Returns:
            The summary, or None when the range holds no trading sessions.

        Raises:
            SymbolNotFoundError: If the provider does not know the symbol.
            ProviderError: If a needed provider call fails.
            RepositoryError: If the store is unreachable.
        """
        normalized, _, _ = self._ensure_coverage(symbol, requested)
        return self._repository.summarize(normalized, Interval.DAY, requested.start, requested.end)

    def list_instruments(self) -> list[Instrument]:
        """Return every instrument held locally, with its synced date window.

        Returns:
            All known instruments, ordered by symbol.

        Raises:
            RepositoryError: If the store is unreachable.
        """
        return self._repository.list_instruments()

    def _ensure_coverage(self, symbol: str, requested: DateRange) -> tuple[str, DataSource, Instrument]:
        """Fill any gap in the store for the requested range.

        Args:
            symbol: Ticker symbol in any case.
            requested: Inclusive session-date range.

        Returns:
            The normalized symbol, whether a provider was called, and the
            instrument carrying the up-to-date sync ledger.
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
