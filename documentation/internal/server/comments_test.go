package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"documentation/internal/github"
)

var testNow = time.Date(2026, 11, 21, 12, 0, 0, 0, time.UTC)

// fakeGitHub records what the handlers asked of GitHub; only token "ghu_ok" is accepted.
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

func (f *fakeGitHub) CreateIssue(_ context.Context, token, _, _ string, labels []string) (json.RawMessage, error) {
	if token != "ghu_ok" {
		return nil, github.ErrUnauthorized
	}
	f.labels = labels
	return json.RawMessage(`{"number":7}`), nil
}

func (f *fakeGitHub) CloseIssue(_ context.Context, token string, number int, reason string) error {
	if token != "ghu_ok" {
		return github.ErrUnauthorized
	}
	f.closed[number] = reason
	return nil
}

// memoryStore keeps the token as Vault would.
type memoryStore struct{ token *github.Token }

func (m *memoryStore) Read(_ context.Context, out any) (bool, error) {
	if m.token == nil {
		return false, nil
	}
	*out.(*github.Token) = *m.token
	return true, nil
}

func (m *memoryStore) Write(_ context.Context, data any) error {
	token := data.(github.Token)
	m.token = &token
	return nil
}

// commentServer is the site's handler with fakes; token, when given, is already stored.
func commentServer(token *github.Token) (http.Handler, *fakeGitHub, *memoryStore) {
	gh, store := &fakeGitHub{closed: map[int]string{}}, &memoryStore{token: token}
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

var signedIn = &github.Token{AccessToken: "ghu_ok", ExpiresAt: testNow.Add(time.Hour)}

func TestStatus(t *testing.T) {
	off := New(stubSource{}, site, &url.URL{}, NewComments(nil, nil))
	if got := send(t, off, http.MethodGet, "/api/github/status", "", nil).Body.String(); !strings.Contains(got, `"configured":false`) {
		t.Errorf("off: %s", got)
	}
	expired := &github.Token{AccessToken: "ghu_ok", ExpiresAt: testNow.Add(-time.Minute)}
	for token, want := range map[*github.Token]string{nil: `"signedIn":false`, expired: `"signedIn":false`, signedIn: `"signedIn":true`} {
		handler, _, _ := commentServer(token)
		if got := send(t, handler, http.MethodGet, "/api/github/status", "", nil).Body.String(); !strings.Contains(got, want) {
			t.Errorf("token %v: %s, want %s", token, got, want)
		}
	}
}

func TestSignInRoundTripStoresTheToken(t *testing.T) {
	handler, _, store := commentServer(nil)
	login := send(t, handler, http.MethodGet, "/api/github/login", "", map[string]string{"X-Forwarded-Proto": "https"})
	target, err := url.Parse(login.Header().Get("Location"))
	if login.Code != http.StatusFound || err != nil || target.Query().Get("redirect_uri") != "https://docs.localhost/api/github/callback" {
		t.Fatalf("login: %d %s", login.Code, login.Header().Get("Location"))
	}
	state := target.Query().Get("state")
	cookie := stateCookie + "=" + state
	if bad := send(t, handler, http.MethodGet, "/api/github/callback?code=x&state="+state, "", nil); bad.Code != http.StatusBadRequest {
		t.Errorf("callback without the cookie: %d, want 400", bad.Code)
	}
	ok := send(t, handler, http.MethodGet, "/api/github/callback?code=ok&state="+state, "", map[string]string{"Cookie": cookie})
	if ok.Code != http.StatusOK || store.token == nil || store.token.AccessToken != "ghu_ok" {
		t.Fatalf("callback: %d, stored %+v", ok.Code, store.token)
	}
	if !strings.Contains(ok.Body.String(), "BroadcastChannel") {
		t.Error("the callback page must tell the site's tab")
	}
}

func TestCreateNeedsASignedInPersonAndLabelsTheIssue(t *testing.T) {
	comment := `{"title":"docs(state.html): fix","body":"text"}`
	expired := &github.Token{AccessToken: "ghu_ok", ExpiresAt: testNow.Add(-time.Minute)}
	rejected := &github.Token{AccessToken: "ghu_revoked"}
	for name, token := range map[string]*github.Token{"none": nil, "expired": expired, "rejected by GitHub": rejected} {
		handler, _, _ := commentServer(token)
		if rec := send(t, handler, http.MethodPost, "/api/comments", comment, nil); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: %d, want 401", name, rec.Code)
		}
	}
	handler, gh, _ := commentServer(signedIn)
	rec := send(t, handler, http.MethodPost, "/api/comments", comment, map[string]string{"Origin": "http://docs.localhost"})
	if rec.Code != http.StatusCreated || rec.Body.String() != "{\"number\":7}\n" || len(gh.labels) != 2 {
		t.Fatalf("create: %d %s, labels %v", rec.Code, rec.Body, gh.labels)
	}
	if bad := send(t, handler, http.MethodPost, "/api/comments", `{"title":""}`, nil); bad.Code != http.StatusBadRequest {
		t.Errorf("empty comment: %d, want 400", bad.Code)
	}
}

func TestResolveAndDeleteCloseTheIssue(t *testing.T) {
	handler, gh, _ := commentServer(signedIn)
	if rec := send(t, handler, http.MethodPost, "/api/comments/7/resolve", "", nil); rec.Code != http.StatusNoContent {
		t.Errorf("resolve: %d", rec.Code)
	}
	if rec := send(t, handler, http.MethodDelete, "/api/comments/8", "", nil); rec.Code != http.StatusNoContent {
		t.Errorf("delete: %d", rec.Code)
	}
	if gh.closed[7] != "completed" || gh.closed[8] != "not_planned" {
		t.Errorf("closed = %v", gh.closed)
	}
	if rec := send(t, handler, http.MethodDelete, "/api/comments/abc", "", nil); rec.Code != http.StatusBadRequest {
		t.Errorf("bad number: %d", rec.Code)
	}
}

func TestOtherSitesAndUnconfiguredServersAreRefused(t *testing.T) {
	handler, gh, _ := commentServer(signedIn)
	rec := send(t, handler, http.MethodDelete, "/api/comments/7", "", map[string]string{"Origin": "https://evil.example"})
	if rec.Code != http.StatusForbidden || len(gh.closed) != 0 {
		t.Errorf("cross-origin delete: %d, closed %v", rec.Code, gh.closed)
	}
	off := New(stubSource{}, site, &url.URL{}, NewComments(nil, nil))
	if rec := send(t, off, http.MethodPost, "/api/comments", `{"title":"t","body":"b"}`, nil); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("unconfigured: %d, want 503", rec.Code)
	}
}
