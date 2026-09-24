package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Server struct {
	store *Store
}

func (s *Server) routes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/connections", s.listConnections)
	mux.HandleFunc("POST /api/connections", s.createConnection)
	mux.HandleFunc("PUT /api/connections/{id}", s.updateConnection)
	mux.HandleFunc("DELETE /api/connections/{id}", s.deleteConnection)
	mux.HandleFunc("POST /api/connections/test", s.testNewConnection)
	mux.HandleFunc("POST /api/connections/{id}/test", s.testExistingConnection)
	mux.HandleFunc("GET /api/connections/{id}/info", s.serverInfo)
	mux.HandleFunc("GET /api/connections/{id}/databases", s.listDatabases)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/export", s.exportDatabase)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/tables", s.listTables)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables", s.createTable)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/tables/{table}/structure", s.tableStructure)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/tables/{table}/data", s.tableData)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/tables/{table}/export", s.exportTable)
	mux.HandleFunc("DELETE /api/connections/{id}/databases/{db}/tables/{table}", s.dropTable)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/rename", s.renameTable)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/columns", s.addColumn)
	mux.HandleFunc("PUT /api/connections/{id}/databases/{db}/tables/{table}/columns/{column}", s.modifyColumn)
	mux.HandleFunc("DELETE /api/connections/{id}/databases/{db}/tables/{table}/columns/{column}", s.dropColumn)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/indexes", s.addIndex)
	mux.HandleFunc("DELETE /api/connections/{id}/databases/{db}/tables/{table}/indexes/{index}", s.dropIndex)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/rows", s.insertRow)
	mux.HandleFunc("PUT /api/connections/{id}/databases/{db}/tables/{table}/rows", s.updateRow)
	mux.HandleFunc("DELETE /api/connections/{id}/databases/{db}/tables/{table}/rows", s.deleteRow)
	mux.HandleFunc("POST /api/connections/{id}/query", s.runQuery)
}

// ---- connection CRUD ----------------------------------------------------

type connectionInput struct {
	Name     string     `json:"name"`
	Host     string     `json:"host"`
	Port     int        `json:"port"`
	User     string     `json:"user"`
	Password string     `json:"password"`
	Database string     `json:"database"`
	SSL      string     `json:"ssl"`
	Color    string     `json:"color"`
	SSH      *SSHConfig `json:"ssh"`
}

func (in connectionInput) toConnection() Connection {
	if in.Port == 0 {
		in.Port = 3306
	}
	return Connection{
		Name:     in.Name,
		Host:     in.Host,
		Port:     in.Port,
		User:     in.User,
		Password: in.Password,
		Database: in.Database,
		SSL:      in.SSL,
		Color:    in.Color,
		SSH:      in.SSH,
	}
}

func (in connectionInput) validate() error {
	if strings.TrimSpace(in.Name) == "" {
		return errors.New("connection name is required")
	}
	if strings.TrimSpace(in.Host) == "" {
		return errors.New("host is required")
	}
	if strings.TrimSpace(in.User) == "" {
		return errors.New("user is required")
	}
	if in.SSH != nil && in.SSH.Enabled {
		if strings.TrimSpace(in.SSH.Host) == "" {
			return errors.New("ssh host is required")
		}
		if strings.TrimSpace(in.SSH.User) == "" {
			return errors.New("ssh user is required")
		}
		if strings.TrimSpace(in.SSH.Password) == "" && strings.TrimSpace(in.SSH.PrivateKey) == "" {
			return errors.New("ssh requires a password or a private key")
		}
	}
	return nil
}

func (s *Server) listConnections(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.store.List())
}

func (s *Server) createConnection(w http.ResponseWriter, r *http.Request) {
	var in connectionInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	if err := in.validate(); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	entry, err := s.store.Create(in.toConnection())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	resp := map[string]any{"connection": entry.Info}
	start := time.Now()
	if err := entry.Ping(); err != nil {
		resp["connected"] = false
		resp["error"] = err.Error()
	} else {
		resp["connected"] = true
		resp["latencyMs"] = time.Since(start).Milliseconds()
	}
	writeJSON(w, http.StatusCreated, resp)
}

func (s *Server) updateConnection(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var in connectionInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	if err := in.validate(); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	entry, err := s.store.Update(id, in.toConnection())
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	resp := map[string]any{"connection": entry.Info}
	if err := entry.Ping(); err != nil {
		resp["connected"] = false
		resp["error"] = err.Error()
	} else {
		resp["connected"] = true
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) deleteConnection(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Delete(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) testNewConnection(w http.ResponseWriter, r *http.Request) {
	var in connectionInput
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	if err := in.validate(); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	entry := newConnEntry(in.toConnection())
	defer entry.Close()
	start := time.Now()
	if err := entry.Ping(); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"connected": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"connected": true, "latencyMs": time.Since(start).Milliseconds()})
}

func (s *Server) testExistingConnection(w http.ResponseWriter, r *http.Request) {
	entry, err := s.store.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	start := time.Now()
	if err := entry.Ping(); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"connected": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"connected": true, "latencyMs": time.Since(start).Milliseconds()})
}

// ---- helpers for connection scoped handlers -----------------------------

func (s *Server) entry(w http.ResponseWriter, r *http.Request) (*ConnEntry, bool) {
	entry, err := s.store.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return nil, false
	}
	return entry, true
}

func (s *Server) db(w http.ResponseWriter, r *http.Request, entry *ConnEntry, database string) (*sql.DB, bool) {
	conn, err := entry.getDB(database)
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("connection failed: %w", err))
		return nil, false
	}
	return conn, true
}

func (s *Server) params(w http.ResponseWriter, r *http.Request) (entry *ConnEntry, db *sql.DB, dbName, table string, ok bool) {
	entry, ok = s.entry(w, r)
	if !ok {
		return
	}
	dbName = r.PathValue("db")
	table = r.PathValue("table")
	if dbName == "" {
		writeErr(w, http.StatusBadRequest, errors.New("database is required"))
		return entry, nil, "", "", false
	}
	db, ok = s.db(w, r, entry, dbName)
	if !ok {
		return
	}
	if table != "" && !validIdent(table) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid table name %q", table))
		return entry, nil, "", "", false
	}
	return entry, db, dbName, table, true
}

// ---- schema browsing ----------------------------------------------------

type databaseInfo struct {
	Name      string `json:"name"`
	Charset   string `json:"charset"`
	Collation string `json:"collation"`
	IsSystem  bool   `json:"isSystem"`
}

var systemSchemas = map[string]bool{
	"information_schema": true,
	"performance_schema": true,
	"mysql":              true,
	"sys":                true,
}

func (s *Server) listDatabases(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	db, ok := s.db(w, r, entry, "")
	if !ok {
		return
	}
	rows, err := db.QueryContext(r.Context(), `
		SELECT SCHEMA_NAME, COALESCE(DEFAULT_CHARACTER_SET_NAME, ''), COALESCE(DEFAULT_COLLATION_NAME, '')
		FROM information_schema.SCHEMATA
		ORDER BY SCHEMA_NAME`)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer rows.Close()

	out := make([]databaseInfo, 0)
	for rows.Next() {
		var d databaseInfo
		if err := rows.Scan(&d.Name, &d.Charset, &d.Collation); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		d.IsSystem = systemSchemas[strings.ToLower(d.Name)]
		out = append(out, d)
	}
	writeJSON(w, http.StatusOK, out)
}

type tableInfo struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	Engine    string `json:"engine"`
	Rows      int64  `json:"rows"`
	Comment   string `json:"comment"`
	Collation string `json:"collation"`
}

func (s *Server) listTables(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	dbName := r.PathValue("db")
	db, ok := s.db(w, r, entry, dbName)
	if !ok {
		return
	}
	rows, err := db.QueryContext(r.Context(), `
		SELECT TABLE_NAME, TABLE_TYPE,
		       COALESCE(ENGINE, ''), COALESCE(TABLE_ROWS, 0),
		       COALESCE(TABLE_COMMENT, ''), COALESCE(TABLE_COLLATION, '')
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ?
		ORDER BY TABLE_NAME`, dbName)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer rows.Close()

	out := make([]tableInfo, 0)
	for rows.Next() {
		var t tableInfo
		if err := rows.Scan(&t.Name, &t.Type, &t.Engine, &t.Rows, &t.Comment, &t.Collation); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		out = append(out, t)
	}
	writeJSON(w, http.StatusOK, out)
}

type columnInfo struct {
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	Collation *string `json:"collation"`
	Nullable  bool    `json:"nullable"`
	Key       string  `json:"key"`
	Default   any     `json:"default"`
	Extra     string  `json:"extra"`
	Comment   string  `json:"comment"`
}

type indexInfo struct {
	Name        string `json:"name"`
	Unique      bool   `json:"unique"`
	Seq         int    `json:"seq"`
	Column      string `json:"column"`
	Cardinality *int64 `json:"cardinality"`
	IndexType   string `json:"indexType"`
}

type tableStructureResponse struct {
	Name      string       `json:"name"`
	Type      string       `json:"type"`
	Engine    string       `json:"engine"`
	Comment   string       `json:"comment"`
	Columns   []columnInfo `json:"columns"`
	Indexes   []indexInfo  `json:"indexes"`
	CreateSQL string       `json:"createSql"`
}

func (s *Server) tableStructure(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok {
		return
	}
	ctx := r.Context()

	resp := tableStructureResponse{Name: table, Columns: []columnInfo{}, Indexes: []indexInfo{}}

	var tableType, engine, comment sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT TABLE_TYPE, ENGINE, TABLE_COMMENT
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, dbName, table).
		Scan(&tableType, &engine, &comment)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	resp.Type = tableType.String
	resp.Engine = engine.String
	resp.Comment = comment.String

	colRows, err := db.QueryContext(ctx, "SHOW FULL COLUMNS FROM "+qualify(dbName, table))
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer colRows.Close()
	for colRows.Next() {
		var (
			field, typ, null, key, extra    string
			collation, def, privileges, cmt sql.NullString
		)
		if err := colRows.Scan(&field, &typ, &collation, &null, &key, &def, &extra, &privileges, &cmt); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		c := columnInfo{
			Name:     field,
			Type:     typ,
			Nullable: strings.EqualFold(null, "YES"),
			Key:      key,
			Extra:    extra,
			Comment:  cmt.String,
		}
		if collation.Valid {
			v := collation.String
			c.Collation = &v
		}
		if def.Valid {
			c.Default = def.String
		}
		resp.Columns = append(resp.Columns, c)
	}

	idxRows, err := db.QueryContext(ctx, "SHOW INDEX FROM "+qualify(dbName, table))
	if err == nil {
		defer idxRows.Close()
		idxCols, _ := idxRows.Columns()
		for idxRows.Next() {
			vals := make([]any, len(idxCols))
			ptrs := make([]any, len(idxCols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := idxRows.Scan(ptrs...); err != nil {
				continue
			}
			row := map[string]any{}
			for i, name := range idxCols {
				row[strings.ToLower(name)] = normalizeValue(vals[i])
			}
			idx := indexInfo{
				Name:      str(row["key_name"]),
				Unique:    toInt(row["non_unique"]) == 0,
				Seq:       int(toInt(row["seq_in_index"])),
				Column:    str(row["column_name"]),
				IndexType: str(row["index_type"]),
			}
			if card, ok := toIntOK(row["cardinality"]); ok {
				idx.Cardinality = &card
			}
			resp.Indexes = append(resp.Indexes, idx)
		}
	}

	var createName, createSQL string
	if err := db.QueryRowContext(ctx, "SHOW CREATE TABLE "+qualify(dbName, table)).Scan(&createName, &createSQL); err == nil {
		resp.CreateSQL = createSQL
	}

	writeJSON(w, http.StatusOK, resp)
}

func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}

func toInt(v any) int64 {
	n, _ := toIntOK(v)
	return n
}

func toIntOK(v any) (int64, bool) {
	switch t := v.(type) {
	case int64:
		return t, true
	case int:
		return int64(t), true
	case float64:
		return int64(t), true
	case string:
		n, err := strconv.ParseInt(t, 10, 64)
		if err == nil {
			return n, true
		}
	case []byte:
		n, err := strconv.ParseInt(string(t), 10, 64)
		if err == nil {
			return n, true
		}
	}
	return 0, false
}

// ---- table data ---------------------------------------------------------

func primaryKeyColumns(ctx context.Context, db *sql.DB, schema, table string) []string {
	rows, err := db.QueryContext(ctx, `
		SELECT COLUMN_NAME
		FROM information_schema.KEY_COLUMN_USAGE
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
		ORDER BY ORDINAL_POSITION`, schema, table)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err == nil {
			cols = append(cols, c)
		}
	}
	return cols
}

type tableDataResponse struct {
	Columns    []string `json:"columns"`
	Rows       [][]any  `json:"rows"`
	Total      int64    `json:"total"`
	Limit      int      `json:"limit"`
	Offset     int      `json:"offset"`
	PrimaryKey []string `json:"primaryKey"`
}

func (s *Server) tableData(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok {
		return
	}
	if table == "" {
		writeErr(w, http.StatusBadRequest, errors.New("table is required"))
		return
	}
	ctx := r.Context()

	limit := parseIntDefault(r.URL.Query().Get("limit"), 100)
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	offset := parseIntDefault(r.URL.Query().Get("offset"), 0)
	if offset < 0 {
		offset = 0
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

	var total int64
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+qualify(dbName, table)+where, filterVals...).Scan(&total); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}

	pk := primaryKeyColumns(ctx, db, dbName, table)
	if order == "" && len(pk) > 0 {
		quoted := make([]string, len(pk))
		for i, c := range pk {
			quoted[i] = quoteIdent(c)
		}
		order = " ORDER BY " + strings.Join(quoted, ", ")
	}

	q := fmt.Sprintf("SELECT * FROM %s%s%s LIMIT ? OFFSET ?", qualify(dbName, table), where, order)
	args := append(append([]any{}, filterVals...), limit, offset)
	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer rows.Close()

	columns, data, _, err := scanRows(rows, 0)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}

	writeJSON(w, http.StatusOK, tableDataResponse{
		Columns:    columns,
		Rows:       data,
		Total:      total,
		Limit:      limit,
		Offset:     offset,
		PrimaryKey: pk,
	})
}

// ---- row write operations ----------------------------------------------

type rowWriteRequest struct {
	Data       map[string]any `json:"data"`
	PrimaryKey map[string]any `json:"primaryKey"`
}

func (s *Server) insertRow(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok {
		return
	}
	var in rowWriteRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	if len(in.Data) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("no data supplied"))
		return
	}

	cols := make([]string, 0, len(in.Data))
	vals := make([]any, 0, len(in.Data))
	for k, v := range in.Data {
		if !validIdent(k) {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid column name %q", k))
			return
		}
		cols = append(cols, quoteIdent(k))
		vals = append(vals, v)
	}

	q := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
		qualify(dbName, table), strings.Join(cols, ", "), placeholders(len(vals)))
	res, err := db.ExecContext(r.Context(), q, vals...)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	lastID, _ := res.LastInsertId()
	affected, _ := res.RowsAffected()
	writeJSON(w, http.StatusOK, map[string]any{"lastInsertId": lastID, "affected": affected})
}

func (s *Server) updateRow(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok {
		return
	}
	var in rowWriteRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	if len(in.PrimaryKey) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("primaryKey is required to update a row"))
		return
	}
	if len(in.Data) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("no data supplied"))
		return
	}

	sets := make([]string, 0, len(in.Data))
	vals := make([]any, 0, len(in.Data)+len(in.PrimaryKey))
	for k, v := range in.Data {
		if !validIdent(k) {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid column name %q", k))
			return
		}
		sets = append(sets, quoteIdent(k)+" = ?")
		vals = append(vals, v)
	}

	where, whereVals, err := buildWhere(in.PrimaryKey)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	vals = append(vals, whereVals...)

	q := fmt.Sprintf("UPDATE %s SET %s WHERE %s", qualify(dbName, table), strings.Join(sets, ", "), where)
	res, err := db.ExecContext(r.Context(), q, vals...)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	affected, _ := res.RowsAffected()
	writeJSON(w, http.StatusOK, map[string]any{"affected": affected})
}

func (s *Server) deleteRow(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok {
		return
	}
	var in rowWriteRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	if len(in.PrimaryKey) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("primaryKey is required to delete a row"))
		return
	}
	where, vals, err := buildWhere(in.PrimaryKey)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	q := fmt.Sprintf("DELETE FROM %s WHERE %s", qualify(dbName, table), where)
	res, err := db.ExecContext(r.Context(), q, vals...)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	affected, _ := res.RowsAffected()
	writeJSON(w, http.StatusOK, map[string]any{"affected": affected})
}

func buildWhere(cond map[string]any) (string, []any, error) {
	keys := make([]string, 0, len(cond))
	for k := range cond {
		if !validIdent(k) {
			return "", nil, fmt.Errorf("invalid column name %q", k)
		}
		keys = append(keys, k)
	}
	// deterministic ordering keeps generated SQL stable
	sortStrings(keys)

	parts := make([]string, 0, len(keys))
	vals := make([]any, 0, len(keys))
	for _, k := range keys {
		v := cond[k]
		if v == nil {
			parts = append(parts, quoteIdent(k)+" IS NULL")
			continue
		}
		parts = append(parts, quoteIdent(k)+" = ?")
		vals = append(vals, v)
	}
	return strings.Join(parts, " AND "), vals, nil
}

func sortStrings(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

// ---- arbitrary SQL ------------------------------------------------------

type queryRequest struct {
	Database string `json:"database"`
	SQL      string `json:"sql"`
}

type queryResult struct {
	Columns    []string `json:"columns"`
	Rows       [][]any  `json:"rows"`
	RowCount   int      `json:"rowCount"`
	Affected   int64    `json:"affected"`
	LastInsert int64    `json:"lastInsertId"`
	DurationMs int64    `json:"durationMs"`
	Message    string   `json:"message"`
	Truncated  bool     `json:"truncated"`
	IsQuery    bool     `json:"isQuery"`
}

const maxQueryRows = 5000

func (s *Server) runQuery(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	var in queryRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	sqlText := strings.TrimSpace(in.SQL)
	if sqlText == "" {
		writeErr(w, http.StatusBadRequest, errors.New("sql is required"))
		return
	}
	db, ok := s.db(w, r, entry, in.Database)
	if !ok {
		return
	}

	ctx := r.Context()
	start := time.Now()
	result := queryResult{Columns: []string{}, Rows: [][]any{}}

	if isQueryStatement(sqlText) {
		rows, err := db.QueryContext(ctx, sqlText)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		defer rows.Close()
		columns, data, truncated, err := scanRows(rows, maxQueryRows)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		result.IsQuery = true
		result.Columns = columns
		result.Rows = data
		result.RowCount = len(data)
		result.Truncated = truncated
		result.DurationMs = time.Since(start).Milliseconds()
		if result.Message == "" {
			result.Message = fmt.Sprintf("%d row(s) returned", len(data))
		}
		writeJSON(w, http.StatusOK, result)
		return
	}

	res, err := db.ExecContext(ctx, sqlText)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	affected, _ := res.RowsAffected()
	lastID, _ := res.LastInsertId()
	result.Affected = affected
	result.LastInsert = lastID
	result.DurationMs = time.Since(start).Milliseconds()
	result.Message = fmt.Sprintf("%d row(s) affected", affected)
	writeJSON(w, http.StatusOK, result)
}

func parseIntDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}
