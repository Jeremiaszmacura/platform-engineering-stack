package server

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"cluster-map/internal/cluster"
	"cluster-map/internal/topology"
)

type stubSource struct {
	ready bool
	err   error
}

func (s stubSource) Map(context.Context) (topology.Map, error) {
	return topology.Map{Context: "test"}, s.err
}

func (s stubSource) Ready() bool { return s.ready }

func TestRoutes(t *testing.T) {
	page := fstest.MapFS{"index.html": {Data: []byte("<title>Sample Cluster Anatomy</title>")}}
	tests := []struct {
		name       string
		source     stubSource
		path       string
		wantStatus int
		wantBody   string
	}{
		{"page", stubSource{ready: true}, "/", http.StatusOK, "Sample Cluster Anatomy"},
		{"map", stubSource{ready: true}, "/api/map", http.StatusOK, `"context":"test"`},
		{"map while syncing", stubSource{err: cluster.ErrNotSynced}, "/api/map", http.StatusServiceUnavailable, "not synced"},
		{"map api failure", stubSource{ready: true, err: errors.New("forbidden")}, "/api/map", http.StatusBadGateway, "forbidden"},
		{"healthy", stubSource{ready: true}, "/health", http.StatusOK, "healthy"},
		{"syncing", stubSource{}, "/health", http.StatusServiceUnavailable, "syncing"},
		{"metrics", stubSource{}, "/metrics", http.StatusOK, "go_goroutines"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			New(tt.source, page).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tt.path, http.NoBody))
			if rec.Code != tt.wantStatus || !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Errorf("GET %s = %d %q, want %d containing %q", tt.path, rec.Code, rec.Body.String(), tt.wantStatus, tt.wantBody)
			}
		})
	}
}
