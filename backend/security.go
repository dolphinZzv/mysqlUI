package main

import (
	"errors"
	"net/http"
)

// errReadOnly is returned when a write is attempted on a read-only connection.
var errReadOnly = errors.New("connection is read-only; write operations are disabled")

// isReadOnly reports whether the connection in the URL is flagged read-only.
func (s *Server) isReadOnly(r *http.Request) bool {
	entry, err := s.store.Get(r.PathValue("id"))
	return err == nil && entry.Info.ReadOnly
}

// requireWrite writes an error and reports whether the request may proceed with
// a write. The read-only flag is enforced by the server, not just hidden in the
// UI.
func (s *Server) requireWrite(w http.ResponseWriter, r *http.Request) bool {
	entry, err := s.store.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return false
	}
	if entry.Info.ReadOnly {
		writeErr(w, http.StatusForbidden, errReadOnly)
		return false
	}
	return true
}
