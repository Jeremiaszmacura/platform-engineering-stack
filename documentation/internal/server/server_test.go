package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"

	"documentation/internal/cluster"
	"documentation/internal/topology"
)

type stubSource struct {
	ready bool
	err   error
}

func (s stubSource) Map(context.Context) (topology.Map, error) {
	return topology.Map{Context: "test"}, s.err
}

func (s stubSource) Ready() bool { return s.ready }

var site = fstest.MapFS{
	"index.html":        {Data: []byte("<title>Overview</title>")},
	"networking.html":   {Data: []byte("<title>Networking</title>")},
	"assets/js/site.js": {Data: []byte("export {}")},
}

// prometheusStub answers every request with the path and query it received.
func prometheusStub(t *testing.T) *url.URL {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if _, err := w.Write([]byte(`{"status":"success","got":"` + r.URL.RequestURI() + `"}`)); err != nil {
			t.Errorf("write stub response: %v", err)
		}
	}))
	t.Cleanup(upstream.Close)
	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatalf("parse stub url: %v", err)
	}
	return target
}

func get(t *testing.T, handler http.Handler, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(method, path, http.NoBody))
	return rec
}

func TestRoutes(t *testing.T) {
	prometheus := prometheusStub(t)
	tests := []struct {
		name       string
		source     stubSource
		method     string
		path       string
		wantStatus int
		wantBody   string
	}{
		{"home page", stubSource{ready: true}, http.MethodGet, "/", http.StatusOK, "Overview"},
		{"other page", stubSource{ready: true}, http.MethodGet, "/networking.html", http.StatusOK, "Networking"},
		{"asset", stubSource{ready: true}, http.MethodGet, "/assets/js/site.js", http.StatusOK, "export"},
		{"no directory listing", stubSource{ready: true}, http.MethodGet, "/assets/", http.StatusNotFound, ""},
		{"map", stubSource{ready: true}, http.MethodGet, "/api/map", http.StatusOK, `"context":"test"`},
		{"map while syncing", stubSource{err: cluster.ErrNotSynced}, http.MethodGet, "/api/map", http.StatusServiceUnavailable, "not synced"},
		{"map api failure", stubSource{ready: true, err: errors.New("forbidden")}, http.MethodGet, "/api/map", http.StatusBadGateway, "forbidden"},
		{"healthy", stubSource{ready: true}, http.MethodGet, "/health", http.StatusOK, "healthy"},
		{"syncing", stubSource{}, http.MethodGet, "/health", http.StatusServiceUnavailable, "syncing"},
		{"metrics", stubSource{}, http.MethodGet, "/metrics", http.StatusOK, "go_goroutines"},
		{"instant query", stubSource{}, http.MethodGet, "/api/prometheus/api/v1/query?query=up", http.StatusOK,
			`"got":"/api/v1/query?query=up"`},
		{"range query", stubSource{}, http.MethodGet, "/api/prometheus/api/v1/query_range?query=up&step=15", http.StatusOK,
			`"got":"/api/v1/query_range?query=up&step=15"`},
		{"other prometheus api", stubSource{}, http.MethodGet, "/api/prometheus/api/v1/status/config", http.StatusNotFound, ""},
		{"query by post", stubSource{}, http.MethodPost, "/api/prometheus/api/v1/query", http.StatusMethodNotAllowed, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := get(t, New(tt.source, site, prometheus), tt.method, tt.path)
			if rec.Code != tt.wantStatus || !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Errorf("%s %s = %d %q, want %d containing %q", tt.method, tt.path, rec.Code, rec.Body.String(), tt.wantStatus, tt.wantBody)
			}
		})
	}
}

func TestPrometheusDown(t *testing.T) {
	down := &url.URL{Scheme: "http", Host: "127.0.0.1:1"}
	rec := get(t, New(stubSource{}, site, down), http.MethodGet, "/api/prometheus/api/v1/query?query=up")
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "prometheus did not answer") {
		t.Errorf("query with Prometheus down = %d %q, want 502 with an error", rec.Code, rec.Body.String())
	}
}
