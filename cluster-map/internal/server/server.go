// Package server serves the cluster map page, its JSON, health and metrics.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"cluster-map/internal/cluster"
	"cluster-map/internal/topology"
)

type mapSource interface {
	Map(ctx context.Context) (topology.Map, error)
	Ready() bool
}

// New returns the handler for /, /api/map, /health and /metrics.
func New(source mapSource, page fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /", http.FileServerFS(page))
	mux.Handle("GET /metrics", promhttp.Handler())
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		if !source.Ready() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "syncing"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "healthy"})
	})
	mux.HandleFunc("GET /api/map", func(w http.ResponseWriter, r *http.Request) {
		m, err := source.Map(r.Context())
		switch {
		case errors.Is(err, cluster.ErrNotSynced):
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		case err != nil:
			slog.Error("build map", "error", err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		default:
			writeJSON(w, http.StatusOK, m)
		}
	})
	return mux
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("write response", "error", err)
	}
}
