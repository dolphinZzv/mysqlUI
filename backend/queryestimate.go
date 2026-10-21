package main

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// estimateQueryRows runs EXPLAIN for a DML statement and sums the estimated
// rows. It is advisory only: a failure returns -1 so the client can still run
// the statement after its own confirmation.
func (s *Server) estimateQueryRows(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	var in struct {
		Database string `json:"database"`
		SQL      string `json:"sql"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	stmt := strings.TrimSpace(in.SQL)
	upper := strings.ToUpper(stmt)
	isDML := strings.HasPrefix(upper, "UPDATE") || strings.HasPrefix(upper, "DELETE")
	if !isDML {
		writeJSON(w, http.StatusOK, map[string]any{
			"estimatedRows": int64(-1),
			"isDML":         false,
			"error":         "only UPDATE/DELETE statements can be estimated",
		})
		return
	}
	if strings.HasSuffix(stmt, ";") {
		stmt = strings.TrimSpace(strings.TrimSuffix(stmt, ";"))
	}
	if strings.Contains(stmt, ";") {
		writeErr(w, http.StatusBadRequest, errors.New("estimate requires a single statement"))
		return
	}
	db, err := entry.getDB(in.Database)
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("connection failed: %w", err))
		return
	}
	rows, err := db.QueryContext(r.Context(), "EXPLAIN "+stmt)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"estimatedRows": int64(-1),
			"isDML":         true,
			"error":         err.Error(),
		})
		return
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	rowCol := -1
	for i, c := range cols {
		if strings.EqualFold(c, "rows") {
			rowCol = i
			break
		}
	}
	var total int64
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			break
		}
		if rowCol >= 0 && rowCol < len(vals) {
			total += estimateInt(vals[rowCol])
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"estimatedRows": total, "isDML": true})
}

func estimateInt(v any) int64 {
	switch x := v.(type) {
	case int64:
		return x
	case int:
		return int64(x)
	case []byte:
		n, _ := strconv.ParseInt(string(x), 10, 64)
		return n
	case string:
		n, _ := strconv.ParseInt(x, 10, 64)
		return n
	}
	return 0
}

var _ = sql.ErrNoRows
