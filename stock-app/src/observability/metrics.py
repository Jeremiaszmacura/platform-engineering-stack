"""Prometheus metrics for stock-app.

Label values must come from a small fixed set, never straight from a request (symbol, header, HTTP method):
each new value is a series the app keeps until it restarts.
"""

from enum import StrEnum

from prometheus_client import Counter, Histogram

REQUEST_COUNT = Counter("http_requests_total", "Total number of HTTP requests", ["method", "endpoint", "status_code"])

REQUEST_DURATION = Histogram(
    "http_request_duration_seconds", "HTTP request duration in seconds", ["method", "endpoint"]
)

RESPONSE_STATUS = Counter("http_responses_by_status_total", "HTTP responses by status code", ["status_class"])

MONITORING_REQUESTS = Counter(
    "monitoring_requests_total", "Total number of monitoring/metrics requests", ["endpoint", "status_code"]
)

# Service-specific instrumentation: the cache-aside pipeline.
PROVIDER_REQUESTS = Counter(
    "stock_provider_requests_total", "Calls made to a market data provider", ["provider", "outcome"]
)

PROVIDER_DURATION = Histogram(
    "stock_provider_request_duration_seconds", "Market data provider call duration in seconds", ["provider"]
)

CACHE_LOOKUPS = Counter("stock_cache_lookups_total", "Price history lookups by cache outcome", ["outcome"])

BARS_UPSERTED = Counter("stock_bars_upserted_total", "Price bars written to the store", ["provider"])

ROWS_REJECTED = Counter(
    "stock_provider_rows_rejected_total",
    "Provider rows dropped for violating a domain invariant",
    ["provider", "reason"],
)

MONITORING_ENDPOINTS = ("/metrics", "/health")


class CacheOutcome(StrEnum):
    """How a price history lookup was served."""

    HIT = "hit"
    MISS = "miss"
    REFRESH = "refresh"


class ProviderOutcome(StrEnum):
    """Result of a single market data provider call."""

    SUCCESS = "success"
    NOT_FOUND = "not_found"
    ERROR = "error"


class RejectionReason(StrEnum):
    """Why a provider row could not be turned into a domain object."""

    VALIDATION = "validation"
    MALFORMED = "malformed"


def register_provider(provider: str) -> None:
    """Create zero-valued series for a provider, so they exist before the first call."""
    for outcome in ProviderOutcome:
        PROVIDER_REQUESTS.labels(provider=provider, outcome=outcome.value)
    for reason in RejectionReason:
        ROWS_REJECTED.labels(provider=provider, reason=reason.value)
    PROVIDER_DURATION.labels(provider=provider)
    BARS_UPSERTED.labels(provider=provider)


def record_cache_lookup(outcome: CacheOutcome) -> None:
    """Count one price history lookup by cache outcome."""
    CACHE_LOOKUPS.labels(outcome=outcome.value).inc()


def record_provider_call(provider: str, outcome: ProviderOutcome, duration_seconds: float) -> None:
    """Count one provider call and record its duration."""
    PROVIDER_REQUESTS.labels(provider=provider, outcome=outcome.value).inc()
    PROVIDER_DURATION.labels(provider=provider).observe(duration_seconds)


def record_rejected_row(provider: str, reason: RejectionReason) -> None:
    """Count one provider row dropped by validation."""
    ROWS_REJECTED.labels(provider=provider, reason=reason.value).inc()


def record_bars_upserted(provider: str, count: int) -> None:
    """Count bars written to the store."""
    BARS_UPSERTED.labels(provider=provider).inc(count)


for _outcome in CacheOutcome:
    CACHE_LOOKUPS.labels(outcome=_outcome.value)
