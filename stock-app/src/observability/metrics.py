"""Prometheus instrumentation for stock-app.

Metric definitions live here rather than in an adapter because both the
application layer (cache outcomes) and the adapters (provider calls, upserts,
HTTP requests) report into them. The module deliberately imports no web
framework, so the application layer stays free of adapter dependencies.

No metric is ever labeled by symbol: symbols arrive in request paths from
untrusted callers, so a symbol label would be an unbounded-cardinality denial
of service vector rather than merely untidy.
"""

from enum import StrEnum

from prometheus_client import Counter, Histogram

# Generic HTTP instrumentation, using the same metric names as go-app so
# dashboards can share queries.
REQUEST_COUNT = Counter("http_requests_total", "Total number of HTTP requests", ["method", "endpoint", "status_code"])

REQUEST_DURATION = Histogram(
    "http_request_duration_seconds", "HTTP request duration in seconds", ["method", "endpoint"]
)

RESPONSE_STATUS = Counter("http_responses_by_status_total", "HTTP responses by status code", ["status_class"])

MONITORING_REQUESTS = Counter(
    "monitoring_requests_total", "Total number of monitoring/metrics requests", ["endpoint", "user_agent"]
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
    """Create zero-valued series for every label combination of a provider.

    Counters are invisible until their first increment, which would leave
    dashboards and alerts querying metrics that do not exist yet on a freshly
    started pod.

    Args:
        provider: Provider name used as the ``provider`` label value.
    """
    for outcome in ProviderOutcome:
        PROVIDER_REQUESTS.labels(provider=provider, outcome=outcome.value)
    for reason in RejectionReason:
        ROWS_REJECTED.labels(provider=provider, reason=reason.value)
    PROVIDER_DURATION.labels(provider=provider)
    BARS_UPSERTED.labels(provider=provider)


def record_cache_lookup(outcome: CacheOutcome) -> None:
    """Count one price history lookup.

    Args:
        outcome: Whether the request was served from cache, missed entirely,
            or refreshed the trailing edge.
    """
    CACHE_LOOKUPS.labels(outcome=outcome.value).inc()


def record_provider_call(provider: str, outcome: ProviderOutcome, duration_seconds: float) -> None:
    """Count one provider call and record how long it took.

    Args:
        provider: Provider name.
        outcome: Result of the call.
        duration_seconds: Wall-clock duration of the call.
    """
    PROVIDER_REQUESTS.labels(provider=provider, outcome=outcome.value).inc()
    PROVIDER_DURATION.labels(provider=provider).observe(duration_seconds)


def record_rejected_row(provider: str, reason: RejectionReason) -> None:
    """Count one provider row dropped before it reached the domain.

    Args:
        provider: Provider name.
        reason: Why the row was dropped.
    """
    ROWS_REJECTED.labels(provider=provider, reason=reason.value).inc()


def record_bars_upserted(provider: str, count: int) -> None:
    """Count bars written to the store.

    Args:
        provider: Provider the bars originated from.
        count: Number of bars written.
    """
    BARS_UPSERTED.labels(provider=provider).inc(count)


for _outcome in CacheOutcome:
    CACHE_LOOKUPS.labels(outcome=_outcome.value)
