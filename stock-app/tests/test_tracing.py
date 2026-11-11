"""Tests for request tracing: sampling, the provider span, log correlation and metric exemplars."""

import logging
import unittest
from datetime import date

from fastapi.testclient import TestClient
from opentelemetry import trace
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind, StatusCode

from src.adapters.inbound.http.deps import get_price_history_service, get_repository
from src.adapters.providers.traced import TracedMarketDataProvider
from src.domain.errors import ProviderError
from src.main import create_app
from src.observability.logging import NO_TRACE_ID, TraceIdFilter
from src.observability.tracing import build_tracer_provider, create_tracer_provider, current_trace_id
from tests.test_routes import BAR, PERIOD_PARAMS, FakeRepository, FakeService

TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
INCOMING_TRACEPARENT = f"00-{TRACE_ID}-00f067aa0ba902b7-01"
OPENMETRICS_ACCEPT = "application/openmetrics-text; version=1.0.0"


class TracingTestCase(unittest.TestCase):
    """Base fixture: a tracer provider that keeps finished spans in memory."""

    def setUp(self):
        self.exporter = InMemorySpanExporter()
        self.tracer_provider = create_tracer_provider(self.exporter)
        self.tracer = self.tracer_provider.get_tracer(__name__)

    def finished_spans(self):
        """Flush the batch processor and return every finished span."""
        self.tracer_provider.force_flush()
        return self.exporter.get_finished_spans()


class TestSampling(TracingTestCase):
    """Only traces that start at an HTTP request are kept."""

    def test_a_server_root_span_is_recorded(self):
        with self.tracer.start_as_current_span("GET /", kind=SpanKind.SERVER):
            pass

        self.assertEqual([span.name for span in self.finished_spans()], ["GET /"])

    def test_a_root_span_outside_a_request_is_dropped(self):
        with self.tracer.start_as_current_span("SELECT", kind=SpanKind.CLIENT):
            pass

        self.assertEqual(self.finished_spans(), ())

    def test_children_of_a_request_are_recorded(self):
        with self.tracer.start_as_current_span("GET /", kind=SpanKind.SERVER):
            with self.tracer.start_as_current_span("SELECT", kind=SpanKind.CLIENT):
                pass

        self.assertEqual({span.name for span in self.finished_spans()}, {"GET /", "SELECT"})

    def test_tracing_is_a_no_op_without_an_endpoint(self):
        self.assertIsInstance(build_tracer_provider(None), trace.NoOpTracerProvider)


class TestTraceId(TracingTestCase):
    """The active trace id reaches log lines."""

    def test_there_is_no_trace_id_outside_a_request(self):
        self.assertIsNone(current_trace_id())

    def test_the_trace_id_is_32_hex_digits_inside_a_request(self):
        with self.tracer.start_as_current_span("GET /", kind=SpanKind.SERVER) as span:
            trace_id = current_trace_id()

        self.assertEqual(trace_id, trace.format_trace_id(span.get_span_context().trace_id))

    def test_log_records_carry_the_trace_id(self):
        record = logging.LogRecord("stock-app", logging.INFO, __file__, 1, "message", None, None)

        with self.tracer.start_as_current_span("GET /", kind=SpanKind.SERVER):
            TraceIdFilter().filter(record)
            trace_id = current_trace_id()

        self.assertEqual(record.trace_id, trace_id)

    def test_log_records_outside_a_request_get_a_placeholder(self):
        record = logging.LogRecord("stock-app", logging.INFO, __file__, 1, "message", None, None)

        TraceIdFilter().filter(record)

        self.assertEqual(record.trace_id, NO_TRACE_ID)


class FakeProvider:
    """Market data provider returning one bar, or raising error."""

    name = "fake"

    def __init__(self, error=None):
        """Create the fake with an optional error to raise."""
        self.error = error

    def fetch_daily_bars(self, symbol, start, end):
        """Return one bar or raise the configured error."""
        if self.error is not None:
            raise self.error
        return [BAR]

    def fetch_instrument(self, symbol):
        """Not used by these tests."""
        raise NotImplementedError


class TestTracedProvider(TracingTestCase):
    """Provider calls become CLIENT spans inside the request's trace."""

    def fetch_in_request(self, provider):
        """Fetch bars through a traced provider inside a request span; return the provider span."""
        traced = TracedMarketDataProvider(provider, self.tracer)
        with self.tracer.start_as_current_span("GET /", kind=SpanKind.SERVER):
            try:
                traced.fetch_daily_bars("AAPL", date(2026, 6, 25), date(2026, 6, 26))
            except ProviderError:
                pass
        return next(span for span in self.finished_spans() if span.kind == SpanKind.CLIENT)

    def test_a_fetch_is_a_client_span_with_symbol_and_bar_count(self):
        span = self.fetch_in_request(FakeProvider())

        self.assertEqual(span.name, "fake fetch_daily_bars")
        self.assertEqual(span.attributes["stock.symbol"], "AAPL")
        self.assertEqual(span.attributes["stock.provider"], "fake")
        self.assertEqual(span.attributes["stock.bar_count"], 1)

    def test_a_failed_fetch_marks_the_span_as_an_error(self):
        span = self.fetch_in_request(FakeProvider(error=ProviderError("down")))

        self.assertEqual(span.status.status_code, StatusCode.ERROR)

    def test_the_wrapper_keeps_the_provider_name(self):
        self.assertEqual(TracedMarketDataProvider(FakeProvider(), self.tracer).name, "fake")


class TestRequestTracing(unittest.TestCase):
    """Each HTTP request is one trace, linked from the latency histogram by an exemplar."""

    @classmethod
    def setUpClass(cls):
        # One app per class: the SQLAlchemy and requests instrumentations are process-wide.
        cls.exporter = InMemorySpanExporter()
        cls.tracer_provider = create_tracer_provider(cls.exporter)
        app = create_app(tracer_provider=cls.tracer_provider)
        app.dependency_overrides[get_price_history_service] = FakeService
        app.dependency_overrides[get_repository] = FakeRepository
        cls.client = TestClient(app)

    def setUp(self):
        self.exporter.clear()

    def finished_spans(self):
        """Flush the batch processor and return every finished span."""
        self.tracer_provider.force_flush()
        return self.exporter.get_finished_spans()

    def server_spans(self):
        """Return the finished SERVER spans."""
        return [span for span in self.finished_spans() if span.kind == SpanKind.SERVER]

    def test_a_request_is_named_by_its_route_template(self):
        self.client.get("/api/v1/instruments/AAPL/bars", params=PERIOD_PARAMS)

        self.assertEqual([span.name for span in self.server_spans()], ["GET /api/v1/instruments/{symbol}/bars"])

    def test_an_incoming_traceparent_continues_the_callers_trace(self):
        self.client.get("/", headers={"traceparent": INCOMING_TRACEPARENT})

        (span,) = self.server_spans()
        self.assertEqual(trace.format_trace_id(span.context.trace_id), TRACE_ID)

    def test_probes_and_scrapes_are_not_traced(self):
        self.client.get("/metrics")
        self.client.get("/health")

        self.assertEqual(self.server_spans(), [])

    def test_the_latency_histogram_links_to_the_trace(self):
        self.client.get("/", headers={"traceparent": INCOMING_TRACEPARENT})

        response = self.client.get("/metrics", headers={"accept": OPENMETRICS_ACCEPT})

        self.assertTrue(response.headers["content-type"].startswith("application/openmetrics-text"))
        self.assertIn(f'# {{trace_id="{TRACE_ID}"}}', response.text)

    def test_plain_text_metrics_remain_the_default(self):
        response = self.client.get("/metrics")

        self.assertTrue(response.headers["content-type"].startswith("text/plain"))
