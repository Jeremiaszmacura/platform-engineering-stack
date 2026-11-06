"""Translation of failures into the contract's single error shape.

The only place where domain errors and HTTP status codes meet, so routes and
the application layer never mention status codes. Request validation is handled
here too: FastAPI's default 422 body is a list of pydantic errors, which would
make one endpoint answer failures in two different shapes depending on which
one occurred. ``ErrorResponse`` in ``openapi.yaml`` is the one shape, so
validation errors are flattened into it.

Each handler is annotated with the error it handles rather than with
``Exception``; the exception middleware dispatches on the class the handler is
registered under, so the narrower signature costs nothing and documents itself.
"""

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
    """Install a handler for every failure the service answers with a body.

    Args:
        app: Application to install the handlers on.
    """
    app.add_exception_handler(RequestValidationError, handle_request_validation_error)
    app.add_exception_handler(SymbolNotFoundError, handle_symbol_not_found)
    app.add_exception_handler(ProviderError, handle_provider_error)
    app.add_exception_handler(RepositoryError, handle_repository_error)
    app.add_exception_handler(SecretNotFoundError, handle_secret_not_found)
    app.add_exception_handler(SecretStoreError, handle_secret_store_error)


def describe_validation_error(item: dict) -> str:
    """Describe one pydantic validation error as a single sentence.

    Args:
        item: One entry of ``RequestValidationError.errors()``.

    Returns:
        The offending parameter and why it was rejected, e.g.
        ``"start: Field required"``. The first element of ``loc`` is dropped: it
        names the part of the request ("query", "path"), which the parameter
        name already implies.
    """
    location = ".".join(str(part) for part in item["loc"][1:])
    return f"{location}: {item['msg']}" if location else item["msg"]


def handle_request_validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
    """Return 422 for a request the declared parameter schemas rejected.

    Args:
        request: Request that failed validation.
        error: The raised RequestValidationError.

    Returns:
        A 422 JSON response in the contract's error shape.
    """
    detail = "; ".join(describe_validation_error(item) for item in error.errors())
    logger.info(f"Request rejected: {detail}")
    return JSONResponse(status_code=422, content={"detail": detail})


def handle_symbol_not_found(request: Request, error: SymbolNotFoundError) -> JSONResponse:
    """Return 404 for a symbol the provider does not know.

    Args:
        request: Request that raised the error.
        error: The raised SymbolNotFoundError.

    Returns:
        A 404 JSON response.
    """
    logger.info(f"Symbol not found: {error}")
    return JSONResponse(status_code=404, content={"detail": "symbol not found"})


def handle_provider_error(request: Request, error: ProviderError) -> JSONResponse:
    """Return 502 when the upstream market data provider failed.

    Args:
        request: Request that raised the error.
        error: The raised ProviderError.

    Returns:
        A 502 JSON response.
    """
    logger.error(f"Market data provider failed: {error}")
    return JSONResponse(status_code=502, content={"detail": "market data provider request failed"})


def handle_repository_error(request: Request, error: RepositoryError) -> JSONResponse:
    """Return 503 when the price bar store is unavailable.

    Args:
        request: Request that raised the error.
        error: The raised RepositoryError.

    Returns:
        A 503 JSON response.
    """
    logger.error(f"Price bar store failed: {error}")
    return JSONResponse(status_code=503, content={"detail": "price bar store unavailable"})


def handle_secret_not_found(request: Request, error: SecretNotFoundError) -> JSONResponse:
    """Return 404 for a key holding no secret.

    Args:
        request: Request that raised the error.
        error: The raised SecretNotFoundError.

    Returns:
        A 404 JSON response.
    """
    logger.info(f"Secret not found: {error}")
    return JSONResponse(status_code=404, content={"detail": "secret not found"})


def handle_secret_store_error(request: Request, error: SecretStoreError) -> JSONResponse:
    """Return 502 when the secret store failed.

    Args:
        request: Request that raised the error.
        error: The raised SecretStoreError.

    Returns:
        A 502 JSON response.
    """
    logger.error(f"Secret store failed: {error}")
    return JSONResponse(status_code=502, content={"detail": "secret store request failed"})
