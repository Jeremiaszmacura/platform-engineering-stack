"""OpenTelemetry tracing: one trace per HTTP request, exported over OTLP to the OpenTelemetry Collector."""

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanExporter
from opentelemetry.sdk.trace.sampling import Decision, ParentBased, Sampler, SamplingResult

STOCK_APP_SERVICE_NAME = "stock-app"

OTLP_TRACES_PATH = "/v1/traces"


class HttpRequestRootSampler(Sampler):
    """Starts a trace only at an incoming HTTP request (a SERVER span).

    Without it, work outside a request (the readiness probe's database query) would become one-span traces.
    """

    def should_sample(self, parent_context, trace_id, name, kind=None, attributes=None, links=None, trace_state=None):
        """Record SERVER spans and drop every other root span."""
        if kind == trace.SpanKind.SERVER:
            return SamplingResult(Decision.RECORD_AND_SAMPLE, attributes)
        return SamplingResult(Decision.DROP)

    def get_description(self) -> str:
        """Name the sampler (shown in debug output)."""
        return "HttpRequestRootSampler"


def create_tracer_provider(exporter: SpanExporter) -> TracerProvider:
    """Return a provider that batches stock-app's sampled spans to exporter."""
    sampler = ParentBased(root=HttpRequestRootSampler())
    provider = TracerProvider(resource=Resource.create({SERVICE_NAME: STOCK_APP_SERVICE_NAME}), sampler=sampler)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    return provider


def build_tracer_provider(otlp_endpoint: str | None) -> trace.TracerProvider:
    """Return a provider exporting to otlp_endpoint, or a no-op one when tracing is not configured (tests)."""
    if not otlp_endpoint:
        return trace.NoOpTracerProvider()
    return create_tracer_provider(OTLPSpanExporter(endpoint=otlp_endpoint.rstrip("/") + OTLP_TRACES_PATH))


def current_trace_id() -> str | None:
    """Return the active sampled trace's id as 32 hex digits, or None outside a trace."""
    span_context = trace.get_current_span().get_span_context()
    if not span_context.is_valid or not span_context.trace_flags.sampled:
        return None
    return trace.format_trace_id(span_context.trace_id)
