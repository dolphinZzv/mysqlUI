package catchreport

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCapturePostsEvent(t *testing.T) {
	received := make(chan Event, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if got := r.Header.Get("X-Ingest-Key"); got != "ck_test" {
			t.Errorf("ingest key = %q", got)
		}
		var payload struct {
			Events []Event `json:"events"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode body: %v", err)
		}
		if len(payload.Events) == 1 {
			received <- payload.Events[0]
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	client := New(server.URL, "ck_test", "test", "motion-api", "v1")
	client.Capture(Event{Message: "boom", Request: &Request{Method: "GET", Status: 500}})

	select {
	case event := <-received:
		if event.Kind != "error" || event.Source != "backend" || event.Level != "error" {
			t.Fatalf("unexpected event defaults: %+v", event)
		}
		if event.Environment != "test" || event.Service != "motion-api" || event.Release != "v1" {
			t.Fatalf("unexpected metadata: %+v", event)
		}
		if event.Timestamp.IsZero() {
			t.Fatal("timestamp was not populated")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for Catch request")
	}
}

func TestNewDisabledWithoutURLOrKey(t *testing.T) {
	if New("", "ck_test", "", "", "") != nil {
		t.Fatal("client should be disabled without a URL")
	}
	if New("http://localhost:8091", "", "", "", "") != nil {
		t.Fatal("client should be disabled without an ingest key")
	}
}

func TestSetEnabledDropsEvents(t *testing.T) {
	called := make(chan struct{}, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called <- struct{}{}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()

	client := New(server.URL, "ck_test", "test", "motion-api", "v1")
	SetEnabled(false)
	defer SetEnabled(true)
	client.Capture(Event{Message: "must not be sent"})
	select {
	case <-called:
		t.Fatal("event was sent while reporting was disabled")
	case <-time.After(300 * time.Millisecond):
	}
}
