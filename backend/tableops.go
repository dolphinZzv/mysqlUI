package main

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// =========================================================================
// Filters & ordering
// =========================================================================

type filterCondition struct {
	Column string `json:"column"`
	Op     string `json:"op"`
	Value  any    `json:"value"`
}

func parseFilters(raw string) ([]filterCondition, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var conds []filterCondition
	if err := json.Unmarshal([]byte(raw), &conds); err != nil {
		return nil, fmt.Errorf("invalid filters: %w", err)
	}
	return conds, nil
}

func buildFilterSQL(conds []filterCondition) (string, []any, error) {
	if len(conds) == 0 {
		return "", nil, nil
	}
	parts := make([]string, 0, len(conds))
	vals := make([]any, 0)
	for _, c := range conds {
		if !validIdent(c.Column) {
			return "", nil, fmt.Errorf("invalid column %q", c.Column)
		}
		col := quoteIdent(c.Column)
		op := strings.ToLower(strings.TrimSpace(c.Op))
		switch op {
		case "=", "!=", "<>", ">", ">=", "<", "<=":
			parts = append(parts, col+" "+op+" ?")
			vals = append(vals, c.Value)
		case "like", "not like":
			parts = append(parts, col+" "+strings.ToUpper(op)+" ?")
			vals = append(vals, c.Value)
		case "contains":
			parts = append(parts, col+" LIKE ?")
			vals = append(vals, "%"+str(c.Value)+"%")
		case "starts with", "starts":
			parts = append(parts, col+" LIKE ?")
			vals = append(vals, str(c.Value)+"%")
		case "ends with", "ends":
			parts = append(parts, col+" LIKE ?")
			vals = append(vals, "%"+str(c.Value))
		case "is null":
			parts = append(parts, col+" IS NULL")
		case "is not null":
			parts = append(parts, col+" IS NOT NULL")
		case "in", "not in":
			list, ok := toAnySlice(c.Value)
			if !ok || len(list) == 0 {
				return "", nil, fmt.Errorf("operator %q requires a non-empty list", op)
			}
			parts = append(parts, col+" "+strings.ToUpper(op)+" ("+placeholders(len(list))+")")
			vals = append(vals, list...)
		default:
			return "", nil, fmt.Errorf("unsupported operator %q", c.Op)
		}
	}
	return " WHERE " + strings.Join(parts, " AND "), vals, nil
}

func toAnySlice(v any) ([]any, bool) {
	switch t := v.(type) {
	case []any:
		return t, true
	case []string:
		out := make([]any, len(t))
		for i, s := range t {
			out[i] = s
		}
		return out, true
	}
	return nil, false
}

// parseOrderSQL turns "name,-created_at" into an ORDER BY clause. A leading
// minus marks descending order.
func parseOrderSQL(orderBy string) (string, error) {
	orderBy = strings.TrimSpace(orderBy)
	if orderBy == "" {
		return "", nil
	}
	clauses := make([]string, 0)
	for _, raw := range strings.Split(orderBy, ",") {
		p := strings.TrimSpace(raw)
		if p == "" {
			continue
		}
		dir := "ASC"
		switch p[0] {
		case '-':
			dir = "DESC"
			p = p[1:]
		case '+':
			p = p[1:]
		}
		if !validIdent(p) {
			return "", fmt.Errorf("invalid order column %q", p)
		}
		clauses = append(clauses, quoteIdent(p)+" "+dir)
	}
	if len(clauses) == 0 {
		return "", nil
	}
	return " ORDER BY " + strings.Join(clauses, ", "), nil
}

// =========================================================================
// Data export
// =========================================================================

func contentDisposition(filename string) string {
	return fmt.Sprintf("attachment; filename=%q", filename)
}

func (s *Server) exportTable(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok {
		return
	}
	if table == "" {
		writeErr(w, http.StatusBadRequest, errors.New("table is required"))
		return
	}
	format := strings.ToLower(r.URL.Query().Get("format"))
	if format == "" {
		format = "csv"
	}

	conds, err := parseFilters(r.URL.Query().Get("filters"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	where, filterVals, err := buildFilterSQL(conds)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	order, err := parseOrderSQL(r.URL.Query().Get("orderBy"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}

	rows, err := db.QueryContext(r.Context(), "SELECT * FROM "+qualify(dbName, table)+where+order, filterVals...)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer rows.Close()

	columns, err := rows.Columns()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}

	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", contentDisposition(table+".csv"))
		_ = streamRowsCSV(w, columns, rows)
	case "json":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", contentDisposition(table+".json"))
		_ = streamRowsJSON(w, columns, rows)
	case "sql":
		w.Header().Set("Content-Type", "application/sql; charset=utf-8")
		w.Header().Set("Content-Disposition", contentDisposition(table+".sql"))
		_ = streamTableSQL(w, db, dbName, table, columns, rows)
	default:
		writeErr(w, http.StatusBadRequest, fmt.Errorf("unsupported format %q", format))
	}
}

func (s *Server) exportDatabase(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, _, ok := s.params(w, r)
	if !ok {
		return
	}
	format := strings.ToLower(r.URL.Query().Get("format"))
	if format == "" {
		format = "sql"
	}
	if format != "sql" {
		writeErr(w, http.StatusBadRequest, errors.New("database export only supports format=sql"))
		return
	}

	rows, err := db.QueryContext(r.Context(), `
		SELECT TABLE_NAME FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
		ORDER BY TABLE_NAME`, dbName)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err == nil {
			names = append(names, n)
		}
	}
	rows.Close()

	w.Header().Set("Content-Type", "application/sql; charset=utf-8")
	w.Header().Set("Content-Disposition", contentDisposition(dbName+".sql"))

	fmt.Fprintf(w, "-- MySQL UI dump\n-- Database: %s\n-- Generated: %s\n\nSET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\n\n",
		dbName, time.Now().Format("2006-01-02 15:04:05"))

	for _, name := range names {
		dataRows, err := db.QueryContext(r.Context(), "SELECT * FROM "+qualify(dbName, name))
		if err != nil {
			fmt.Fprintf(w, "-- skipping %s: %s\n\n", name, err)
			continue
		}
		columns, err := dataRows.Columns()
		if err != nil {
			dataRows.Close()
			continue
		}
		_ = streamTableSQL(w, db, dbName, name, columns, dataRows)
		dataRows.Close()
	}
	fmt.Fprint(w, "SET FOREIGN_KEY_CHECKS=1;\n")
}

func scanBuffers(n int) ([]any, []any) {
	vals := make([]any, n)
	ptrs := make([]any, n)
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	return vals, ptrs
}

func streamRowsCSV(w io.Writer, columns []string, rows *sql.Rows) error {
	cw := csv.NewWriter(w)
	if err := cw.Write(columns); err != nil {
		return err
	}
	vals, ptrs := scanBuffers(len(columns))
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		rec := make([]string, len(columns))
		for i, v := range vals {
			rec[i] = csvValue(v)
		}
		if err := cw.Write(rec); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

func csvValue(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case []byte:
		return string(t)
	case time.Time:
		return t.Format("2006-01-02 15:04:05")
	default:
		return fmt.Sprintf("%v", t)
	}
}

func streamRowsJSON(w io.Writer, columns []string, rows *sql.Rows) error {
	if _, err := io.WriteString(w, "[\n"); err != nil {
		return err
	}
	vals, ptrs := scanBuffers(len(columns))
	first := true
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		obj := make(map[string]any, len(columns))
		for i, v := range vals {
			obj[columns[i]] = normalizeValue(v)
		}
		buf, err := json.Marshal(obj)
		if err != nil {
			return err
		}
		if !first {
			if _, err := io.WriteString(w, ",\n"); err != nil {
				return err
			}
		}
		first = false
		if _, err := w.Write(buf); err != nil {
			return err
		}
	}
	_, err := io.WriteString(w, "\n]\n")
	return err
}

func streamTableSQL(w io.Writer, db *sql.DB, dbName, table string, columns []string, rows *sql.Rows) error {
	var createName, createSQL string
	if err := db.QueryRow("SHOW CREATE TABLE "+qualify(dbName, table)).Scan(&createName, &createSQL); err == nil {
		fmt.Fprintf(w, "--\n-- Table structure for `%s`\n--\nDROP TABLE IF EXISTS %s;\n%s;\n\n",
			table, qualify(dbName, table), createSQL)
	}

	colList := make([]string, len(columns))
	for i, c := range columns {
		colList[i] = quoteIdent(c)
	}
	prefix := fmt.Sprintf("INSERT INTO %s (%s) VALUES ", qualify(dbName, table), strings.Join(colList, ", "))

	fmt.Fprintf(w, "--\n-- Records of `%s`\n--\n", table)
	vals, ptrs := scanBuffers(len(columns))
	const batchSize = 100
	batch := 0
	started := false
	for rows.Next() {
		if err := rows.Scan(ptrs...); err != nil {
			return err
		}
		if !started {
			if _, err := io.WriteString(w, prefix); err != nil {
				return err
			}
			started = true
		} else {
			if _, err := io.WriteString(w, ","); err != nil {
				return err
			}
		}
		if _, err := io.WriteString(w, "("+sqlTuple(vals)+")"); err != nil {
			return err
		}
		batch++
		if batch >= batchSize {
			if _, err := io.WriteString(w, ";\n"); err != nil {
				return err
			}
			started = false
			batch = 0
		}
	}
	if started {
		if _, err := io.WriteString(w, ";\n"); err != nil {
			return err
		}
	}
	fmt.Fprint(w, "\n")
	return rows.Err()
}

func sqlTuple(vals []any) string {
	parts := make([]string, len(vals))
	for i, v := range vals {
		parts[i] = sqlValueLiteral(v)
	}
	return strings.Join(parts, ",")
}

var sqlStringEscaper = strings.NewReplacer(
	"\\", "\\\\",
	"'", "\\'",
	"\n", "\\n",
	"\r", "\\r",
	"\x00", "\\0",
	"\x1a", "\\Z",
)

func quoteSQLString(s string) string {
	return "'" + sqlStringEscaper.Replace(s) + "'"
}

func sqlValueLiteral(v any) string {
	switch t := v.(type) {
	case nil:
		return "NULL"
	case bool:
		if t {
			return "1"
		}
		return "0"
	case int64:
		return strconv.FormatInt(t, 10)
	case int:
		return strconv.Itoa(t)
	case float64:
		return strconv.FormatFloat(t, 'g', -1, 64)
	case []byte:
		return quoteSQLString(string(t))
	case string:
		return quoteSQLString(t)
	case time.Time:
		return quoteSQLString(t.Format("2006-01-02 15:04:05"))
	default:
		return quoteSQLString(fmt.Sprintf("%v", t))
	}
}

// =========================================================================
// Table designer (DDL)
// =========================================================================

type columnDefInput struct {
	Name          string `json:"name"`
	Type          string `json:"type"`
	Length        string `json:"length"`
	Nullable      bool   `json:"nullable"`
	AutoIncrement bool   `json:"autoIncrement"`
	PrimaryKey    bool   `json:"primaryKey"`
	Unique        bool   `json:"unique"`
	Default       any    `json:"default"`
	HasDefault    bool   `json:"hasDefault"`
	Comment       string `json:"comment"`
	Unsigned      bool   `json:"unsigned"`
}

type indexDefInput struct {
	Name    string   `json:"name"`
	Unique  bool     `json:"unique"`
	Columns []string `json:"columns"`
}

type createTableRequest struct {
	Name      string           `json:"name"`
	Engine    string           `json:"engine"`
	Charset   string           `json:"charset"`
	Collation string           `json:"collation"`
	Comment   string           `json:"comment"`
	Columns   []columnDefInput `json:"columns"`
	Indexes   []indexDefInput  `json:"indexes"`
}

type addColumnRequest struct {
	columnDefInput
	After string `json:"after"`
}

var baseTypeRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_ ]*$`)
var lengthRe = regexp.MustCompile(`^[A-Za-z0-9_', ()]+$`)

func numericBaseType(base string) bool {
	b := strings.ToLower(base)
	for _, k := range []string{"int", "decimal", "numeric", "float", "double", "real", "bit", "year"} {
		if strings.Contains(b, k) {
			return true
		}
	}
	return false
}

func buildColumnDef(c columnDefInput) (string, error) {
	name := strings.TrimSpace(c.Name)
	if !validIdent(name) {
		return "", fmt.Errorf("invalid column name %q", c.Name)
	}
	base := strings.TrimSpace(c.Type)
	if base == "" {
		return "", fmt.Errorf("column %q: type is required", name)
	}
	if !baseTypeRe.MatchString(base) {
		return "", fmt.Errorf("column %q: unsupported type %q", name, base)
	}
	def := quoteIdent(name) + " " + base
	if strings.TrimSpace(c.Length) != "" {
		length := strings.TrimSpace(c.Length)
		if !lengthRe.MatchString(length) {
			return "", fmt.Errorf("column %q: invalid length/spec %q", name, c.Length)
		}
		def += "(" + length + ")"
	}
	if c.Unsigned {
		def += " unsigned"
	}
	if c.Nullable {
		def += " NULL"
	} else {
		def += " NOT NULL"
	}
	if c.HasDefault {
		def += " DEFAULT " + defaultLiteral(c.Default, base)
	}
	if c.AutoIncrement {
		def += " AUTO_INCREMENT"
	}
	if strings.TrimSpace(c.Comment) != "" {
		def += " COMMENT " + sqlValueLiteral(c.Comment)
	}
	return def, nil
}

func defaultLiteral(v any, baseType string) string {
	if v == nil {
		return "NULL"
	}
	s := strings.TrimSpace(str(v))
	switch strings.ToUpper(s) {
	case "CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP()", "CURRENT_DATE", "CURRENT_DATE()",
		"CURRENT_TIME", "CURRENT_TIME()", "NOW()", "NULL":
		return s
	}
	if numericBaseType(baseType) {
		if _, err := strconv.ParseFloat(s, 64); err == nil {
			return s
		}
	}
	return sqlValueLiteral(v)
}

func (s *Server) createTable(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, _, ok := s.params(w, r)
	if !ok {
		return
	}
	var in createTableRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	name := strings.TrimSpace(in.Name)
	if !validIdent(name) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid table name %q", in.Name))
		return
	}
	if len(in.Columns) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("at least one column is required"))
		return
	}

	defs := make([]string, 0, len(in.Columns)+len(in.Indexes)+1)
	var pk []string
	for _, c := range in.Columns {
		def, err := buildColumnDef(c)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		defs = append(defs, def)
		if c.PrimaryKey {
			pk = append(pk, quoteIdent(c.Name))
		}
		if c.Unique && !c.PrimaryKey {
			defs = append(defs, fmt.Sprintf("UNIQUE KEY %s (%s)", quoteIdent(c.Name), quoteIdent(c.Name)))
		}
	}
	if len(pk) > 0 {
		defs = append(defs, "PRIMARY KEY ("+strings.Join(pk, ", ")+")")
	}
	for _, idx := range in.Indexes {
		if len(idx.Columns) == 0 {
			continue
		}
		cols := make([]string, len(idx.Columns))
		for i, c := range idx.Columns {
			if !validIdent(c) {
				writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid index column %q", c))
				return
			}
			cols[i] = quoteIdent(c)
		}
		idxName := idx.Name
		if idxName == "" {
			idxName = strings.Join(idx.Columns, "_")
		}
		if !validIdent(idxName) {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid index name %q", idx.Name))
			return
		}
		kind := "KEY"
		if idx.Unique {
			kind = "UNIQUE KEY"
		}
		defs = append(defs, fmt.Sprintf("%s %s (%s)", kind, quoteIdent(idxName), strings.Join(cols, ", ")))
	}

	q := "CREATE TABLE " + qualify(dbName, name) + " (\n  " + strings.Join(defs, ",\n  ") + "\n)"
	if in.Engine != "" {
		if !validIdent(in.Engine) {
			writeErr(w, http.StatusBadRequest, errors.New("invalid engine"))
			return
		}
		q += " ENGINE=" + in.Engine
	}
	if in.Charset != "" {
		if !validIdent(in.Charset) {
			writeErr(w, http.StatusBadRequest, errors.New("invalid charset"))
			return
		}
		q += " DEFAULT CHARSET=" + in.Charset
	}
	if in.Collation != "" {
		if !validIdent(in.Collation) {
			writeErr(w, http.StatusBadRequest, errors.New("invalid collation"))
			return
		}
		q += " COLLATE=" + in.Collation
	}
	if in.Comment != "" {
		q += " COMMENT=" + sqlValueLiteral(in.Comment)
	}

	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "sql": q})
}

func (s *Server) dropTable(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	q := "DROP TABLE " + qualify(dbName, table)
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) renameTable(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	var in struct {
		NewName string `json:"newName"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if !validIdent(in.NewName) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid table name %q", in.NewName))
		return
	}
	q := "RENAME TABLE " + qualify(dbName, table) + " TO " + qualify(dbName, in.NewName)
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) addColumn(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	var in addColumnRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	def, err := buildColumnDef(in.columnDefInput)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	q := "ALTER TABLE " + qualify(dbName, table) + " ADD COLUMN " + def
	if in.After != "" {
		if !validIdent(in.After) {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid column %q", in.After))
			return
		}
		q += " AFTER " + quoteIdent(in.After)
	}
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) modifyColumn(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	oldName := r.PathValue("column")
	if !validIdent(oldName) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid column %q", oldName))
		return
	}
	var in columnDefInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	def, err := buildColumnDef(in)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	q := "ALTER TABLE " + qualify(dbName, table) + " CHANGE COLUMN " + quoteIdent(oldName) + " " + def
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) dropColumn(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	column := r.PathValue("column")
	if !validIdent(column) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid column %q", column))
		return
	}
	q := "ALTER TABLE " + qualify(dbName, table) + " DROP COLUMN " + quoteIdent(column)
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) addIndex(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	var in indexDefInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if len(in.Columns) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("index requires at least one column"))
		return
	}
	cols := make([]string, len(in.Columns))
	for i, c := range in.Columns {
		if !validIdent(c) {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid index column %q", c))
			return
		}
		cols[i] = quoteIdent(c)
	}
	idxName := in.Name
	if idxName == "" {
		idxName = strings.Join(in.Columns, "_")
	}
	if !validIdent(idxName) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid index name %q", in.Name))
		return
	}
	kind := "INDEX"
	if in.Unique {
		kind = "UNIQUE INDEX"
	}
	q := fmt.Sprintf("ALTER TABLE %s ADD %s %s (%s)", qualify(dbName, table), kind, quoteIdent(idxName), strings.Join(cols, ", "))
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) dropIndex(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	index := r.PathValue("index")
	if !validIdent(index) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid index name %q", index))
		return
	}
	if strings.EqualFold(index, "PRIMARY") {
		writeErr(w, http.StatusBadRequest, errors.New("the primary key cannot be dropped here"))
		return
	}
	q := "ALTER TABLE " + qualify(dbName, table) + " DROP INDEX " + quoteIdent(index)
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// =========================================================================
// Server info
// =========================================================================

type serverInfoResponse struct {
	Version       string `json:"version"`
	Comment       string `json:"comment"`
	Hostname      string `json:"hostname"`
	Port          int    `json:"port"`
	CurrentDB     string `json:"currentDatabase"`
	DatabaseCount int    `json:"databaseCount"`
}

func (s *Server) serverInfo(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	db, ok := s.db(w, r, entry, entry.Info.Database)
	if !ok {
		return
	}
	resp := serverInfoResponse{}
	_ = db.QueryRowContext(r.Context(), "SELECT VERSION()").Scan(&resp.Version)
	_ = db.QueryRowContext(r.Context(), "SELECT @@version_comment").Scan(&resp.Comment)
	_ = db.QueryRowContext(r.Context(), "SELECT @@hostname").Scan(&resp.Hostname)
	_ = db.QueryRowContext(r.Context(), "SELECT @@port").Scan(&resp.Port)
	_ = db.QueryRowContext(r.Context(), "SELECT COALESCE(DATABASE(), '')").Scan(&resp.CurrentDB)
	_ = db.QueryRowContext(r.Context(), "SELECT COUNT(*) FROM information_schema.SCHEMATA").Scan(&resp.DatabaseCount)
	writeJSON(w, http.StatusOK, resp)
}
