package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type Server struct {
	store    *Store
	versions *SchemaVersionStore
	auth     *authManager
	updates  *updateManager
	backups  *backupManager

	queries     sync.Map
	sessions    *querySessionManager
	sessionOnce sync.Once
}

func (s *Server) sessionManager() *querySessionManager {
	s.sessionOnce.Do(func() {
		if s.sessions == nil {
			s.sessions = newQuerySessionManager()
		}
	})
	return s.sessions
}

func (s *Server) routes(mux *http.ServeMux) {
	// auth
	mux.HandleFunc("GET /api/auth/status", s.auth.statusHandler)
	mux.HandleFunc("POST /api/auth/login", s.auth.loginHandler)
	mux.HandleFunc("POST /api/auth/logout", s.auth.logoutHandler)
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": version})
	})

	// scheduled backups
	mux.HandleFunc("GET /api/backups", s.backupStatusHandler)
	mux.HandleFunc("PUT /api/backups", s.backupSettingsHandler)
	mux.HandleFunc("POST /api/backups/run", s.backupRunHandler)
	mux.HandleFunc("GET /api/backups/files", s.backupFilesList)
	mux.HandleFunc("GET /api/backups/files/{fileId}/download", s.backupFileDownload)
	mux.HandleFunc("DELETE /api/backups/files/{fileId}", s.backupFileDelete)
	mux.HandleFunc("POST /api/backups/files/{fileId}/restore", s.backupFileRestore)

	// self-update
	mux.HandleFunc("GET /api/update", s.updateStatusHandler)
	mux.HandleFunc("PUT /api/update", s.updateSettingsHandler)
	mux.HandleFunc("POST /api/update/check", s.updateCheckHandler)
	mux.HandleFunc("POST /api/update/apply", s.updateApplyHandler)
	mux.HandleFunc("POST /api/update/restart", s.updateRestartHandler)

	mux.HandleFunc("GET /api/connections", s.listConnections)
	mux.HandleFunc("GET /api/connections/{id}", s.getConnection)
	mux.HandleFunc("POST /api/connections", s.createConnection)
	mux.HandleFunc("PUT /api/connections/{id}", s.updateConnection)
	mux.HandleFunc("DELETE /api/connections/{id}", s.deleteConnection)
	mux.HandleFunc("POST /api/connections/test", s.testNewConnection)
	mux.HandleFunc("POST /api/connections/test-all", s.testAllConnections)
	mux.HandleFunc("GET /api/connections/export", s.exportConnections)
	mux.HandleFunc("POST /api/connections/import", s.importConnections)
	mux.HandleFunc("POST /api/connections/{id}/test", s.testExistingConnection)
	mux.HandleFunc("POST /api/connections/{id}/clone", s.cloneConnection)
	mux.HandleFunc("PUT /api/connections/{id}/favorite", s.setConnectionFavorite)
	mux.HandleFunc("GET /api/connections/{id}/info", s.serverInfo)
	mux.HandleFunc("GET /api/connections/{id}/databases", s.listDatabases)
	mux.HandleFunc("POST /api/connections/{id}/databases", s.createDatabase)
	mux.HandleFunc("DELETE /api/connections/{id}/databases/{db}", s.dropDatabase)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/export", s.exportDatabase)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/stats", s.databaseStats)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/tables", s.listTables)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/schema", s.databaseSchema)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables", s.createTable)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/tables/{table}/structure", s.tableStructure)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/tables/{table}/data", s.tableData)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/tables/{table}/stats", s.tableStats)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/tables/{table}/export", s.exportTable)
	mux.HandleFunc("DELETE /api/connections/{id}/databases/{db}/tables/{table}", s.dropTable)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/rename", s.renameTable)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/copy", s.copyTable)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/columns", s.addColumn)
	mux.HandleFunc("PUT /api/connections/{id}/databases/{db}/tables/{table}/columns/{column}", s.modifyColumn)
	mux.HandleFunc("DELETE /api/connections/{id}/databases/{db}/tables/{table}/columns/{column}", s.dropColumn)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/indexes", s.addIndex)
	mux.HandleFunc("DELETE /api/connections/{id}/databases/{db}/tables/{table}/indexes/{index}", s.dropIndex)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/rows", s.insertRow)
	mux.HandleFunc("PUT /api/connections/{id}/databases/{db}/tables/{table}/rows", s.updateRow)
	mux.HandleFunc("DELETE /api/connections/{id}/databases/{db}/tables/{table}/rows", s.deleteRow)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/rows/bulk-delete", s.deleteRows)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/rows/bulk-insert", s.bulkInsertRows)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/rows/bulk-update", s.bulkUpdateRows)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/maintenance", s.tableMaintenance)
	mux.HandleFunc("PUT /api/connections/{id}/databases/{db}/tables/{table}/options", s.updateTableOptions)
	mux.HandleFunc("POST /api/connections/{id}/query/estimate", s.estimateQueryRows)
	mux.HandleFunc("POST /api/connections/{id}/query/transaction", s.runTransaction)
	mux.HandleFunc("POST /api/connections/{id}/query", s.runQuery)
	mux.HandleFunc("POST /api/connections/{id}/query/{runId}/cancel", s.cancelQueryHandler)
	mux.HandleFunc("POST /api/connections/{id}/query/file", s.runQueryFile)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/query/file", s.runQueryFile)

	// server monitor
	mux.HandleFunc("GET /api/connections/{id}/monitor/processlist", s.monitorProcessList)
	mux.HandleFunc("GET /api/connections/{id}/monitor/overview", s.monitorOverview)
	mux.HandleFunc("GET /api/connections/{id}/monitor/status", s.monitorStatus)
	mux.HandleFunc("GET /api/connections/{id}/monitor/variables", s.monitorVariables)
	mux.HandleFunc("PUT /api/connections/{id}/monitor/variables/{name}", s.setMonitorVariable)
	mux.HandleFunc("GET /api/connections/{id}/monitor/replication", s.replicationStatus)
	mux.HandleFunc("GET /api/connections/{id}/monitor/slow-queries", s.slowQueries)
	mux.HandleFunc("DELETE /api/connections/{id}/monitor/process/{pid}", s.monitorKill)

	// import / backup
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/import/preview", s.importPreview)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/import", s.importCSV)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/import/json", s.importJSONTable)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/import/excel", s.importExcelTable)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/import/sql", s.importSQL)
	mux.HandleFunc("POST /api/connections/{id}/import/sql", s.importSQL)
	mux.HandleFunc("GET /api/connections/{id}/export", s.exportServer)

	// cell preview
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/cell", s.cellValue)

	// users & privileges
	mux.HandleFunc("GET /api/connections/{id}/users", s.listUsers)
	mux.HandleFunc("POST /api/connections/{id}/users", s.createUser)
	mux.HandleFunc("PUT /api/connections/{id}/users/{host}/{user}", s.alterUser)
	mux.HandleFunc("DELETE /api/connections/{id}/users/{host}/{user}", s.dropUser)
	mux.HandleFunc("GET /api/connections/{id}/users/{host}/{user}/grants", s.userGrants)
	mux.HandleFunc("POST /api/connections/{id}/users/{host}/{user}/grant", s.grantPrivileges)
	mux.HandleFunc("POST /api/connections/{id}/users/{host}/{user}/revoke", s.revokePrivileges)
	mux.HandleFunc("POST /api/connections/{id}/users/{host}/{user}/lock", s.lockUser)
	mux.HandleFunc("POST /api/connections/{id}/users/{host}/{user}/copy-grants", s.copyGrants)
	mux.HandleFunc("POST /api/connections/{id}/users/{host}/{user}/copy", s.copyUser)
	mux.HandleFunc("GET /api/connections/{id}/privilege-matrix", s.privilegeMatrix)

	// stored routines, triggers, events
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/routines", s.listRoutines)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/routines/{kind}/{name}/definition", s.routineDefinition)
	mux.HandleFunc("DELETE /api/connections/{id}/databases/{db}/routines/{kind}/{name}", s.dropRoutine)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/triggers", s.listTriggers)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/triggers/{name}/definition", s.triggerDefinition)
	mux.HandleFunc("DELETE /api/connections/{id}/databases/{db}/triggers/{name}", s.dropTrigger)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/events", s.listEvents)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/events/{name}/definition", s.eventDefinition)
	mux.HandleFunc("DELETE /api/connections/{id}/databases/{db}/events/{name}", s.dropEvent)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/ddl", s.executeDDL)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/views", s.saveView)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/objects", s.saveObject)
	mux.HandleFunc("POST /api/connections/{id}/databases/{db}/tables/{table}/foreign-keys", s.addForeignKey)
	mux.HandleFunc("DELETE /api/connections/{id}/databases/{db}/tables/{table}/foreign-keys/{name}", s.dropForeignKey)

	// global search / ERD / schema diff
	mux.HandleFunc("GET /api/connections/{id}/search", s.globalSearch)
	mux.HandleFunc("GET /api/connections/{id}/databases/{db}/erd", s.erd)
	mux.HandleFunc("POST /api/connections/{id}/diff", s.schemaDiff)
	mux.HandleFunc("POST /api/connections/{id}/data-diff", s.dataDiff)
	mux.HandleFunc("POST /api/cross-diff", s.crossDiff)
	mux.HandleFunc("POST /api/cross-db-diff", s.crossDatabaseDiff)
	mux.HandleFunc("POST /api/table-copy", s.copyTableAcrossConnections)

	// schema versions (snapshots / 封板)
	mux.HandleFunc("GET /api/connections/{id}/schema-versions", s.listSchemaVersions)
	mux.HandleFunc("POST /api/connections/{id}/schema-versions", s.createSchemaVersion)
	mux.HandleFunc("POST /api/connections/{id}/schema-versions/diff", s.diffSchemaVersions)
	mux.HandleFunc("GET /api/connections/{id}/schema-versions/{versionId}", s.getSchemaVersion)
	mux.HandleFunc("DELETE /api/connections/{id}/schema-versions/{versionId}", s.deleteSchemaVersion)
}

// ---- connection CRUD ----------------------------------------------------

type connectionInput struct {
	Name                string     `json:"name"`
	Host                string     `json:"host"`
	Port                int        `json:"port"`
	User                string     `json:"user"`
	Password            string     `json:"password"`
	Database            string     `json:"database"`
	SSL                 string     `json:"ssl"`
	Color               string     `json:"color"`
	Group               string     `json:"group"`
	Favorite            bool       `json:"favorite"`
	ReadOnly            bool       `json:"readOnly"`
	HideSystemDatabases bool       `json:"hideSystemDatabases"`
	SSH                 *SSHConfig `json:"ssh"`
}

func (in connectionInput) toConnection() Connection {
	if in.Port == 0 {
		in.Port = 3306
	}
	return Connection{
		Name:                in.Name,
		Host:                in.Host,
		Port:                in.Port,
		User:                in.User,
		Password:            in.Password,
		Database:            in.Database,
		SSL:                 in.SSL,
		Color:               in.Color,
		Group:               in.Group,
		Favorite:            in.Favorite,
		ReadOnly:            in.ReadOnly,
		HideSystemDatabases: in.HideSystemDatabases,
		SSH:                 in.SSH,
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
	list := s.store.List()
	out := make([]Connection, len(list))
	for i, c := range list {
		out[i] = redactConnection(c)
	}
	writeJSON(w, http.StatusOK, out)
}

// getConnection returns the full connection (including secrets) so the edit
// dialog can prefill credentials. It is only reachable behind authentication.
func (s *Server) getConnection(w http.ResponseWriter, r *http.Request) {
	entry, err := s.store.Get(r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	writeJSON(w, http.StatusOK, entry.Info)
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

// connDB returns a pool for the connection's default database (or no database).
func (s *Server) connDB(w http.ResponseWriter, r *http.Request) (*ConnEntry, *sql.DB, bool) {
	entry, ok := s.entry(w, r)
	if !ok {
		return nil, nil, false
	}
	db, ok := s.db(w, r, entry, "")
	if !ok {
		return nil, nil, false
	}
	return entry, db, true
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

func (s *Server) createDatabase(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	var in struct {
		Name      string `json:"name"`
		Charset   string `json:"charset"`
		Collation string `json:"collation"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	name := strings.TrimSpace(in.Name)
	if !validIdent(name) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid database name %q", name))
		return
	}
	if systemSchemas[strings.ToLower(name)] {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("%q is a reserved system database", name))
		return
	}
	charset := strings.TrimSpace(in.Charset)
	collation := strings.TrimSpace(in.Collation)
	if charset == "" && collation == "" {
		charset = "utf8mb4"
		collation = "utf8mb4_unicode_ci"
	}
	if charset != "" && !validIdent(charset) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid charset %q", charset))
		return
	}
	if collation != "" && !validIdent(collation) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid collation %q", collation))
		return
	}
	q := "CREATE DATABASE " + quoteIdent(name)
	if charset != "" {
		q += " CHARACTER SET " + charset
	}
	if collation != "" {
		q += " COLLATE " + collation
	}
	db, ok := s.db(w, r, entry, "")
	if !ok {
		return
	}
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"name":      name,
		"charset":   charset,
		"collation": collation,
	})
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

	hideSystem := entry.Info.HideSystemDatabases && r.URL.Query().Get("all") != "1"
	out := make([]databaseInfo, 0)
	for rows.Next() {
		var d databaseInfo
		if err := rows.Scan(&d.Name, &d.Charset, &d.Collation); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		d.IsSystem = systemSchemas[strings.ToLower(d.Name)]
		if d.IsSystem && hideSystem {
			continue
		}
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

type foreignKeyInfo struct {
	Column      string `json:"column"`
	RefDatabase string `json:"refDatabase"`
	RefTable    string `json:"refTable"`
	RefColumn   string `json:"refColumn"`
	Constraint  string `json:"constraint"`
	OnDelete    string `json:"onDelete"`
	OnUpdate    string `json:"onUpdate"`
}

type tableStructureResponse struct {
	Name           string           `json:"name"`
	Type           string           `json:"type"`
	Engine         string           `json:"engine"`
	Comment        string           `json:"comment"`
	Columns        []columnInfo     `json:"columns"`
	Indexes        []indexInfo      `json:"indexes"`
	ForeignKeys    []foreignKeyInfo `json:"foreignKeys"`
	CreateSQL      string           `json:"createSql"`
	ViewDefinition string           `json:"viewDefinition,omitempty"`
	Charset        string           `json:"charset,omitempty"`
	Collation      string           `json:"collation,omitempty"`
}

func (s *Server) tableStructure(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok {
		return
	}
	ctx := r.Context()

	resp := tableStructureResponse{Name: table, Columns: []columnInfo{}, Indexes: []indexInfo{}, ForeignKeys: []foreignKeyInfo{}}

	var tableType, engine, comment, collation sql.NullString
	err := db.QueryRowContext(ctx, `
		SELECT TABLE_TYPE, ENGINE, TABLE_COMMENT, COALESCE(TABLE_COLLATION, '')
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, dbName, table).
		Scan(&tableType, &engine, &comment, &collation)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	resp.Type = tableType.String
	resp.Engine = engine.String
	resp.Comment = comment.String
	resp.Collation = collation.String
	if resp.Collation != "" {
		_ = db.QueryRowContext(ctx, `SELECT CHARACTER_SET_NAME FROM information_schema.COLLATIONS
			WHERE COLLATION_NAME = ?`, resp.Collation).Scan(&resp.Charset)
	}

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

	fkRows, err := db.QueryContext(ctx, `
		SELECT k.COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
		       k.CONSTRAINT_NAME, COALESCE(r.DELETE_RULE, ''), COALESCE(r.UPDATE_RULE, '')
		FROM information_schema.KEY_COLUMN_USAGE k
		LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r
		  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
		WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
		ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`, dbName, table)
	if err == nil {
		defer fkRows.Close()
		for fkRows.Next() {
			var fk foreignKeyInfo
			if err := fkRows.Scan(&fk.Column, &fk.RefDatabase, &fk.RefTable, &fk.RefColumn, &fk.Constraint, &fk.OnDelete, &fk.OnUpdate); err == nil {
				resp.ForeignKeys = append(resp.ForeignKeys, fk)
			}
		}
	}

	if strings.EqualFold(resp.Type, "VIEW") {
		if create, err := showCreateSQL(ctx, db, "SHOW CREATE VIEW "+qualify(dbName, table)); err == nil {
			resp.CreateSQL = create
		}
		if err := db.QueryRowContext(ctx, `SELECT VIEW_DEFINITION FROM information_schema.VIEWS
			WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, dbName, table).Scan(&resp.ViewDefinition); err != nil && !errors.Is(err, sql.ErrNoRows) {
			resp.ViewDefinition = ""
		}
	} else {
		var createName, createSQL string
		if err := db.QueryRowContext(ctx, "SHOW CREATE TABLE "+qualify(dbName, table)).Scan(&createName, &createSQL); err == nil {
			resp.CreateSQL = createSQL
		}
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
		return []string{}
	}
	defer rows.Close()
	cols := []string{}
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err == nil {
			cols = append(cols, c)
		}
	}
	return cols
}

type tableDataResponse struct {
	Columns        []string `json:"columns"`
	Rows           [][]any  `json:"rows"`
	Total          int64    `json:"total"`
	Limit          int      `json:"limit"`
	Offset         int      `json:"offset"`
	PrimaryKey     []string `json:"primaryKey"`
	NextToken      string   `json:"nextToken,omitempty"`
	HasMore        bool     `json:"hasMore,omitempty"`
	EstimatedTotal bool     `json:"estimatedTotal,omitempty"`
	Keyset         bool     `json:"keyset,omitempty"`
}

func (s *Server) tableStats(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	var rows, dataLen, indexLen, autoInc sql.NullInt64
	var engine, collation, comment, createTime, updateTime sql.NullString
	err := db.QueryRowContext(r.Context(), `
		SELECT COALESCE(TABLE_ROWS,0), COALESCE(DATA_LENGTH,0), COALESCE(INDEX_LENGTH,0),
		       COALESCE(AUTO_INCREMENT,0), COALESCE(ENGINE,''), COALESCE(TABLE_COLLATION,''),
		       COALESCE(TABLE_COMMENT,''), COALESCE(CREATE_TIME,''), COALESCE(UPDATE_TIME,'')
		FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, dbName, table).
		Scan(&rows, &dataLen, &indexLen, &autoInc, &engine, &collation, &comment, &createTime, &updateTime)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"rows": rows.Int64, "dataLength": dataLen.Int64, "indexLength": indexLen.Int64,
		"autoIncrement": autoInc.Int64, "engine": engine.String, "collation": collation.String,
		"comment": comment.String, "createTime": createTime.String, "updateTime": updateTime.String,
	})
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
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		cols, err := tableColumns(ctx, db, dbName, table)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		parts := make([]string, 0, len(cols))
		for _, c := range cols {
			parts = append(parts, "CAST("+quoteIdent(c)+" AS CHAR) LIKE ?")
			filterVals = append(filterVals, "%"+q+"%")
		}
		searchWhere := "(" + strings.Join(parts, " OR ") + ")"
		if where == "" {
			where = " WHERE " + searchWhere
		} else {
			where += " AND " + searchWhere
		}
	}

	keysetRequested := parseBool(r.URL.Query().Get("keyset"), false)
	withTotal := parseBool(r.URL.Query().Get("withTotal"), true)
	keysetToken := r.URL.Query().Get("token")
	pk := primaryKeyColumns(ctx, db, dbName, table)
	if keysetRequested {
		if len(pk) == 0 {
			writeErr(w, http.StatusBadRequest, errors.New("keyset pagination requires a primary key"))
			return
		}
		if order != "" {
			writeErr(w, http.StatusBadRequest, errors.New("keyset pagination only supports primary-key order"))
			return
		}
	}
	if order == "" && len(pk) > 0 {
		quoted := make([]string, len(pk))
		for i, c := range pk {
			quoted[i] = quoteIdent(c)
		}
		order = " ORDER BY " + strings.Join(quoted, ", ")
	}

	resp := tableDataResponse{Limit: limit, Offset: offset, PrimaryKey: pk}
	var total int64
	if !keysetRequested || withTotal {
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+qualify(dbName, table)+where, filterVals...).Scan(&total); err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		resp.Total = total
	} else {
		// Deep OFFSET pagination avoids COUNT(*); report an approximate row
		// count from information_schema instead.
		_ = db.QueryRowContext(ctx, `SELECT COALESCE(TABLE_ROWS,0) FROM information_schema.TABLES
			WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, dbName, table).Scan(&total)
		resp.Total = total
		resp.EstimatedTotal = true
	}

	var rows *sql.Rows
	if keysetRequested {
		vals, err := decodeKeysetToken(keysetToken)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		queryWhere := where
		args := append([]any{}, filterVals...)
		if len(vals) > 0 {
			cond, condArgs := keysetCondition(pk, vals)
			if cond == "" {
				writeErr(w, http.StatusBadRequest, errors.New("pagination token does not match the primary key"))
				return
			}
			if queryWhere == "" {
				queryWhere = " WHERE " + cond
			} else {
				queryWhere += " AND " + cond
			}
			args = append(args, condArgs...)
		}
		q := fmt.Sprintf("SELECT * FROM %s%s%s LIMIT ?", qualify(dbName, table), queryWhere, order)
		args = append(args, limit+1)
		rows, err = db.QueryContext(ctx, q, args...)
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
		resp.Keyset = true
		if len(data) > limit {
			resp.HasMore = true
			data = data[:limit]
		}
		if len(data) > 0 {
			if tokenValues, err := primaryKeyValues(columns, data[len(data)-1], pk); err == nil {
				resp.NextToken = encodeKeysetToken(tokenValues)
			}
		}
		resp.Columns = columns
		resp.Rows = data
	} else {
		q := fmt.Sprintf("SELECT * FROM %s%s%s LIMIT ? OFFSET ?", qualify(dbName, table), where, order)
		args := append(append([]any{}, filterVals...), limit, offset)
		rows, err = db.QueryContext(ctx, q, args...)
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
		resp.Columns = columns
		resp.Rows = data
		resp.HasMore = int64(offset+len(data)) < total
	}
	writeJSON(w, http.StatusOK, resp)
}

// ---- row write operations ----------------------------------------------

type rowWriteRequest struct {
	Data       map[string]any `json:"data"`
	PrimaryKey map[string]any `json:"primaryKey"`
}

func (s *Server) insertRow(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
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
	if !s.requireWrite(w, r) {
		return
	}
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
	if !s.requireWrite(w, r) {
		return
	}
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

type bulkDeleteRequest struct {
	Keys []map[string]any `json:"keys"`
}

// deleteRows removes several rows by primary key in a single transaction. The
// whole batch is rolled back if any statement fails.
func (s *Server) deleteRows(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	_, db, dbName, table, ok := s.params(w, r)
	if !ok {
		return
	}
	var in bulkDeleteRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid request body: %w", err))
		return
	}
	if len(in.Keys) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("keys is required"))
		return
	}
	if len(in.Keys) > 1000 {
		writeErr(w, http.StatusBadRequest, errors.New("too many rows in one request (max 1000)"))
		return
	}

	tx, err := db.BeginTx(r.Context(), nil)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer tx.Rollback() //nolint:errcheck // no-op after commit

	var affected int64
	for _, key := range in.Keys {
		if len(key) == 0 {
			writeErr(w, http.StatusBadRequest, errors.New("primaryKey is required to delete a row"))
			return
		}
		where, vals, err := buildWhere(key)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		res, err := tx.ExecContext(r.Context(), fmt.Sprintf("DELETE FROM %s WHERE %s", qualify(dbName, table), where), vals...)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		n, _ := res.RowsAffected()
		affected += n
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
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
	Database   string `json:"database"`
	SQL        string `json:"sql"`
	SessionID  string `json:"sessionId,omitempty"`
	RunID      string `json:"runId,omitempty"`
	TimeoutSec int    `json:"timeoutSec,omitempty"`
	PageSize   int    `json:"pageSize,omitempty"`
	PageOffset int    `json:"pageOffset,omitempty"`
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
	Statements int      `json:"statements,omitempty"`
	HasMore    bool     `json:"hasMore,omitempty"`
	// Results holds the result sets of earlier query statements. The final
	// statement's result is exposed in the top-level fields so single
	// statement responses stay unchanged and rows are not serialised twice.
	Results []queryResult `json:"results,omitempty"`
}

const (
	// maxQueryRows bounds the total number of rows materialised for one query
	// request, across all statements. Keeping this global avoids a script with
	// many SELECTs exhausting server or browser memory.
	maxQueryRows = 5000
	// maxQueryResultSets bounds how many earlier result sets are retained.
	maxQueryResultSets = 20
)

func (s *Server) cancelQueryHandler(w http.ResponseWriter, r *http.Request) {
	s.cancelRunningQuery(w, r)
}

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
	if strings.TrimSpace(in.SQL) == "" {
		writeErr(w, http.StatusBadRequest, errors.New("sql is required"))
		return
	}

	// Split the script into statements while ignoring blank lines, comments
	// and DELIMITER directives. Validate every statement up front for
	// read-only connections so a write cannot slip through after a SELECT.
	readOnly := s.isReadOnly(r)
	statementCount, err := validateScript(strings.NewReader(in.SQL), readOnly)
	if err != nil {
		if errors.Is(err, errReadOnly) {
			writeErr(w, http.StatusForbidden, errReadOnly)
			return
		}
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	if statementCount == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("sql is required"))
		return
	}

	var (
		conn    *sql.Conn
		session *querySession
	)
	if strings.TrimSpace(in.SessionID) != "" {
		sess, err := s.sessionManager().get(r.Context(), entry, in.Database, in.SessionID)
		if err != nil {
			writeErr(w, http.StatusBadGateway, fmt.Errorf("connection failed: %w", err))
			return
		}
		if !sess.runMu.TryLock() {
			writeErr(w, http.StatusConflict, errors.New("this query session is busy"))
			return
		}
		defer sess.runMu.Unlock()
		session = sess
		conn = sess.conn
	} else {
		db, ok := s.db(w, r, entry, in.Database)
		if !ok {
			return
		}
		conn, err = db.Conn(r.Context())
		if err != nil {
			writeErr(w, http.StatusBadGateway, fmt.Errorf("connection failed: %w", err))
			return
		}
		defer conn.Close()
	}

	ctx := r.Context()
	var cancel context.CancelFunc
	if in.TimeoutSec > 0 {
		if in.TimeoutSec > 24*60*60 {
			in.TimeoutSec = 24 * 60 * 60
		}
		ctx, cancel = context.WithTimeout(ctx, time.Duration(in.TimeoutSec)*time.Second)
	} else {
		ctx, cancel = context.WithCancel(ctx)
	}
	defer cancel()

	runID := strings.TrimSpace(in.RunID)
	if runID == "" {
		runID = uuid.NewString()
	}
	active := &activeQuery{connectionID: entry.Info.ID, cancel: cancel}
	s.queries.Store(runID, active)
	defer s.queries.Delete(runID)
	if session != nil {
		session.setActive(active)
		defer session.clearActive(active)
	}

	// Remember the MySQL thread id so a cancel request can also issue KILL.
	var mysqlID int64
	if err := conn.QueryRowContext(ctx, "SELECT CONNECTION_ID()").Scan(&mysqlID); err == nil {
		active.setMySQLID(mysqlID)
	}

	// Single SELECT queries can be paged by wrapping them in an outer SELECT.
	// Multi-statement scripts and dialect-specific statements keep the old
	// non-paged behaviour.
	if in.PageSize > 0 && statementCount == 1 {
		var single string
		_ = scanSQL(strings.NewReader(in.SQL), func(stmt string) error {
			single = stmt
			return nil
		})
		upper := strings.ToUpper(strings.TrimSpace(single))
		if strings.HasPrefix(upper, "SELECT") || strings.HasPrefix(upper, "WITH") {
			limit := in.PageSize
			if limit > 5000 {
				limit = 5000
			}
			offset := in.PageOffset
			if offset < 0 {
				offset = 0
			}
			wrapped := "SELECT * FROM (" + trimStatement(single) + ") AS `_mysqlui_page` LIMIT ? OFFSET ?"
			pagedStart := time.Now()
			rows, err := conn.QueryContext(ctx, wrapped, limit+1, offset)
			if err == nil {
				defer rows.Close()
				columns, data, _, scanErr := scanRows(rows, limit+1)
				if scanErr == nil {
					hasMore := len(data) > limit
					if hasMore {
						data = data[:limit]
					}
					res := queryResult{
						Columns:    columns,
						Rows:       data,
						RowCount:   len(data),
						IsQuery:    true,
						HasMore:    hasMore,
						DurationMs: time.Since(pagedStart).Milliseconds(),
						Message:    fmt.Sprintf("%d row(s) returned", len(data)),
						Statements: 1,
					}
					if session != nil {
						session.touch()
					}
					writeJSON(w, http.StatusOK, res)
					return
				}
				err = scanErr
			}
			if errors.Is(err, context.DeadlineExceeded) {
				if session != nil {
					s.sessionManager().remove(in.SessionID)
				}
				writeErr(w, http.StatusGatewayTimeout, errors.New("query timed out"))
				return
			}
			if errors.Is(err, context.Canceled) || active.wasCanceled() {
				if session != nil {
					s.sessionManager().remove(in.SessionID)
				}
				writeErr(w, http.StatusBadGateway, errors.New("query canceled"))
				return
			}
			writeErr(w, http.StatusBadGateway, err)
			return
		}
	}

	start := time.Now()
	run := &scriptRun{
		conn:      conn,
		readOnly:  readOnly,
		rowBudget: maxQueryRows,
	}
	if err := run.execReader(ctx, strings.NewReader(in.SQL)); err != nil {
		if errors.Is(err, errReadOnly) {
			writeErr(w, http.StatusForbidden, errReadOnly)
			return
		}
		if errors.Is(err, context.DeadlineExceeded) {
			if session != nil {
				s.sessionManager().remove(in.SessionID)
			}
			writeErr(w, http.StatusGatewayTimeout, errors.New("query timed out"))
			return
		}
		if errors.Is(err, context.Canceled) || active.wasCanceled() {
			if session != nil {
				s.sessionManager().remove(in.SessionID)
			}
			writeErr(w, http.StatusBadGateway, errors.New("query canceled"))
			return
		}
		writeErr(w, http.StatusBadGateway, fmt.Errorf("executed %d statement(s); %w", run.executed, err))
		return
	}
	if session != nil {
		session.touch()
	}
	writeJSON(w, http.StatusOK, run.result(start))
}

// runQueryFile executes a .sql upload with the same semantics as runQuery.
// The file is streamed through scanSQL, so large dumps do not have to be held
// in memory as a single string.
func (s *Server) runQueryFile(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	database := r.PathValue("db")
	db, ok := s.db(w, r, entry, database)
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

	readOnly := s.isReadOnly(r)
	if readOnly {
		// Validate the whole script before executing anything, then rewind
		// and stream it again. multipart.File is seekable.
		if _, err := validateScript(file, true); err != nil {
			if errors.Is(err, errReadOnly) {
				writeErr(w, http.StatusForbidden, errReadOnly)
				return
			}
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
	}

	ctx := r.Context()
	conn, err := db.Conn(ctx)
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("connection failed: %w", err))
		return
	}
	defer conn.Close()

	start := time.Now()
	run := &scriptRun{
		conn:      conn,
		readOnly:  readOnly,
		rowBudget: maxQueryRows,
	}
	if err := run.execReader(ctx, file); err != nil {
		if errors.Is(err, errReadOnly) {
			writeErr(w, http.StatusForbidden, errReadOnly)
			return
		}
		writeErr(w, http.StatusBadGateway, fmt.Errorf("executed %d statement(s); %w", run.executed, err))
		return
	}
	if run.executed == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("sql is required"))
		return
	}
	writeJSON(w, http.StatusOK, run.result(start))
}

// validateScript scans a script without executing it and optionally rejects
// non-query statements for read-only connections.
func validateScript(r io.Reader, readOnly bool) (int, error) {
	count := 0
	err := scanSQL(r, func(stmt string) error {
		count++
		if readOnly && !isQueryStatement(stmt) {
			return errReadOnly
		}
		return nil
	})
	return count, err
}

// scriptRun accumulates the outcome of executing a multi-statement script.
type scriptRun struct {
	conn      *sql.Conn
	readOnly  bool
	rowBudget int

	executed      int
	totalAffected int64
	lastInsert    int64
	totalReturned int
	anyTruncated  bool
	earlier       []queryResult
	last          queryResult
}

func (run *scriptRun) execReader(ctx context.Context, r io.Reader) error {
	return scanSQL(r, func(stmt string) error {
		if run.readOnly && !isQueryStatement(stmt) {
			return errReadOnly
		}
		res, err := execSQLStatement(ctx, run.conn, stmt, run.rowBudget)
		if err != nil {
			return fmt.Errorf("statement %d: %w", run.executed+1, err)
		}
		run.executed++
		run.totalAffected += res.Affected
		if res.LastInsert > 0 {
			run.lastInsert = res.LastInsert
		}
		if res.IsQuery {
			run.totalReturned += res.RowCount
			run.rowBudget -= res.RowCount
			if run.rowBudget < 0 {
				run.rowBudget = 0
			}
			run.anyTruncated = run.anyTruncated || res.Truncated
			// Keep only the most recent result sets; older ones are dropped
			// so a long script cannot grow the response without bound.
			if maxQueryResultSets > 0 {
				if len(run.earlier) >= maxQueryResultSets {
					copy(run.earlier, run.earlier[1:])
					run.earlier[len(run.earlier)-1] = res
					run.anyTruncated = true
				} else {
					run.earlier = append(run.earlier, res)
				}
			}
		}
		run.last = res
		return nil
	})
}

func (run *scriptRun) result(start time.Time) queryResult {
	// The last statement's result is in the top-level fields, so remove it
	// from the earlier-result list to avoid sending its rows twice.
	results := run.earlier
	if run.last.IsQuery && len(results) > 0 {
		results = results[:len(results)-1]
	}

	last := run.last
	last.DurationMs = time.Since(start).Milliseconds()
	last.Statements = run.executed
	last.Affected = run.totalAffected
	last.LastInsert = run.lastInsert
	last.Truncated = run.anyTruncated || last.Truncated
	if len(results) > 0 {
		last.Results = results
	}
	if run.executed > 1 {
		last.Message = fmt.Sprintf("%d statement(s) executed", run.executed)
		if run.totalAffected > 0 {
			last.Message += fmt.Sprintf(" · %d row(s) affected", run.totalAffected)
		}
		if run.totalReturned > 0 {
			last.Message += fmt.Sprintf(" · %d row(s) returned", run.totalReturned)
		}
	}
	return last
}

// execSQLStatement runs one statement. rowBudget is the number of rows that
// may still be materialised for this request; once it is exhausted the query
// is still executed but its rows are discarded.
func execSQLStatement(ctx context.Context, conn *sql.Conn, stmt string, rowBudget int) (queryResult, error) {
	res := queryResult{Columns: []string{}, Rows: [][]any{}}
	start := time.Now()

	if isQueryStatement(stmt) {
		rows, err := conn.QueryContext(ctx, stmt)
		if err != nil {
			return res, err
		}
		defer rows.Close()
		limit := rowBudget
		if limit <= 0 {
			limit = -1
		}
		columns, data, truncated, err := scanRows(rows, limit)
		if err != nil {
			return res, err
		}
		res.IsQuery = true
		res.Columns = columns
		res.Rows = data
		res.RowCount = len(data)
		res.Truncated = truncated
		res.DurationMs = time.Since(start).Milliseconds()
		res.Message = fmt.Sprintf("%d row(s) returned", len(data))
		return res, nil
	}

	execRes, err := conn.ExecContext(ctx, stmt)
	if err != nil {
		return res, err
	}
	affected, _ := execRes.RowsAffected()
	lastID, _ := execRes.LastInsertId()
	res.Affected = affected
	res.LastInsert = lastID
	res.DurationMs = time.Since(start).Milliseconds()
	res.Message = fmt.Sprintf("%d row(s) affected", affected)
	return res, nil
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

func (s *Server) setConnectionFavorite(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	var in struct {
		Favorite bool `json:"favorite"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	info := entry.Info
	info.Favorite = in.Favorite
	if _, err := s.store.Update(info.ID, info); err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "favorite": in.Favorite})
}
