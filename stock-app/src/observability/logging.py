"""Logging to stdout only (the root filesystem is read-only)."""

import logging
import sys

logger = logging.getLogger("stock-app")

LOG_FORMAT = "[%(asctime)s] [%(levelname)s]: %(message)s"


def configure_logging(level: int = logging.INFO) -> None:
    """Attach one stdout handler to the service logger (idempotent)."""
    logger.setLevel(level)
    if logger.handlers:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    logger.addHandler(handler)
