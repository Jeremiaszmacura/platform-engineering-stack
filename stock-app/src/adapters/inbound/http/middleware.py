"""HTTP request instrumentation, recording per-request Prometheus metrics."""

import time

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from src.observability.metrics import (
    MONITORING_ENDPOINTS,
    MONITORING_REQUESTS,
    REQUEST_COUNT,
    REQUEST_DURATION,
    RESPONSE_STATUS,
)


class PrometheusMiddleware(BaseHTTPMiddleware):
    """Counts requests, durations and status classes for every matched route."""

    async def dispatch(self, request: Request, call_next):
        """Time the request and update the HTTP counters.

        Args:
            request: Incoming request.
            call_next: Downstream ASGI application.

        Returns:
            The downstream response, unmodified.
        """
        start_time = time.time()

        response = await call_next(request)

        process_time = time.time() - start_time

        # Label with the matched route path; a constant for unmatched paths keeps
        # label cardinality bounded (bot probes/404 scans must not mint new series).
        # Route paths keep their {symbol} placeholder, so symbols never become labels.
        route = request.scope.get("route")
        endpoint = route.path if route else "unmatched"
        status_code = str(response.status_code)

        if endpoint in MONITORING_ENDPOINTS:
            # Simplify the user agent (e.g. "Prometheus" from "Prometheus/2.x.x")
            user_agent = request.headers.get("user-agent", "unknown")
            MONITORING_REQUESTS.labels(endpoint=endpoint, user_agent=user_agent.split("/")[0]).inc()
            return response

        REQUEST_COUNT.labels(method=request.method, endpoint=endpoint, status_code=status_code).inc()
        REQUEST_DURATION.labels(method=request.method, endpoint=endpoint).observe(process_time)
        RESPONSE_STATUS.labels(status_class=f"{status_code[0]}XX").inc()
        return response
