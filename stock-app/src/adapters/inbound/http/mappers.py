"""Map domain objects to the generated response models (Decimal becomes float for JSON)."""

from src.adapters.inbound.http.models import (
    BarResponse,
    InstrumentResponse,
    PriceHistoryResponse,
    PriceSummaryResponse,
    SessionDateRange,
)
from src.domain.models import DateRange, Instrument, PriceBar, PriceHistory, PriceSummary


def to_session_date_range(period: DateRange) -> SessionDateRange:
    """Map a DateRange to its response model."""
    return SessionDateRange(start=period.start, end=period.end)


def to_bar_response(bar: PriceBar) -> BarResponse:
    """Map a PriceBar to its response model."""
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
    """Map a PriceHistory to its response model."""
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
    """Map a PriceSummary to its response model."""
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
    """Map an Instrument to its response model."""
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
