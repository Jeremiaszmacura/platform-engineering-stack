"""Hand the adapters built in main.create_app() to routes (overridable in tests)."""

from fastapi import Request

from src.application.ports import PriceBarRepository, SecretStore
from src.application.price_history import PriceHistoryService


def get_price_history_service(request: Request) -> PriceHistoryService:
    """Return the PriceHistoryService from the app state."""
    return request.app.state.price_history_service


def get_repository(request: Request) -> PriceBarRepository:
    """Return the PriceBarRepository from the app state."""
    return request.app.state.repository


def get_secret_store(request: Request) -> SecretStore:
    """Return the SecretStore from the app state."""
    return request.app.state.secret_store
