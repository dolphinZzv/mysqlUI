package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/xuri/excelize/v2"
)

const maxStructuredImportBytes = 64 << 20 // 64 MiB

func insertRowsBulk(ctx context.Context, db *sql.DB, dbName, table string, columns []string, rows [][]any) (int64, error) {
	return insertRowsBulkMode(ctx, db, dbName, table, columns, rows, "error")
}

func insertRowsBulkMode(ctx context.Context, db *sql.DB, dbName, table string, columns []string, rows [][]any, mode string) (int64, error) {
	if len(columns) == 0 || len(rows) == 0 {
		return 0, errors.New("columns and rows are required")
	}
	quoted := make([]string, len(columns))
	for i, c := range columns {
		if !validIdent(c) {
			return 0, fmt.Errorf("invalid column name %q", c)
		}
		quoted[i] = quoteIdent(c)
	}
	for i, row := range rows {
		if len(row) != len(columns) {
			return 0, fmt.Errorf("row %d has %d values, expected %d", i+1, len(row), len(columns))
		}
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback() //nolint:errcheck
	verb := "INSERT INTO "
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "ignore":
		verb = "INSERT IGNORE INTO "
	case "replace", "upsert":
		verb = "REPLACE INTO "
	}
	prefix := verb + qualify(dbName, table) + " (" + strings.Join(quoted, ",") + ") VALUES "
	const batchSize = 200
	var total int64
	for start := 0; start < len(rows); start += batchSize {
		end := start + batchSize
		if end > len(rows) {
			end = len(rows)
		}
		batch := rows[start:end]
		placeholders := make([]string, len(batch))
		args := make([]any, 0, len(batch)*len(columns))
		for i, row := range batch {
			placeholders[i] = "(" + placeholdersN(len(columns)) + ")"
			args = append(args, row...)
		}
		res, err := tx.ExecContext(ctx, prefix+strings.Join(placeholders, ","), args...)
		if err != nil {
			return total, err
		}
		n, _ := res.RowsAffected()
		total += n
	}
	if err := tx.Commit(); err != nil {
		return total, err
	}
	return total, nil
}

func (s *Server) importJSONTable(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	file, truncate, ok := openStructuredUpload(w, r)
	if !ok {
		return
	}
	defer file.Close()
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	data, err := io.ReadAll(io.LimitReader(file, maxStructuredImportBytes+1))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if len(data) > maxStructuredImportBytes {
		writeErr(w, http.StatusBadRequest, errors.New("JSON file is too large"))
		return
	}
	var parsed any
	if err := json.Unmarshal(data, &parsed); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid JSON: %w", err))
		return
	}
	var objects []map[string]any
	switch v := parsed.(type) {
	case []any:
		for _, item := range v {
			obj, ok := item.(map[string]any)
			if !ok {
				writeErr(w, http.StatusBadRequest, errors.New("JSON array must contain objects"))
				return
			}
			objects = append(objects, obj)
		}
	case map[string]any:
		objects = append(objects, v)
	default:
		writeErr(w, http.StatusBadRequest, errors.New("JSON must be an object or an array of objects"))
		return
	}
	if len(objects) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("JSON contains no rows"))
		return
	}
	if len(objects) > 50000 {
		writeErr(w, http.StatusBadRequest, errors.New("too many rows; maximum is 50000"))
		return
	}
	columns := make([]string, 0)
	seen := map[string]bool{}
	for _, obj := range objects {
		for key := range obj {
			if !validIdent(key) {
				writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid column name %q", key))
				return
			}
			if !seen[key] {
				seen[key] = true
				columns = append(columns, key)
			}
		}
	}
	if len(columns) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("JSON objects have no fields"))
		return
	}
	rows := make([][]any, len(objects))
	for i, obj := range objects {
		row := make([]any, len(columns))
		for j, col := range columns {
			row[j] = obj[col]
		}
		rows[i] = row
	}
	if truncate {
		if _, err := db.ExecContext(r.Context(), "TRUNCATE TABLE "+qualify(dbName, table)); err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
	}
	imported, err := insertRowsBulk(r.Context(), db, dbName, table, columns, rows)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"imported": imported, "columns": columns})
}

func (s *Server) importExcelTable(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	file, truncate, ok := openStructuredUpload(w, r)
	if !ok {
		return
	}
	defer file.Close()
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	hasHeader := parseBool(r.FormValue("hasHeader"), true)
	conflict := r.FormValue("conflict")
	mapping, err := parseMapping(r.FormValue("mapping"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	f, err := excelize.OpenReader(io.LimitReader(file, maxStructuredImportBytes+1))
	if err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid Excel file: %w", err))
		return
	}
	defer f.Close()
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("Excel workbook has no sheets"))
		return
	}
	sheetRows, err := f.GetRows(sheets[0])
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if len(sheetRows) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("Excel sheet is empty"))
		return
	}
	tableCols, err := tableColumns(r.Context(), db, dbName, table)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	columns := tableCols
	startRow := 0
	if hasHeader {
		columns, err = mapImportColumns(sheetRows[0], tableCols, mapping)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		startRow = 1
	} else if len(mapping) > 0 {
		columns = mapping
	}
	for _, c := range columns {
		if !validIdent(strings.TrimSpace(c)) {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid column name %q", c))
			return
		}
	}
	var rows [][]any
	for _, raw := range sheetRows[startRow:] {
		if len(raw) == 0 {
			continue
		}
		row := make([]any, len(columns))
		for i := range columns {
			if i < len(raw) && raw[i] != "" {
				row[i] = raw[i]
			}
		}
		rows = append(rows, row)
		if len(rows) >= 50000 {
			break
		}
	}
	if truncate {
		if _, err := db.ExecContext(r.Context(), "TRUNCATE TABLE "+qualify(dbName, table)); err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
	}
	imported, err := insertRowsBulkMode(r.Context(), db, dbName, table, columns, rows, conflict)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"imported": imported, "columns": columns})
}

func openStructuredUpload(w http.ResponseWriter, r *http.Request) (multipartFile, bool, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid upload: %w", err))
		return nil, false, false
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, errors.New("missing file field"))
		return nil, false, false
	}
	return file, parseBool(r.FormValue("truncate"), false), true
}

type multipartFile interface {
	io.Reader
	io.ReaderAt
	io.Seeker
	io.Closer
}

func streamRowsXLSX(w io.Writer, columns []string, rows *sql.Rows) error {
	f := excelize.NewFile()
	defer f.Close()
	sw, err := f.NewStreamWriter("Sheet1")
	if err != nil {
		return err
	}
	header := make([]any, len(columns))
	for i, c := range columns {
		header[i] = c
	}
	if err := sw.SetRow("A1", header); err != nil {
		return err
	}
	vals := make([]any, len(columns))
	ptrs := make([]any, len(columns))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	rowIdx := 2
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		values := make([]any, len(columns))
		for i, v := range vals {
			values[i] = normalizeValue(v)
		}
		cell, _ := excelize.CoordinatesToCellName(1, rowIdx)
		if err := sw.SetRow(cell, values); err != nil {
			return err
		}
		rowIdx++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := sw.Flush(); err != nil {
		return err
	}
	return f.Write(w)
}
