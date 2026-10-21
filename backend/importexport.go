package main

import (
	"bufio"
	"bytes"
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
	if !s.requireWrite(w, r) {
		return
	}
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
	conflict := r.FormValue("conflict")
	mapping, err := parseMapping(r.FormValue("mapping"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	data, err := io.ReadAll(io.LimitReader(file, maxStructuredImportBytes))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	decoded, _ := decodeImportText(data)
	if delimiter == "" || delimiter == "auto" {
		delimiter = detectDelimiter(string(decoded))
	}
	delimRunes := []rune(delimiter)

	reader := csv.NewReader(bytes.NewReader(decoded))
	reader.Comma = delimRunes[0]
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true

	ctx := r.Context()
	tableCols, err := tableColumns(ctx, db, dbName, table)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	columns := tableCols
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
		columns, err = mapImportColumns(header, tableCols, mapping)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
	} else if len(mapping) > 0 {
		columns = mapping
	}

	if truncate {
		if _, err := db.ExecContext(ctx, "TRUNCATE TABLE "+qualify(dbName, table)); err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
	}

	prefix := fmt.Sprintf("INSERT INTO %s (%s) VALUES ", qualify(dbName, table), quoteColumnList(columns))
	switch strings.ToLower(strings.TrimSpace(conflict)) {
	case "ignore":
		prefix = fmt.Sprintf("INSERT IGNORE INTO %s (%s) VALUES ", qualify(dbName, table), quoteColumnList(columns))
	case "replace", "upsert":
		prefix = fmt.Sprintf("REPLACE INTO %s (%s) VALUES ", qualify(dbName, table), quoteColumnList(columns))
	}
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
	if !s.requireWrite(w, r) {
		return
	}
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
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, errors.New("missing file field"))
		return
	}
	defer file.Close()

	ctx := r.Context()
	// Restore scripts often rely on session state (USE, SET, temporary
	// tables), so run every statement on one connection and stream the file.
	conn, err := db.Conn(ctx)
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("connection failed: %w", err))
		return
	}
	defer conn.Close()

	// Rows are not needed for a restore; use a zero budget so large SELECTs
	// in a dump are drained without being materialised.
	run := &scriptRun{conn: conn, rowBudget: 0}
	if err := run.execReader(ctx, file); err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("executed %d statement(s); %v", run.executed, err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"statements": run.executed})
}

// scanSQL reads SQL text and calls emit for each complete statement. It
// understands quoted strings, backtick identifiers, comments and the client
// side DELIMITER directive. Statements that contain no SQL (blank lines or
// comments only) are skipped, and the input is processed incrementally so only
// the statement currently being parsed is held in memory.
func scanSQL(r io.Reader, emit func(stmt string) error) error {
	reader := bufio.NewReaderSize(r, 64*1024)
	delim := ";"
	delimBytes := []byte(delim)
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
		pending = append(pending[:0], pending[upto+len(delimBytes):]...)
		scanned = 0
		if stmt == "" || !statementHasSQL(stmt) {
			return nil
		}
		return emit(stmt)
	}

	for {
		line, readErr := reader.ReadString('\n')
		if line != "" {
			// DELIMITER directive (only at line start, outside a statement).
			if atLineStart && state == stNormal && len(bytes.TrimSpace(pending)) == 0 {
				trimmed := strings.TrimSpace(line)
				if len(trimmed) >= 9 && strings.EqualFold(trimmed[:9], "DELIMITER") {
					rest := strings.TrimSpace(trimmed[9:])
					if rest != "" {
						delim = rest
						delimBytes = []byte(delim)
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
				case len(delimBytes) > 0 && bytes.HasPrefix(pending[scanned:], delimBytes):
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

	if tail := strings.TrimSpace(string(pending)); tail != "" && statementHasSQL(tail) {
		if err := emit(tail); err != nil {
			return err
		}
	}
	return nil
}

// statementHasSQL reports whether a statement contains anything other than
// whitespace, semicolons and comments. It is used to ignore blank lines and
// comment-only chunks (for example trailing notes in a SQL dump). Executable
// version comments (/*! ... */) are treated as SQL, not as comments.
func statementHasSQL(s string) bool {
	for i := 0; i < len(s); {
		switch c := s[i]; {
		case c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f' || c == ';':
			i++
		case c == '#':
			i = skipLineComment(s, i)
		case c == '-' && i+1 < len(s) && s[i+1] == '-':
			i = skipLineComment(s, i)
		case c == '/' && i+1 < len(s) && s[i+1] == '*':
			if i+2 < len(s) && s[i+2] == '!' {
				return true
			}
			end := strings.Index(s[i+2:], "*/")
			if end < 0 {
				return false
			}
			i += 2 + end + 2
		default:
			return true
		}
	}
	return false
}

func skipLineComment(s string, i int) int {
	if end := strings.IndexByte(s[i:], '\n'); end >= 0 {
		return i + end + 1
	}
	return len(s)
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

	ctx := r.Context()
	rows, err := db.QueryContext(ctx, `
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

	fmt.Fprintf(w, "-- MySQL UI full dump\n-- Generated: %s\n\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n",
		time.Now().Format("2006-01-02 15:04:05"))

	for _, schema := range schemas {
		writeDatabaseDump(ctx, w, db, schema)
	}
	fmt.Fprint(w, "SET FOREIGN_KEY_CHECKS=1;\n")
}
