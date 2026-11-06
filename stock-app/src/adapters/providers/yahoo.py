"""Yahoo Finance provider; the only module that imports pandas or yfinance."""

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
    """Fetches daily bars and instrument metadata from Yahoo Finance."""

    name = PROVIDER_NAME

    def __init__(self):
        """Create the provider and register its metric label combinations."""
        register_provider(self.name)

    def fetch_daily_bars(self, symbol: str, start: date, end: date) -> list[PriceBar]:
        """Return validated bars for symbol within start..end, oldest first.

        Raises SymbolNotFoundError for an unknown symbol and ProviderError for other failures.
        """
        with self._timed_call():
            frame = self._request_history(symbol, start, end)
        if frame.empty:
            return []
        return self._to_price_bars(symbol, self._clean(frame))

    def fetch_instrument(self, symbol: str) -> Instrument:
        """Return metadata for symbol; raise SymbolNotFoundError or ProviderError."""
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
        """Time one provider call and record its outcome."""
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
        """Return yfinance's raw daily history; raise SymbolNotFoundError or ProviderError."""
        try:
            # yfinance's end is exclusive. auto_adjust=False keeps both Close and Adj Close.
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
        """Return yfinance's info mapping; raise SymbolNotFoundError or ProviderError."""
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
        """Drop NaN-priced rows, dedupe sessions (keep last), sort and round prices."""
        cleaned = frame.dropna(subset=PRICE_COLUMNS)
        cleaned = cleaned[~cleaned.index.duplicated(keep="last")].sort_index()
        rounded = [column for column in (*PRICE_COLUMNS, ADJ_CLOSE_COLUMN) if column in cleaned.columns]
        cleaned[rounded] = cleaned[rounded].round(PRICE_DECIMALS)
        return cleaned

    def _to_price_bars(self, symbol: str, frame: pd.DataFrame) -> list[PriceBar]:
        """Build PriceBars from a cleaned frame; invalid rows are counted and dropped."""
        bars = []
        for session_date, row in zip(frame.index.date, frame.to_dict("records"), strict=True):
            bar = self._to_price_bar(symbol, session_date, row)
            if bar is not None:
                bars.append(bar)
        return bars

    def _to_price_bar(self, symbol: str, session_date, row: dict) -> PriceBar | None:
        """Return one PriceBar, or None (counted as rejected) if the row breaks an invariant."""
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
            # A NaT index raises TypeError, not ValidationError.
            record_rejected_row(self.name, RejectionReason.MALFORMED)
        return None

    @staticmethod
    def _optional_price(value) -> float | None:
        """Return the price, or None if it is missing or NaN."""
        if value is None or pd.isna(value):
            return None
        return value
