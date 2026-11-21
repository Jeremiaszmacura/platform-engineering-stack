// Package vault reads and writes one KV v2 secret, signing in with the pod's ServiceAccount token (kubernetes auth).
package vault

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

// Secret is one KV v2 secret, reached as Role with the ServiceAccount token in TokenFile.
type Secret struct {
	Addr      string // e.g. http://vault-service.vault:8200
	Role      string // kubernetes auth role
	TokenFile string // projected ServiceAccount token with audience vault
	Path      string // e.g. services/data/documentation/github
	HTTP      *http.Client
}

// Read decodes the secret's data into out; found is false when it was never written.
func (s Secret) Read(ctx context.Context, out any) (found bool, err error) {
	var body struct {
		Data struct {
			Data json.RawMessage `json:"data"`
		} `json:"data"`
	}
	status, err := s.call(ctx, http.MethodGet, "/v1/"+s.Path, nil, &body)
	if status == http.StatusNotFound {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err := json.Unmarshal(body.Data.Data, out); err != nil {
		return false, fmt.Errorf("decode vault secret: %w", err)
	}
	return true, nil
}

// Write replaces the secret's data with data.
func (s Secret) Write(ctx context.Context, data any) error {
	_, err := s.call(ctx, http.MethodPost, "/v1/"+s.Path, map[string]any{"data": data}, nil)
	return err
}

// call signs in, then sends a request with body as JSON and decodes the answer into out.
func (s Secret) call(ctx context.Context, method, path string, body, out any) (status int, err error) {
	token, err := s.login(ctx)
	if err != nil {
		return 0, err
	}
	return s.send(ctx, method, path, token, body, out)
}

// login trades the ServiceAccount token for a Vault token.
func (s Secret) login(ctx context.Context) (string, error) {
	jwt, err := os.ReadFile(s.TokenFile)
	if err != nil {
		return "", fmt.Errorf("read serviceaccount token: %w", err)
	}
	var answer struct {
		Auth struct {
			ClientToken string `json:"client_token"`
		} `json:"auth"`
	}
	request := map[string]string{"role": s.Role, "jwt": strings.TrimSpace(string(jwt))}
	if _, err := s.send(ctx, http.MethodPost, "/v1/auth/kubernetes/login", "", request, &answer); err != nil {
		return "", fmt.Errorf("vault login: %w", err)
	}
	return answer.Auth.ClientToken, nil
}

// send makes one request to Vault; an answer other than 2xx is an error.
func (s Secret) send(ctx context.Context, method, path, token string, body, out any) (status int, err error) {
	payload, err := encode(body)
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, method, s.Addr+path, payload)
	if err != nil {
		return 0, fmt.Errorf("vault request: %w", err)
	}
	if token != "" {
		req.Header.Set("X-Vault-Token", token)
	}
	res, err := s.HTTP.Do(req)
	if err != nil {
		return 0, fmt.Errorf("vault %s %s: %w", method, path, err)
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		return res.StatusCode, fmt.Errorf("vault %s %s: HTTP %d", method, path, res.StatusCode)
	}
	if out == nil {
		return res.StatusCode, nil
	}
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		return res.StatusCode, fmt.Errorf("decode vault answer: %w", err)
	}
	return res.StatusCode, nil
}

// encode is body as JSON, or no body when it is nil.
func encode(body any) (io.Reader, error) {
	if body == nil {
		return http.NoBody, nil
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("encode vault request: %w", err)
	}
	return bytes.NewReader(encoded), nil
}
