package main

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
)

type copyTableRequest struct {
	TargetDatabase string `json:"targetDatabase"`
	TargetTable    string `json:"targetTable"`
	DropTarget     bool   `json:"dropTarget"`
	CopyData       bool   `json:"copyData"`
}

// copyTable creates a table with the same structure as the source (including
// indexes) in the same or another database on the same connection, optionally
// dropping the target first and copying the rows.
func (s *Server) copyTable(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	var in copyTableRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	targetDB := strings.TrimSpace(in.TargetDatabase)
	if targetDB == "" {
		targetDB = dbName
	}
	targetTable := strings.TrimSpace(in.TargetTable)
	if !validIdent(targetDB) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid target database %q", in.TargetDatabase))
		return
	}
	if !validIdent(targetTable) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid target table %q", in.TargetTable))
		return
	}
	if targetDB == dbName && targetTable == table {
		writeErr(w, http.StatusBadRequest, errors.New("target must differ from the source table"))
		return
	}
	// The target database must exist.
	var exists int
	if err := db.QueryRowContext(r.Context(), "SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", targetDB).Scan(&exists); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}

	src := qualify(dbName, table)
	dst := qualify(targetDB, targetTable)
	ctx := r.Context()

	if in.DropTarget {
		if _, err := db.ExecContext(ctx, "DROP TABLE IF EXISTS "+dst); err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
	}
	if _, err := db.ExecContext(ctx, "CREATE TABLE "+dst+" LIKE "+src); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}

	copied := int64(0)
	if in.CopyData {
		res, err := db.ExecContext(ctx, "INSERT INTO "+dst+" SELECT * FROM "+src)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		copied, _ = res.RowsAffected()
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"ok":         true,
		"target":     targetDB + "." + targetTable,
		"rowsCopied": copied,
	})
}
