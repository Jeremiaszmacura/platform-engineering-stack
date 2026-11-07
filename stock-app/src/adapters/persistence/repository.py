"""TimescaleDB implementation of the PriceBarRepository port."""

from collections.abc import Sequence
from contextlib import contextmanager
from datetime import date, datetime, time, timezone

from sqlalchemy import Engine, Row, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from src.adapters.persistence.tables import instruments, price_bars
from src.domain.errors import RepositoryError
from src.domain.models import DateRange, Instrument, Interval, PriceBar, PriceSummary
from src.observability.metrics import record_bars_upserted

# first()/last() are TimescaleDB aggregates.
SUMMARY_SQL = text("""
    SELECT first(close, ts) AS first_close,
           last(close, ts)  AS last_close,
           max(high)        AS period_high,
           min(low)         AS period_low,
           avg(volume)      AS average_volume,
           count(*)         AS bar_count
    FROM price_bars
    WHERE symbol = :symbol AND interval = :interval AND ts >= :start AND ts <= :end
    """)


def to_timestamp(session_date: date) -> datetime:
    """Return the session date as a UTC midnight timestamp."""
    return datetime.combine(session_date, time.min, tzinfo=timezone.utc)


class TimescalePriceBarRepository:
    """Stores instruments and price bars in TimescaleDB."""

    def __init__(self, engine: Engine):
        """Bind the repository to an engine."""
        self._engine = engine

    def get_instrument(self, symbol: str) -> Instrument | None:
        """Return the stored instrument and its sync ledger, or None if unknown."""
        statement = select(instruments).where(instruments.c.symbol == symbol)
        with self._connect() as connection:
            row = connection.execute(statement).one_or_none()
        if row is None:
            return None
        return self._to_instrument(row)

    def list_instruments(self) -> list[Instrument]:
        """Return every stored instrument, ordered by symbol."""
        statement = select(instruments).order_by(instruments.c.symbol)
        with self._connect() as connection:
            rows = connection.execute(statement).all()
        return [self._to_instrument(row) for row in rows]

    def bars_in_range(self, symbol: str, interval: Interval, start: date, end: date) -> list[PriceBar]:
        """Return stored bars for a symbol over an inclusive session-date range."""
        statement = (
            select(price_bars)
            .where(
                price_bars.c.symbol == symbol,
                price_bars.c.interval == interval.value,
                price_bars.c.ts >= to_timestamp(start),
                price_bars.c.ts <= to_timestamp(end),
            )
            .order_by(price_bars.c.ts)
        )
        with self._connect() as connection:
            rows = connection.execute(statement).all()
        return [self._to_price_bar(row) for row in rows]

    def save_bars(self, instrument: Instrument, bars: Sequence[PriceBar]) -> int:
        """Upsert an instrument and its bars in a single transaction."""
        with self._begin() as connection:
            connection.execute(self._upsert_instrument_statement(instrument))
            if bars:
                connection.execute(self._upsert_bars_statement(instrument.source, bars))
        record_bars_upserted(instrument.source, len(bars))
        return len(bars)

    def summarize(self, symbol: str, interval: Interval, start: date, end: date) -> PriceSummary | None:
        """Return aggregate statistics over the stored bars in a range."""
        parameters = {
            "symbol": symbol,
            "interval": interval.value,
            "start": to_timestamp(start),
            "end": to_timestamp(end),
        }
        with self._connect() as connection:
            row = connection.execute(SUMMARY_SQL, parameters).one()
        if row.bar_count == 0:
            return None
        return PriceSummary(
            symbol=symbol,
            interval=interval,
            period=DateRange(start=start, end=end),
            first_close=row.first_close,
            last_close=row.last_close,
            period_high=row.period_high,
            period_low=row.period_low,
            average_volume=row.average_volume,
            bar_count=row.bar_count,
        )

    def check_health(self) -> bool:
        """Return True when the database answers a trivial query."""
        try:
            with self._engine.connect() as connection:
                connection.execute(text("SELECT 1"))
        except SQLAlchemyError:
            return False
        return True

    @contextmanager
    def _translating_errors(self, open_connection):
        """Yield a connection; raise RepositoryError for any database failure, including during statements."""
        try:
            with open_connection() as connection:
                yield connection
        except SQLAlchemyError as error:
            raise RepositoryError("database operation failed") from error

    def _connect(self):
        """Return a context manager yielding a read-only connection."""
        return self._translating_errors(self._engine.connect)

    def _begin(self):
        """Return a context manager yielding a connection inside a transaction."""
        return self._translating_errors(self._engine.begin)

    @staticmethod
    def _upsert_instrument_statement(instrument: Instrument):
        """Return the upsert statement for one instrument."""
        values = {
            "symbol": instrument.symbol,
            "name": instrument.name,
            "exchange": instrument.exchange,
            "currency": instrument.currency,
            "first_synced_date": instrument.first_synced_date,
            "last_synced_date": instrument.last_synced_date,
            "last_synced_at": instrument.last_synced_at,
            "source": instrument.source,
        }
        statement = insert(instruments).values(**values)
        return statement.on_conflict_do_update(
            index_elements=[instruments.c.symbol],
            set_={column: statement.excluded[column] for column in values if column != "symbol"},
        )

    @staticmethod
    def _upsert_bars_statement(source: str, bars: Sequence[PriceBar]):
        """Return the upsert statement for a batch of bars (existing rows are overwritten)."""
        rows = [
            {
                "symbol": bar.symbol,
                "interval": bar.interval.value,
                "ts": to_timestamp(bar.session_date),
                "open": bar.open,
                "high": bar.high,
                "low": bar.low,
                "close": bar.close,
                "adj_close": bar.adj_close,
                "volume": bar.volume,
                "source": source,
            }
            for bar in bars
        ]
        statement = insert(price_bars).values(rows)
        updated = ("open", "high", "low", "close", "adj_close", "volume", "source")
        return statement.on_conflict_do_update(
            index_elements=[price_bars.c.symbol, price_bars.c.interval, price_bars.c.ts],
            set_={column: statement.excluded[column] for column in updated},
        )

    @staticmethod
    def _to_instrument(row: Row) -> Instrument:
        """Map an instruments row to an Instrument."""
        return Instrument(
            symbol=row.symbol,
            name=row.name,
            exchange=row.exchange,
            currency=row.currency,
            first_synced_date=row.first_synced_date,
            last_synced_date=row.last_synced_date,
            last_synced_at=row.last_synced_at,
            source=row.source,
        )

    @staticmethod
    def _to_price_bar(row: Row) -> PriceBar:
        """Map a price_bars row to a PriceBar."""
        return PriceBar(
            symbol=row.symbol,
            interval=Interval(row.interval),
            session_date=row.ts.date(),
            open=row.open,
            high=row.high,
            low=row.low,
            close=row.close,
            adj_close=row.adj_close,
            volume=row.volume,
        )
