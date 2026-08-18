"""Translation from domain objects onto the generated response models.

The models in ``models.py`` are generated from ``openapi.yaml`` and so cannot
carry constructors of their own. That separation is worth having on its own:
the wire format is described in one file, the mapping onto it in another, and
both are pure functions of a domain object.

``Decimal`` is cast to ``float`` here because pydantic renders a ``Decimal`` as
a JSON string and charting libraries will not accept that.
"""

from src.adapters.inbound.http.models import (
    BarResponse,
    InstrumentResponse,
    PriceHistoryResponse,
    PriceSummaryResponse,
    SessionDateRange,
)
from src.domain.models import DateRange, Instrument, PriceBar, PriceHistory, PriceSummary


def to_session_date_range(period: DateRange) -> SessionDateRange:
    """Render a domain date range.

    Args:
        period: Range to render.

    Returns:
        The range as it appears on the wire.
    """
    return SessionDateRange(start=period.start, end=period.end)


def to_bar_response(bar: PriceBar) -> BarResponse:
    """Render one OHLCV bar.

    Args:
        bar: Domain bar to render.

    Returns:
        The bar with its prices as JSON numbers.
    """
    return BarResponse(
        date=bar.session_date,
        open=float(bar.open),
        high=float(bar.high),
        low=float(bar.low),
        close=float(bar.close),
        adj_close=None if bar.adj_close is None else float(bar.adj_close),
        volume=bar.volume,
    )


def to_price_history_response(history: PriceHistory) -> PriceHistoryResponse:
    """Render the bars of one symbol over a requested range.

    Args:
        history: Domain price history to render.

    Returns:
        The price history as it appears on the wire.
    """
    return PriceHistoryResponse(
        symbol=history.symbol,
        interval=history.interval.value,
        currency=history.currency,
        source=history.source.value,
        range=to_session_date_range(history.period),
        count=len(history.bars),
        bars=[to_bar_response(bar) for bar in history.bars],
    )


def to_price_summary_response(summary: PriceSummary) -> PriceSummaryResponse:
    """Render the aggregate statistics of a period.

    Args:
        summary: Domain summary to render.

    Returns:
        The summary with its prices as JSON numbers.
    """
    return PriceSummaryResponse(
        symbol=summary.symbol,
        interval=summary.interval.value,
        range=to_session_date_range(summary.period),
        bar_count=summary.bar_count,
        first_close=float(summary.first_close),
        last_close=float(summary.last_close),
        period_high=float(summary.period_high),
        period_low=float(summary.period_low),
        average_volume=float(summary.average_volume),
    )


def to_instrument_response(instrument: Instrument) -> InstrumentResponse:
    """Render an instrument and its sync ledger.

    Args:
        instrument: Domain instrument to render.

    Returns:
        The instrument as it appears on the wire.
    """
    return InstrumentResponse(
        symbol=instrument.symbol,
        name=instrument.name,
        exchange=instrument.exchange,
        currency=instrument.currency,
        first_synced_date=instrument.first_synced_date,
        last_synced_date=instrument.last_synced_date,
        last_synced_at=instrument.last_synced_at,
        source=instrument.source,
    )
