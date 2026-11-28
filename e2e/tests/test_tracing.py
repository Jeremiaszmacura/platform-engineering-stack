"""End-to-end tests of request tracing: stock-app -> OpenTelemetry Collector -> Tempo -> Grafana, and exemplars.

Each test sends its own W3C traceparent, so it knows the trace id to look up. Tempo has no HTTPRoute; it is
queried through Grafana's datasource proxy, which also proves the datasource is wired.
"""

import secrets
import time
import uuid
from collections.abc import Callable
from typing import Any, NamedTuple

import requests

from cluster import (
    JsonObject,
    GRAFANA_CREDENTIALS,
    GRAFANA_URL,
    METRICS_PIPELINE_TIMEOUT_SECONDS,
    PROMETHEUS_URL,
    REQUEST_TIMEOUT_SECONDS,
    STOCK_APP_URL,
    wait_until,
)

TEMPO_VIA_GRAFANA_URL = f"{GRAFANA_URL}/api/datasources/proxy/uid/tempo"
# The SDK exports in batches every 5 s.
TRACE_TIMEOUT_SECONDS = 30
EXEMPLAR_WINDOW_SECONDS = 600

SERVER = "SPAN_KIND_SERVER"
CLIENT = "SPAN_KIND_CLIENT"


class Span(NamedTuple):
    """One span from Tempo, with the attributes of the service (resource) that sent it."""

    kind: str
    name: str
    attributes: dict[str, Any]
    resource: dict[str, Any]


def traced_request(method: str, path: str, **kwargs: Any) -> str:
    """Send a request to stock-app inside a new sampled trace; return the trace id."""
    trace_id = secrets.token_hex(16)
    headers = {"traceparent": f"00-{trace_id}-{secrets.token_hex(8)}-01"}
    response = requests.request(
        method, f"{STOCK_APP_URL}{path}", headers=headers, timeout=REQUEST_TIMEOUT_SECONDS, **kwargs
    )
    assert response.status_code < 300
    return trace_id


def attribute_values(attributes: list[JsonObject]) -> dict[str, Any]:
    """Flatten OTLP JSON attributes ([{key, value: {stringValue: ...}}]) into a dict."""
    return {attribute["key"]: next(iter(attribute["value"].values())) for attribute in attributes}


def fetch_spans(trace_id: str) -> list[Span]:
    """Return the trace's spans, or [] while Tempo has not received it."""
    response = requests.get(
        f"{TEMPO_VIA_GRAFANA_URL}/api/v2/traces/{trace_id}", auth=GRAFANA_CREDENTIALS, timeout=REQUEST_TIMEOUT_SECONDS
    )
    response.raise_for_status()
    # Tempo answers 200 with an empty "trace" object for a trace it has not received yet.
    return [
        Span(
            span["kind"],
            span["name"],
            attribute_values(span.get("attributes", [])),
            attribute_values(resource_spans["resource"]["attributes"]),
        )
        for resource_spans in response.json()["trace"].get("resourceSpans", [])
        for scope_spans in resource_spans["scopeSpans"]
        for span in scope_spans["spans"]
    ]


def wait_for_spans(trace_id: str, is_complete: Callable[[list[Span]], bool]) -> list[Span]:
    """Poll Tempo until the trace's spans satisfy is_complete; return them."""
    found: list[Span] = []

    def check() -> bool:
        found[:] = fetch_spans(trace_id)
        return is_complete(found)

    wait_until(check, TRACE_TIMEOUT_SECONDS, description=f"trace {trace_id} in Tempo")
    return found


def has_server_span(spans: list[Span], name: str) -> bool:
    """Return True if spans include the stock-app request span called name."""
    return any(span.kind == SERVER and span.name == name for span in spans)


def test_a_request_is_traced_with_its_database_queries() -> None:
    """The request span and its SQL queries land in one trace."""
    trace_id = traced_request("GET", "/api/v1/instruments")

    spans = wait_for_spans(
        trace_id,
        lambda spans: has_server_span(spans, "GET /api/v1/instruments")
        and any(span.kind == CLIENT and span.attributes.get("db.system") == "postgresql" for span in spans),
    )

    assert any(span.attributes.get("http.status_code") == "200" for span in spans if span.kind == SERVER)


def test_the_collector_adds_kubernetes_metadata() -> None:
    """Spans reach Tempo through the Collector, which names the pod, deployment and namespace that sent them."""
    trace_id = traced_request("GET", "/")

    spans = wait_for_spans(trace_id, lambda spans: has_server_span(spans, "GET /"))

    assert len(spans) == 1
    span = spans[0]
    assert span.resource["k8s.namespace.name"] == "apps"
    assert span.resource["k8s.deployment.name"] == "stock-app"
    assert span.resource["k8s.pod.name"].startswith("stock-app-")


def test_a_secret_request_traces_the_vault_call() -> None:
    """The outgoing call to Vault is a child span of the request."""
    trace_id = traced_request("POST", "/secret", json={"key": f"e2e-trace-{uuid.uuid4().hex}", "value": "v"})

    wait_for_spans(
        trace_id,
        lambda spans: has_server_span(spans, "POST /secret")
        and any(
            span.kind == CLIENT and span.attributes.get("http.url", "").startswith("http://vault-service.vault:8200/")
            for span in spans
        ),
    )


def count_trace_exemplars() -> int:
    """Return how many recent stock-app latency exemplars carry a trace id."""
    now = time.time()
    params: dict[str, str | float] = {
        "query": 'http_request_duration_seconds_bucket{job="stock-app"}',
        "start": now - EXEMPLAR_WINDOW_SECONDS,
        "end": now,
    }
    response = requests.get(
        f"{PROMETHEUS_URL}/api/v1/query_exemplars",
        params=params,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return sum(
        1 for series in response.json()["data"] for exemplar in series["exemplars"] if "trace_id" in exemplar["labels"]
    )


def test_latency_samples_link_to_traces() -> None:
    """Prometheus stores exemplars that point from the latency histogram to traces."""
    traced_request("GET", "/")

    wait_until(
        lambda: count_trace_exemplars() > 0,
        METRICS_PIPELINE_TIMEOUT_SECONDS,
        description="a stock-app latency exemplar with a trace_id in Prometheus",
    )


def test_grafana_has_tempo_datasource() -> None:
    """Grafana is provisioned with the Tempo datasource the exemplars link to."""
    response = requests.get(
        f"{GRAFANA_URL}/api/datasources/uid/tempo", auth=GRAFANA_CREDENTIALS, timeout=REQUEST_TIMEOUT_SECONDS
    )
    assert response.status_code == 200
    assert response.json()["type"] == "tempo"
