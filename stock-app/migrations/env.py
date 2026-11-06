"""Alembic environment, online mode only (migrations run in an init container)."""

from alembic import context

from src.adapters.persistence.engine import create_database_engine
from src.adapters.persistence.tables import metadata
from src.config import get_settings

target_metadata = metadata


def run_migrations() -> None:
    """Apply pending migrations against the configured database."""
    engine = create_database_engine(get_settings().database_url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations()
