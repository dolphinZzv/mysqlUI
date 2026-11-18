package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"mysqlui/internal/catchreport"
)

type telemetrySettings struct {
	ErrorTracking bool `json:"errorTracking"`
}

type telemetryManager struct {
	mu    sync.Mutex
	path  string
	saved telemetrySettings
}

func newTelemetryManager(dir string) *telemetryManager {
	m := &telemetryManager{
		path:  filepath.Join(dir, "telemetry.json"),
		saved: telemetrySettings{ErrorTracking: true},
	}
	if data, err := os.ReadFile(m.path); err == nil {
		_ = json.Unmarshal(data, &m.saved)
	}
	return m
}

func (m *telemetryManager) get() telemetrySettings {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.saved
}

func (m *telemetryManager) set(errorTracking bool) error {
	m.mu.Lock()
	m.saved.ErrorTracking = errorTracking
	data, err := json.MarshalIndent(m.saved, "", "  ")
	m.mu.Unlock()
	if err != nil {
		return err
	}
	if dir := filepath.Dir(m.path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	tmp := m.path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, m.path)
}

func (s *Server) telemetryStatusHandler(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.telemetry.get())
}

func (s *Server) telemetrySettingsHandler(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ErrorTracking *bool `json:"errorTracking"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if in.ErrorTracking == nil {
		writeErr(w, http.StatusBadRequest, errors.New("errorTracking is required"))
		return
	}
	if err := s.telemetry.set(*in.ErrorTracking); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	catchreport.SetEnabled(*in.ErrorTracking)
	writeJSON(w, http.StatusOK, s.telemetry.get())
}
