package vault

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// fakeVault accepts role "documentation" with jwt "sa-token" and keeps one KV v2 secret in memory.
func fakeVault(t *testing.T) Secret {
	t.Helper()
	var mu sync.Mutex
	var stored json.RawMessage
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/auth/kubernetes/login", func(w http.ResponseWriter, r *http.Request) {
		var req map[string]string
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Errorf("decode login: %v", err)
		}
		if req["role"] != "documentation" || req["jwt"] != "sa-token" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		reply(t, w, `{"auth":{"client_token":"vault-token"}}`)
	})
	mux.HandleFunc("/v1/services/data/documentation/github", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch {
		case r.Header.Get("X-Vault-Token") != "vault-token":
			w.WriteHeader(http.StatusForbidden)
		case r.Method == http.MethodPost:
			var req struct{ Data json.RawMessage }
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Errorf("decode write: %v", err)
			}
			stored = req.Data
		case stored == nil:
			w.WriteHeader(http.StatusNotFound)
		default:
			reply(t, w, `{"data":{"data":`+string(stored)+`}}`)
		}
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	tokenFile := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(tokenFile, []byte("sa-token\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return Secret{Addr: server.URL, Role: "documentation", TokenFile: tokenFile, Path: "services/data/documentation/github", HTTP: server.Client()}
}

// reply writes body as the response.
func reply(t *testing.T, w http.ResponseWriter, body string) {
	t.Helper()
	if _, err := w.Write([]byte(body)); err != nil {
		t.Errorf("write response: %v", err)
	}
}

func TestWriteThenRead(t *testing.T) {
	secret := fakeVault(t)
	ctx := context.Background()
	var got map[string]string
	if found, err := secret.Read(ctx, &got); err != nil || found {
		t.Fatalf("before write: found %v, err %v", found, err)
	}
	if err := secret.Write(ctx, map[string]string{"access_token": "abc"}); err != nil {
		t.Fatalf("write: %v", err)
	}
	if found, err := secret.Read(ctx, &got); err != nil || !found || got["access_token"] != "abc" {
		t.Fatalf("after write: %v, found %v, err %v", got, found, err)
	}
}

func TestWrongRoleIsAnError(t *testing.T) {
	secret := fakeVault(t)
	secret.Role = "stock-app"
	if err := secret.Write(context.Background(), map[string]string{}); err == nil {
		t.Fatal("want a login error")
	}
}
