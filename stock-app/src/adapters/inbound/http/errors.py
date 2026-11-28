"""Map domain errors and request validation errors to the contract's ErrorResponse."""

import logging
from http import HTTPStatus
from typing import Any, cast

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

# Domain error -> (status, response detail, log level).
DOMAIN_ERROR_RESPONSES: dict[type[Exception], tuple[HTTPStatus, str, int]] = {
    SymbolNotFoundError: (HTTPStatus.NOT_FOUND, "symbol not found", logging.INFO),
    ProviderError: (HTTPStatus.BAD_GATEWAY, "market data provider request failed", logging.ERROR),
    RepositoryError: (HTTPStatus.SERVICE_UNAVAILABLE, "price bar store unavailable", logging.ERROR),
    SecretNotFoundError: (HTTPStatus.NOT_FOUND, "secret not found", logging.INFO),
    SecretStoreError: (HTTPStatus.BAD_GATEWAY, "secret store request failed", logging.ERROR),
}


def register_exception_handlers(app: FastAPI) -> None:
    """Install the exception handlers on the app."""
    app.add_exception_handler(RequestValidationError, handle_request_validation_error)
    for error_type in DOMAIN_ERROR_RESPONSES:
        app.add_exception_handler(error_type, handle_domain_error)


def describe_validation_error(item: dict[str, Any]) -> str:
    """Return one pydantic error as "<param>: <message>", e.g. "start: Field required"."""
    location = ".".join(str(part) for part in item["loc"][1:])
    message: str = item["msg"]
    return f"{location}: {message}" if location else message


def handle_request_validation_error(request: Request, error: Exception) -> JSONResponse:
    """Return 422 with a single error message instead of FastAPI's error list."""
    del request
    # Registered for RequestValidationError only; Starlette types every handler with Exception.
    items = cast(RequestValidationError, error).errors()
    detail = "; ".join(describe_validation_error(item) for item in items)
    logger.info("Request rejected: %s", detail)
    return JSONResponse(status_code=HTTPStatus.UNPROCESSABLE_ENTITY, content={"detail": detail})


def handle_domain_error(request: Request, error: Exception) -> JSONResponse:
    """Return the status and detail DOMAIN_ERROR_RESPONSES lists for the error's type."""
    del request
    status, detail, level = DOMAIN_ERROR_RESPONSES[type(error)]
    logger.log(level, "%s: %s", detail, error)
    return JSONResponse(status_code=status, content={"detail": detail})
