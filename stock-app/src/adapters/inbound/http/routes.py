"""HTTP routes, one per operation in openapi.yaml.

Handlers are sync (def) because yfinance and SQLAlchemy Core are; FastAPI runs them in a threadpool.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from prometheus_client import REGISTRY
from prometheus_client.exposition import choose_encoder

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
    """Return the service name."""
    return ServiceIdentity(service="stock-app")


@router.get("/health", operation_id="getHealth")
def get_health(repository: Repository, response: Response) -> HealthStatus:
    """Report readiness; answer 503 when the database is unreachable."""
    if repository.check_health():
        return HealthStatus(status="healthy", database="reachable")
    logger.error("Health check failed: database unreachable")
    response.status_code = 503
    return HealthStatus(status="unhealthy", database="unreachable")


@router.get("/metrics", operation_id="getMetrics")
def get_metrics(request: Request) -> Response:
    """Return metrics as text, or as OpenMetrics (which carries trace exemplars) when the scraper accepts it."""
    encoder, content_type = choose_encoder(request.headers.get("accept", ""))
    return Response(encoder(REGISTRY), media_type=content_type)


@router.post("/secret", operation_id="storeSecret", status_code=201)
def store_secret(secret: SecretRequest, store: Secrets) -> StoredSecretResponse:
    """Store a secret in Vault; the value is not echoed back."""
    logger.info(f"Storing secret under key {secret.key}")
    store.write_secret(secret.key, secret.value)
    return StoredSecretResponse(key=secret.key, status="stored")


@router.get("/secret/{key}", operation_id="readSecret")
def read_secret(key: SecretKeyPath, store: Secrets) -> SecretResponse:
    """Return a stored secret."""
    logger.info(f"Reading secret under key {key}")
    return SecretResponse(key=key, value=store.read_secret(key))


@router.get(API_PREFIX + "/instruments", operation_id="listInstruments")
def list_instruments(service: History) -> list[InstrumentResponse]:
    """List stored instruments with their synced windows."""
    return [to_instrument_response(instrument) for instrument in service.list_instruments()]


@router.get(API_PREFIX + "/instruments/{symbol}/bars", operation_id="getPriceHistory")
def get_price_history(symbol: SymbolPath, period: Period, service: History) -> PriceHistoryResponse:
    """Return daily bars for a symbol, fetching any missing part from the provider."""
    logger.info(f"Bars requested for {symbol} over {period.start}..{period.end}")
    return to_price_history_response(service.get_price_history(symbol, period))


@router.get(API_PREFIX + "/instruments/{symbol}/summary", operation_id="getPriceSummary")
def get_price_summary(symbol: SymbolPath, period: Period, service: History) -> PriceSummaryResponse:
    """Return period statistics for a symbol; 404 when the period has no sessions."""
    logger.info(f"Summary requested for {symbol} over {period.start}..{period.end}")
    summary = service.get_price_summary(symbol, period)
    if summary is None:
        raise HTTPException(status_code=404, detail="no bars in the requested range")
    return to_price_summary_response(summary)
