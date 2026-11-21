package github

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

var now = time.Date(2026, 11, 21, 12, 0, 0, 0, time.UTC)

// fakeGitHub serves handler for both GitHub's web and API hosts.
func fakeGitHub(t *testing.T, handler http.HandlerFunc) App {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return App{ClientID: "id", ClientSecret: "secret", Repo: "o/r", Web: server.URL, API: server.URL, HTTP: server.Client()}
}

// reply writes body as the response.
func reply(t *testing.T, w http.ResponseWriter, body string) {
	t.Helper()
	if _, err := w.Write([]byte(body)); err != nil {
		t.Errorf("write response: %v", err)
	}
}

func TestAuthorizeURL(t *testing.T) {
	app := App{ClientID: "id", Web: "https://github.com"}
	got, err := url.Parse(app.AuthorizeURL("http://docs.localhost/api/github/callback", "s1"))
	if err != nil {
		t.Fatal(err)
	}
	q := got.Query()
	if got.Path != "/login/oauth/authorize" || q.Get("client_id") != "id" || q.Get("state") != "s1" ||
		q.Get("redirect_uri") != "http://docs.localhost/api/github/callback" {
		t.Errorf("authorize URL = %s", got)
	}
}

func TestExchangeSendsTheSecretAndKeepsTheExpiry(t *testing.T) {
	app := fakeGitHub(t, func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse form: %v", err)
		}
		if r.URL.Path != "/login/oauth/access_token" || r.Form.Get("client_secret") != "secret" || r.Form.Get("code") != "c1" {
			t.Errorf("unexpected exchange %s %v", r.URL.Path, r.Form)
		}
		reply(t, w, `{"access_token":"ghu_1","expires_in":28800}`)
	})
	token, err := app.Exchange(context.Background(), "c1", "http://docs.localhost/api/github/callback", now)
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if token.AccessToken != "ghu_1" || !token.ExpiresAt.Equal(now.Add(8*time.Hour)) {
		t.Errorf("token = %+v", token)
	}
	if !token.Valid(now) || token.Valid(now.Add(9*time.Hour)) {
		t.Error("token validity is wrong")
	}
}

func TestExchangeRejectsABadCode(t *testing.T) {
	app := fakeGitHub(t, func(w http.ResponseWriter, _ *http.Request) {
		reply(t, w, `{"error":"bad_verification_code","error_description":"The code is incorrect or expired."}`)
	})
	if _, err := app.Exchange(context.Background(), "old", "x", now); err == nil {
		t.Fatal("want an error")
	}
}

func TestCreateIssueSendsLabelsAsThePerson(t *testing.T) {
	app := fakeGitHub(t, func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read body: %v", err)
		}
		var got map[string]any
		if err := json.Unmarshal(body, &got); err != nil {
			t.Errorf("decode: %v", err)
		}
		if r.URL.Path != "/repos/o/r/issues" || r.Header.Get("Authorization") != "Bearer ghu_1" || len(got["labels"].([]any)) != 2 {
			t.Errorf("unexpected request %s %v", r.URL.Path, got)
		}
		w.WriteHeader(http.StatusCreated)
		reply(t, w, `{"number":7}`)
	})
	issue, err := app.CreateIssue(context.Background(), "ghu_1", "t", "b", []string{"documentation", "docs-feedback"})
	if err != nil || string(issue) != `{"number":7}` {
		t.Fatalf("issue %s, err %v", issue, err)
	}
}

func TestCloseIssueAndRejectedTokens(t *testing.T) {
	app := fakeGitHub(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer ghu_1" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.Method != http.MethodPatch || r.URL.Path != "/repos/o/r/issues/7" {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		reply(t, w, `{}`)
	})
	if err := app.CloseIssue(context.Background(), "ghu_1", 7, "completed"); err != nil {
		t.Fatalf("close: %v", err)
	}
	if err := app.CloseIssue(context.Background(), "expired", 7, "completed"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("err = %v, want ErrUnauthorized", err)
	}
}
