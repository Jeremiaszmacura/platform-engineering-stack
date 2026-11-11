"""Logging to stdout only (the root filesystem is read-only)."""

import logging
import sys

from src.observability.tracing import current_trace_id

logger = logging.getLogger("stock-app")

LOG_FORMAT = "[%(asctime)s] [%(levelname)s] [trace_id=%(trace_id)s]: %(message)s"

NO_TRACE_ID = "-"


class TraceIdFilter(logging.Filter):
    """Adds the active trace id to each record, so a log line leads to its trace in Tempo."""

    def filter(self, record: logging.LogRecord) -> bool:
        """Set record.trace_id ("-" outside a request) and keep the record."""
        record.trace_id = current_trace_id() or NO_TRACE_ID
        return True


def configure_logging(level: int = logging.INFO) -> None:
    """Attach one stdout handler to the service logger (idempotent)."""
    logger.setLevel(level)
    if logger.handlers:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    handler.addFilter(TraceIdFilter())
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    logger.addHandler(handler)
