package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

type crossCopyRequest struct {
	SourceConnectionID string `json:"sourceConnectionId"`
	SourceDatabase     string `json:"sourceDatabase"`
	SourceTable        string `json:"sourceTable"`
	TargetConnectionID string `json:"targetConnectionId"`
	TargetDatabase     string `json:"targetDatabase"`
	TargetTable        string `json:"targetTable"`
	DropTarget         bool   `json:"dropTarget"`
	CopyData           bool   `json:"copyData"`
	CopyStructure      bool   `json:"copyStructure"`
}

// copyTableAcrossConnections copies a table's structure and/or rows between
// two saved connections. The target connection's read-only flag is enforced.
func (s *Server) copyTableAcrossConnections(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(r.PathValue("id")) != "" && !s.requireWrite(w, r) {
		return
	}
	var in crossCopyRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if !validIdent(in.SourceDatabase) || !validIdent(in.SourceTable) ||
		!validIdent(in.TargetDatabase) || !validIdent(in.TargetTable) {
		writeErr(w, http.StatusBadRequest, errors.New("invalid source or target table"))
		return
	}
	srcEntry, err := s.store.Get(in.SourceConnectionID)
	if err != nil {
		writeErr(w, http.StatusNotFound, fmt.Errorf("source connection: %w", err))
		return
	}
	tgtEntry, err := s.store.Get(in.TargetConnectionID)
	if err != nil {
		writeErr(w, http.StatusNotFound, fmt.Errorf("target connection: %w", err))
		return
	}
	if tgtEntry.Info.ReadOnly {
		writeErr(w, http.StatusForbidden, errReadOnly)
		return
	}
	srcDB, err := srcEntry.getDB(in.SourceDatabase)
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("source connection failed: %w", err))
		return
	}
	tgtDB, err := tgtEntry.getDB(in.TargetDatabase)
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("target connection failed: %w", err))
		return
	}
	ctx := r.Context()

	var exists int
	if err := tgtDB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, in.TargetDatabase, in.TargetTable).Scan(&exists); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	if exists > 0 && in.DropTarget {
		if _, err := tgtDB.ExecContext(ctx, "DROP TABLE "+qualify(in.TargetDatabase, in.TargetTable)); err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		exists = 0
	}

	if in.CopyStructure {
		if exists > 0 {
			writeErr(w, http.StatusConflict, fmt.Errorf("target table %s.%s already exists; enable drop target or copy data only", in.TargetDatabase, in.TargetTable))
			return
		}
		var name, createSQL string
		if err := srcDB.QueryRowContext(ctx, "SHOW CREATE TABLE "+qualify(in.SourceDatabase, in.SourceTable)).Scan(&name, &createSQL); err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		createSQL = renameCreateTable(createSQL, in.SourceTable, in.TargetTable)
		if _, err := tgtDB.ExecContext(ctx, createSQL); err != nil {
			writeErr(w, http.StatusBadGateway, fmt.Errorf("create target table: %w", err))
			return
		}
		exists = 1
	}
	if exists == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("target table does not exist; enable structure copy first"))
		return
	}

	rowsCopied := int64(0)
	if in.CopyData {
		rowsCopied, err = copyTableRows(ctx, srcDB, tgtDB, in.SourceDatabase, in.SourceTable, in.TargetDatabase, in.TargetTable)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"target":     in.TargetDatabase + "." + in.TargetTable,
		"rowsCopied": rowsCopied,
	})
}

func renameCreateTable(createSQL, sourceTable, targetTable string) string {
	open := strings.Index(createSQL, "(")
	if open < 0 {
		return createSQL
	}
	return "CREATE TABLE " + quoteIdent(targetTable) + " " + strings.TrimSpace(createSQL[open:])
}

func copyTableRows(ctx context.Context, srcDB, tgtDB *sql.DB, srcSchema, srcTable, dstSchema, dstTable string) (int64, error) {
	rows, err := srcDB.QueryContext(ctx, "SELECT * FROM "+qualify(srcSchema, srcTable))
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return 0, err
	}
	tgtColumns, err := tableColumns(ctx, tgtDB, dstSchema, dstTable)
	if err != nil {
		return 0, err
	}
	targetSet := map[string]string{}
	for _, c := range tgtColumns {
		targetSet[strings.ToLower(c)] = c
	}
	for _, c := range columns {
		if _, ok := targetSet[strings.ToLower(c)]; !ok {
			return 0, fmt.Errorf("target table is missing source column %q", c)
		}
	}
	tx, err := tgtDB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback() //nolint:errcheck
	quoted := make([]string, len(columns))
	for i, c := range columns {
		quoted[i] = quoteIdent(targetSet[strings.ToLower(c)])
	}
	prefix := "INSERT INTO " + qualify(dstSchema, dstTable) + " (" + strings.Join(quoted, ",") + ") VALUES "
	const batchSize = 200
	var total int64
	batch := make([][]any, 0, batchSize)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		placeholders := make([]string, len(batch))
		args := make([]any, 0, len(batch)*len(columns))
		for i, row := range batch {
			placeholders[i] = "(" + placeholdersN(len(columns)) + ")"
			args = append(args, row...)
		}
		res, err := tx.ExecContext(ctx, prefix+strings.Join(placeholders, ","), args...)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		total += n
		batch = batch[:0]
		return nil
	}
	for rows.Next() {
		vals := make([]any, len(columns))
		ptrs := make([]any, len(columns))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return total, err
		}
		row := make([]any, len(vals))
		for i, v := range vals {
			row[i] = normalizeValue(v)
		}
		batch = append(batch, row)
		if len(batch) >= batchSize {
			if err := flush(); err != nil {
				return total, err
			}
		}
	}
	if err := rows.Err(); err != nil {
		return total, err
	}
	if err := flush(); err != nil {
		return total, err
	}
	if err := tx.Commit(); err != nil {
		return total, err
	}
	return total, nil
}
