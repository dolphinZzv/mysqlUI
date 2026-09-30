package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func TestRequireWriteEnforcesReadOnly(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "connections.json"))
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	ro, err := store.Create(Connection{Name: "ro", Host: "h", User: "u", ReadOnly: true})
	if err != nil {
		t.Fatalf("Create ro: %v", err)
	}
	rw, err := store.Create(Connection{Name: "rw", Host: "h", User: "u"})
	if err != nil {
		t.Fatalf("Create rw: %v", err)
	}

	srv := &Server{store: store}

	check := func(id string, want bool) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/connections/"+id, nil)
		req.SetPathValue("id", id)
		rec := httptest.NewRecorder()
		if got := srv.requireWrite(rec, req); got != want {
			t.Errorf("requireWrite(%q) = %v, want %v", id, got, want)
		}
	}

	check(ro.Info.ID, false)
	check(rw.Info.ID, true)

	// A read-only connection rejects direct writes too.
	req := httptest.NewRequest(http.MethodDelete, "/api/connections/"+ro.Info.ID, nil)
	req.SetPathValue("id", ro.Info.ID)
	if !srv.isReadOnly(req) {
		t.Error("isReadOnly should report true for a read-only connection")
	}

	// Unknown IDs are reported as not found (403 vs 404 handled by requireWrite).
	req = httptest.NewRequest(http.MethodPost, "/api/connections/missing", nil)
	req.SetPathValue("id", "missing")
	rec := httptest.NewRecorder()
	if srv.requireWrite(rec, req) {
		t.Error("requireWrite should reject unknown connections")
	}
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}
