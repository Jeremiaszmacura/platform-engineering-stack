"""Composition root: the only module that constructs adapters."""

from datetime import timedelta

from fastapi import FastAPI

from src.adapters.inbound.http.errors import register_exception_handlers
from src.adapters.inbound.http.middleware import PrometheusMiddleware
from src.adapters.inbound.http.routes import router
from src.adapters.inbound.http.spec import load_contract, serve_contract
from src.adapters.persistence.engine import create_database_engine
from src.adapters.persistence.repository import TimescalePriceBarRepository
from src.adapters.providers.fixture import PROVIDER_NAME as FIXTURE, FixtureMarketDataProvider
from src.adapters.providers.yahoo import PROVIDER_NAME as YAHOO, YahooMarketDataProvider
from src.adapters.secrets.vault import VaultSecretStore
from src.application.ports import MarketDataProvider
from src.application.price_history import PriceHistoryService
from src.config import Settings, get_settings
from src.observability.logging import configure_logging, logger


def build_provider(name: str) -> MarketDataProvider:
    """Return the provider named by STOCK_PROVIDER; raise ValueError for an unknown name."""
    if name == YAHOO:
        return YahooMarketDataProvider()
    if name == FIXTURE:
        return FixtureMarketDataProvider()
    raise ValueError(f"unknown market data provider: {name!r}")


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the FastAPI app with its adapters (settings default to the environment)."""
    settings = settings or get_settings()
    configure_logging()

    engine = create_database_engine(settings.database_url)
    repository = TimescalePriceBarRepository(engine)
    provider = build_provider(settings.provider)
    service = PriceHistoryService(provider, repository, timedelta(seconds=settings.stale_after_seconds))
    secret_store = VaultSecretStore(
        settings.vault_addr, settings.vault_token.get_secret_value(), settings.vault_secret_path
    )

    # Title and version come from the contract. openapi_url=None: serve_contract publishes the YAML instead.
    contract = load_contract()
    app = FastAPI(title=contract["info"]["title"], version=contract["info"]["version"], openapi_url=None)
    app.state.repository = repository
    app.state.price_history_service = service
    app.state.secret_store = secret_store
    app.add_middleware(PrometheusMiddleware)
    register_exception_handlers(app)
    serve_contract(app)
    app.include_router(router)

    logger.info(f"stock-app configured with provider '{provider.name}' and database {settings.db_host}")
    return app


app = create_app()
