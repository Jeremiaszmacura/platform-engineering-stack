package appmetrics

import (
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// Application metrics; /metrics and /health are excluded.
	requestCount = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests",
		},
		[]string{"method", "endpoint", "status_code"},
	)

	requestDuration = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request duration in seconds",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "endpoint"},
	)

	responseStatus = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_responses_by_status_total",
			Help: "HTTP responses by status code",
		},
		[]string{"status_class"},
	)

	// Separate metric for monitoring requests
	monitoringRequests = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "monitoring_requests_total",
			Help: "Total number of monitoring/metrics requests",
		},
		[]string{"endpoint", "user_agent"},
	)
)

// PrometheusMiddleware records request metrics. /metrics and /health hits go
// to monitoring_requests_total only, so probes don't skew app metrics.
func PrometheusMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		// Process request
		c.Next()

		// Calculate duration
		duration := time.Since(start).Seconds()

		// Label with the matched route template; a constant for unmatched routes
		// keeps label cardinality bounded (bot probes must not mint new series)
		endpoint := c.FullPath()
		if endpoint == "" {
			endpoint = "unmatched"
		}
		method := c.Request.Method
		statusCode := strconv.Itoa(c.Writer.Status())
		userAgent := c.GetHeader("User-Agent")

		// Track metrics differently for app vs monitoring endpoints
		isMonitoring := endpoint == "/metrics" || endpoint == "/health"
		if isMonitoring {
			// Extract simplified user agent (e.g., "Prometheus" from "Prometheus/2.x.x")
			simplifiedUA := userAgent
			if strings.Contains(userAgent, "/") {
				simplifiedUA = strings.Split(userAgent, "/")[0]
			}
			if simplifiedUA == "" {
				simplifiedUA = "unknown"
			}
			monitoringRequests.WithLabelValues(endpoint, simplifiedUA).Inc()
		} else {
			// Application metrics
			requestCount.WithLabelValues(method, endpoint, statusCode).Inc()
			requestDuration.WithLabelValues(method, endpoint).Observe(duration)

			// Status class (2XX, 3XX, 4XX, 5XX)
			statusClass := string(statusCode[0]) + "XX"
			responseStatus.WithLabelValues(statusClass).Inc()
		}
	}
}
