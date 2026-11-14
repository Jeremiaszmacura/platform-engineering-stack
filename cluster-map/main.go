// Command cluster-map serves a live, interactive map of the Kubernetes cluster it runs in.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	gatewayclient "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned"

	"cluster-map/internal/cluster"
	"cluster-map/internal/server"
	"cluster-map/internal/topology"
	"cluster-map/web"
)

func main() {
	if err := run(); err != nil {
		slog.Error("cluster-map stopped", "error", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	clients, version, err := connect()
	if err != nil {
		return err
	}
	watcher := cluster.NewWatcher(clients, cluster.Options{
		ClusterName: os.Getenv("CLUSTER_NAME"),
		Version:     version,
		References:  parseReferences(os.Getenv("REFERENCES")),
	})
	watcher.Start(ctx)

	srv := &http.Server{
		Addr:              ":" + envOr("PORT", "8080"),
		Handler:           server.New(watcher, web.Files),
		ReadHeaderTimeout: 5 * time.Second,
	}
	return serve(ctx, srv)
}

// connect builds the API clients and returns them with the server's version.
func connect() (clients cluster.Clients, version string, err error) {
	config, err := restConfig()
	if err != nil {
		return clients, "", fmt.Errorf("load kubernetes config: %w", err)
	}
	core, err := kubernetes.NewForConfig(config)
	if err != nil {
		return clients, "", fmt.Errorf("create client: %w", err)
	}
	gateway, err := gatewayclient.NewForConfig(config)
	if err != nil {
		return clients, "", fmt.Errorf("create gateway api client: %w", err)
	}
	info, err := core.Discovery().ServerVersion()
	if err != nil {
		return clients, "", fmt.Errorf("read server version: %w", err)
	}
	return cluster.Clients{Core: core, Gateway: gateway}, info.GitVersion, nil
}

// serve runs srv until it fails or ctx is cancelled, then shuts it down gracefully.
func serve(ctx context.Context, srv *http.Server) error {
	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.ListenAndServe() }()
	slog.Info("listening", "addr", srv.Addr)

	select {
	case err := <-serveErr:
		return fmt.Errorf("serve: %w", err)
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	return nil
}

// restConfig uses the pod's ServiceAccount in the cluster and the local kubeconfig outside it.
func restConfig() (*rest.Config, error) {
	config, err := rest.InClusterConfig()
	if err == nil {
		return config, nil
	}
	if !errors.Is(err, rest.ErrNotInCluster) {
		return nil, fmt.Errorf("in-cluster config: %w", err)
	}
	rules := clientcmd.NewDefaultClientConfigLoadingRules()
	config, err = clientcmd.NewNonInteractiveDeferredLoadingClientConfig(rules, &clientcmd.ConfigOverrides{}).ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("kubeconfig: %w", err)
	}
	return config, nil
}

// parseReferences reads "app=address,app=address" pairs.
func parseReferences(raw string) []topology.Reference {
	var refs []topology.Reference
	for pair := range strings.SplitSeq(raw, ",") {
		app, value, ok := strings.Cut(strings.TrimSpace(pair), "=")
		if ok && app != "" && value != "" {
			refs = append(refs, topology.Reference{App: app, Value: value})
		}
	}
	return refs
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
