package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go-app/internal/vaultclient"

	"github.com/gin-gonic/gin"
)

// fakeStore is an in-memory secretStore; err, when set, is returned by every call.
type fakeStore struct {
	secrets map[string]string
	err     error
}

func (f *fakeStore) WriteSecret(_ context.Context, key, value string) error {
	if f.err != nil {
		return f.err
	}
	f.secrets[key] = value
	return nil
}

func (f *fakeStore) ReadSecret(_ context.Context, key string) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	value, ok := f.secrets[key]
	if !ok {
		return "", vaultclient.ErrSecretNotFound
	}
	return value, nil
}

// newTestRouter returns a router serving the secret endpoints from store.
func newTestRouter(store secretStore) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	secrets := NewSecretsHandler(store)
	router.POST("/secret", secrets.Write)
	router.GET("/secret/:key", secrets.Read)
	return router
}

// serve sends one request to router and returns the recorded response.
func serve(router *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(method, path, strings.NewReader(body)))
	return recorder
}

func TestWriteSecret(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		storeErr error
		want     int
	}{
		{"stores valid secret", `{"key":"demo","value":"x"}`, nil, http.StatusCreated},
		{"rejects missing value", `{"key":"demo"}`, nil, http.StatusUnprocessableEntity},
		{"rejects slash in key", `{"key":"a/b","value":"x"}`, nil, http.StatusUnprocessableEntity},
		{"rejects malformed json", `{`, nil, http.StatusUnprocessableEntity},
		{"maps vault failure to 502", `{"key":"demo","value":"x"}`, errors.New("down"), http.StatusBadGateway},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := newTestRouter(&fakeStore{secrets: map[string]string{}, err: tt.storeErr})
			if got := serve(router, http.MethodPost, "/secret", tt.body).Code; got != tt.want {
				t.Fatalf("status = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestReadSecret(t *testing.T) {
	tests := []struct {
		name     string
		key      string
		storeErr error
		want     int
	}{
		{"returns stored secret", "demo", nil, http.StatusOK},
		{"returns 404 for missing key", "missing", nil, http.StatusNotFound},
		{"maps vault failure to 502", "demo", errors.New("down"), http.StatusBadGateway},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := newTestRouter(&fakeStore{secrets: map[string]string{"demo": "x"}, err: tt.storeErr})
			if got := serve(router, http.MethodGet, "/secret/"+tt.key, "").Code; got != tt.want {
				t.Fatalf("status = %d, want %d", got, tt.want)
			}
		})
	}
}
