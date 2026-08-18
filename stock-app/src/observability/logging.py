"""Stdout logging for stock-app.

No log file is written: container logs belong to the container runtime, and
a writable log directory would defeat the read-only root filesystem the
Deployment asks for.
"""

import logging
import sys

logger = logging.getLogger("stock-app")

LOG_FORMAT = "[%(asctime)s] [%(levelname)s]: %(message)s"


def configure_logging(level: int = logging.INFO) -> None:
    """Attach a single stdout handler to the service logger.

    Repeat calls are no-ops, so importing the composition root twice does not
    duplicate log lines.

    Args:
        level: Minimum level the service logger emits.
    """
    logger.setLevel(level)
    if logger.handlers:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    logger.addHandler(handler)
