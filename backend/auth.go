package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const authCookieName = "mysqlui_token"

// authManager implements optional password protection for the whole UI/API.
// When no password is configured the manager is disabled and every request is
// allowed (the default for local use).
type authManager struct {
	mu       sync.Mutex
	enabled  bool
	password string
	secret   []byte
	ttl      time.Duration
}

func newAuthManager(dir string) *authManager {
	a := &authManager{ttl: 7 * 24 * time.Hour}
	a.password = firstNonEmpty(os.Getenv("MYSQLUI_AUTH_PASSWORD"), os.Getenv("MYSQLUI_PASSWORD"))
	a.enabled = strings.TrimSpace(a.password) != ""

	secret := os.Getenv("MYSQLUI_AUTH_SECRET")
	if secret == "" {
		path := filepath.Join(dir, "auth.secret")
		if b, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(b))) >= 32 {
			secret = strings.TrimSpace(string(b))
		} else {
			buf := make([]byte, 32)
			_, _ = rand.Read(buf)
			secret = hex.EncodeToString(buf)
			if err := os.MkdirAll(dir, 0o755); err == nil {
				_ = os.WriteFile(path, []byte(secret), 0o600)
			}
		}
	}
	a.secret = []byte(secret)
	return a
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func (a *authManager) issueToken() string {
	exp := strconv.FormatInt(time.Now().Add(a.ttl).Unix(), 10)
	mac := hmac.New(sha256.New, a.secret)
	mac.Write([]byte(exp))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return exp + "." + sig
}

func (a *authManager) validToken(token string) bool {
	parts := strings.SplitN(strings.TrimSpace(token), ".", 2)
	if len(parts) != 2 {
		return false
	}
	exp, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}
	mac := hmac.New(sha256.New, a.secret)
	mac.Write([]byte(parts[0]))
	got, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	return hmac.Equal(mac.Sum(nil), got)
}

func (a *authManager) tokenFromRequest(r *http.Request) string {
	if c, err := r.Cookie(authCookieName); err == nil && c.Value != "" {
		return c.Value
	}
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	}
	return r.URL.Query().Get("token")
}

func (a *authManager) authenticated(r *http.Request) bool {
	if !a.enabled {
		return true
	}
	return a.validToken(a.tokenFromRequest(r))
}

func isPublicAPIPath(path string) bool {
	switch path {
	case "/api/auth/login", "/api/auth/logout", "/api/auth/status", "/api/version", "/api/health":
		return true
	}
	return false
}

// middleware protects /api/* except the public endpoints. Static assets stay
// public so the login screen can load.
func (a *authManager) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.enabled || !strings.HasPrefix(r.URL.Path, "/api/") || isPublicAPIPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		if a.authenticated(r) {
			next.ServeHTTP(w, r)
			return
		}
		writeErr(w, http.StatusUnauthorized, errors.New("authentication required"))
	})
}

// ---- handlers -----------------------------------------------------------

func (a *authManager) statusHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{
		"required":      a.enabled,
		"authenticated": a.authenticated(r),
	})
}

func (a *authManager) loginHandler(w http.ResponseWriter, r *http.Request) {
	if !a.enabled {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true, "required": false})
		return
	}
	var in struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, errors.New("invalid request body"))
		return
	}
	expected := []byte(a.password)
	got := []byte(in.Password)
	if subtle.ConstantTimeCompare(expected, got) != 1 {
		time.Sleep(300 * time.Millisecond)
		writeErr(w, http.StatusUnauthorized, errors.New("invalid password"))
		return
	}
	token := a.issueToken()
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
		MaxAge:   int(a.ttl.Seconds()),
	})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "token": token})
}

func (a *authManager) logoutHandler(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
