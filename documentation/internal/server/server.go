// Package server serves the documentation site, its live data from the cluster, health and metrics.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"

	"documentation/internal/cluster"
	"documentation/internal/topology"
)

// prometheusTimeout bounds a proxied query, so a stuck Prometheus can't pile up the page's polls.
const prometheusTimeout = 10 * time.Second

type mapSource interface {
	Map(ctx context.Context) (topology.Map, error)
	Ready() bool
}

// New returns the handler for the site, /api/map, the Prometheus query proxy, /health and /metrics.
func New(source mapSource, site fs.FS, prometheus *url.URL) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /", withoutListings(http.FileServerFS(site)))
	mux.Handle("GET /metrics", promhttp.Handler())
	mux.HandleFunc("GET /health", health(source))
	mux.HandleFunc("GET /api/map", clusterMap(source))
	// Read-only: the two query endpoints, nothing that changes Prometheus or reveals its config.
	queries := http.StripPrefix("/api/prometheus", prometheusProxy(prometheus))
	mux.Handle("GET /api/prometheus/api/v1/query", queries)
	mux.Handle("GET /api/prometheus/api/v1/query_range", queries)
	return mux
}

func health(source mapSource) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		if !source.Ready() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "syncing"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "healthy"})
	}
}

func clusterMap(source mapSource) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
	}
}

// prometheusProxy forwards queries the way Grafana's "proxy" datasource mode does: the browser only talks to
// this service, which reaches Prometheus at its in-cluster address.
func prometheusProxy(target *url.URL) http.Handler {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = prometheusTimeout
	return &httputil.ReverseProxy{
		Rewrite:   func(r *httputil.ProxyRequest) { r.SetURL(target) },
		Transport: transport,
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			slog.Error("query prometheus", "error", err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "prometheus did not answer"})
		},
	}
}

// withoutListings answers 404 for directories, so the file server never lists the site's assets.
func withoutListings(files http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		files.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("write response", "error", err)
	}
}
