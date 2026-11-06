"""Tests for the stdout-only service logger."""

import logging
import sys
import unittest

from logger import configure_logging, logger


class TestConfigureLogging(unittest.TestCase):
    """Tests for logger.configure_logging."""

    def setUp(self):
        self._remove_handlers()

    def tearDown(self):
        self._remove_handlers()

    def _remove_handlers(self):
        """Detach all handlers so each test starts with an unconfigured logger."""
        for handler in list(logger.handlers):
            logger.removeHandler(handler)

    def test_attaches_single_stdout_handler(self):
        configure_logging()

        self.assertEqual(len(logger.handlers), 1)
        handler = logger.handlers[0]
        self.assertIsInstance(handler, logging.StreamHandler)
        self.assertIs(handler.stream, sys.stdout)

    def test_does_not_duplicate_handlers_when_called_twice(self):
        configure_logging()
        configure_logging()

        self.assertEqual(len(logger.handlers), 1)


if __name__ == "__main__":
    unittest.main()
