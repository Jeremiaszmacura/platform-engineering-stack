"""Dependency accessors for the objects built by the composition root.

The adapters themselves are constructed in ``main.create_app`` and parked on
the application state; these functions only hand them to routes, which keeps
them overridable through ``app.dependency_overrides`` in tests.
"""

from fastapi import Request

from src.application.ports import PriceBarRepository, SecretStore
from src.application.price_history import PriceHistoryService


def get_price_history_service(request: Request) -> PriceHistoryService:
    """Return the price history use case wired up in main.create_app().

    Args:
        request: Incoming request, carrying the application state.

    Returns:
        The process-wide PriceHistoryService.
    """
    return request.app.state.price_history_service


def get_repository(request: Request) -> PriceBarRepository:
    """Return the price bar repository wired up in main.create_app().

    Args:
        request: Incoming request, carrying the application state.

    Returns:
        The process-wide PriceBarRepository.
    """
    return request.app.state.repository


def get_secret_store(request: Request) -> SecretStore:
    """Return the secret store wired up in main.create_app().

    Args:
        request: Incoming request, carrying the application state.

    Returns:
        The process-wide SecretStore.
    """
    return request.app.state.secret_store
