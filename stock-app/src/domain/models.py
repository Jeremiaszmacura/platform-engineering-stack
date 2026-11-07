"""Provider-independent domain model; every stored bar passes these invariants."""

import re
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Shape only, not existence. Also guards provider URLs and metric labels.
SYMBOL_PATTERN = re.compile(r"^[A-Z0-9.\-]{1,16}$")

# Matches numeric(18,4) in the database schema.
PRICE_EXPONENT = Decimal("0.0001")

# Exchanges east of UTC can be a day ahead of UTC.
MAX_SESSION_DATE_SKEW = timedelta(days=1)

Price = Annotated[Decimal, Field(gt=0)]


def normalize_symbol(value: str) -> str:
    """Return the symbol stripped and uppercased; raise ValueError if it doesn't match SYMBOL_PATTERN."""
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
    """An inclusive range of session dates."""

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
    """One validated OHLCV bar for a trading session.

    Raw prices are kept next to adj_close, which providers rewrite after splits and dividends.
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
    """An instrument and its sync ledger.

    first/last_synced_date are the window requested from the provider, not bar dates,
    so weekends and holidays don't look like gaps.
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
        """Return a copy with name, exchange and currency from other, keeping this sync ledger."""
        return self.model_copy(
            update={
                "name": other.name,
                "exchange": other.exchange,
                "currency": other.currency,
                "source": other.source,
            }
        )

    def with_coverage(self, synced: DateRange, synced_at: datetime) -> "Instrument":
        """Return a copy whose sync ledger also covers synced, last synced at synced_at."""
        first = synced.start if self.first_synced_date is None else min(self.first_synced_date, synced.start)
        last = synced.end if self.last_synced_date is None else max(self.last_synced_date, synced.end)
        return self.model_copy(
            update={"first_synced_date": first, "last_synced_date": last, "last_synced_at": synced_at}
        )


class PriceSummary(BaseModel):
    """Statistics for one symbol over a period."""

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
    """Bars for a symbol over a period, and whether they came from cache or the provider."""

    model_config = ConfigDict(frozen=True)

    symbol: str
    interval: Interval
    currency: str | None
    source: DataSource
    period: DateRange
    bars: tuple[PriceBar, ...]
