package main

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const maxUploadBytes = 512 << 20 // 512 MiB

// =========================================================================
// CSV import
// =========================================================================

func (s *Server) importCSV(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok {
		return
	}
	if table == "" {
		writeErr(w, http.StatusBadRequest, errors.New("table is required"))
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid upload: %w", err))
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, errors.New("missing file field"))
		return
	}
	defer file.Close()

	hasHeader := parseBool(r.FormValue("hasHeader"), true)
	truncate := parseBool(r.FormValue("truncate"), false)
	nullValue := r.FormValue("nullValue")
	delimiter := r.FormValue("delimiter")
	if delimiter == "" {
		delimiter = ","
	}
	delimRunes := []rune(delimiter)

	reader := csv.NewReader(file)
	reader.Comma = delimRunes[0]
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true

	ctx := r.Context()
	columns, err := tableColumns(ctx, db, dbName, table)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	if hasHeader {
		header, err := reader.Read()
		if err != nil && err != io.EOF {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("cannot read header row: %w", err))
			return
		}
		if len(header) == 0 {
			writeErr(w, http.StatusBadRequest, errors.New("empty csv"))
			return
		}
		cols := make([]string, len(header))
		for i, h := range header {
			name := strings.TrimSpace(strings.TrimPrefix(h, "\ufeff"))
			if !validIdent(name) {
				writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid column name %q in header", name))
				return
			}
			cols[i] = name
		}
		columns = cols
	}

	if truncate {
		if _, err := db.ExecContext(ctx, "TRUNCATE TABLE "+qualify(dbName, table)); err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
	}

	prefix := fmt.Sprintf("INSERT INTO %s (%s) VALUES ", qualify(dbName, table), quoteColumnList(columns))
	batchSize := 500

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}

	imported := 0
	line := 0
	var rows [][]any
	flush := func() error {
		if len(rows) == 0 {
			return nil
		}
		placeholders := make([]string, len(rows))
		args := make([]any, 0, len(rows)*len(columns))
		for i, row := range rows {
			placeholders[i] = "(" + placeholdersN(len(columns)) + ")"
			args = append(args, row...)
		}
		q := prefix + strings.Join(placeholders, ",")
		if _, err := tx.ExecContext(ctx, q, args...); err != nil {
			return err
		}
		imported += len(rows)
		rows = rows[:0]
		return nil
	}

	var importErr error
	for {
		record, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			importErr = fmt.Errorf("line %d: %w", line+1, err)
			break
		}
		line++
		row := make([]any, len(columns))
		for i := range columns {
			if i < len(record) {
				v := record[i]
				if v == nullValue && nullValue != "" {
					row[i] = nil
				} else {
					row[i] = v
				}
			} else {
				row[i] = nil
			}
		}
		rows = append(rows, row)
		if len(rows) >= batchSize {
			if err := flush(); err != nil {
				importErr = err
				break
			}
		}
	}
	if importErr == nil {
		importErr = flush()
	}

	if importErr != nil {
		_ = tx.Rollback()
		writeErr(w, http.StatusBadGateway, fmt.Errorf("import failed after %d rows: %w", imported, importErr))
		return
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"imported": imported, "columns": columns})
}

func placeholdersN(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func quoteColumnList(cols []string) string {
	quoted := make([]string, len(cols))
	for i, c := range cols {
		quoted[i] = quoteIdent(c)
	}
	return strings.Join(quoted, ",")
}

func tableColumns(ctx context.Context, db *sql.DB, schema, table string) ([]string, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT COLUMN_NAME FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		ORDER BY ORDINAL_POSITION`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err == nil {
			cols = append(cols, c)
		}
	}
	if len(cols) == 0 {
		return nil, fmt.Errorf("table %s.%s has no columns", schema, table)
	}
	return cols, nil
}

func parseBool(s string, def bool) bool {
	if strings.TrimSpace(s) == "" {
		return def
	}
	v, err := strconv.ParseBool(s)
	if err != nil {
		return def
	}
	return v
}

// =========================================================================
// SQL import / restore
// =========================================================================

func (s *Server) importSQL(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	dbName := r.PathValue("db")
	db, ok := s.db(w, r, entry, dbName)
	if !ok {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid upload: %w", err))
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, errors.New("missing file field"))
		return
	}
	defer file.Close()

	ctx := r.Context()
	executed := 0
	var firstErr error

	handler := func(stmt string) error {
		if isQueryStatement(stmt) {
			rows, err := db.QueryContext(ctx, stmt)
			if err != nil {
				return err
			}
			return rows.Close()
		}
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return err
		}
		executed++
		return nil
	}

	if err := scanSQL(file, handler); err != nil {
		firstErr = err
	}

	if firstErr != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("executed %d statement(s); %v", executed, firstErr))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"statements": executed})
}

// scanSQL reads SQL text and calls emit for each complete statement. It
// understands quoted strings, backtick identifiers, comments and the client
// side DELIMITER directive.
func scanSQL(r io.Reader, emit func(stmt string) error) error {
	reader := bufio.NewReaderSize(r, 64*1024)
	delim := ";"
	var pending []byte
	scanned := 0
	atLineStart := true

	const (
		stNormal = iota
		stSingle
		stDouble
		stBacktick
		stLineComment
		stBlockComment
	)
	state := stNormal

	flushPending := func(upto int) error {
		stmt := strings.TrimSpace(string(pending[:upto]))
		pending = append(pending[:0], pending[upto+len(delim):]...)
		scanned = 0
		if stmt == "" {
			return nil
		}
		return emit(stmt)
	}

	for {
		line, readErr := reader.ReadString('\n')
		if line != "" {
			// DELIMITER directive (only at line start, outside a statement).
			if atLineStart && state == stNormal && len(strings.TrimSpace(string(pending))) == 0 {
				trimmed := strings.TrimSpace(line)
				if len(trimmed) >= 9 && strings.EqualFold(trimmed[:9], "DELIMITER") {
					rest := strings.TrimSpace(trimmed[9:])
					if rest != "" {
						delim = rest
					}
					pending = pending[:0]
					scanned = 0
					if readErr != nil {
						break
					}
					continue
				}
			}
			pending = append(pending, line...)
		}
		if line != "" && !strings.HasSuffix(line, "\n") {
			atLineStart = false
		} else {
			atLineStart = true
		}

		for scanned < len(pending) {
			c := pending[scanned]
			switch state {
			case stNormal:
				switch {
				case c == '\'':
					state = stSingle
					scanned++
				case c == '"':
					state = stDouble
					scanned++
				case c == '`':
					state = stBacktick
					scanned++
				case c == '-' && scanned+1 < len(pending) && pending[scanned+1] == '-':
					state = stLineComment
					scanned += 2
				case c == '#':
					state = stLineComment
					scanned++
				case c == '/' && scanned+1 < len(pending) && pending[scanned+1] == '*':
					state = stBlockComment
					scanned += 2
				case delim != "" && strings.HasPrefix(string(pending[scanned:]), delim):
					if err := flushPending(scanned); err != nil {
						return err
					}
				default:
					scanned++
				}
			case stSingle:
				if c == '\\' {
					scanned += 2
				} else if c == '\'' {
					if scanned+1 < len(pending) && pending[scanned+1] == '\'' {
						scanned += 2
					} else {
						state = stNormal
						scanned++
					}
				} else {
					scanned++
				}
			case stDouble:
				if c == '\\' {
					scanned += 2
				} else if c == '"' {
					if scanned+1 < len(pending) && pending[scanned+1] == '"' {
						scanned += 2
					} else {
						state = stNormal
						scanned++
					}
				} else {
					scanned++
				}
			case stBacktick:
				if c == '`' {
					if scanned+1 < len(pending) && pending[scanned+1] == '`' {
						scanned += 2
					} else {
						state = stNormal
						scanned++
					}
				} else {
					scanned++
				}
			case stLineComment:
				if c == '\n' {
					state = stNormal
				}
				scanned++
			case stBlockComment:
				if c == '*' && scanned+1 < len(pending) && pending[scanned+1] == '/' {
					state = stNormal
					scanned += 2
				} else {
					scanned++
				}
			}
			if scanned > len(pending) {
				scanned = len(pending)
			}
		}

		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return readErr
		}
	}

	if tail := strings.TrimSpace(string(pending)); tail != "" {
		if err := emit(tail); err != nil {
			return err
		}
	}
	return nil
}

// =========================================================================
// Whole-server backup
// =========================================================================

func (s *Server) exportServer(w http.ResponseWriter, r *http.Request) {
	entry, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	format := strings.ToLower(r.URL.Query().Get("format"))
	if format == "" {
		format = "sql"
	}
	if format != "sql" {
		writeErr(w, http.StatusBadRequest, errors.New("server export only supports format=sql"))
		return
	}

	rows, err := db.QueryContext(r.Context(), `
		SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME`)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	var schemas []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			if !systemSchemas[strings.ToLower(name)] {
				schemas = append(schemas, name)
			}
		}
	}
	rows.Close()

	w.Header().Set("Content-Type", "application/sql; charset=utf-8")
	w.Header().Set("Content-Disposition", contentDisposition(entry.Info.Name+".sql"))

	fmt.Fprintf(w, "-- MySQL UI full dump\n-- Generated: %s\n\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n",
		time.Now().Format("2006-01-02 15:04:05"))

	for _, schema := range schemas {
		fmt.Fprintf(w, "-- Database: %s\nCREATE DATABASE IF NOT EXISTS %s;\nUSE %s;\n\n",
			schema, quoteIdent(schema), quoteIdent(schema))
		tables, err := db.QueryContext(r.Context(), `
			SELECT TABLE_NAME FROM information_schema.TABLES
			WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
			ORDER BY TABLE_NAME`, schema)
		if err != nil {
			continue
		}
		var names []string
		for tables.Next() {
			var n string
			if err := tables.Scan(&n); err == nil {
				names = append(names, n)
			}
		}
		tables.Close()
		for _, name := range names {
			dataRows, err := db.QueryContext(r.Context(), "SELECT * FROM "+qualify(schema, name))
			if err != nil {
				fmt.Fprintf(w, "-- skipping %s.%s: %s\n\n", schema, name, err)
				continue
			}
			cols, err := dataRows.Columns()
			if err == nil {
				_ = streamTableSQL(w, db, schema, name, cols, dataRows)
			}
			dataRows.Close()
		}
	}
	fmt.Fprint(w, "SET FOREIGN_KEY_CHECKS=1;\n")
}
