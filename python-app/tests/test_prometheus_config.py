"""Tests for the Prometheus middleware labels and counters."""

import unittest

from fastapi.testclient import TestClient

from main import app
from prometheus_config import MONITORING_REQUESTS, REQUEST_COUNT, RESPONSE_STATUS


class TestPrometheusMiddleware(unittest.TestCase):
    """Tests for PrometheusMiddleware request instrumentation."""

    def setUp(self):
        self.client = TestClient(app)

    def _counter_value(self, counter, **labels):
        return counter.labels(**labels)._value.get()

    def test_tracked_endpoint_increments_request_and_status_counters(self):
        before_count = self._counter_value(REQUEST_COUNT, method="GET", endpoint="/", status_code="200")
        before_status = self._counter_value(RESPONSE_STATUS, status_class="2XX")

        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self._counter_value(REQUEST_COUNT, method="GET", endpoint="/", status_code="200"), before_count + 1
        )
        self.assertEqual(self._counter_value(RESPONSE_STATUS, status_class="2XX"), before_status + 1)

    def test_health_endpoint_is_excluded_from_request_count_but_tracked_as_monitoring(self):
        before_monitoring = self._counter_value(MONITORING_REQUESTS, endpoint="/health", user_agent="testclient")

        response = self.client.get("/health", headers={"user-agent": "testclient/1.0"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self._counter_value(MONITORING_REQUESTS, endpoint="/health", user_agent="testclient"),
            before_monitoring + 1,
        )

    def test_unmatched_path_is_labeled_with_constant_endpoint(self):
        before = self._counter_value(REQUEST_COUNT, method="GET", endpoint="unmatched", status_code="404")

        response = self.client.get("/no-such-path")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            self._counter_value(REQUEST_COUNT, method="GET", endpoint="unmatched", status_code="404"), before + 1
        )

    def test_metrics_endpoint_is_excluded_from_request_count_but_tracked_as_monitoring(self):
        before_monitoring = self._counter_value(MONITORING_REQUESTS, endpoint="/metrics", user_agent="testclient")

        response = self.client.get("/metrics", headers={"user-agent": "testclient/1.0"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self._counter_value(MONITORING_REQUESTS, endpoint="/metrics", user_agent="testclient"),
            before_monitoring + 1,
        )


if __name__ == "__main__":
    unittest.main()
