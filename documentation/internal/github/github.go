// Package github signs a person in through a GitHub App (OAuth web flow) and creates and closes issues as them.
package github

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// ErrUnauthorized means GitHub rejected the token: the person must sign in again.
var ErrUnauthorized = errors.New("github rejected the token")

// App is a GitHub App that acts on issues of one repository.
type App struct {
	ClientID     string
	ClientSecret string
	Repo         string // owner/name
	Web          string // https://github.com
	API          string // https://api.github.com
	HTTP         *http.Client
}

// Token is a person's GitHub token; ExpiresAt is zero when it doesn't expire.
type Token struct {
	AccessToken string    `json:"access_token"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// Valid reports whether the token can still be used at now.
func (t Token) Valid(now time.Time) bool {
	return t.AccessToken != "" && (t.ExpiresAt.IsZero() || now.Before(t.ExpiresAt))
}

// AuthorizeURL is GitHub's sign-in page, which sends the person back to redirectURI with a code and state.
func (a App) AuthorizeURL(redirectURI, state string) string {
	query := url.Values{"client_id": {a.ClientID}, "redirect_uri": {redirectURI}, "state": {state}}
	return a.Web + "/login/oauth/authorize?" + query.Encode()
}

// Exchange trades the code GitHub sent back for the person's token.
func (a App) Exchange(ctx context.Context, code, redirectURI string, now time.Time) (Token, error) {
	form := url.Values{"client_id": {a.ClientID}, "client_secret": {a.ClientSecret}, "code": {code}, "redirect_uri": {redirectURI}}
	var answer struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
		Error       string `json:"error_description"`
	}
	if err := a.call(ctx, http.MethodPost, a.Web+"/login/oauth/access_token", "", form, &answer); err != nil {
		return Token{}, err
	}
	if answer.AccessToken == "" {
		return Token{}, fmt.Errorf("github sign-in: %s", answer.Error)
	}
	token := Token{AccessToken: answer.AccessToken}
	if answer.ExpiresIn > 0 {
		token.ExpiresAt = now.Add(time.Duration(answer.ExpiresIn) * time.Second)
	}
	return token, nil
}

// CreateIssue opens an issue with labels and returns it as GitHub's JSON.
func (a App) CreateIssue(ctx context.Context, token, title, body string, labels []string) (json.RawMessage, error) {
	var issue json.RawMessage
	request := map[string]any{"title": title, "body": body, "labels": labels}
	err := a.call(ctx, http.MethodPost, a.API+"/repos/"+a.Repo+"/issues", token, request, &issue)
	return issue, err
}

// CloseIssue closes issue number with reason "completed" or "not_planned".
func (a App) CloseIssue(ctx context.Context, token string, number int, reason string) error {
	request := map[string]string{"state": "closed", "state_reason": reason}
	return a.call(ctx, http.MethodPatch, a.API+"/repos/"+a.Repo+"/issues/"+strconv.Itoa(number), token, request, nil)
}

// call sends body (url.Values as a form, anything else as JSON) and decodes the JSON answer into out.
func (a App) call(ctx context.Context, method, target, token string, body, out any) error {
	req, err := newRequest(ctx, method, target, body)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := a.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("github %s %s: %w", method, target, err)
	}
	defer res.Body.Close()
	return decodeAnswer(res, out)
}

// decodeAnswer decodes a 2xx answer into out; a 401 is ErrUnauthorized, any other status an error.
func decodeAnswer(res *http.Response, out any) error {
	request := res.Request.Method + " " + res.Request.URL.String()
	if res.StatusCode == http.StatusUnauthorized {
		return ErrUnauthorized
	}
	if res.StatusCode/100 != 2 {
		detail, err := io.ReadAll(io.LimitReader(res.Body, 512))
		if err != nil {
			return fmt.Errorf("github %s: HTTP %d, unreadable answer: %w", request, res.StatusCode, err)
		}
		return fmt.Errorf("github %s: HTTP %d: %s", request, res.StatusCode, detail)
	}
	if out == nil {
		return nil
	}
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		return fmt.Errorf("decode github answer: %w", err)
	}
	return nil
}

// newRequest encodes body as a form when it is url.Values, else as JSON.
func newRequest(ctx context.Context, method, target string, body any) (*http.Request, error) {
	if form, ok := body.(url.Values); ok {
		return request(ctx, method, target, "application/x-www-form-urlencoded", []byte(form.Encode()))
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("encode github request: %w", err)
	}
	return request(ctx, method, target, "application/json", encoded)
}

// request is a request with payload of contentType.
func request(ctx context.Context, method, target, contentType string, payload []byte) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("github request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	return req, nil
}
