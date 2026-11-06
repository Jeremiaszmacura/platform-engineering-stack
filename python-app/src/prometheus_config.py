"""Prometheus metrics and the middleware that records them for every request."""

import time

from fastapi import Request
from prometheus_client import Counter, Histogram
from starlette.middleware.base import BaseHTTPMiddleware

# Endpoints hit by probes and scrapers; tracked apart so they don't skew app metrics
MONITORING_ENDPOINTS = ("/metrics", "/health")

# Application metrics; MONITORING_ENDPOINTS are excluded
REQUEST_COUNT = Counter("http_requests_total", "Total number of HTTP requests", ["method", "endpoint", "status_code"])
REQUEST_DURATION = Histogram(
    "http_request_duration_seconds", "HTTP request duration in seconds", ["method", "endpoint"]
)
RESPONSE_STATUS = Counter("http_responses_by_status_total", "HTTP responses by status code", ["status_class"])

# Hits on MONITORING_ENDPOINTS, labeled by simplified user agent (e.g. "Prometheus")
MONITORING_REQUESTS = Counter(
    "monitoring_requests_total", "Total number of monitoring/metrics requests", ["endpoint", "user_agent"]
)


class PrometheusMiddleware(BaseHTTPMiddleware):
    """Records request count, latency and status class for every request."""

    async def dispatch(self, request: Request, call_next):
        """Run the request, then record its metrics.

        Args:
            request: Incoming HTTP request.
            call_next: Callable that runs the rest of the app.

        Returns:
            The response produced by the app.
        """
        start_time = time.perf_counter()
        response = await call_next(request)
        duration = time.perf_counter() - start_time

        # Matched route path; a constant for unmatched paths keeps label
        # cardinality bounded (bot probes/404 scans must not mint new series)
        route = request.scope.get("route")
        endpoint = route.path if route else "unmatched"

        if endpoint in MONITORING_ENDPOINTS:
            user_agent = request.headers.get("user-agent", "unknown")
            MONITORING_REQUESTS.labels(endpoint=endpoint, user_agent=user_agent.split("/")[0]).inc()
            return response

        status_code = str(response.status_code)
        REQUEST_COUNT.labels(method=request.method, endpoint=endpoint, status_code=status_code).inc()
        REQUEST_DURATION.labels(method=request.method, endpoint=endpoint).observe(duration)
        RESPONSE_STATUS.labels(status_class=f"{status_code[0]}XX").inc()
        return response
