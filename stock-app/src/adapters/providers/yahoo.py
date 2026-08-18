"""Yahoo Finance implementation of the MarketDataProvider port.

This is the only module allowed to import pandas or yfinance: cleaning is done
vectorized on the DataFrame, and domain objects are materialized once at the
end, with pydantic acting as the final invariant gate on already-clean data.
"""

import time
from contextlib import contextmanager
from datetime import date, timedelta

import pandas as pd
import yfinance as yf
from pydantic import ValidationError
from yfinance.exceptions import YFPricesMissingError, YFTickerMissingError

from src.domain.errors import ProviderError, SymbolNotFoundError
from src.domain.models import Instrument, Interval, PriceBar
from src.observability.metrics import (
    ProviderOutcome,
    RejectionReason,
    record_provider_call,
    record_rejected_row,
    register_provider,
)

PROVIDER_NAME = "yahoo"

OPEN_COLUMN = "Open"
HIGH_COLUMN = "High"
LOW_COLUMN = "Low"
CLOSE_COLUMN = "Close"
ADJ_CLOSE_COLUMN = "Adj Close"
VOLUME_COLUMN = "Volume"

PRICE_COLUMNS = [OPEN_COLUMN, HIGH_COLUMN, LOW_COLUMN, CLOSE_COLUMN]
PRICE_DECIMALS = 4


class YahooMarketDataProvider:
    """Fetches daily bars and instrument metadata from Yahoo Finance.

    Attributes:
        name: Provider name recorded on stored rows and used as a metric label.
    """

    name = PROVIDER_NAME

    def __init__(self):
        """Create the provider and register its metric label combinations."""
        register_provider(self.name)

    def fetch_daily_bars(self, symbol: str, start: date, end: date) -> list[PriceBar]:
        """Return Yahoo's daily bars for a symbol over an inclusive date range.

        Args:
            symbol: Normalized ticker symbol.
            start: First session date to fetch.
            end: Last session date to fetch.

        Returns:
            Validated bars in ascending session-date order; empty when the
            range holds no trading sessions.

        Raises:
            SymbolNotFoundError: If Yahoo does not know the symbol.
            ProviderError: If the request fails for any other reason.
        """
        with self._timed_call():
            frame = self._request_history(symbol, start, end)
        if frame.empty:
            return []
        return self._to_price_bars(symbol, self._clean(frame))

    def fetch_instrument(self, symbol: str) -> Instrument:
        """Return Yahoo's metadata for a symbol.

        Args:
            symbol: Normalized ticker symbol.

        Returns:
            The instrument with descriptive fields filled in and an empty
            sync ledger.

        Raises:
            SymbolNotFoundError: If Yahoo does not know the symbol.
            ProviderError: If the request fails for any other reason.
        """
        with self._timed_call():
            info = self._request_info(symbol)
        return Instrument(
            symbol=symbol,
            name=info.get("longName") or info.get("shortName"),
            exchange=info.get("fullExchangeName") or info.get("exchange"),
            currency=info.get("currency"),
            source=self.name,
        )

    @contextmanager
    def _timed_call(self):
        """Time one provider call and count its outcome.

        Yields:
            Control to the caller, whose exceptions classify the outcome.
        """
        started_at = time.monotonic()
        try:
            yield
        except SymbolNotFoundError:
            record_provider_call(self.name, ProviderOutcome.NOT_FOUND, time.monotonic() - started_at)
            raise
        except ProviderError:
            record_provider_call(self.name, ProviderOutcome.ERROR, time.monotonic() - started_at)
            raise
        record_provider_call(self.name, ProviderOutcome.SUCCESS, time.monotonic() - started_at)

    def _request_history(self, symbol: str, start: date, end: date) -> pd.DataFrame:
        """Call yfinance for the raw daily price history.

        Args:
            symbol: Normalized ticker symbol.
            start: First session date to fetch.
            end: Last session date to fetch.

        Returns:
            The raw DataFrame, empty when Yahoo holds no prices for the range.

        Raises:
            SymbolNotFoundError: If Yahoo does not know the symbol.
            ProviderError: If the request fails for any other reason.
        """
        try:
            # yfinance treats `end` as exclusive while the port's range is
            # inclusive. auto_adjust=False is load-bearing: the default folds
            # adjustments into Close and drops Adj Close, and both are stored.
            return yf.Ticker(symbol).history(
                start=start,
                end=end + timedelta(days=1),
                interval=Interval.DAY.value,
                auto_adjust=False,
                actions=False,
            )
        except YFPricesMissingError:
            # The symbol exists but has no sessions in this range.
            return pd.DataFrame()
        except YFTickerMissingError as error:
            raise SymbolNotFoundError(symbol) from error
        except Exception as error:  # yfinance wraps a scraper: network, parsing and rate-limit errors
            raise ProviderError(f"yahoo price history request failed for {symbol}") from error

    def _request_info(self, symbol: str) -> dict:
        """Call yfinance for the raw instrument metadata.

        Args:
            symbol: Normalized ticker symbol.

        Returns:
            Yahoo's info mapping for the symbol.

        Raises:
            SymbolNotFoundError: If Yahoo does not know the symbol.
            ProviderError: If the request fails for any other reason.
        """
        try:
            info = yf.Ticker(symbol).get_info()
        except YFTickerMissingError as error:
            raise SymbolNotFoundError(symbol) from error
        except Exception as error:  # yfinance wraps a scraper: network, parsing and rate-limit errors
            raise ProviderError(f"yahoo instrument request failed for {symbol}") from error
        if not info or not (info.get("symbol") or info.get("quoteType")):
            raise SymbolNotFoundError(symbol)
        return info

    @staticmethod
    def _clean(frame: pd.DataFrame) -> pd.DataFrame:
        """Drop unusable rows and normalize the frame, vectorized.

        Holiday and trading-halt rows carry NaN prices, Yahoo occasionally
        repeats a session, and rows are not guaranteed to arrive in order.

        Args:
            frame: Raw DataFrame as returned by yfinance.

        Returns:
            A frame with NaN-priced rows dropped, duplicate sessions collapsed
            to the last occurrence, rows sorted chronologically and prices
            rounded to the stored precision.
        """
        cleaned = frame.dropna(subset=PRICE_COLUMNS)
        cleaned = cleaned[~cleaned.index.duplicated(keep="last")].sort_index()
        rounded = [column for column in (*PRICE_COLUMNS, ADJ_CLOSE_COLUMN) if column in cleaned.columns]
        cleaned[rounded] = cleaned[rounded].round(PRICE_DECIMALS)
        return cleaned

    def _to_price_bars(self, symbol: str, frame: pd.DataFrame) -> list[PriceBar]:
        """Materialize domain objects from a cleaned frame.

        The index is already localized to the exchange timezone by yfinance,
        so its ``date`` is the trading session in the exchange's own calendar.

        Args:
            symbol: Normalized ticker symbol.
            frame: Cleaned DataFrame.

        Returns:
            The bars that satisfy every domain invariant; rows that do not are
            counted as rejections and dropped.
        """
        bars = []
        for session_date, row in zip(frame.index.date, frame.to_dict("records"), strict=True):
            bar = self._to_price_bar(symbol, session_date, row)
            if bar is not None:
                bars.append(bar)
        return bars

    def _to_price_bar(self, symbol: str, session_date, row: dict) -> PriceBar | None:
        """Build one bar, counting and dropping the row if it violates an invariant.

        Args:
            symbol: Normalized ticker symbol.
            session_date: Session date taken from the exchange-local index.
            row: One row of the cleaned frame as a column-to-value mapping.

        Returns:
            The bar, or None when the row could not be validated.
        """
        try:
            return PriceBar(
                symbol=symbol,
                interval=Interval.DAY,
                session_date=session_date,
                open=row[OPEN_COLUMN],
                high=row[HIGH_COLUMN],
                low=row[LOW_COLUMN],
                close=row[CLOSE_COLUMN],
                adj_close=self._optional_price(row.get(ADJ_CLOSE_COLUMN)),
                volume=row[VOLUME_COLUMN],
            )
        except ValidationError:
            record_rejected_row(self.name, RejectionReason.VALIDATION)
        except (TypeError, ValueError):
            # A pd.NaT index entry raises a bare TypeError rather than a
            # ValidationError, so a malformed date is a rejection, not a 500.
            record_rejected_row(self.name, RejectionReason.MALFORMED)
        return None

    @staticmethod
    def _optional_price(value) -> float | None:
        """Return a price, or None when the provider left it unreported.

        The adjusted close is optional in the domain, so a missing one drops
        that single column rather than the whole bar.

        Args:
            value: Raw value from the frame, possibly NaN or absent.

        Returns:
            The value, or None when it is absent or NaN.
        """
        if value is None or pd.isna(value):
            return None
        return value
