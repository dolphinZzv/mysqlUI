package main

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type transactionStatementResult struct {
	Statement  int    `json:"statement"`
	Preview    string `json:"preview"`
	Success    bool   `json:"success"`
	Message    string `json:"message"`
	Affected   int64  `json:"affected"`
	RowCount   int    `json:"rowCount"`
	DurationMs int64  `json:"durationMs"`
	Error      string `json:"error,omitempty"`
}

type transactionResponse struct {
	Committed  bool                         `json:"committed"`
	RolledBack bool                         `json:"rolledBack"`
	Executed   int                          `json:"executed"`
	Results    []transactionStatementResult `json:"results"`
	Error      string                       `json:"error,omitempty"`
}

// transactionSafeStatement rejects statements that implicitly commit or
// manage transactions themselves. MySQL DDL always causes an implicit commit,
// so a script containing DDL cannot offer an all-or-nothing rollback.
func transactionSafeStatement(stmt string) bool {
	upper := strings.ToUpper(strings.TrimSpace(stmt))
	for _, prefix := range []string{
		"SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "WITH",
		"INSERT", "UPDATE", "DELETE", "REPLACE",
	} {
		if strings.HasPrefix(upper, prefix) {
			if len(upper) == len(prefix) {
				return true
			}
			c := upper[len(prefix)]
			return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '('
		}
	}
	return false
}

func statementPreview(stmt string) string {
	compact := strings.Join(strings.Fields(stmt), " ")
	if len(compact) > 160 {
		return compact[:160] + "…"
	}
	return compact
}

func (s *Server) runTransaction(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
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
	if strings.TrimSpace(in.SQL) == "" {
		writeErr(w, http.StatusBadRequest, errors.New("sql is required"))
		return
	}
	db, err := entry.getDB(in.Database)
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("connection failed: %w", err))
		return
	}
	ctx := r.Context()
	conn, err := db.Conn(ctx)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer conn.Close()

	resp := transactionResponse{Results: []transactionStatementResult{}}
	var statements []string
	if err := scanSQL(strings.NewReader(in.SQL), func(stmt string) error {
		if !transactionSafeStatement(stmt) {
			return fmt.Errorf("statement %d is not transaction-safe: %s", len(statements)+1, statementPreview(stmt))
		}
		statements = append(statements, stmt)
		return nil
	}); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if len(statements) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("no statements supplied"))
		return
	}
	if _, err := conn.ExecContext(ctx, "START TRANSACTION"); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	rowBudget := maxQueryRows
	failed := false
	for i, stmt := range statements {
		start := time.Now()
		res, err := execSQLStatement(ctx, conn, stmt, rowBudget)
		item := transactionStatementResult{
			Statement:  i + 1,
			Preview:    statementPreview(stmt),
			DurationMs: time.Since(start).Milliseconds(),
		}
		if err != nil {
			item.Error = err.Error()
			resp.Results = append(resp.Results, item)
			resp.Error = fmt.Sprintf("statement %d failed: %v", i+1, err)
			failed = true
			break
		}
		item.Success = true
		item.Message = res.Message
		item.Affected = res.Affected
		item.RowCount = res.RowCount
		if res.IsQuery {
			rowBudget -= res.RowCount
			if rowBudget < 0 {
				rowBudget = 0
			}
		}
		resp.Results = append(resp.Results, item)
		resp.Executed++
	}
	if failed {
		if _, err := conn.ExecContext(ctx, "ROLLBACK"); err != nil {
			resp.Error += fmt.Sprintf("; rollback failed: %v", err)
		}
		resp.RolledBack = true
		writeJSON(w, http.StatusOK, resp)
		return
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		resp.Error = fmt.Sprintf("commit failed: %v", err)
		_, _ = conn.ExecContext(ctx, "ROLLBACK")
		resp.RolledBack = true
		writeJSON(w, http.StatusOK, resp)
		return
	}
	resp.Committed = true
	writeJSON(w, http.StatusOK, resp)
}
