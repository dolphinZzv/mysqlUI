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
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// snapshotTable is the persisted, point-in-time structure of one table.
type snapshotTable struct {
	Name      string         `json:"name"`
	Type      string         `json:"type"`
	CreateSQL string         `json:"createSql"`
	Columns   []schemaColumn `json:"columns"`
	Indexes   []schemaIndex  `json:"indexes"`
}

// SchemaSnapshot is a sealed ("封板") version of a database's structure.
type SchemaSnapshot struct {
	ID           string          `json:"id"`
	ConnectionID string          `json:"connectionId"`
	Database     string          `json:"database"`
	Name         string          `json:"name"`
	Note         string          `json:"note,omitempty"`
	CreatedAt    time.Time       `json:"createdAt"`
	TableCount   int             `json:"tableCount"`
	Tables       []snapshotTable `json:"tables,omitempty"`
}

// SchemaVersionStore persists schema snapshots to a JSON file.
type SchemaVersionStore struct {
	mu   sync.RWMutex
	path string
	list []SchemaSnapshot
}

// NewSchemaVersionStore loads (or creates) the snapshot store at path.
func NewSchemaVersionStore(path string) (*SchemaVersionStore, error) {
	s := &SchemaVersionStore{path: path, list: []SchemaSnapshot{}}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return nil, err
	}
	if len(data) > 0 {
		if err := json.Unmarshal(data, &s.list); err != nil {
			return nil, err
		}
	}
	if s.list == nil {
		s.list = []SchemaSnapshot{}
	}
	// Backfill TableCount for stores written before the field existed.
	for i := range s.list {
		if s.list[i].TableCount == 0 {
			s.list[i].TableCount = len(s.list[i].Tables)
		}
	}
	return s, nil
}

func (s *SchemaVersionStore) saveLocked() error {
	if dir := filepath.Dir(s.path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	data, err := json.MarshalIndent(s.list, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// List returns snapshots for a connection (optionally filtered by database),
// newest first. Table bodies are omitted; use Get for the full structure.
func (s *SchemaVersionStore) List(connectionID, database string) []SchemaSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []SchemaSnapshot{}
	for _, v := range s.list {
		if v.ConnectionID != connectionID {
			continue
		}
		if database != "" && !strings.EqualFold(v.Database, database) {
			continue
		}
		v.TableCount = len(v.Tables)
		v.Tables = nil
		out = append(out, v)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

// Get returns a single snapshot by id.
func (s *SchemaVersionStore) Get(connectionID, id string) (SchemaSnapshot, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, v := range s.list {
		if v.ID == id && v.ConnectionID == connectionID {
			return v, true
		}
	}
	return SchemaSnapshot{}, false
}

// Add inserts a snapshot.
func (s *SchemaVersionStore) Add(v SchemaSnapshot) (SchemaSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v.ID == "" {
		v.ID = uuid.NewString()
	}
	if v.CreatedAt.IsZero() {
		v.CreatedAt = time.Now().UTC()
	}
	v.TableCount = len(v.Tables)
	s.list = append(s.list, v)
	if err := s.saveLocked(); err != nil {
		s.list = s.list[:len(s.list)-1]
		return SchemaSnapshot{}, err
	}
	return v, nil
}

// Delete removes a snapshot.
func (s *SchemaVersionStore) Delete(connectionID, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, v := range s.list {
		if v.ID == id && v.ConnectionID == connectionID {
			prev := s.list
			s.list = append(append([]SchemaSnapshot{}, s.list[:i]...), s.list[i+1:]...)
			if err := s.saveLocked(); err != nil {
				s.list = prev
				return err
			}
			return nil
		}
	}
	return errors.New("version not found")
}

// ---- capture ---------------------------------------------------------------

// captureDatabase snapshots every table/view in a database.
func captureDatabase(ctx context.Context, db *sql.DB, database string) ([]snapshotTable, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT TABLE_NAME, COALESCE(TABLE_TYPE,'BASE TABLE')
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ?
		ORDER BY TABLE_NAME`, database)
	if err != nil {
		return nil, err
	}
	type tableRef struct{ name, typ string }
	refs := []tableRef{}
	for rows.Next() {
		var r tableRef
		if err := rows.Scan(&r.name, &r.typ); err != nil {
			rows.Close()
			return nil, err
		}
		refs = append(refs, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]snapshotTable, 0, len(refs))
	for _, ref := range refs {
		st, err := captureTable(ctx, db, database, ref.name, ref.typ)
		if err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, nil
}

func captureTable(ctx context.Context, db *sql.DB, database, table, tableType string) (snapshotTable, error) {
	st := snapshotTable{Name: table, Type: tableType, Columns: []schemaColumn{}, Indexes: []schemaIndex{}}
	schema, err := loadSchema(ctx, db, database, table)
	if err != nil {
		return st, err
	}
	st.Columns = schema.Columns
	st.Indexes = schema.Indexes

	rows, err := db.QueryContext(ctx, "SHOW CREATE TABLE "+qualify(database, table))
	if err != nil {
		return st, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return st, err
	}
	if rows.Next() {
		vals := make([]sql.NullString, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return st, err
		}
		// Column 1 is "Create Table" / "Create View".
		if len(vals) > 1 {
			st.CreateSQL = vals[1].String
		}
	}
	return st, nil
}

// ---- diff ------------------------------------------------------------------

type tableSummary struct {
	Name      string `json:"name"`
	CreateSQL string `json:"createSql"`
}

type tableSchemaDiff struct {
	Table  string `json:"table"`
	Status string `json:"status"` // "changed"
	schemaDiffResponse
}

type databaseDiffResponse struct {
	TablesAdded   []tableSummary    `json:"tablesAdded"`
	TablesRemoved []tableSummary    `json:"tablesRemoved"`
	TablesChanged []tableSchemaDiff `json:"tablesChanged"`
	DDL           []string          `json:"ddl"`
}

func snapshotToSchema(t snapshotTable) *schemaTable {
	return &schemaTable{Columns: t.Columns, Indexes: t.Indexes}
}

// diffDatabases compares two captured databases and returns the DDL that turns
// base into target. The altered tables live in database (both sides are
// versions of the same database).
func diffDatabases(base, target []snapshotTable, database string) databaseDiffResponse {
	resp := databaseDiffResponse{
		TablesAdded:   []tableSummary{},
		TablesRemoved: []tableSummary{},
		TablesChanged: []tableSchemaDiff{},
		DDL:           []string{},
	}

	baseMap := map[string]snapshotTable{}
	for _, t := range base {
		baseMap[strings.ToLower(t.Name)] = t
	}
	tgtMap := map[string]snapshotTable{}
	for _, t := range target {
		tgtMap[strings.ToLower(t.Name)] = t
	}

	for _, t := range target {
		if _, ok := baseMap[strings.ToLower(t.Name)]; !ok {
			resp.TablesAdded = append(resp.TablesAdded, tableSummary{Name: t.Name, CreateSQL: t.CreateSQL})
			if strings.TrimSpace(t.CreateSQL) != "" {
				resp.DDL = append(resp.DDL, strings.TrimRight(strings.TrimSpace(t.CreateSQL), ";")+";")
			}
		}
	}
	for _, t := range base {
		if _, ok := tgtMap[strings.ToLower(t.Name)]; !ok {
			resp.TablesRemoved = append(resp.TablesRemoved, tableSummary{Name: t.Name, CreateSQL: t.CreateSQL})
			resp.DDL = append(resp.DDL, "DROP TABLE "+qualify(database, t.Name)+";")
		}
	}
	for _, t := range target {
		b, ok := baseMap[strings.ToLower(t.Name)]
		if !ok {
			continue
		}
		d := diffSchemaTable(snapshotToSchema(t), snapshotToSchema(b), database, t.Name)
		if len(d.DDL) == 0 {
			continue
		}
		resp.TablesChanged = append(resp.TablesChanged, tableSchemaDiff{Table: t.Name, Status: "changed", schemaDiffResponse: d})
		resp.DDL = append(resp.DDL, d.DDL...)
	}
	return resp
}

// ---- HTTP handlers ---------------------------------------------------------

func (s *Server) listSchemaVersions(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	database := r.URL.Query().Get("database")
	if database != "" && !validIdent(database) {
		writeErr(w, http.StatusBadRequest, errors.New("invalid database"))
		return
	}
	writeJSON(w, http.StatusOK, s.versions.List(entry.Info.ID, database))
}

func (s *Server) createSchemaVersion(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	var in struct {
		Database string `json:"database"`
		Name     string `json:"name"`
		Note     string `json:"note"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	if !validIdent(in.Database) {
		writeErr(w, http.StatusBadRequest, errors.New("invalid database"))
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = "v" + time.Now().UTC().Format("20060102-150405")
	}
	db, err := entry.getDB(in.Database)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	tables, err := captureDatabase(r.Context(), db, in.Database)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	snap, err := s.versions.Add(SchemaSnapshot{
		ConnectionID: entry.Info.ID,
		Database:     in.Database,
		Name:         name,
		Note:         strings.TrimSpace(in.Note),
		Tables:       tables,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, snap)
}

func (s *Server) getSchemaVersion(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	snap, found := s.versions.Get(entry.Info.ID, r.PathValue("versionId"))
	if !found {
		writeErr(w, http.StatusNotFound, errors.New("version not found"))
		return
	}
	writeJSON(w, http.StatusOK, snap)
}

func (s *Server) deleteSchemaVersion(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	if err := s.versions.Delete(entry.Info.ID, r.PathValue("versionId")); err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type schemaRef struct {
	VersionID string `json:"versionId"`
}

func (s *Server) resolveSchemaRef(ctx context.Context, entry *ConnEntry, database string, ref schemaRef) ([]snapshotTable, error) {
	if strings.TrimSpace(ref.VersionID) == "" {
		db, err := entry.getDB(database)
		if err != nil {
			return nil, err
		}
		return captureDatabase(ctx, db, database)
	}
	snap, found := s.versions.Get(entry.Info.ID, ref.VersionID)
	if !found {
		return nil, errors.New("version not found")
	}
	if !strings.EqualFold(snap.Database, database) {
		return nil, errors.New("version belongs to a different database")
	}
	return snap.Tables, nil
}

func (s *Server) diffSchemaVersions(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	var in struct {
		Database string    `json:"database"`
		Base     schemaRef `json:"base"`
		Target   schemaRef `json:"target"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	if !validIdent(in.Database) {
		writeErr(w, http.StatusBadRequest, errors.New("invalid database"))
		return
	}
	base, err := s.resolveSchemaRef(r.Context(), entry, in.Database, in.Base)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	target, err := s.resolveSchemaRef(r.Context(), entry, in.Database, in.Target)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, diffDatabases(base, target, in.Database))
}
