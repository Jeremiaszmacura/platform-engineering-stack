package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"documentation/internal/github"
)

var testNow = time.Date(2026, 11, 21, 12, 0, 0, 0, time.UTC)

// fakeGitHub records what the handlers asked of GitHub; only token "ghu_ok" is accepted. Issue 5 is a bug report,
// 6 a pull request, 9 gets a 422; every other number is a comment issue.
type fakeGitHub struct {
	labels []string
	closed map[int]string
}

func (f *fakeGitHub) AuthorizeURL(redirectURI, state string) string {
	return "https://github.test/authorize?" + url.Values{"redirect_uri": {redirectURI}, "state": {state}}.Encode()
}

func (f *fakeGitHub) Exchange(_ context.Context, code, _ string, now time.Time) (github.Token, error) {
	return github.Token{AccessToken: "ghu_" + code, ExpiresAt: now.Add(8 * time.Hour)}, nil
}

func (f *fakeGitHub) CreateIssue(_ context.Context, token, title, _ string, labels []string) (json.RawMessage, error) {
	if token != "ghu_ok" {
		return nil, github.ErrUnauthorized
	}
	if title == "rejected" {
		return nil, &github.APIError{Status: http.StatusUnprocessableEntity, Message: "Validation Failed"}
	}
	f.labels = labels
	return json.RawMessage(`{"number":7}`), nil
}

func (f *fakeGitHub) Issue(_ context.Context, token string, number int) (github.Issue, error) {
	if token != "ghu_ok" {
		return github.Issue{}, github.ErrUnauthorized
	}
	var issue github.Issue
	labels := map[int]string{5: `"bug"`}[number]
	if labels == "" {
		labels = `"docs-feedback"`
	}
	pullRequest := map[int]string{6: `,"pull_request":{"url":"x"}`}[number]
	if err := json.Unmarshal([]byte(`{"labels":[{"name":`+labels+`}]`+pullRequest+`}`), &issue); err != nil {
		return issue, fmt.Errorf("fake issue: %w", err)
	}
	return issue, nil
}

func (f *fakeGitHub) CloseIssue(_ context.Context, _ string, number int, reason string) error {
	f.closed[number] = reason
	return nil
}

// memoryStore keeps the session as Vault would.
type memoryStore struct{ stored []byte }

func (m *memoryStore) Read(_ context.Context, out any) (bool, error) {
	if m.stored == nil {
		return false, nil
	}
	if err := json.Unmarshal(m.stored, out); err != nil {
		return true, fmt.Errorf("fake read: %w", err)
	}
	return true, nil
}

func (m *memoryStore) Write(_ context.Context, data any) error {
	stored, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("fake write: %w", err)
	}
	m.stored = stored
	return nil
}

// commentServer is the site's handler with fakes.
func commentServer(t *testing.T) (http.Handler, *fakeGitHub, *memoryStore) {
	t.Helper()
	gh, store := &fakeGitHub{closed: map[int]string{}}, &memoryStore{}
	comments := NewComments(gh, store)
	comments.now = func() time.Time { return testNow }
	return New(stubSource{}, site, &url.URL{}, comments), gh, store
}

func send(t *testing.T, handler http.Handler, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Host = "docs.localhost"
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// signIn runs the sign-in with GitHub's code and returns the browser's session cookie header.
func signIn(t *testing.T, handler http.Handler, code string) map[string]string {
	t.Helper()
	login := send(t, handler, http.MethodGet, "/api/github/login", "", map[string]string{"X-Forwarded-Proto": "https"})
	target, err := url.Parse(login.Header().Get("Location"))
	if login.Code != http.StatusFound || err != nil || target.Query().Get("redirect_uri") != "https://docs.localhost/api/github/callback" {
		t.Fatalf("login: %d %s", login.Code, login.Header().Get("Location"))
	}
	state := target.Query().Get("state")
	callback := send(t, handler, http.MethodGet, "/api/github/callback?code="+code+"&state="+state, "",
		map[string]string{"Cookie": stateCookie + "=" + state})
	if callback.Code != http.StatusOK || !strings.Contains(callback.Body.String(), "BroadcastChannel") {
		t.Fatalf("callback: %d %s", callback.Code, callback.Body)
	}
	for _, c := range callback.Result().Cookies() {
		if c.Name == sessionCookie && c.HttpOnly && c.SameSite == http.SameSiteStrictMode {
			return map[string]string{"Cookie": c.Name + "=" + c.Value}
		}
	}
	t.Fatal("callback set no HttpOnly, SameSite=Strict session cookie")
	return nil
}

const comment = `{"title":"docs(state.html): fix","body":"text"}`

func TestStatusSaysOnlyWhetherCommentsAreOn(t *testing.T) {
	off := New(stubSource{}, site, &url.URL{}, NewComments(nil, nil))
	if got := send(t, off, http.MethodGet, "/api/github/status", "", nil).Body.String(); got != "{\"configured\":false}\n" {
		t.Errorf("off: %s", got)
	}
	handler, _, _ := commentServer(t)
	if got := send(t, handler, http.MethodGet, "/api/github/status", "", nil).Body.String(); got != "{\"configured\":true}\n" {
		t.Errorf("on: %s", got)
	}
}

func TestCallbackChecksTheState(t *testing.T) {
	handler, _, store := commentServer(t)
	if rec := send(t, handler, http.MethodGet, "/api/github/callback?code=ok&state=s", "", nil); rec.Code != http.StatusBadRequest || store.stored != nil {
		t.Errorf("callback without the state cookie: %d, stored %s", rec.Code, store.stored)
	}
}

func TestOnlyTheBrowserThatSignedInActs(t *testing.T) {
	handler, gh, store := commentServer(t)
	browser := signIn(t, handler, "ok")
	if strings.Contains(string(store.stored), strings.TrimPrefix(browser["Cookie"], sessionCookie+"=")) {
		t.Error("Vault must keep only a hash of the session cookie")
	}
	other := map[string]string{"Cookie": sessionCookie + "=guessed"}
	for name, headers := range map[string]map[string]string{"no cookie": nil, "another cookie": other} {
		if rec := send(t, handler, http.MethodPost, "/api/comments", comment, headers); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: create %d, want 401", name, rec.Code)
		}
		if rec := send(t, handler, http.MethodDelete, "/api/comments/7", "", headers); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: delete %d, want 401", name, rec.Code)
		}
	}
	rec := send(t, handler, http.MethodPost, "/api/comments", comment, browser)
	if rec.Code != http.StatusCreated || len(gh.labels) != 2 || len(gh.closed) != 0 {
		t.Fatalf("create: %d %s, labels %v, closed %v", rec.Code, rec.Body, gh.labels, gh.closed)
	}
}

func TestExpiredOrRejectedTokensNeedANewSignIn(t *testing.T) {
	handler, _, _ := commentServer(t)
	rejected := signIn(t, handler, "revoked") // the fake GitHub accepts only ghu_ok
	if rec := send(t, handler, http.MethodPost, "/api/comments", comment, rejected); rec.Code != http.StatusUnauthorized {
		t.Errorf("rejected: %d, want 401", rec.Code)
	}

	now := testNow
	comments := NewComments(&fakeGitHub{closed: map[int]string{}}, &memoryStore{})
	comments.now = func() time.Time { return now }
	handler = New(stubSource{}, site, &url.URL{}, comments)
	browser := signIn(t, handler, "ok")
	now = testNow.Add(9 * time.Hour) // the token lasts 8
	if rec := send(t, handler, http.MethodPost, "/api/comments", comment, browser); rec.Code != http.StatusUnauthorized {
		t.Errorf("expired: %d, want 401", rec.Code)
	}
}

func TestSignOutForgetsTheToken(t *testing.T) {
	handler, _, store := commentServer(t)
	browser := signIn(t, handler, "ok")
	if rec := send(t, handler, http.MethodPost, "/api/github/logout", "", browser); rec.Code != http.StatusNoContent {
		t.Fatalf("logout: %d", rec.Code)
	}
	if strings.Contains(string(store.stored), "ghu_ok") {
		t.Errorf("token still stored: %s", store.stored)
	}
	if rec := send(t, handler, http.MethodPost, "/api/comments", comment, browser); rec.Code != http.StatusUnauthorized {
		t.Errorf("create after logout: %d, want 401", rec.Code)
	}
}

func TestOnlyCommentIssuesAreClosed(t *testing.T) {
	handler, gh, _ := commentServer(t)
	browser := signIn(t, handler, "ok")
	for path, want := range map[string]int{
		"/api/comments/7/resolve": http.StatusNoContent, "/api/comments/5/resolve": http.StatusNotFound,
		"/api/comments/6/resolve": http.StatusNotFound, "/api/comments/abc/resolve": http.StatusBadRequest,
	} {
		if rec := send(t, handler, http.MethodPost, path, "", browser); rec.Code != want {
			t.Errorf("%s: %d, want %d", path, rec.Code, want)
		}
	}
	if rec := send(t, handler, http.MethodDelete, "/api/comments/8", "", browser); rec.Code != http.StatusNoContent {
		t.Errorf("delete: %d", rec.Code)
	}
	if len(gh.closed) != 2 || gh.closed[7] != "completed" || gh.closed[8] != "not_planned" {
		t.Errorf("closed = %v", gh.closed)
	}
}

func TestBadCommentsAndGitHubErrorsAreExplained(t *testing.T) {
	handler, _, _ := commentServer(t)
	browser := signIn(t, handler, "ok")
	tooLong := `{"title":"t","body":"` + strings.Repeat("x", maxBody+1) + `"}`
	for _, body := range []string{`{"title":""}`, tooLong} {
		if rec := send(t, handler, http.MethodPost, "/api/comments", body, browser); rec.Code != http.StatusBadRequest {
			t.Errorf("bad comment: %d, want 400", rec.Code)
		}
	}
	rec := send(t, handler, http.MethodPost, "/api/comments", `{"title":"rejected","body":"b"}`, browser)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "Validation Failed") {
		t.Errorf("GitHub 422: %d %s", rec.Code, rec.Body)
	}
}

func TestOtherSitesAndUnconfiguredServersAreRefused(t *testing.T) {
	handler, gh, _ := commentServer(t)
	browser := signIn(t, handler, "ok")
	browser["Origin"] = "https://evil.example"
	if rec := send(t, handler, http.MethodDelete, "/api/comments/7", "", browser); rec.Code != http.StatusForbidden || len(gh.closed) != 0 {
		t.Errorf("cross-origin delete: %d, closed %v", rec.Code, gh.closed)
	}
	off := New(stubSource{}, site, &url.URL{}, NewComments(nil, nil))
	if rec := send(t, off, http.MethodPost, "/api/comments", comment, nil); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("unconfigured: %d, want 503", rec.Code)
	}
}
