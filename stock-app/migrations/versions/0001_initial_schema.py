"""Initial market data schema: instruments ledger and the price_bars hypertable.

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

PRICE = sa.Numeric(18, 4)

# Daily bars at the 7-day default would create one near-empty chunk per week.
CHUNK_INTERVAL = "1 year"


def upgrade() -> None:
    """Create the schema and turn price_bars into a hypertable."""
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")

    op.create_table(
        "instruments",
        sa.Column("symbol", sa.Text, primary_key=True),
        sa.Column("name", sa.Text),
        sa.Column("exchange", sa.Text),
        sa.Column("currency", sa.Text),
        # The sync ledger: the session-date window already requested from the
        # provider, not the dates of the bars that came back. Weekends and
        # holidays produce no bars, so a window derived from bar dates would
        # look incomplete forever and refetch on every request.
        sa.Column("first_synced_date", sa.Date),
        sa.Column("last_synced_date", sa.Date),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column("source", sa.Text, nullable=False),
    )

    op.create_table(
        "price_bars",
        sa.Column("symbol", sa.Text, sa.ForeignKey("instruments.symbol", ondelete="CASCADE"), nullable=False),
        sa.Column("interval", sa.Text, nullable=False),
        # Session date at 00:00:00 UTC; the exchange-local to UTC conversion
        # happens in the provider adapter.
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("open", PRICE, nullable=False),
        sa.Column("high", PRICE, nullable=False),
        sa.Column("low", PRICE, nullable=False),
        sa.Column("close", PRICE, nullable=False),
        sa.Column("adj_close", PRICE),
        sa.Column("volume", sa.BigInteger, nullable=False),
        sa.Column("source", sa.Text, nullable=False),
        sa.Column("ingested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        # TimescaleDB requires the partitioning column in every unique index,
        # which is why ts is part of the primary key. It is also the
        # ON CONFLICT target of the upsert.
        sa.PrimaryKeyConstraint("symbol", "interval", "ts"),
    )

    op.execute(
        f"SELECT create_hypertable('price_bars', by_range('ts', INTERVAL '{CHUNK_INTERVAL}'), if_not_exists => TRUE)"
    )


def downgrade() -> None:
    """Drop the schema. The hypertable disappears with its table."""
    op.drop_table("price_bars")
    op.drop_table("instruments")
