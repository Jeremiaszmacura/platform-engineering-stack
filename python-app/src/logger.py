"""Service logger. Logs go to stdout only, so Kubernetes collects them."""

import logging
import sys

logger = logging.getLogger("python-app")
logger.setLevel(logging.INFO)


def configure_logging() -> None:
    """Attach a stdout handler to the service logger, once.

    Calling it again is a no-op, so handlers are never duplicated.
    """
    if logger.handlers:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("[%(asctime)s] [%(levelname)s]: %(message)s"))
    logger.addHandler(handler)
