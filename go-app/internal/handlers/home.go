package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Home returns basic service information as JSON.
func Home(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"message":   "Hello from Go App",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"service":   "go-app",
	})
}
