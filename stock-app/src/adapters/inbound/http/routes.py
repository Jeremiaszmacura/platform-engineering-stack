"""HTTP routes: one handler per operation declared in ``openapi.yaml``.

Each handler names the ``operation_id`` it implements and returns a model
generated from the contract, so the wire format is not restated here.
``tests/test_openapi_contract.py`` fails if the routes and the contract ever
stop describing the same API.

Every handler is ``def`` rather than ``async def``: yfinance and SQLAlchemy
Core are both synchronous, so FastAPI runs the handlers in its threadpool and
the event loop is never blocked.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from src.adapters.inbound.http.deps import get_price_history_service, get_repository, get_secret_store
from src.adapters.inbound.http.mappers import (
    to_instrument_response,
    to_price_history_response,
    to_price_summary_response,
)
from src.adapters.inbound.http.models import (
    HealthStatus,
    InstrumentResponse,
    PriceHistoryResponse,
    PriceSummaryResponse,
    SecretRequest,
    SecretResponse,
    ServiceIdentity,
    StoredSecretResponse,
)
from src.adapters.inbound.http.params import Period, SecretKeyPath, SymbolPath
from src.application.ports import PriceBarRepository, SecretStore
from src.application.price_history import PriceHistoryService
from src.observability.logging import logger

API_PREFIX = "/api/v1"

router = APIRouter()

Repository = Annotated[PriceBarRepository, Depends(get_repository)]
History = Annotated[PriceHistoryService, Depends(get_price_history_service)]
Secrets = Annotated[SecretStore, Depends(get_secret_store)]


@router.get("/", operation_id="getServiceIdentity")
def get_service_identity() -> ServiceIdentity:
    """Identify the service.

    Returns:
        The service name.
    """
    return ServiceIdentity(service="stock-app")


@router.get("/health", operation_id="getHealth")
def get_health(repository: Repository, response: Response) -> HealthStatus:
    """Report readiness, which for this service means a reachable database.

    Args:
        repository: Price bar store to probe.
        response: Response whose status is lowered to 503 when the store is
            unreachable, so the pod leaves the Service instead of answering
            requests it cannot serve.

    Returns:
        The readiness of the service and of its store.
    """
    if repository.check_health():
        return HealthStatus(status="healthy", database="reachable")
    logger.error("Health check failed: database unreachable")
    response.status_code = 503
    return HealthStatus(status="unhealthy", database="unreachable")


@router.get("/metrics", operation_id="getMetrics")
def get_metrics() -> Response:
    """Expose Prometheus metrics in text exposition format.

    Returns:
        The metrics payload under the Prometheus content type.
    """
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@router.post("/secret", operation_id="storeSecret", status_code=201)
def store_secret(secret: SecretRequest, store: Secrets) -> StoredSecretResponse:
    """Store a secret under this service's path in the cluster's secret store.

    Args:
        secret: Key and value to store.
        store: Secret store to write to.

    Returns:
        The key that was written. The value is deliberately not echoed back.
    """
    logger.info(f"Storing secret under key {secret.key}")
    store.write_secret(secret.key, secret.value)
    return StoredSecretResponse(key=secret.key, status="stored")


@router.get("/secret/{key}", operation_id="readSecret")
def read_secret(key: SecretKeyPath, store: Secrets) -> SecretResponse:
    """Return a secret stored under this service's path.

    Args:
        key: Key to read.
        store: Secret store to read from.

    Returns:
        The key and its stored value.
    """
    logger.info(f"Reading secret under key {key}")
    return SecretResponse(key=key, value=store.read_secret(key))


@router.get(API_PREFIX + "/instruments", operation_id="listInstruments")
def list_instruments(service: History) -> list[InstrumentResponse]:
    """List every instrument held locally, with the date window synced for it.

    Args:
        service: Price history use case.

    Returns:
        All known instruments, ordered by symbol.
    """
    return [to_instrument_response(instrument) for instrument in service.list_instruments()]


@router.get(API_PREFIX + "/instruments/{symbol}/bars", operation_id="getPriceHistory")
def get_price_history(symbol: SymbolPath, period: Period, service: History) -> PriceHistoryResponse:
    """Return daily bars for a symbol, fetching any part not held locally.

    Args:
        symbol: Ticker symbol.
        period: Validated inclusive session-date range.
        service: Price history use case.

    Returns:
        The bars held for the range, with the source they were served from.
    """
    logger.info(f"Bars requested for {symbol} over {period.start}..{period.end}")
    return to_price_history_response(service.get_price_history(symbol, period))


@router.get(API_PREFIX + "/instruments/{symbol}/summary", operation_id="getPriceSummary")
def get_price_summary(symbol: SymbolPath, period: Period, service: History) -> PriceSummaryResponse:
    """Return aggregate statistics for a symbol over a period.

    Args:
        symbol: Ticker symbol.
        period: Validated inclusive session-date range.
        service: Price history use case.

    Returns:
        The period statistics.

    Raises:
        HTTPException: 404 when the period holds no trading sessions.
    """
    logger.info(f"Summary requested for {symbol} over {period.start}..{period.end}")
    summary = service.get_price_summary(symbol, period)
    if summary is None:
        raise HTTPException(status_code=404, detail="no bars in the requested range")
    return to_price_summary_response(summary)
