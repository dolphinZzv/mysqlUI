package main

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// ---- database / view / programmable object management -------------------

func (s *Server) dropDatabase(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	dbName := strings.TrimSpace(r.PathValue("db"))
	if !validIdent(dbName) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid database name %q", dbName))
		return
	}
	if systemSchemas[strings.ToLower(dbName)] {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("%q is a reserved system database", dbName))
		return
	}
	db, ok := s.db(w, r, entry, "")
	if !ok {
		return
	}
	if _, err := db.ExecContext(r.Context(), "DROP DATABASE "+quoteIdent(dbName)); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "name": dbName})
}

type viewRequest struct {
	Name       string `json:"name"`
	Definition string `json:"definition"`
}

func (s *Server) saveView(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	dbName := strings.TrimSpace(r.PathValue("db"))
	if !validIdent(dbName) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid database name %q", dbName))
		return
	}
	var in viewRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	name := strings.TrimSpace(in.Name)
	if !validIdent(name) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid view name %q", name))
		return
	}
	definition := strings.TrimSpace(strings.TrimRight(strings.TrimSpace(in.Definition), ";"))
	if definition == "" || !isQueryStatement(definition) {
		writeErr(w, http.StatusBadRequest, errors.New("view definition must be a SELECT/WITH query"))
		return
	}
	db, ok := s.db(w, r, entry, dbName)
	if !ok {
		return
	}
	q := "CREATE OR REPLACE VIEW " + qualify(dbName, name) + " AS " + definition
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "name": name})
}

type objectRequest struct {
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Definition string `json:"definition"`
}

// saveObject creates or replaces a stored procedure, function, trigger or
// event. The definition is a complete CREATE statement (as returned by SHOW
// CREATE), executed on a single pinned connection.
func (s *Server) saveObject(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	dbName := strings.TrimSpace(r.PathValue("db"))
	if !validIdent(dbName) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid database name %q", dbName))
		return
	}
	var in objectRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	kind := strings.ToUpper(strings.TrimSpace(in.Kind))
	switch kind {
	case "PROCEDURE", "FUNCTION", "TRIGGER", "EVENT":
	default:
		writeErr(w, http.StatusBadRequest, fmt.Errorf("unsupported object kind %q", in.Kind))
		return
	}
	name := strings.TrimSpace(in.Name)
	if !validIdent(name) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid object name %q", name))
		return
	}
	definition := strings.TrimSpace(in.Definition)
	if definition == "" || !strings.HasPrefix(strings.ToUpper(definition), "CREATE") {
		writeErr(w, http.StatusBadRequest, errors.New("definition must be a complete CREATE statement"))
		return
	}

	db, ok := s.db(w, r, entry, dbName)
	if !ok {
		return
	}
	conn, err := db.Conn(r.Context())
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("connection failed: %w", err))
		return
	}
	defer conn.Close()

	drop := "DROP " + kind + " IF EXISTS " + qualify(dbName, name)
	if _, err := conn.ExecContext(r.Context(), drop); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	if _, err := conn.ExecContext(r.Context(), definition); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "kind": kind, "name": name})
}

type foreignKeyRequest struct {
	Name        string `json:"name"`
	Column      string `json:"column"`
	RefDatabase string `json:"refDatabase"`
	RefTable    string `json:"refTable"`
	RefColumn   string `json:"refColumn"`
	OnDelete    string `json:"onDelete"`
	OnUpdate    string `json:"onUpdate"`
}

func normalizeFKAction(action string) (string, bool) {
	action = strings.ToUpper(strings.Join(strings.Fields(action), " "))
	if action == "" {
		return "", true
	}
	switch action {
	case "CASCADE", "SET NULL", "RESTRICT", "NO ACTION", "SET DEFAULT":
		return action, true
	default:
		return "", false
	}
}

func (s *Server) addForeignKey(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	var in foreignKeyRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	column := strings.TrimSpace(in.Column)
	refDB := strings.TrimSpace(in.RefDatabase)
	if refDB == "" {
		refDB = dbName
	}
	refTable := strings.TrimSpace(in.RefTable)
	refColumn := strings.TrimSpace(in.RefColumn)
	if !validIdent(column) || !validIdent(refDB) || !validIdent(refTable) || !validIdent(refColumn) {
		writeErr(w, http.StatusBadRequest, errors.New("invalid foreign key column or table name"))
		return
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		name = "fk_" + table + "_" + column
	}
	if len(name) > 64 {
		name = name[:64]
	}
	if !validIdent(name) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid constraint name %q", name))
		return
	}
	onDelete, okDelete := normalizeFKAction(in.OnDelete)
	onUpdate, okUpdate := normalizeFKAction(in.OnUpdate)
	if !okDelete || !okUpdate {
		writeErr(w, http.StatusBadRequest, errors.New("invalid ON DELETE/ON UPDATE action"))
		return
	}
	q := fmt.Sprintf("ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s)",
		qualify(dbName, table), quoteIdent(name), quoteIdent(column), qualify(refDB, refTable), quoteIdent(refColumn))
	if onDelete != "" {
		q += " ON DELETE " + onDelete
	}
	if onUpdate != "" {
		q += " ON UPDATE " + onUpdate
	}
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "name": name})
}

func (s *Server) dropForeignKey(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	name := strings.TrimSpace(r.PathValue("name"))
	if !validIdent(name) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid constraint name %q", name))
		return
	}
	q := "ALTER TABLE " + qualify(dbName, table) + " DROP FOREIGN KEY " + quoteIdent(name)
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
