package appmetrics

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

// TestMiddlewareLabelsUnmatchedRoutesWithConstant checks unknown paths share the "unmatched" label.
func TestMiddlewareLabelsUnmatchedRoutesWithConstant(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(PrometheusMiddleware())

	counter := requestCount.WithLabelValues(http.MethodGet, "unmatched", "404")
	before := testutil.ToFloat64(counter)

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/some/bot/probe", http.NoBody))

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", recorder.Code)
	}
	if got := testutil.ToFloat64(counter); got != before+1 {
		t.Fatalf("expected unmatched counter to increase by 1, got %v -> %v", before, got)
	}
}
