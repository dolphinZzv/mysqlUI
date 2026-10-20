package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type backupSettings struct {
	Enabled       bool      `json:"enabled"`
	IntervalHours int       `json:"intervalHours"`
	RetentionDays int       `json:"retentionDays"`
	Directory     string    `json:"directory"`
	LastRun       time.Time `json:"lastRun,omitempty"`
	LastError     string    `json:"lastError,omitempty"`
}

type backupManager struct {
	mu       sync.Mutex
	path     string
	dataDir  string
	store    *Store
	settings backupSettings
	running  bool
}

func newBackupManager(dataDir string, store *Store) *backupManager {
	m := &backupManager{
		path:    filepath.Join(dataDir, "backups.json"),
		dataDir: dataDir,
		store:   store,
		settings: backupSettings{
			Enabled:       false,
			IntervalHours: 24,
			RetentionDays: 7,
			Directory:     filepath.Join(dataDir, "backups"),
		},
	}
	if data, err := os.ReadFile(m.path); err == nil {
		_ = json.Unmarshal(data, &m.settings)
	}
	if m.settings.IntervalHours <= 0 {
		m.settings.IntervalHours = 24
	}
	if m.settings.RetentionDays <= 0 {
		m.settings.RetentionDays = 7
	}
	if strings.TrimSpace(m.settings.Directory) == "" {
		m.settings.Directory = filepath.Join(dataDir, "backups")
	}
	return m
}

func (m *backupManager) status() backupSettings {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.settings
}

func (m *backupManager) configure(enabled bool, intervalHours, retentionDays int, directory string) error {
	if intervalHours <= 0 {
		intervalHours = 24
	}
	if retentionDays <= 0 {
		retentionDays = 7
	}
	directory = strings.TrimSpace(directory)
	if directory == "" {
		directory = filepath.Join(m.dataDir, "backups")
	}
	m.mu.Lock()
	m.settings.Enabled = enabled
	m.settings.IntervalHours = intervalHours
	m.settings.RetentionDays = retentionDays
	m.settings.Directory = directory
	settings := m.settings
	m.mu.Unlock()
	return m.save(settings)
}

func (m *backupManager) save(s backupSettings) error {
	data, err := json.MarshalIndent(s, "", "  ")
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

func (m *backupManager) run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.mu.Lock()
			enabled := m.settings.Enabled
			due := time.Since(m.settings.LastRun) >= time.Duration(m.settings.IntervalHours)*time.Hour
			m.mu.Unlock()
			if enabled && due {
				if err := m.runOnce(ctx); err != nil {
					fmt.Printf("scheduled backup failed: %v\n", err)
				}
			}
		}
	}
}

func (m *backupManager) runOnce(ctx context.Context) error {
	m.mu.Lock()
	if m.running {
		m.mu.Unlock()
		return errors.New("backup is already running")
	}
	m.running = true
	settings := m.settings
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		m.running = false
		m.mu.Unlock()
	}()

	if err := os.MkdirAll(settings.Directory, 0o755); err != nil {
		m.finish(settings, err)
		return err
	}
	var firstErr error
	stamp := time.Now().Format("20060102-150405")
	for _, info := range m.store.List() {
		entry, err := m.store.Get(info.ID)
		if err != nil {
			continue
		}
		db, err := entry.getDB("")
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		rows, err := db.QueryContext(ctx, "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME")
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		var schemas []string
		for rows.Next() {
			var name string
			if rows.Scan(&name) == nil && !systemSchemas[strings.ToLower(name)] {
				schemas = append(schemas, name)
			}
		}
		rows.Close()
		connDir := filepath.Join(settings.Directory, safeFilePart(info.Name))
		if err := os.MkdirAll(connDir, 0o755); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		for _, schema := range schemas {
			filePath := filepath.Join(connDir, safeFilePart(schema)+"-"+stamp+".sql")
			if err := writeBackupFile(ctx, filePath, db, schema); err != nil {
				if firstErr == nil {
					firstErr = err
				}
			}
		}
	}
	m.cleanup(settings)
	m.finish(settings, firstErr)
	return firstErr
}

func (m *backupManager) finish(settings backupSettings, err error) {
	m.mu.Lock()
	m.settings.LastRun = time.Now()
	if err != nil {
		m.settings.LastError = err.Error()
	} else {
		m.settings.LastError = ""
	}
	updated := m.settings
	m.mu.Unlock()
	_ = m.save(updated)
}

func (m *backupManager) cleanup(settings backupSettings) {
	cutoff := time.Now().Add(-time.Duration(settings.RetentionDays) * 24 * time.Hour)
	_ = filepath.WalkDir(settings.Directory, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(strings.ToLower(d.Name()), ".sql") {
			return nil
		}
		if info, err := d.Info(); err == nil && info.ModTime().Before(cutoff) {
			_ = os.Remove(path)
		}
		return nil
	})
}

func writeBackupFile(ctx context.Context, path string, db *sql.DB, schema string) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := fmt.Fprintf(f, "-- MySQL UI backup\n-- Database: %s\n-- Generated: %s\n\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n",
		schema, time.Now().Format("2006-01-02 15:04:05")); err != nil {
		return err
	}
	writeDatabaseDump(ctx, f, db, schema)
	if _, err := fmt.Fprint(f, "SET FOREIGN_KEY_CHECKS=1;\n"); err != nil {
		return err
	}
	return f.Close()
}

func safeFilePart(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	if b.Len() == 0 {
		return "unnamed"
	}
	return b.String()
}

func (s *Server) backupStatusHandler(w http.ResponseWriter, r *http.Request) {
	if s.backups == nil {
		writeErr(w, http.StatusServiceUnavailable, errors.New("backup manager is unavailable"))
		return
	}
	m := s.backups
	m.mu.Lock()
	settings := m.settings
	running := m.running
	m.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":       settings.Enabled,
		"intervalHours": settings.IntervalHours,
		"retentionDays": settings.RetentionDays,
		"directory":     settings.Directory,
		"lastRun":       settings.LastRun,
		"lastError":     settings.LastError,
		"running":       running,
	})
}

func (s *Server) backupSettingsHandler(w http.ResponseWriter, r *http.Request) {
	if s.backups == nil {
		writeErr(w, http.StatusServiceUnavailable, errors.New("backup manager is unavailable"))
		return
	}
	var in struct {
		Enabled       bool   `json:"enabled"`
		IntervalHours int    `json:"intervalHours"`
		RetentionDays int    `json:"retentionDays"`
		Directory     string `json:"directory"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := s.backups.configure(in.Enabled, in.IntervalHours, in.RetentionDays, in.Directory); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	s.backupStatusHandler(w, r)
}

func (s *Server) backupRunHandler(w http.ResponseWriter, r *http.Request) {
	if s.backups == nil {
		writeErr(w, http.StatusServiceUnavailable, errors.New("backup manager is unavailable"))
		return
	}
	if err := s.backups.runOnce(r.Context()); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	s.backupStatusHandler(w, r)
}
