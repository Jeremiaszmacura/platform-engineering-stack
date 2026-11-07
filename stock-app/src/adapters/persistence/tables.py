"""SQLAlchemy Core table definitions."""

from sqlalchemy import (
    BigInteger,
    Column,
    Date,
    DateTime,
    ForeignKey,
    MetaData,
    Numeric,
    PrimaryKeyConstraint,
    Table,
    Text,
    func,
)

metadata = MetaData()

PRICE_PRECISION = 18
PRICE_SCALE = 4

# Coverage ledger: one row per symbol, recording how far it has been synced.
instruments = Table(
    "instruments",
    metadata,
    Column("symbol", Text, primary_key=True),
    Column("name", Text),
    Column("exchange", Text),
    Column("currency", Text),
    Column("first_synced_date", Date),
    Column("last_synced_date", Date),
    Column("last_synced_at", DateTime(timezone=True)),
    Column("source", Text, nullable=False),
)

# Hypertable partitioned on ts, so ts is part of the primary key.
price_bars = Table(
    "price_bars",
    metadata,
    Column("symbol", Text, ForeignKey("instruments.symbol", ondelete="CASCADE"), nullable=False),
    Column("interval", Text, nullable=False),
    Column("ts", DateTime(timezone=True), nullable=False),
    Column("open", Numeric(PRICE_PRECISION, PRICE_SCALE), nullable=False),
    Column("high", Numeric(PRICE_PRECISION, PRICE_SCALE), nullable=False),
    Column("low", Numeric(PRICE_PRECISION, PRICE_SCALE), nullable=False),
    Column("close", Numeric(PRICE_PRECISION, PRICE_SCALE), nullable=False),
    Column("adj_close", Numeric(PRICE_PRECISION, PRICE_SCALE)),
    Column("volume", BigInteger, nullable=False),
    Column("source", Text, nullable=False),
    Column("ingested_at", DateTime(timezone=True), nullable=False, server_default=func.now()),
    PrimaryKeyConstraint("symbol", "interval", "ts"),
)
