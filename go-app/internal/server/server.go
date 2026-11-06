package server

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go-app/internal/appmetrics"
	"go-app/internal/handlers"
	"go-app/internal/vaultclient"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

const (
	listenAddr      = ":8080"
	readTimeout     = 10 * time.Second
	writeTimeout    = 10 * time.Second
	shutdownTimeout = 10 * time.Second
)

// StartServer runs the HTTP server on listenAddr and shuts it down gracefully
// when SIGINT or SIGTERM is received.
func StartServer() error {
	srv := &http.Server{
		Addr:         listenAddr,
		Handler:      newRouter(),
		ReadTimeout:  readTimeout,
		WriteTimeout: writeTimeout,
	}

	serveErr := make(chan error, 1)
	go func() {
		serveErr <- srv.ListenAndServe()
	}()
	log.Printf("Starting Go server on %s", listenAddr)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case err := <-serveErr:
		return fmt.Errorf("failed to start server: %w", err)
	case sig := <-quit:
		log.Printf("Received %s, shutting down", sig)
	}

	return shutdownGracefully(srv)
}

// newRouter builds the Gin router with Prometheus middleware and all routes.
func newRouter() *gin.Engine {
	router := gin.Default()                       // Includes Logger and Recovery middleware.
	router.Use(appmetrics.PrometheusMiddleware()) // Custom middleware for Prometheus metrics.

	router.GET("/", handlers.Home)
	router.GET("/health", handlers.HealthCheck)
	router.GET("/metrics", gin.WrapH(promhttp.Handler()))
	router.GET("/error", handlers.Error)
	router.GET("/redirect", handlers.Redirect)

	secrets := handlers.NewSecretsHandler(vaultclient.NewFromEnv())
	router.POST("/secret", secrets.Write)
	router.GET("/secret/:key", secrets.Read)

	return router
}

// shutdownGracefully stops the server, allowing in-flight requests up to
// shutdownTimeout to complete.
func shutdownGracefully(srv *http.Server) error {
	ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		return fmt.Errorf("graceful shutdown failed: %w", err)
	}
	return nil
}
