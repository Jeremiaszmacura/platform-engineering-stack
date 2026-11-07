"""Database engine construction."""

from sqlalchemy import Engine, create_engine

POOL_SIZE = 5


def create_database_engine(url: str) -> Engine:
    """Create the SQLAlchemy engine; pool_pre_ping drops connections broken by a database restart."""
    return create_engine(url, pool_pre_ping=True, pool_size=POOL_SIZE)
