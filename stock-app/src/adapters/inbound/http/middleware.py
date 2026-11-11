"""HTTP request instrumentation, recording per-request Prometheus metrics."""

import time
from http import HTTPStatus

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from src.observability.metrics import (
    MONITORING_ENDPOINTS,
    MONITORING_REQUESTS,
    REQUEST_COUNT,
    REQUEST_DURATION,
    RESPONSE_STATUS,
)
from src.observability.tracing import current_trace_id


class PrometheusMiddleware(BaseHTTPMiddleware):
    """Counts requests, durations and status classes for every matched route."""

    async def dispatch(self, request: Request, call_next):
        """Time the request and update the HTTP metrics, counting an unhandled exception as a 500."""
        start_time = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            # Starlette's outermost error middleware turns the exception into the 500 the client sees.
            record_request(request, HTTPStatus.INTERNAL_SERVER_ERROR, time.perf_counter() - start_time)
            raise
        record_request(request, response.status_code, time.perf_counter() - start_time)
        return response


def record_request(request: Request, status_code: int, duration: float) -> None:
    """Update the HTTP metrics for one finished request."""
    # Label by route template (keeps {symbol}); unknown paths share one label to bound cardinality.
    route = request.scope.get("route")
    endpoint = route.path if route else "unmatched"
    status = str(int(status_code))

    if endpoint in MONITORING_ENDPOINTS:
        # Simplify the user agent (e.g. "Prometheus" from "Prometheus/2.x.x")
        user_agent = request.headers.get("user-agent", "unknown")
        MONITORING_REQUESTS.labels(endpoint=endpoint, user_agent=user_agent.split("/")[0], status_code=status).inc()
        return

    REQUEST_COUNT.labels(method=request.method, endpoint=endpoint, status_code=status).inc()
    REQUEST_DURATION.labels(method=request.method, endpoint=endpoint).observe(duration, exemplar=trace_exemplar())
    RESPONSE_STATUS.labels(status_class=f"{status[0]}XX").inc()


def trace_exemplar() -> dict[str, str] | None:
    """Return the exemplar linking a latency sample to its trace in Tempo, or None outside a trace."""
    trace_id = current_trace_id()
    return {"trace_id": trace_id} if trace_id else None
