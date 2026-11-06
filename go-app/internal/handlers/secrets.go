package handlers

import (
	"context"
	"errors"
	"net/http"
	"regexp"

	"go-app/internal/vaultclient"

	"github.com/gin-gonic/gin"
)

// validKey is the key format both backends accept: letters, digits, '_', '.', '-'.
var validKey = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)

// secretStore is the subset of the Vault client the handlers need.
type secretStore interface {
	WriteSecret(ctx context.Context, key, value string) error
	ReadSecret(ctx context.Context, key string) (string, error)
}

// SecretsHandler serves the /secret endpoints backed by Vault.
type SecretsHandler struct {
	store secretStore
}

// NewSecretsHandler returns a SecretsHandler storing secrets in store.
func NewSecretsHandler(store secretStore) *SecretsHandler {
	return &SecretsHandler{store: store}
}

// secretRequest is the request body for storing a secret.
type secretRequest struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// Write stores the secret from the request body in Vault.
// It answers 422 when the key or value is missing or invalid.
func (h *SecretsHandler) Write(c *gin.Context) {
	var req secretRequest
	if err := c.ShouldBindJSON(&req); err != nil || !validKey.MatchString(req.Key) || req.Value == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "key (letters, digits, _ . -) and non-empty value are required"})
		return
	}

	if err := h.store.WriteSecret(c.Request.Context(), req.Key, req.Value); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "vault request failed"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"key": req.Key, "status": "stored"})
}

// Read returns the secret stored in Vault under the key path parameter.
func (h *SecretsHandler) Read(c *gin.Context) {
	key := c.Param("key")

	value, err := h.store.ReadSecret(c.Request.Context(), key)
	if errors.Is(err, vaultclient.ErrSecretNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "secret not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "vault request failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"key": key, "value": value})
}
