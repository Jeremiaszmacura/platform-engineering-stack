"""Provider-independent model of daily market data.

Every bar that reaches the database passes through :class:`PriceBar`, so the
invariants declared here hold regardless of which provider produced the data.
This module depends on nothing but the standard library and pydantic.
"""

import re
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Bounds the *shape* of a symbol, not its existence: the provider decides
# whether it exists. Also a security control - the symbol reaches provider
# URLs and metric labels, so nothing outside this alphabet may pass.
SYMBOL_PATTERN = re.compile(r"^[A-Z0-9.\-]{1,16}$")

# Matches numeric(18,4) in the database schema.
PRICE_EXPONENT = Decimal("0.0001")

# Exchange calendars east of UTC open on a session date that can still be
# "tomorrow" in UTC, so allow a day of slack before calling a bar future-dated.
MAX_SESSION_DATE_SKEW = timedelta(days=1)

Price = Annotated[Decimal, Field(gt=0)]


def normalize_symbol(value: str) -> str:
    """Return the canonical form of a ticker symbol.

    Args:
        value: Raw symbol, in any case and with surrounding whitespace.

    Returns:
        The symbol stripped and uppercased.

    Raises:
        ValueError: If the normalized symbol does not match SYMBOL_PATTERN.
    """
    symbol = value.strip().upper()
    if not SYMBOL_PATTERN.match(symbol):
        raise ValueError(f"invalid symbol: {value!r}")
    return symbol


def utc_today() -> date:
    """Return the current date in UTC."""
    return datetime.now(timezone.utc).date()


class Interval(StrEnum):
    """Bar interval. Only daily bars are supported today."""

    DAY = "1d"


class DataSource(StrEnum):
    """Where the bars of a response were served from."""

    CACHE = "cache"
    PROVIDER = "provider"


class DateRange(BaseModel):
    """An inclusive range of trading session dates.

    Attributes:
        start: First session date in the range.
        end: Last session date in the range.
    """

    model_config = ConfigDict(frozen=True)

    start: date
    end: date

    @model_validator(mode="after")
    def _check_order(self) -> "DateRange":
        """Reject ranges whose start lies after their end."""
        if self.start > self.end:
            raise ValueError("range start must not be after its end")
        return self


class PriceBar(BaseModel):
    """One standardized OHLCV bar for a single trading session.

    Raw prices are kept alongside ``adj_close`` because adjusted prices are
    rewritten retroactively by every split and dividend, which makes the raw
    columns the only ones that can be reconciled against a provider later.

    Attributes:
        symbol: Normalized ticker symbol.
        interval: Bar interval.
        session_date: Trading session in the exchange's local calendar.
        open: Opening price.
        high: Highest price of the session.
        low: Lowest price of the session.
        close: Closing price.
        adj_close: Split/dividend-adjusted close, when the provider reports one.
        volume: Number of shares traded.
    """

    model_config = ConfigDict(frozen=True)

    symbol: str
    interval: Interval
    session_date: date
    open: Price
    high: Price
    low: Price
    close: Price
    adj_close: Price | None = None
    volume: int = Field(ge=0)

    @field_validator("symbol")
    @classmethod
    def _normalize_symbol(cls, value: str) -> str:
        """Normalize and validate the ticker symbol."""
        return normalize_symbol(value)

    @field_validator("open", "high", "low", "close", "adj_close")
    @classmethod
    def _quantize_price(cls, value: Decimal | None) -> Decimal | None:
        """Round a price to the four decimal places the database stores."""
        if value is None:
            return None
        return value.quantize(PRICE_EXPONENT, rounding=ROUND_HALF_UP)

    @model_validator(mode="after")
    def _check_bar_consistency(self) -> "PriceBar":
        """Reject bars whose OHLC values contradict each other or lie in the future."""
        if self.high < self.low:
            raise ValueError("high must not be below low")
        if self.low > min(self.open, self.close):
            raise ValueError("low must not exceed open or close")
        if self.high < max(self.open, self.close):
            raise ValueError("high must not be below open or close")
        if self.session_date > utc_today() + MAX_SESSION_DATE_SKEW:
            raise ValueError("session_date must not be in the future")
        return self


class Instrument(BaseModel):
    """A tradable instrument and the ledger of how far it has been synced.

    ``first_synced_date`` and ``last_synced_date`` record the session-date
    window that has been requested from the provider - not the dates of the
    bars that came back. Weekends and holidays produce no bars, so a window
    derived from bar dates would look incomplete forever and refetch on every
    request.

    Attributes:
        symbol: Normalized ticker symbol.
        name: Human-readable instrument name, when the provider reports one.
        exchange: Exchange code the instrument trades on.
        currency: Currency the prices are quoted in.
        first_synced_date: Earliest session date synced from the provider.
        last_synced_date: Latest session date synced from the provider.
        last_synced_at: When the provider was last called for this instrument.
        source: Name of the provider the metadata came from.
    """

    model_config = ConfigDict(frozen=True)

    symbol: str
    name: str | None = None
    exchange: str | None = None
    currency: str | None = None
    first_synced_date: date | None = None
    last_synced_date: date | None = None
    last_synced_at: datetime | None = None
    source: str

    @field_validator("symbol")
    @classmethod
    def _normalize_symbol(cls, value: str) -> str:
        """Normalize and validate the ticker symbol."""
        return normalize_symbol(value)

    def with_metadata(self, other: "Instrument") -> "Instrument":
        """Return a copy of this instrument with descriptive fields taken from another.

        Used to refresh name, exchange and currency from the provider while
        keeping the sync ledger already recorded locally.

        Args:
            other: Instrument carrying freshly fetched provider metadata.

        Returns:
            A copy of this instrument with refreshed descriptive fields.
        """
        return self.model_copy(
            update={
                "name": other.name,
                "exchange": other.exchange,
                "currency": other.currency,
                "source": other.source,
            }
        )

    def with_coverage(self, synced: DateRange, synced_at: datetime) -> "Instrument":
        """Return a copy whose sync ledger also spans the given range.

        Args:
            synced: Session-date range just requested from the provider.
            synced_at: Time of that provider call.

        Returns:
            A copy of this instrument with a widened sync window.
        """
        first = synced.start if self.first_synced_date is None else min(self.first_synced_date, synced.start)
        last = synced.end if self.last_synced_date is None else max(self.last_synced_date, synced.end)
        return self.model_copy(
            update={"first_synced_date": first, "last_synced_date": last, "last_synced_at": synced_at}
        )


class PriceSummary(BaseModel):
    """Aggregate statistics for one symbol over a range of sessions.

    Attributes:
        symbol: Normalized ticker symbol.
        interval: Bar interval the statistics were computed over.
        period: Session-date range the statistics cover.
        first_close: Close of the earliest bar in the period.
        last_close: Close of the latest bar in the period.
        period_high: Highest price reached in the period.
        period_low: Lowest price reached in the period.
        average_volume: Mean traded volume per session.
        bar_count: Number of bars the statistics were computed from.
    """

    model_config = ConfigDict(frozen=True)

    symbol: str
    interval: Interval
    period: DateRange
    first_close: Decimal
    last_close: Decimal
    period_high: Decimal
    period_low: Decimal
    average_volume: Decimal
    bar_count: int = Field(ge=1)


class PriceHistory(BaseModel):
    """Bars for one symbol over a requested range, and where they came from.

    Attributes:
        symbol: Normalized ticker symbol.
        interval: Bar interval.
        currency: Currency the prices are quoted in.
        source: Whether the request was served from cache or hit the provider.
        period: Session-date range that was requested.
        bars: Bars in the range, in ascending session-date order.
    """

    model_config = ConfigDict(frozen=True)

    symbol: str
    interval: Interval
    currency: str | None
    source: DataSource
    period: DateRange
    bars: tuple[PriceBar, ...]
