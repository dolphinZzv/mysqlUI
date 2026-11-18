// Package catchreport sends backend errors to a Catch ingest endpoint.
//
// Reporting is best-effort and never blocks request handling: events are queued
// in memory and dropped when the queue is full. Configuration is disabled when
// either the Catch URL or ingest key is empty.
package catchreport

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"time"
)

var reportingEnabled atomic.Bool

func init() { reportingEnabled.Store(true) }

// SetEnabled turns reporting on or off at runtime. It is safe to call while
// requests are in flight; disabled clients drop events instead of queueing.
func SetEnabled(enabled bool) { reportingEnabled.Store(enabled) }

// ReportingEnabled reports the current runtime switch.
func ReportingEnabled() bool { return reportingEnabled.Load() }

// Event mirrors the subset of Catch's ingest schema used by Motion.
type Event struct {
	Kind        string            `json:"kind"`
	Source      string            `json:"source,omitempty"`
	Level       string            `json:"level,omitempty"`
	Message     string            `json:"message"`
	ErrorType   string            `json:"errorType,omitempty"`
	Stack       string            `json:"stack,omitempty"`
	Culprit     string            `json:"culprit,omitempty"`
	URL         string            `json:"url,omitempty"`
	Timestamp   time.Time         `json:"timestamp,omitempty"`
	Environment string            `json:"environment,omitempty"`
	Release     string            `json:"release,omitempty"`
	Service     string            `json:"service,omitempty"`
	Platform    string            `json:"platform,omitempty"`
	Tags        map[string]string `json:"tags,omitempty"`
	Context     map[string]any    `json:"context,omitempty"`
	User        *User             `json:"user,omitempty"`
	Request     *Request          `json:"request,omitempty"`
}

type User struct {
	ID       string `json:"id,omitempty"`
	Email    string `json:"email,omitempty"`
	Username string `json:"username,omitempty"`
}

type Request struct {
	Method     string `json:"method,omitempty"`
	URL        string `json:"url,omitempty"`
	Status     int    `json:"status,omitempty"`
	DurationMS int64  `json:"durationMs,omitempty"`
	RequestID  string `json:"requestId,omitempty"`
}

// Client owns a small background queue so reporting cannot slow down requests.
type Client struct {
	endpoint    string
	key         string
	environment string
	service     string
	release     string

	queue chan Event
	http  *http.Client
}

// NewFromEnv builds a client from CATCH_URL, CATCH_KEY, CATCH_ENV,
// CATCH_SERVICE and CATCH_RELEASE. It returns nil when reporting is disabled.
func NewFromEnv() *Client {
	return New(os.Getenv("CATCH_URL"), os.Getenv("CATCH_KEY"), os.Getenv("CATCH_ENV"), os.Getenv("CATCH_SERVICE"), os.Getenv("CATCH_RELEASE"))
}

// New returns nil when Catch is not configured.
func New(baseURL, key, environment, service, release string) *Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	key = strings.TrimSpace(key)
	if baseURL == "" || key == "" {
		return nil
	}
	if strings.TrimSpace(environment) == "" {
		environment = "production"
	}
	if strings.TrimSpace(service) == "" {
		service = "motion-api"
	}
	c := &Client{
		endpoint:    baseURL + "/api/ingest",
		key:         key,
		environment: environment,
		service:     service,
		release:     strings.TrimSpace(release),
		queue:       make(chan Event, 256),
		http:        &http.Client{Timeout: 5 * time.Second},
	}
	go c.loop()
	return c
}

// Capture enqueues an event. It is safe to call on a nil client.
func (c *Client) Capture(event Event) {
	if c == nil || !reportingEnabled.Load() {
		return
	}
	if event.Kind == "" {
		event.Kind = "error"
	}
	if event.Source == "" {
		event.Source = "backend"
	}
	if event.Level == "" {
		event.Level = "error"
	}
	if event.Platform == "" {
		event.Platform = "go"
	}
	if event.Environment == "" {
		event.Environment = c.environment
	}
	if event.Service == "" {
		event.Service = c.service
	}
	if event.Release == "" {
		event.Release = c.release
	}
	if event.Timestamp.IsZero() {
		event.Timestamp = time.Now().UTC()
	}
	select {
	case c.queue <- event:
	default:
		// Reporting must never backpressure application traffic.
	}
}

func (c *Client) loop() {
	for event := range c.queue {
		c.send(event)
	}
}

// Startup records a normal application-start event.
func (c *Client) Startup(message string) {
	c.Capture(Event{Kind: "log", Level: "info", Message: message})
}

// Wrap adds best-effort 5xx and panic reporting around any HTTP handler.
// The wrapper is transparent for streaming, WebSocket upgrades and HTTP/2.
func (c *Client) Wrap(next http.Handler) http.Handler {
	if c == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		// A reporter's own ingest request must never generate another report,
		// otherwise a failing self-monitoring path could recurse indefinitely.
		skipReport := r.Header.Get("X-Catch-Reporter") == "1"
		defer func() {
			if recovered := recover(); recovered != nil {
				if recovered == http.ErrAbortHandler {
					panic(recovered)
				}
				if skipReport {
					http.Error(ww, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
					return
				}
				message := strings.TrimSpace(strings.Join(strings.Fields(strings.TrimSpace(toString(recovered))), " "))
				if message == "" {
					message = "panic"
				}
				c.Capture(Event{
					Kind: "error", Level: "fatal", Message: message, ErrorType: "panic",
					Stack: string(debug.Stack()), URL: requestURL(r), Culprit: r.Method + " " + r.URL.Path,
					Request: &Request{Method: r.Method, URL: requestURL(r), Status: http.StatusInternalServerError, DurationMS: time.Since(start).Milliseconds()},
				})
				http.Error(ww, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
				return
			}
			if !skipReport && ww.status >= http.StatusInternalServerError {
				c.Capture(Event{
					Kind: "error", Level: "error", URL: requestURL(r), Culprit: r.Method + " " + r.URL.Path,
					Message: "HTTP " + http.StatusText(ww.status) + " on " + r.Method + " " + r.URL.Path,
					Request: &Request{Method: r.Method, URL: requestURL(r), Status: ww.status, DurationMS: time.Since(start).Milliseconds()},
				})
			}
		}()
		next.ServeHTTP(ww, r)
	})
}

func toString(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	if err, ok := value.(error); ok {
		return err.Error()
	}
	return fmt.Sprint(value)
}

func requestURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + r.Host + r.URL.RequestURI()
}

type responseWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (w *responseWriter) WriteHeader(code int) {
	if w.wrote {
		return
	}
	w.status = code
	w.wrote = true
	w.ResponseWriter.WriteHeader(code)
}

func (w *responseWriter) Write(data []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(data)
}

func (w *responseWriter) Flush() {
	_ = http.NewResponseController(w.ResponseWriter).Flush()
}

func (w *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return http.NewResponseController(w.ResponseWriter).Hijack()
}

func (w *responseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (c *Client) send(event Event) {
	body, err := json.Marshal(map[string]any{"events": []Event{event}})
	if err != nil {
		return
	}
	for attempt := 0; attempt < 3; attempt++ {
		req, err := http.NewRequest(http.MethodPost, c.endpoint, bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Ingest-Key", c.key)
		req.Header.Set("X-Catch-Reporter", "1")
		resp, err := c.http.Do(req)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return
			}
		}
		time.Sleep(time.Duration(attempt+1) * 500 * time.Millisecond)
	}
}
