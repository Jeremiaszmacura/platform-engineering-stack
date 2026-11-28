"""Map domain errors and request validation errors to the contract's ErrorResponse."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from src.domain.errors import (
    ProviderError,
    RepositoryError,
    SecretNotFoundError,
    SecretStoreError,
    SymbolNotFoundError,
)
from src.observability.logging import logger


def register_exception_handlers(app: FastAPI) -> None:
    """Install the exception handlers on the app."""
    app.add_exception_handler(RequestValidationError, handle_request_validation_error)
    app.add_exception_handler(SymbolNotFoundError, handle_symbol_not_found)
    app.add_exception_handler(ProviderError, handle_provider_error)
    app.add_exception_handler(RepositoryError, handle_repository_error)
    app.add_exception_handler(SecretNotFoundError, handle_secret_not_found)
    app.add_exception_handler(SecretStoreError, handle_secret_store_error)


def describe_validation_error(item: dict) -> str:
    """Return one pydantic error as "<param>: <message>", e.g. "start: Field required"."""
    location = ".".join(str(part) for part in item["loc"][1:])
    message = item["msg"]
    return f"{location}: {message}" if location else message


def handle_request_validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
    """Return 422 with a single error message instead of FastAPI's error list."""
    del request
    detail = "; ".join(describe_validation_error(item) for item in error.errors())
    logger.info("Request rejected: %s", detail)
    return JSONResponse(status_code=422, content={"detail": detail})


def handle_symbol_not_found(request: Request, error: SymbolNotFoundError) -> JSONResponse:
    """Return 404 for an unknown symbol."""
    del request
    logger.info("Symbol not found: %s", error)
    return JSONResponse(status_code=404, content={"detail": "symbol not found"})


def handle_provider_error(request: Request, error: ProviderError) -> JSONResponse:
    """Return 502 when the market data provider failed."""
    del request
    logger.error("Market data provider failed: %s", error)
    return JSONResponse(status_code=502, content={"detail": "market data provider request failed"})


def handle_repository_error(request: Request, error: RepositoryError) -> JSONResponse:
    """Return 503 when the database is unavailable."""
    del request
    logger.error("Price bar store failed: %s", error)
    return JSONResponse(status_code=503, content={"detail": "price bar store unavailable"})


def handle_secret_not_found(request: Request, error: SecretNotFoundError) -> JSONResponse:
    """Return 404 for a missing secret."""
    del request
    logger.info("Secret not found: %s", error)
    return JSONResponse(status_code=404, content={"detail": "secret not found"})


def handle_secret_store_error(request: Request, error: SecretStoreError) -> JSONResponse:
    """Return 502 when Vault failed."""
    del request
    logger.error("Secret store failed: %s", error)
    return JSONResponse(status_code=502, content={"detail": "secret store request failed"})
