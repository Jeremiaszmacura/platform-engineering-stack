// Package vaultclient provides a minimal client for Vault's KV v2 secrets
// engine, covering only what the app needs: writing and reading a single
// string value per key.
package vaultclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"time"
)

const (
	defaultAddr = "http://vault-service:8200"

	// defaultSecretPath namespaces this service's secrets within the KV
	// mount, so Vault policies can scope each service to its own path.
	defaultSecretPath = "go-app"

	// mountPath is the KV v2 mount holding all service secrets
	// (services/<service>/<key>), enabled by the vault-configure Job.
	mountPath = "services"

	requestTimeout = 5 * time.Second
)

// ErrSecretNotFound is returned by ReadSecret when no secret exists under the key.
var ErrSecretNotFound = errors.New("secret not found")

// Client talks to a single Vault server using static token authentication,
// storing all secrets under one service-specific path in the KV mount.
type Client struct {
	addr       string
	token      string
	secretPath string
	httpClient *http.Client
}

// New returns a Client for the Vault server at addr authenticating with
// token, keeping secrets under secretPath within the KV mount.
func New(addr, token, secretPath string) *Client {
	return &Client{
		addr:       addr,
		token:      token,
		secretPath: secretPath,
		httpClient: &http.Client{Timeout: requestTimeout},
	}
}

// NewFromEnv returns a Client configured from VAULT_ADDR, VAULT_TOKEN and
// VAULT_SECRET_PATH. Address and path fall back to the in-cluster service and
// this service's own path; the token has no default and must be set.
func NewFromEnv() *Client {
	addr := os.Getenv("VAULT_ADDR")
	if addr == "" {
		addr = defaultAddr
	}
	token := os.Getenv("VAULT_TOKEN")
	secretPath := os.Getenv("VAULT_SECRET_PATH")
	if secretPath == "" {
		secretPath = defaultSecretPath
	}
	return New(addr, token, secretPath)
}

// WriteSecret stores value under key in the KV v2 engine, overwriting any
// existing value.
func (c *Client) WriteSecret(ctx context.Context, key, value string) error {
	payload, err := json.Marshal(map[string]any{"data": map[string]string{"value": value}})
	if err != nil {
		return fmt.Errorf("encode secret payload: %w", err)
	}

	resp, err := c.do(ctx, http.MethodPost, key, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("write secret %q: vault returned status %d", key, resp.StatusCode)
	}
	return nil
}

// ReadSecret returns the value stored under key, or ErrSecretNotFound when
// the key does not exist.
func (c *Client) ReadSecret(ctx context.Context, key string) (string, error) {
	resp, err := c.do(ctx, http.MethodGet, key, nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return "", ErrSecretNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("read secret %q: vault returned status %d", key, resp.StatusCode)
	}

	var body struct {
		Data struct {
			Data map[string]string `json:"data"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("decode secret response: %w", err)
	}

	value, ok := body.Data.Data["value"]
	if !ok {
		return "", fmt.Errorf("secret %q has no value field", key)
	}
	return value, nil
}

// do sends an authenticated request to the KV v2 data endpoint for key
// under the client's service path.
func (c *Client) do(ctx context.Context, method, key string, body io.Reader) (*http.Response, error) {
	endpoint := fmt.Sprintf("%s/v1/%s/data/%s/%s", c.addr, mountPath, c.secretPath, url.PathEscape(key))
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, fmt.Errorf("build vault request: %w", err)
	}
	req.Header.Set("X-Vault-Token", c.token)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call vault: %w", err)
	}
	return resp, nil
}
