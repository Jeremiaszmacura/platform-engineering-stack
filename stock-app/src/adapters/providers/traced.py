"""Tracing decorator for any market data provider (yfinance's HTTP client has no OpenTelemetry instrumentation)."""

from datetime import date

from opentelemetry.trace import SpanKind, Tracer

from src.application.ports import MarketDataProvider
from src.domain.models import Instrument, PriceBar

SYMBOL_ATTRIBUTE = "stock.symbol"
PROVIDER_ATTRIBUTE = "stock.provider"
BAR_COUNT_ATTRIBUTE = "stock.bar_count"


class TracedMarketDataProvider:
    """Wraps a provider so each call becomes a CLIENT span in the request's trace."""

    def __init__(self, provider: MarketDataProvider, tracer: Tracer):
        """Wrap provider, recording spans with tracer."""
        self._provider = provider
        self._tracer = tracer
        self.name = provider.name

    def fetch_daily_bars(self, symbol: str, start: date, end: date) -> list[PriceBar]:
        """Delegate to the provider inside a span; the span also records how many bars came back."""
        with self._tracer.start_as_current_span(
            f"{self.name} fetch_daily_bars", kind=SpanKind.CLIENT, attributes=self._attributes(symbol)
        ) as span:
            bars = self._provider.fetch_daily_bars(symbol, start, end)
            span.set_attribute(BAR_COUNT_ATTRIBUTE, len(bars))
            return bars

    def fetch_instrument(self, symbol: str) -> Instrument:
        """Delegate to the provider inside a span."""
        with self._tracer.start_as_current_span(
            f"{self.name} fetch_instrument", kind=SpanKind.CLIENT, attributes=self._attributes(symbol)
        ):
            return self._provider.fetch_instrument(symbol)

    def _attributes(self, symbol: str) -> dict[str, str]:
        """Return the span attributes shared by every call (a symbol is fine here: spans are not metric series)."""
        return {PROVIDER_ATTRIBUTE: self.name, SYMBOL_ATTRIBUTE: symbol}
