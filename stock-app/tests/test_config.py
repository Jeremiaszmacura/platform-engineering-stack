"""Tests for settings parsing and database URL assembly."""

import unittest
from unittest.mock import patch

from src.config import Settings, get_settings


class TestSettings(unittest.TestCase):
    """Tests for the environment-driven settings."""

    def test_defaults_point_at_the_in_cluster_database(self):
        settings = Settings()

        self.assertEqual(settings.db_host, "timescaledb-service.data")
        self.assertEqual(settings.db_port, 5432)
        self.assertEqual(settings.db_name, "stockdata")
        self.assertEqual(settings.provider, "yahoo")
        self.assertEqual(settings.stale_after_seconds, 3600)

    def test_environment_overrides_every_field(self):
        environment = {
            "STOCK_DB_HOST": "db.example",
            "STOCK_DB_PORT": "6543",
            "STOCK_DB_NAME": "market",
            "STOCK_DB_USER": "reader",
            "STOCK_DB_PASSWORD": "topsecret",  # nosec B105 - test fixture, not a credential
            "STOCK_PROVIDER": "yahoo",
            "STOCK_STALE_AFTER_SECONDS": "60",
        }
        with patch.dict("os.environ", environment, clear=False):
            settings = Settings()

        self.assertEqual(settings.db_host, "db.example")
        self.assertEqual(settings.db_port, 6543)
        self.assertEqual(settings.db_name, "market")
        self.assertEqual(settings.db_user, "reader")
        self.assertEqual(settings.db_password.get_secret_value(), "topsecret")
        self.assertEqual(settings.stale_after_seconds, 60)

    def test_password_is_not_exposed_by_repr(self):
        self.assertNotIn("stockapp", repr(Settings().db_password))

    def test_database_url_uses_the_psycopg_driver(self):
        settings = Settings(db_host="db.example", db_port=5432, db_name="market", db_user="reader")

        self.assertTrue(settings.database_url.startswith("postgresql+psycopg://"))
        self.assertTrue(settings.database_url.endswith("@db.example:5432/market"))

    def test_database_url_escapes_credentials(self):
        settings = Settings(db_user="read/er", db_password="p@ss word")  # nosec B106 - test fixture, not a credential

        self.assertIn("read%2Fer:p%40ss+word@", settings.database_url)


class TestGetSettings(unittest.TestCase):
    """Tests for the cached settings accessor."""

    def tearDown(self):
        get_settings.cache_clear()

    def test_settings_are_parsed_once(self):
        get_settings.cache_clear()

        self.assertIs(get_settings(), get_settings())


if __name__ == "__main__":
    unittest.main()
