# Generated from openapi.yaml by datamodel-code-generator - do not edit.
# Change the contract and run `tox -e api`; `make lint-python` fails on drift.

from datetime import date as date_aliased
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class ServiceIdentity(BaseModel):
    """
    The identity of this service.
    """

    model_config = ConfigDict(
        populate_by_name=True,
    )
    service: Annotated[str, Field(examples=["stock-app"])]
    """
    Service name.
    """


class HealthStatus(BaseModel):
    """
    Readiness of the service and of the store behind it.
    """

    model_config = ConfigDict(
        populate_by_name=True,
    )
    status: Literal["healthy", "unhealthy"]
    """
    Whether the service can serve requests.
    """
    database: Literal["reachable", "unreachable"]
    """
    Whether the price bar store answered.
    """


class ErrorResponse(BaseModel):
    """
    The single error shape of this API. Every 4xx and 5xx answer carries
    it, including request validation failures.

    """

    model_config = ConfigDict(
        populate_by_name=True,
    )
    detail: Annotated[str, Field(examples=["start must not be after end"])]
    """
    Human-readable reason the request failed.
    """


class SecretRequest(BaseModel):
    """
    A value to keep in Vault under this service's path.
    """

    model_config = ConfigDict(
        populate_by_name=True,
    )
    key: Annotated[str, Field(examples=["api-token"], pattern="^[A-Za-z0-9._\\-]{1,64}$")]
    """
    Key to store the value under.
    """
    value: Annotated[str, Field(min_length=1)]
    """
    The secret value. Never logged, and never echoed back on write.
    """


class StoredSecretResponse(BaseModel):
    """
    Confirmation that a secret was written. The value is not echoed back:
    a response body is far more likely to be logged than a request body.

    """

    model_config = ConfigDict(
        populate_by_name=True,
    )
    key: str
    """
    Key the value was stored under.
    """
    status: Literal["stored"]
    """
    Outcome of the write.
    """


class SecretResponse(BaseModel):
    """
    A secret read back from Vault.
    """

    model_config = ConfigDict(
        populate_by_name=True,
    )
    key: str
    """
    Key the value was stored under.
    """
    value: str
    """
    The stored value.
    """


class SessionDateRange(BaseModel):
    """
    An inclusive range of trading session dates.
    """

    model_config = ConfigDict(
        populate_by_name=True,
    )
    start: date_aliased
    """
    First session date of the range.
    """
    end: date_aliased
    """
    Last session date of the range.
    """


class BarResponse(BaseModel):
    """
    One OHLCV bar. `date` is a bare session date rather than an instant:
    an ISO timestamp at UTC midnight renders as the previous day for
    viewers west of UTC. Prices are JSON numbers, not strings, because
    charting libraries will not accept strings.

    """

    model_config = ConfigDict(
        populate_by_name=True,
    )
    date: date_aliased
    """
    Trading session date in the exchange's local calendar.
    """
    open: float
    """
    Opening price.
    """
    high: float
    """
    Highest price of the session.
    """
    low: float
    """
    Lowest price of the session.
    """
    close: float
    """
    Closing price.
    """
    adj_close: Annotated[float | None, Field(alias="adjClose")]
    """
    Split and dividend adjusted close, when the provider reports one.
    """
    volume: int
    """
    Number of shares traded.
    """


class PriceHistoryResponse(BaseModel):
    """
    Bars for one symbol over a requested range.
    """

    model_config = ConfigDict(
        populate_by_name=True,
    )
    symbol: str
    """
    Normalized ticker symbol.
    """
    interval: Literal["1d"]
    """
    Bar interval. Only daily bars are served today.
    """
    currency: str | None
    """
    Currency the prices are quoted in.
    """
    source: Literal["cache", "provider"]
    """
    Whether the store answered on its own or the provider was called.
    The cheapest way to observe the sync ledger working.

    """
    range: SessionDateRange
    count: int
    """
    Number of bars returned.
    """
    bars: list[BarResponse]
    """
    The bars, in ascending session-date order.
    """


class PriceSummaryResponse(BaseModel):
    """
    Aggregate statistics over the bars of a period.
    """

    model_config = ConfigDict(
        populate_by_name=True,
    )
    symbol: str
    """
    Normalized ticker symbol.
    """
    interval: Literal["1d"]
    """
    Bar interval the statistics were computed over.
    """
    range: SessionDateRange
    bar_count: Annotated[int, Field(alias="barCount")]
    """
    Number of bars the statistics were computed from.
    """
    first_close: Annotated[float, Field(alias="firstClose")]
    """
    Close of the earliest bar in the period.
    """
    last_close: Annotated[float, Field(alias="lastClose")]
    """
    Close of the latest bar in the period.
    """
    period_high: Annotated[float, Field(alias="periodHigh")]
    """
    Highest price reached in the period.
    """
    period_low: Annotated[float, Field(alias="periodLow")]
    """
    Lowest price reached in the period.
    """
    average_volume: Annotated[float, Field(alias="averageVolume")]
    """
    Mean traded volume per session.
    """


class InstrumentResponse(BaseModel):
    """
    An instrument held locally and its sync ledger. The synced dates record
    the window that has been *requested* from the provider, not the dates
    of the bars that came back — weekends and holidays produce no bars, so
    a window derived from bar dates would look incomplete forever.

    """

    model_config = ConfigDict(
        populate_by_name=True,
    )
    symbol: str
    """
    Normalized ticker symbol.
    """
    name: str | None
    """
    Human-readable instrument name.
    """
    exchange: str | None
    """
    Exchange the instrument trades on.
    """
    currency: str | None
    """
    Currency the prices are quoted in.
    """
    first_synced_date: Annotated[date_aliased | None, Field(alias="firstSyncedDate")]
    """
    Earliest session date requested from the provider.
    """
    last_synced_date: Annotated[date_aliased | None, Field(alias="lastSyncedDate")]
    """
    Latest session date requested from the provider.
    """
    last_synced_at: Annotated[AwareDatetime | None, Field(alias="lastSyncedAt")]
    """
    When the provider was last called for this instrument.
    """
    source: str
    """
    Provider the data came from.
    """
