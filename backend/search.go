package main

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
)

type tableHit struct {
	Database  string `json:"database"`
	Table     string `json:"table"`
	TableType string `json:"tableType"`
	Comment   string `json:"comment"`
}

type columnHit struct {
	Database   string `json:"database"`
	Table      string `json:"table"`
	Column     string `json:"column"`
	ColumnType string `json:"columnType"`
	Key        string `json:"key"`
	Comment    string `json:"comment"`
}

// globalSearch finds tables and columns whose name matches the query across all
// non-system schemas.
func (s *Server) globalSearch(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeErr(w, http.StatusBadRequest, errors.New("q is required"))
		return
	}
	limit := parseIntDefault(r.URL.Query().Get("limit"), 50)
	if limit <= 0 || limit > 300 {
		limit = 50
	}
	like := "%" + query + "%"

	tables := make([]tableHit, 0)
	rows, err := db.QueryContext(r.Context(), `
		SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, COALESCE(TABLE_COMMENT,'')
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA NOT IN ('information_schema','performance_schema','mysql','sys')
		  AND TABLE_NAME LIKE ?
		ORDER BY TABLE_SCHEMA, TABLE_NAME
		LIMIT `+strconv.Itoa(limit), like)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	for rows.Next() {
		var t tableHit
		if err := rows.Scan(&t.Database, &t.Table, &t.TableType, &t.Comment); err == nil {
			tables = append(tables, t)
		}
	}
	rows.Close()

	columns := make([]columnHit, 0)
	colRows, err := db.QueryContext(r.Context(), `
		SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COALESCE(COLUMN_KEY,''), COALESCE(COLUMN_COMMENT,'')
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA NOT IN ('information_schema','performance_schema','mysql','sys')
		  AND COLUMN_NAME LIKE ?
		ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION
		LIMIT `+strconv.Itoa(limit), like)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	for colRows.Next() {
		var c columnHit
		if err := colRows.Scan(&c.Database, &c.Table, &c.Column, &c.ColumnType, &c.Key, &c.Comment); err == nil {
			columns = append(columns, c)
		}
	}
	colRows.Close()

	writeJSON(w, http.StatusOK, map[string]any{"tables": tables, "columns": columns})
}
