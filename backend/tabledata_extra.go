package main

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
)

var maintenanceOps = map[string]bool{
	"TRUNCATE": true, "OPTIMIZE": true, "ANALYZE": true, "CHECK": true, "REPAIR": true,
}

func (s *Server) tableMaintenance(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	var in struct {
		Operation string `json:"operation"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	op := strings.ToUpper(strings.TrimSpace(in.Operation))
	if !maintenanceOps[op] {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("unsupported maintenance operation %q", in.Operation))
		return
	}
	if _, err := db.ExecContext(r.Context(), op+" TABLE "+qualify(dbName, table)); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "operation": op})
}

func (s *Server) updateTableOptions(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	var in struct {
		Engine    string `json:"engine"`
		Charset   string `json:"charset"`
		Collation string `json:"collation"`
		Comment   string `json:"comment"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	var clauses []string
	if engine := strings.TrimSpace(in.Engine); engine != "" {
		if !validIdent(engine) {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid engine %q", engine))
			return
		}
		clauses = append(clauses, "ENGINE="+engine)
	}
	if charset := strings.TrimSpace(in.Charset); charset != "" {
		if !validIdent(charset) {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid charset %q", charset))
			return
		}
		clauses = append(clauses, "DEFAULT CHARACTER SET "+charset)
	}
	if collation := strings.TrimSpace(in.Collation); collation != "" {
		if !validIdent(collation) {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid collation %q", collation))
			return
		}
		clauses = append(clauses, "COLLATE "+collation)
	}
	clauses = append(clauses, "COMMENT="+quoteSQLString(in.Comment))
	q := "ALTER TABLE " + qualify(dbName, table) + " " + strings.Join(clauses, " ")
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) bulkInsertRows(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	var in struct {
		Columns []string `json:"columns"`
		Rows    [][]any  `json:"rows"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if len(in.Columns) == 0 || len(in.Rows) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("columns and rows are required"))
		return
	}
	if len(in.Rows) > 5000 {
		writeErr(w, http.StatusBadRequest, errors.New("too many rows; maximum is 5000 per request"))
		return
	}
	cols := make([]string, len(in.Columns))
	for i, c := range in.Columns {
		if !validIdent(c) {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid column name %q", c))
			return
		}
		cols[i] = quoteIdent(c)
	}
	for i, row := range in.Rows {
		if len(row) != len(cols) {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("row %d has %d values, expected %d", i+1, len(row), len(cols)))
			return
		}
	}
	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer tx.Rollback() //nolint:errcheck
	prefix := "INSERT INTO " + qualify(dbName, table) + " (" + strings.Join(cols, ",") + ") VALUES "
	const batchSize = 200
	total := int64(0)
	for start := 0; start < len(in.Rows); start += batchSize {
		end := start + batchSize
		if end > len(in.Rows) {
			end = len(in.Rows)
		}
		batch := in.Rows[start:end]
		placeholders := make([]string, len(batch))
		args := make([]any, 0, len(batch)*len(cols))
		for i, row := range batch {
			placeholders[i] = "(" + placeholdersN(len(cols)) + ")"
			args = append(args, row...)
		}
		res, err := tx.ExecContext(r.Context(), prefix+strings.Join(placeholders, ","), args...)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		n, _ := res.RowsAffected()
		total += n
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "affected": total})
}
