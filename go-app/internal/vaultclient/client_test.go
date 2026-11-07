package vaultclient

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// newTestServer returns a Client pointed at a fake Vault running handler.
func newTestServer(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return New(server.URL, "test-token", "go-app")
}

func TestWriteSecretSendsTokenAndPayload(t *testing.T) {
	var gotPath, gotToken string
	var gotBody map[string]map[string]string

	client := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotToken = r.Header.Get("X-Vault-Token")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	})

	if err := client.WriteSecret(context.Background(), "api-key", "hunter2"); err != nil {
		t.Fatalf("WriteSecret returned error: %v", err)
	}
	if gotPath != "/v1/services/data/go-app/api-key" {
		t.Errorf("got path %q, want /v1/services/data/go-app/api-key", gotPath)
	}
	if gotToken != "test-token" {
		t.Errorf("got token %q, want test-token", gotToken)
	}
	if gotBody["data"]["value"] != "hunter2" {
		t.Errorf("got body %v, want data.value=hunter2", gotBody)
	}
}

func TestWriteSecretReturnsErrorOnServerFailure(t *testing.T) {
	client := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})

	if err := client.WriteSecret(context.Background(), "api-key", "hunter2"); err == nil {
		t.Fatal("WriteSecret returned nil error, want failure")
	}
}

func TestReadSecretReturnsStoredValue(t *testing.T) {
	client := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/services/data/go-app/api-key" {
			t.Errorf("got path %q, want /v1/services/data/go-app/api-key", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"data": {"data": {"value": "hunter2"}}}`))
	})

	value, err := client.ReadSecret(context.Background(), "api-key")
	if err != nil {
		t.Fatalf("ReadSecret returned error: %v", err)
	}
	if value != "hunter2" {
		t.Errorf("got value %q, want hunter2", value)
	}
}

func TestReadSecretReturnsErrSecretNotFound(t *testing.T) {
	client := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	if _, err := client.ReadSecret(context.Background(), "missing"); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("got error %v, want ErrSecretNotFound", err)
	}
}

func TestReadSecretReturnsErrorOnMissingValueField(t *testing.T) {
	client := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data": {"data": {"other": "x"}}}`))
	})

	if _, err := client.ReadSecret(context.Background(), "api-key"); err == nil {
		t.Fatal("ReadSecret returned nil error, want failure")
	}
}
