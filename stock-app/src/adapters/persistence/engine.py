"""Database engine construction."""

from sqlalchemy import Engine, create_engine

POOL_SIZE = 5


def create_database_engine(url: str) -> Engine:
    """Create the process-wide SQLAlchemy engine.

    ``pool_pre_ping`` matters here because the database and the service are
    separate pods: a restarted database leaves stale connections in the pool
    that must be discarded rather than handed to a request.

    Args:
        url: SQLAlchemy database URL.

    Returns:
        A configured Engine. No connection is opened until first use.
    """
    return create_engine(url, pool_pre_ping=True, pool_size=POOL_SIZE)
