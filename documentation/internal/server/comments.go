package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"documentation/internal/github"
)

// Every comment issue carries these labels; the site and agents find comments by docs-feedback.
var commentLabels = []string{"documentation", "docs-feedback"}

const (
	stateCookie  = "github_sign_in_state"
	maxBodyBytes = 64 << 10
)

// errSignIn means no valid GitHub token is stored: the person must sign in.
var errSignIn = errors.New("sign in to GitHub")

type issueTracker interface {
	AuthorizeURL(redirectURI, state string) string
	Exchange(ctx context.Context, code, redirectURI string, now time.Time) (github.Token, error)
	CreateIssue(ctx context.Context, token, title, body string, labels []string) (json.RawMessage, error)
	CloseIssue(ctx context.Context, token string, number int, reason string) error
}

type secretStore interface {
	Read(ctx context.Context, out any) (found bool, err error)
	Write(ctx context.Context, data any) error
}

// Comments creates and closes the site's comment issues as the person signed in to GitHub; their token stays in Vault.
type Comments struct {
	github issueTracker // nil when no GitHub App is configured
	tokens secretStore
	now    func() time.Time
}

// NewComments acts through app with the token kept in tokens; a nil app turns comments off.
func NewComments(app issueTracker, tokens secretStore) *Comments {
	return &Comments{github: app, tokens: tokens, now: time.Now}
}

// register adds the sign-in and comment routes to mux.
func (c *Comments) register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/github/status", c.status)
	mux.HandleFunc("GET /api/github/login", c.configured(c.login))
	mux.HandleFunc("GET /api/github/callback", c.configured(c.callback))
	mux.HandleFunc("POST /api/comments", sameOrigin(c.configured(c.create)))
	mux.HandleFunc("POST /api/comments/{number}/resolve", sameOrigin(c.configured(c.closer("completed"))))
	mux.HandleFunc("DELETE /api/comments/{number}", sameOrigin(c.configured(c.closer("not_planned"))))
}

// status tells the site whether it can act on GitHub and whether someone is signed in.
func (c *Comments) status(w http.ResponseWriter, r *http.Request) {
	_, err := c.token(r.Context())
	writeJSON(w, http.StatusOK, map[string]bool{"configured": c.github != nil, "signedIn": err == nil})
}

// login sends the person to GitHub's sign-in page; GitHub returns them to callback.
func (c *Comments) login(w http.ResponseWriter, r *http.Request) {
	state, err := randomState()
	if err != nil {
		http.Error(w, "sign-in failed", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: stateCookie, Value: state, Path: "/api/github/", MaxAge: 600,
		HttpOnly: true, Secure: isHTTPS(r), SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, c.github.AuthorizeURL(redirectURI(r), state), http.StatusFound)
}

// callback trades GitHub's code for the person's token, keeps it in Vault and tells the site's other tab.
func (c *Comments) callback(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(stateCookie)
	if err != nil || cookie.Value != r.URL.Query().Get("state") {
		page(w, http.StatusBadRequest, "Sign-in failed: the request didn't start here. Try again from the page.")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Path: "/api/github/", MaxAge: -1})
	token, err := c.github.Exchange(r.Context(), r.URL.Query().Get("code"), redirectURI(r), c.now())
	if err == nil {
		err = c.tokens.Write(r.Context(), token)
	}
	if err != nil {
		slog.Error("github sign-in", "error", err)
		page(w, http.StatusBadGateway, "Sign-in failed. Close this tab and try again.")
		return
	}
	page(w, http.StatusOK, "Signed in to GitHub. You can close this tab.")
}

// create opens an issue for a new comment and answers with it.
func (c *Comments) create(w http.ResponseWriter, r *http.Request) {
	var comment struct{ Title, Body string }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&comment); err != nil || comment.Title == "" || comment.Body == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a comment needs a title and a body"})
		return
	}
	token, err := c.token(r.Context())
	if err != nil {
		c.fail(w, err)
		return
	}
	issue, err := c.github.CreateIssue(r.Context(), token.AccessToken, comment.Title, comment.Body, commentLabels)
	if err != nil {
		c.fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, issue)
}

// closer closes the issue in the path with reason: "completed" resolves a comment, "not_planned" deletes it.
func (c *Comments) closer(reason string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		number, err := strconv.Atoi(r.PathValue("number"))
		if err != nil || number < 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "not an issue number"})
			return
		}
		token, err := c.token(r.Context())
		if err == nil {
			err = c.github.CloseIssue(r.Context(), token.AccessToken, number, reason)
		}
		if err != nil {
			c.fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// token is the stored GitHub token, or errSignIn when there is none or it has expired.
func (c *Comments) token(ctx context.Context) (github.Token, error) {
	var token github.Token
	if c.tokens == nil {
		return token, errSignIn
	}
	found, err := c.tokens.Read(ctx, &token)
	if err != nil {
		return token, err //nolint:wrapcheck // the store's own error says what failed
	}
	if !found || !token.Valid(c.now()) {
		return token, errSignIn
	}
	return token, nil
}

// fail answers 401 when the person must sign in again, else 502.
func (c *Comments) fail(w http.ResponseWriter, err error) {
	if errors.Is(err, errSignIn) || errors.Is(err, github.ErrUnauthorized) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": errSignIn.Error()})
		return
	}
	slog.Error("comment", "error", err)
	writeJSON(w, http.StatusBadGateway, map[string]string{"error": "GitHub or Vault did not answer"})
}

// configured answers 503 when no GitHub App is set up.
func (c *Comments) configured(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if c.github == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "GitHub sign-in is not configured"})
			return
		}
		next(w, r)
	}
}

// sameOrigin rejects requests other sites' pages send from the person's browser (cross-site request forgery).
func sameOrigin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			if u, err := url.Parse(origin); err != nil || u.Host != r.Host {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "cross-origin request"})
				return
			}
		}
		next(w, r)
	}
}

// redirectURI is the callback on the host and scheme the person reached the site with.
func redirectURI(r *http.Request) string {
	scheme := "http"
	if isHTTPS(r) {
		scheme = "https"
	}
	return scheme + "://" + r.Host + "/api/github/callback"
}

// isHTTPS reports whether the person used HTTPS: TLS ends at the Gateway, which says so in X-Forwarded-Proto.
func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
}

// randomState is an unguessable value tying GitHub's callback to the sign-in it started.
func randomState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err //nolint:wrapcheck // crypto/rand fails only if the OS has no entropy
	}
	return hex.EncodeToString(b), nil
}

// page answers with a small HTML page showing message, which tells the site's tabs that sign-in finished.
func page(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	body := `<!doctype html><meta charset="utf-8"><title>GitHub sign-in</title><p>` + message + `</p>` +
		`<script>new BroadcastChannel("github-sign-in").postMessage(` + strconv.Itoa(status) + `); window.close();</script>`
	if _, err := w.Write([]byte(body)); err != nil {
		slog.Error("write page", "error", err)
	}
}
