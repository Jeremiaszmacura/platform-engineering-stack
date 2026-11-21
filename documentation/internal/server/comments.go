package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"time"
	"unicode/utf8"

	"documentation/internal/github"
)

// commentLabel marks comment issues: the site lists them by it, and closes only issues that have it.
const commentLabel = "docs-feedback"

// Labels of every comment issue.
var commentLabels = []string{"documentation", commentLabel}

const (
	stateCookie   = "github_sign_in_state"
	sessionCookie = "docs_session"
	maxBodyBytes  = 128 << 10
	maxTitle      = 256   // GitHub's limit, in characters
	maxBody       = 65536 // GitHub's limit, in characters
)

var (
	// errSignIn means this browser has no valid GitHub token: the person must sign in.
	errSignIn = errors.New("sign in to GitHub")
	// errNotComment means the issue isn't a comment issue, which this site must not close.
	errNotComment = errors.New("not a comment issue")
)

type issueTracker interface {
	AuthorizeURL(redirectURI, state string) string
	Exchange(ctx context.Context, code, redirectURI string, now time.Time) (github.Token, error)
	CreateIssue(ctx context.Context, token, title, body string, labels []string) (json.RawMessage, error)
	Issue(ctx context.Context, token string, number int) (github.Issue, error)
	CloseIssue(ctx context.Context, token string, number int, reason string) error
}

type secretStore interface {
	Read(ctx context.Context, out any) (found bool, err error)
	Write(ctx context.Context, data any) error
}

// session is what Vault keeps: the GitHub token of the one browser that signed in, and a hash of its session cookie.
type session struct {
	github.Token
	CookieHash string `json:"cookie_hash"`
}

// Comments creates and closes the site's comment issues with the GitHub account of the browser that signed in.
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
	mux.HandleFunc("POST /api/github/logout", sameOrigin(c.configured(c.logout)))
	mux.HandleFunc("POST /api/comments", sameOrigin(c.configured(c.create)))
	mux.HandleFunc("POST /api/comments/{number}/resolve", sameOrigin(c.configured(c.closer("completed"))))
	mux.HandleFunc("DELETE /api/comments/{number}", sameOrigin(c.configured(c.closer("not_planned"))))
}

// status tells the site whether it can act on GitHub.
func (c *Comments) status(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"configured": c.github != nil})
}

// login sends the person to GitHub's sign-in page; GitHub returns them to callback.
func (c *Comments) login(w http.ResponseWriter, r *http.Request) {
	state, err := randomHex()
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

// callback trades GitHub's code for the person's token, keeps it in Vault for this browser only and tells the
// site's other tab. A new sign-in replaces the previous browser's session.
func (c *Comments) callback(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(stateCookie)
	if err != nil || cookie.Value != r.URL.Query().Get("state") {
		page(w, http.StatusBadRequest, "Sign-in failed: the request didn't start here. Try again from the page.")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Path: "/api/github/", MaxAge: -1})
	id, err := c.signIn(r.Context(), r.URL.Query().Get("code"), redirectURI(r))
	if err != nil {
		slog.Error("github sign-in", "error", err)
		page(w, http.StatusBadGateway, "Sign-in failed. Close this tab and try again.")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: id, Path: "/api/",
		HttpOnly: true, Secure: isHTTPS(r), SameSite: http.SameSiteStrictMode,
	})
	page(w, http.StatusOK, "Signed in to GitHub. You can close this tab.")
}

// signIn exchanges code for a token and stores it with a new session; it returns the session cookie's value.
func (c *Comments) signIn(ctx context.Context, code, redirect string) (string, error) {
	token, err := c.github.Exchange(ctx, code, redirect, c.now())
	if err != nil {
		return "", err //nolint:wrapcheck // the client's error says what failed
	}
	id, err := randomHex()
	if err != nil {
		return "", err
	}
	return id, c.tokens.Write(ctx, session{Token: token, CookieHash: hash(id)}) //nolint:wrapcheck // as above
}

// logout forgets the GitHub token of the browser that signed in.
func (c *Comments) logout(w http.ResponseWriter, r *http.Request) {
	if _, err := c.token(r); err == nil {
		if err := c.tokens.Write(r.Context(), session{}); err != nil {
			c.fail(w, err)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Path: "/api/", MaxAge: -1})
	w.WriteHeader(http.StatusNoContent)
}

// create opens an issue for a new comment and answers with it.
func (c *Comments) create(w http.ResponseWriter, r *http.Request) {
	var comment struct{ Title, Body string }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(&comment); err != nil || !validComment(comment.Title, comment.Body) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a comment needs a title and a body within GitHub's limits"})
		return
	}
	token, err := c.token(r)
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
		token, err := c.token(r)
		if err == nil {
			err = c.closeComment(r.Context(), token.AccessToken, number, reason)
		}
		if err != nil {
			c.fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// closeComment closes issue number with reason, unless it isn't a comment issue.
func (c *Comments) closeComment(ctx context.Context, token string, number int, reason string) error {
	issue, err := c.github.Issue(ctx, token, number)
	if err != nil {
		return err //nolint:wrapcheck // the client's error says what failed
	}
	if !issue.HasLabel(commentLabel) || issue.IsPullRequest() {
		return errNotComment
	}
	return c.github.CloseIssue(ctx, token, number, reason) //nolint:wrapcheck // as above
}

// token is the GitHub token stored for the browser of request r, or errSignIn when it has none or it has expired.
func (c *Comments) token(r *http.Request) (github.Token, error) {
	cookie, err := r.Cookie(sessionCookie)
	if err != nil || c.tokens == nil {
		return github.Token{}, errSignIn
	}
	var stored session
	found, err := c.tokens.Read(r.Context(), &stored)
	if err != nil {
		return github.Token{}, err //nolint:wrapcheck // the store's own error says what failed
	}
	sameBrowser := subtle.ConstantTimeCompare([]byte(stored.CookieHash), []byte(hash(cookie.Value))) == 1
	if !found || !sameBrowser || !stored.Valid(c.now()) {
		return github.Token{}, errSignIn
	}
	return stored.Token, nil
}

// fail answers 401 when the person must sign in again, 404 for an issue that isn't a comment, else 502 with
// GitHub's message when it gave one.
func (c *Comments) fail(w http.ResponseWriter, err error) {
	var apiErr *github.APIError
	switch {
	case errors.Is(err, errSignIn) || errors.Is(err, github.ErrUnauthorized):
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": errSignIn.Error()})
	case errors.Is(err, errNotComment):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": errNotComment.Error()})
	case errors.As(err, &apiErr):
		slog.Error("comment", "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "GitHub: " + apiErr.Message})
	default:
		slog.Error("comment", "error", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "GitHub or Vault did not answer"})
	}
}

// validComment reports whether title and body are present and within GitHub's limits.
func validComment(title, body string) bool {
	return title != "" && body != "" && utf8.RuneCountInString(title) <= maxTitle && utf8.RuneCountInString(body) <= maxBody
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

// randomHex is an unguessable value: the sign-in state and the session cookie.
func randomHex() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err //nolint:wrapcheck // crypto/rand fails only if the OS has no entropy
	}
	return hex.EncodeToString(b), nil
}

// hash is the hex SHA-256 of value; Vault keeps the session cookie only as this.
func hash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
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
