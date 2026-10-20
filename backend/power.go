package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// =========================================================================
// Batch cell edits (single transaction)
// =========================================================================

type batchEdit struct {
	Data       map[string]any `json:"data"`
	PrimaryKey map[string]any `json:"primaryKey"`
}

func (s *Server) bulkUpdateRows(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	var in struct {
		Changes []batchEdit `json:"changes"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if len(in.Changes) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("no changes supplied"))
		return
	}
	if len(in.Changes) > 5000 {
		writeErr(w, http.StatusBadRequest, errors.New("too many changes in one batch (max 5000)"))
		return
	}

	ctx := r.Context()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	rollback := func(err error) {
		_ = tx.Rollback()
		writeErr(w, http.StatusBadGateway, err)
	}

	for i, change := range in.Changes {
		if len(change.Data) == 0 {
			rollback(fmt.Errorf("change %d has no values", i+1))
			return
		}
		if len(change.PrimaryKey) == 0 {
			rollback(fmt.Errorf("change %d has no primary key; rows cannot be targeted safely", i+1))
			return
		}
		cols := make([]string, 0, len(change.Data))
		for c := range change.Data {
			if !validIdent(c) {
				rollback(fmt.Errorf("change %d: invalid column %q", i+1, c))
				return
			}
			cols = append(cols, c)
		}
		sort.Strings(cols)
		sets := make([]string, len(cols))
		args := make([]any, 0, len(cols)+len(change.PrimaryKey))
		for j, c := range cols {
			sets[j] = quoteIdent(c) + " = ?"
			args = append(args, change.Data[c])
		}
		pkCols := make([]string, 0, len(change.PrimaryKey))
		for c := range change.PrimaryKey {
			if !validIdent(c) {
				rollback(fmt.Errorf("change %d: invalid primary key column %q", i+1, c))
				return
			}
			pkCols = append(pkCols, c)
		}
		sort.Strings(pkCols)
		where := make([]string, len(pkCols))
		for j, c := range pkCols {
			where[j] = quoteIdent(c) + " = ?"
			args = append(args, change.PrimaryKey[c])
		}
		q := fmt.Sprintf("UPDATE %s SET %s WHERE %s", qualify(dbName, table), strings.Join(sets, ", "), strings.Join(where, " AND "))
		if _, err := tx.ExecContext(ctx, q, args...); err != nil {
			rollback(fmt.Errorf("change %d failed: %w", i+1, err))
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "updated": len(in.Changes)})
}

// =========================================================================
// Database capacity statistics
// =========================================================================

func (s *Server) databaseStats(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	name := r.PathValue("db")
	if !validIdent(name) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid database name %q", name))
		return
	}
	var rows, dataLen, indexLen, freeLen sql.NullInt64
	var tables sql.NullInt64
	var charset, collation sql.NullString
	_ = db.QueryRowContext(r.Context(), `
		SELECT COALESCE(SUM(TABLE_ROWS),0), COALESCE(SUM(DATA_LENGTH),0),
		       COALESCE(SUM(INDEX_LENGTH),0), COALESCE(SUM(DATA_FREE),0), COUNT(*)
		FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`, name).
		Scan(&rows, &dataLen, &indexLen, &freeLen, &tables)
	_ = db.QueryRowContext(r.Context(), `
		SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
		FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`, name).Scan(&charset, &collation)
	writeJSON(w, http.StatusOK, map[string]any{
		"database":    name,
		"tables":      tables.Int64,
		"rows":        rows.Int64,
		"dataLength":  dataLen.Int64,
		"indexLength": indexLen.Int64,
		"freeLength":  freeLen.Int64,
		"charset":     charset.String,
		"collation":   collation.String,
	})
}

// rewriteDumpDatabase redirects a dump statement from its original schema to
// the restore target. Only schema-qualified identifiers and the CREATE/USE
// directives are touched; string literal data is left alone.
func rewriteDumpDatabase(stmt, original, target string) string {
	origIdent := quoteIdent(original)
	targetIdent := quoteIdent(target)
	replacements := []struct{ from, to string }{
		{"CREATE DATABASE IF NOT EXISTS " + origIdent, "CREATE DATABASE IF NOT EXISTS " + targetIdent},
		{"CREATE DATABASE " + origIdent, "CREATE DATABASE " + targetIdent},
		{"DROP DATABASE IF EXISTS " + origIdent, "DROP DATABASE IF EXISTS " + targetIdent},
		{"DROP DATABASE " + origIdent, "DROP DATABASE " + targetIdent},
		{"USE " + origIdent, "USE " + targetIdent},
		{origIdent + ".", targetIdent + "."},
	}
	var out strings.Builder
	for i := 0; i < len(stmt); {
		if strings.HasPrefix(stmt[i:], origIdent+".") {
			out.WriteString(targetIdent + ".")
			i += len(origIdent) + 1
			continue
		}
		c := stmt[i]
		if c == '\'' || c == '"' || c == '`' {
			quote := c
			out.WriteByte(c)
			i++
			for i < len(stmt) {
				out.WriteByte(stmt[i])
				if stmt[i] == '\\' && i+1 < len(stmt) {
					out.WriteByte(stmt[i+1])
					i += 2
					continue
				}
				if stmt[i] == quote {
					if i+1 < len(stmt) && stmt[i+1] == quote {
						out.WriteByte(stmt[i+1])
						i += 2
						continue
					}
					i++
					break
				}
				i++
			}
			continue
		}
		if c == '#' || (c == '-' && i+1 < len(stmt) && stmt[i+1] == '-') {
			if end := strings.IndexByte(stmt[i:], '\n'); end >= 0 {
				out.WriteString(stmt[i : i+end+1])
				i += end + 1
			} else {
				out.WriteString(stmt[i:])
				i = len(stmt)
			}
			continue
		}
		if c == '/' && i+1 < len(stmt) && stmt[i+1] == '*' {
			if end := strings.Index(stmt[i+2:], "*/"); end >= 0 {
				out.WriteString(stmt[i : i+2+end+2])
				i += 2 + end + 2
			} else {
				out.WriteString(stmt[i:])
				i = len(stmt)
			}
			continue
		}
		matched := false
		for _, repl := range replacements {
			if strings.HasPrefix(stmt[i:], repl.from) {
				out.WriteString(repl.to)
				i += len(repl.from)
				matched = true
				break
			}
		}
		if matched {
			continue
		}
		out.WriteByte(c)
		i++
	}
	return out.String()
}

// =========================================================================
// Backup file manager
// =========================================================================

type backupFile struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Path       string `json:"path"`
	Size       int64  `json:"size"`
	Modified   string `json:"modified"`
	Connection string `json:"connection"`
	Database   string `json:"database"`
}

func backupFileID(rel string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(rel))
}

func (m *backupManager) resolve(id string) (string, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(id)
	if err != nil {
		return "", errors.New("invalid backup id")
	}
	rel := filepath.Clean(string(decoded))
	if rel == "." || filepath.IsAbs(rel) || strings.HasPrefix(rel, "..") {
		return "", errors.New("invalid backup path")
	}
	root := filepath.Clean(m.settings.Directory)
	full := filepath.Join(root, rel)
	relCheck, err := filepath.Rel(root, full)
	if err != nil || strings.HasPrefix(relCheck, "..") {
		return "", errors.New("invalid backup path")
	}
	return full, nil
}

func (m *backupManager) listFiles() ([]backupFile, error) {
	m.mu.Lock()
	root := m.settings.Directory
	m.mu.Unlock()
	root = filepath.Clean(root)
	out := []backupFile{}
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		if d.IsDir() || !strings.HasSuffix(strings.ToLower(d.Name()), ".sql") {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		conn := filepath.Dir(rel)
		if conn == "." {
			conn = ""
		}
		base := strings.TrimSuffix(d.Name(), filepath.Ext(d.Name()))
		database := base
		if m := backupDumpRe.FindStringSubmatch(base); len(m) == 3 {
			database = m[1]
		}
		out = append(out, backupFile{
			ID:         backupFileID(rel),
			Name:       d.Name(),
			Path:       rel,
			Size:       info.Size(),
			Modified:   info.ModTime().Format(time.RFC3339),
			Connection: conn,
			Database:   database,
		})
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Modified > out[j].Modified })
	return out, err
}

func (s *Server) backupFilesList(w http.ResponseWriter, r *http.Request) {
	if s.backups == nil {
		writeErr(w, http.StatusServiceUnavailable, errors.New("backup manager is unavailable"))
		return
	}
	files, err := s.backups.listFiles()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, files)
}

func (s *Server) backupFileDelete(w http.ResponseWriter, r *http.Request) {
	if s.backups == nil {
		writeErr(w, http.StatusServiceUnavailable, errors.New("backup manager is unavailable"))
		return
	}
	path, err := s.backups.resolve(r.PathValue("fileId"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if err := os.Remove(path); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) backupFileDownload(w http.ResponseWriter, r *http.Request) {
	if s.backups == nil {
		writeErr(w, http.StatusServiceUnavailable, errors.New("backup manager is unavailable"))
		return
	}
	path, err := s.backups.resolve(r.PathValue("fileId"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	defer f.Close()
	info, _ := f.Stat()
	w.Header().Set("Content-Type", "application/sql; charset=utf-8")
	w.Header().Set("Content-Disposition", contentDisposition(filepath.Base(path)))
	if info != nil {
		w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	}
	_, _ = io.Copy(w, f)
}

func (s *Server) backupFileRestore(w http.ResponseWriter, r *http.Request) {
	if s.backups == nil {
		writeErr(w, http.StatusServiceUnavailable, errors.New("backup manager is unavailable"))
		return
	}
	var in struct {
		ConnectionID string `json:"connectionId"`
		Database     string `json:"database"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	entry, err := s.store.Get(in.ConnectionID)
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	if entry.Info.ReadOnly {
		writeErr(w, http.StatusForbidden, errReadOnly)
		return
	}
	database := strings.TrimSpace(in.Database)
	if database != "" && !validIdent(database) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid database name %q", database))
		return
	}
	path, err := s.backups.resolve(r.PathValue("fileId"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		writeErr(w, http.StatusNotFound, err)
		return
	}
	defer f.Close()
	db, err := entry.getDB(database)
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

	// A scheduled backup file contains CREATE DATABASE/USE for the original
	// database. When restoring into a chosen database, rewrite those qualified
	// names so the dump lands where the user asked.
	original := ""
	if m := backupDumpRe.FindStringSubmatch(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))); len(m) == 3 {
		original = m[1]
	}
	executed := 0
	err = scanSQL(f, func(stmt string) error {
		if database != "" && original != "" && database != original {
			stmt = rewriteDumpDatabase(stmt, original, database)
		}
		if _, err := execSQLStatement(ctx, conn, stmt, 0); err != nil {
			return fmt.Errorf("statement %d: %w", executed+1, err)
		}
		executed++
		return nil
	})
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("restore executed %d statement(s): %v", executed, err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "statements": executed})
}

// =========================================================================
// Cross-connection diff
// =========================================================================

type crossDiffRequest struct {
	SourceConnectionID string `json:"sourceConnectionId"`
	SourceDatabase     string `json:"sourceDatabase"`
	SourceTable        string `json:"sourceTable"`
	TargetConnectionID string `json:"targetConnectionId"`
	TargetDatabase     string `json:"targetDatabase"`
	TargetTable        string `json:"targetTable"`
	Mode               string `json:"mode"`
}

type crossDiffResponse struct {
	Source      string              `json:"source"`
	Target      string              `json:"target"`
	Schema      *schemaDiffResponse `json:"schema,omitempty"`
	Data        *dataDiffResponse   `json:"data,omitempty"`
	Unavailable string              `json:"unavailable,omitempty"`
}

func (s *Server) crossDiff(w http.ResponseWriter, r *http.Request) {
	var in crossDiffRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	for _, ref := range []struct{ db, table string }{
		{in.SourceDatabase, in.SourceTable},
		{in.TargetDatabase, in.TargetTable},
	} {
		if !validIdent(ref.db) || !validIdent(ref.table) {
			writeErr(w, http.StatusBadRequest, errors.New("invalid source/target table"))
			return
		}
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
	mode := strings.ToLower(strings.TrimSpace(in.Mode))
	if mode == "" {
		mode = "schema"
	}
	resp := crossDiffResponse{
		Source: in.SourceConnectionID + ":" + in.SourceDatabase + "." + in.SourceTable,
		Target: in.TargetConnectionID + ":" + in.TargetDatabase + "." + in.TargetTable,
	}
	if mode == "schema" || mode == "both" {
		src, err := loadSchema(ctx, srcDB, in.SourceDatabase, in.SourceTable)
		if err != nil {
			writeErr(w, http.StatusBadGateway, fmt.Errorf("source schema: %w", err))
			return
		}
		tgt, err := loadSchema(ctx, tgtDB, in.TargetDatabase, in.TargetTable)
		if err != nil {
			writeErr(w, http.StatusBadGateway, fmt.Errorf("target schema: %w", err))
			return
		}
		diff := diffSchemaTable(src, tgt, in.TargetDatabase, in.TargetTable)
		resp.Schema = &diff
	}
	if mode == "data" || mode == "both" {
		data, err := crossDataDiff(ctx, srcDB, tgtDB, in)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		resp.Data = data
	}
	writeJSON(w, http.StatusOK, resp)
}

func crossDataDiff(ctx context.Context, srcDB, tgtDB *sql.DB, in crossDiffRequest) (*dataDiffResponse, error) {
	pk := primaryKeyColumns(ctx, srcDB, in.SourceDatabase, in.SourceTable)
	if len(pk) == 0 {
		return nil, errors.New("source table has no primary key; data diff requires one")
	}
	srcCols, srcRows, srcTruncated, err := dataRows(ctx, srcDB, in.SourceDatabase, in.SourceTable, pk)
	if err != nil {
		return nil, err
	}
	dstCols, dstRows, dstTruncated, err := dataRows(ctx, tgtDB, in.TargetDatabase, in.TargetTable, pk)
	if err != nil {
		return nil, err
	}
	srcIdx := columnIndex(srcCols)
	dstIdx := columnIndex(dstCols)
	pkSrc := make([]int, len(pk))
	pkDst := make([]int, len(pk))
	for i, c := range pk {
		si, okS := srcIdx[strings.ToLower(c)]
		di, okD := dstIdx[strings.ToLower(c)]
		if !okS || !okD {
			return nil, fmt.Errorf("primary key column %q is missing from one of the tables", c)
		}
		pkSrc[i] = si
		pkDst[i] = di
	}
	common := make([]string, 0)
	for _, c := range srcCols {
		if _, ok := dstIdx[strings.ToLower(c)]; ok {
			common = append(common, c)
		}
	}
	srcByKey := make(map[string]map[string]any, len(srcRows))
	for _, row := range srcRows {
		values := make([]any, len(pk))
		for i, idx := range pkSrc {
			values[i] = row[idx]
		}
		obj := make(map[string]any, len(common))
		for _, c := range common {
			obj[c] = row[srcIdx[strings.ToLower(c)]]
		}
		srcByKey[dataKey(values)] = obj
	}
	dstByKey := make(map[string][]any, len(dstRows))
	for _, row := range dstRows {
		values := make([]any, len(pk))
		for i, idx := range pkDst {
			values[i] = row[idx]
		}
		vals := make([]any, len(common))
		for i, c := range common {
			vals[i] = row[dstIdx[strings.ToLower(c)]]
		}
		dstByKey[dataKey(values)] = vals
	}
	resp := &dataDiffResponse{
		Source:     in.SourceDatabase + "." + in.SourceTable,
		Target:     in.TargetDatabase + "." + in.TargetTable,
		KeyColumns: pk,
		SourceRows: len(srcRows),
		TargetRows: len(dstRows),
		Truncated:  srcTruncated || dstTruncated,
	}
	var stmts []string
	const maxStatements = 500
	appendSQL := func(stmt string) {
		if len(stmts) < maxStatements {
			stmts = append(stmts, stmt)
		} else {
			resp.Truncated = true
		}
	}
	columnList := make([]string, len(common))
	for i, c := range common {
		columnList[i] = quoteIdent(c)
	}
	for key, src := range srcByKey {
		dst, exists := dstByKey[key]
		if !exists {
			resp.OnlyInSource++
			values := make([]string, len(common))
			for i, c := range common {
				values[i] = dataSQLValue(src[c])
			}
			appendSQL(fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s);",
				qualify(in.TargetDatabase, in.TargetTable), strings.Join(columnList, ", "), strings.Join(values, ", ")))
			continue
		}
		changed := false
		for i, c := range common {
			if fmt.Sprintf("%v", src[c]) != fmt.Sprintf("%v", dst[i]) {
				changed = true
				break
			}
		}
		if changed {
			resp.Changed++
			sets := make([]string, 0, len(common))
			where := make([]string, 0, len(pk))
			for _, c := range common {
				if containsString(pk, c) {
					continue
				}
				sets = append(sets, quoteIdent(c)+" = "+dataSQLValue(src[c]))
			}
			for _, c := range pk {
				where = append(where, quoteIdent(c)+" = "+dataSQLValue(src[c]))
			}
			appendSQL(fmt.Sprintf("UPDATE %s SET %s WHERE %s;",
				qualify(in.TargetDatabase, in.TargetTable), strings.Join(sets, ", "), strings.Join(where, " AND ")))
		}
	}
	for _, row := range dstRows {
		vals := make([]any, len(pk))
		for i, idx := range pkDst {
			vals[i] = row[idx]
		}
		key := dataKey(vals)
		if _, exists := srcByKey[key]; exists {
			continue
		}
		resp.OnlyInTarget++
		parts := make([]string, len(pk))
		for i, c := range pk {
			parts[i] = quoteIdent(c) + " = " + dataSQLValue(row[pkDst[i]])
		}
		appendSQL(fmt.Sprintf("DELETE FROM %s WHERE %s;",
			qualify(in.TargetDatabase, in.TargetTable), strings.Join(parts, " AND ")))
	}
	resp.SQL = strings.Join(stmts, "\n")
	return resp, nil
}

// =========================================================================
// Connection clone / batch test / import-export
// =========================================================================

func (s *Server) cloneConnection(w http.ResponseWriter, r *http.Request) {
	entry, ok := s.entry(w, r)
	if !ok {
		return
	}
	info := entry.Info
	info.ID = ""
	info.Name = strings.TrimSpace(info.Name) + " (copy)"
	created, err := s.store.Create(info)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"connection": redactConnection(created.Info)})
}

type connectionTestResult struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Connected bool   `json:"connected"`
	LatencyMs int64  `json:"latencyMs,omitempty"`
	Error     string `json:"error,omitempty"`
}

func (s *Server) testAllConnections(w http.ResponseWriter, r *http.Request) {
	list := s.store.List()
	results := make([]connectionTestResult, len(list))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i, info := range list {
		wg.Add(1)
		go func(i int, info Connection) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			start := time.Now()
			entry, err := s.store.Get(info.ID)
			if err != nil {
				results[i] = connectionTestResult{ID: info.ID, Name: info.Name, Error: err.Error()}
				return
			}
			if err := entry.Ping(); err != nil {
				results[i] = connectionTestResult{ID: info.ID, Name: info.Name, Error: err.Error()}
				return
			}
			results[i] = connectionTestResult{ID: info.ID, Name: info.Name, Connected: true, LatencyMs: time.Since(start).Milliseconds()}
		}(i, info)
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, results)
}

func (s *Server) exportConnections(w http.ResponseWriter, r *http.Request) {
	includePasswords := parseBool(r.URL.Query().Get("passwords"), false)
	list := s.store.List()
	out := make([]Connection, len(list))
	for i, c := range list {
		if includePasswords {
			out[i] = c
		} else {
			out[i] = redactConnection(c)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"version":     1,
		"exportedAt":  time.Now().UTC(),
		"passwords":   includePasswords,
		"connections": out,
	})
}

func (s *Server) importConnections(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Connections []Connection `json:"connections"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if len(in.Connections) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("no connections supplied"))
		return
	}
	existing := s.store.List()
	names := make(map[string]bool, len(existing))
	for _, c := range existing {
		names[strings.ToLower(c.Name)] = true
	}
	imported := []Connection{}
	skipped := []map[string]string{}
	for i, c := range in.Connections {
		input := connectionInput{
			Name: c.Name, Host: c.Host, Port: c.Port, User: c.User, Password: c.Password,
			Database: c.Database, SSL: c.SSL, Color: c.Color, ReadOnly: c.ReadOnly,
			HideSystemDatabases: c.HideSystemDatabases, SSH: c.SSH,
		}
		if err := input.validate(); err != nil {
			skipped = append(skipped, map[string]string{"name": c.Name, "reason": fmt.Sprintf("entry %d: %v", i+1, err)})
			continue
		}
		name := strings.TrimSpace(c.Name)
		if names[strings.ToLower(name)] {
			base := name + " (imported)"
			name = base
			for n := 2; names[strings.ToLower(name)]; n++ {
				name = fmt.Sprintf("%s %d", base, n)
			}
		}
		conn := input.toConnection()
		conn.Name = name
		entry, err := s.store.Create(conn)
		if err != nil {
			skipped = append(skipped, map[string]string{"name": name, "reason": err.Error()})
			continue
		}
		names[strings.ToLower(name)] = true
		imported = append(imported, redactConnection(entry.Info))
	}
	status := http.StatusOK
	if len(imported) == 0 && len(skipped) > 0 {
		status = http.StatusBadRequest
	}
	writeJSON(w, status, map[string]any{
		"imported": imported,
		"skipped":  skipped,
		"renamed":  len(imported) > 0,
	})
}

// =========================================================================
// Copy user (password + grants)
// =========================================================================

func (s *Server) copyUser(w http.ResponseWriter, r *http.Request) {
	if !s.requireWrite(w, r) {
		return
	}
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	var in struct {
		TargetUser   string `json:"targetUser"`
		TargetHost   string `json:"targetHost"`
		Password     string `json:"password"`
		CopyPassword bool   `json:"copyPassword"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	sourceUser := r.PathValue("user")
	sourceHost := r.PathValue("host")
	spec, err := userSpec(in.TargetUser, in.TargetHost)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	create := "CREATE USER " + spec
	if strings.TrimSpace(in.Password) != "" {
		create += " IDENTIFIED BY " + quoteSQLString(in.Password)
	} else if in.CopyPassword {
		plugin, hash, err := userPasswordHash(r.Context(), db, sourceUser, sourceHost)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		if hash == "" {
			writeErr(w, http.StatusBadRequest, errors.New("source account has no password hash to copy; supply a password"))
			return
		}
		var version string
		_ = db.QueryRowContext(r.Context(), "SELECT VERSION()").Scan(&version)
		if strings.Contains(strings.ToLower(version), "mariadb") {
			create += " IDENTIFIED BY PASSWORD " + quoteSQLString(hash)
		} else {
			if plugin == "" {
				plugin = "mysql_native_password"
			}
			create += " IDENTIFIED WITH " + quoteIdent(plugin) + " AS " + quoteSQLString(hash)
		}
	}
	if _, err := db.ExecContext(r.Context(), create); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	sourceSpec, err := userSpec(sourceUser, sourceHost)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	rows, err := db.QueryContext(r.Context(), "SHOW GRANTS FOR "+sourceSpec)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	var grants []string
	for rows.Next() {
		var g string
		if rows.Scan(&g) == nil {
			grants = append(grants, g)
		}
	}
	rows.Close()
	for _, grant := range grants {
		q := strings.ReplaceAll(grant, sourceSpec, spec)
		// USAGE only grants no privileges; skip it when recreating.
		if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(q)), "GRANT USAGE ON *.* TO") {
			continue
		}
		if _, err := db.ExecContext(r.Context(), q); err != nil {
			writeErr(w, http.StatusBadGateway, fmt.Errorf("creating account succeeded but copying grants failed: %w", err))
			return
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "grants": len(grants)})
}

func userPasswordHash(ctx context.Context, db *sql.DB, user, host string) (plugin, hash string, err error) {
	// MySQL 5.7/8.0 and MariaDB expose different column names.
	err = db.QueryRowContext(ctx, `
		SELECT COALESCE(plugin,''), COALESCE(authentication_string,'')
		FROM mysql.user WHERE User = ? AND Host = ?`, user, host).Scan(&plugin, &hash)
	if err == nil {
		return plugin, hash, nil
	}
	err = db.QueryRowContext(ctx, `
		SELECT COALESCE(plugin,''), COALESCE(Password,'')
		FROM mysql.user WHERE User = ? AND Host = ?`, user, host).Scan(&plugin, &hash)
	return plugin, hash, err
}

// =========================================================================
// Privilege matrix
// =========================================================================

var matrixFlags = []string{
	"SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP", "ALTER",
	"INDEX", "REFERENCES", "CREATE VIEW", "SHOW VIEW", "TRIGGER", "EXECUTE",
	"EVENT", "GRANT OPTION",
}

type matrixTableGrant struct {
	Table string          `json:"table"`
	Flags map[string]bool `json:"flags"`
}

type matrixDatabaseGrant struct {
	Flags     map[string]bool    `json:"flags"`
	Inherited bool               `json:"inherited"`
	Tables    []matrixTableGrant `json:"tables"`
}

type matrixUser struct {
	User      string                         `json:"user"`
	Host      string                         `json:"host"`
	Global    map[string]bool                `json:"global"`
	Databases map[string]matrixDatabaseGrant `json:"databases"`
}

type privilegeMatrixResponse struct {
	Users     []matrixUser `json:"users"`
	Databases []string     `json:"databases"`
	Flags     []string     `json:"flags"`
}

var grantRe = regexp.MustCompile(`(?is)^\s*GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+`)

var backupDumpRe = regexp.MustCompile(`^(.*)-(\d{8}-\d{6})$`)

func parsePrivilegeList(raw string) []string {
	var out []string
	depth := 0
	start := 0
	flush := func(part string) {
		p := strings.TrimSpace(part)
		if idx := strings.Index(p, "("); idx >= 0 {
			p = strings.TrimSpace(p[:idx])
		}
		p = strings.ToUpper(strings.Join(strings.Fields(p), " "))
		if p != "" {
			out = append(out, p)
		}
	}
	for i, r := range raw {
		switch r {
		case '(':
			depth++
		case ')':
			if depth > 0 {
				depth--
			}
		case ',':
			if depth == 0 {
				flush(raw[start:i])
				start = i + 1
			}
		}
	}
	flush(raw[start:])
	return out
}

func parseGrantObject(raw string) (dbName, table string) {
	raw = strings.TrimSpace(raw)
	if raw == "*.*" {
		return "*", "*"
	}
	parts := strings.SplitN(raw, ".", 2)
	clean := func(s string) string {
		s = strings.TrimSpace(s)
		s = strings.Trim(s, "`")
		s = strings.ReplaceAll(s, "``", "`")
		return s
	}
	if len(parts) == 1 {
		return clean(parts[0]), "*"
	}
	return clean(parts[0]), clean(parts[1])
}

func flagsFromPrivileges(privs []string) map[string]bool {
	out := map[string]bool{}
	all := false
	for _, p := range privs {
		if p == "ALL" || p == "ALL PRIVILEGES" {
			all = true
			continue
		}
		if p == "GRANT OPTION" {
			out["GRANT OPTION"] = true
			continue
		}
		out[p] = true
	}
	if all {
		for _, f := range matrixFlags {
			out[f] = true
		}
	}
	return out
}

func mergeFlags(dst, src map[string]bool) {
	for k, v := range src {
		if v {
			dst[k] = true
		}
	}
}

func (s *Server) privilegeMatrix(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	rows, err := db.QueryContext(ctx, "SELECT User, Host FROM mysql.user ORDER BY User, Host")
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	type account struct{ user, host string }
	var accounts []account
	for rows.Next() {
		var a account
		if rows.Scan(&a.user, &a.host) == nil {
			accounts = append(accounts, a)
		}
	}
	rows.Close()

	dbRows, err := db.QueryContext(ctx, `
		SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME`)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	var databases []string
	for dbRows.Next() {
		var name string
		if dbRows.Scan(&name) == nil && !systemSchemas[strings.ToLower(name)] {
			databases = append(databases, name)
		}
	}
	dbRows.Close()
	dbSet := map[string]bool{}
	for _, d := range databases {
		dbSet[strings.ToLower(d)] = true
	}

	resp := privilegeMatrixResponse{Users: make([]matrixUser, 0, len(accounts)), Databases: databases, Flags: matrixFlags}
	for _, a := range accounts {
		spec, err := userSpec(a.user, a.host)
		if err != nil {
			continue
		}
		grantRows, err := db.QueryContext(ctx, "SHOW GRANTS FOR "+spec)
		if err != nil {
			continue
		}
		u := matrixUser{User: a.user, Host: a.host, Global: map[string]bool{}, Databases: map[string]matrixDatabaseGrant{}}
		for grantRows.Next() {
			var g string
			if grantRows.Scan(&g) != nil {
				continue
			}
			m := grantRe.FindStringSubmatch(g)
			if m == nil {
				continue
			}
			privs := parsePrivilegeList(m[1])
			flags := flagsFromPrivileges(privs)
			dbName, table := parseGrantObject(m[2])
			switch {
			case dbName == "*" && table == "*":
				mergeFlags(u.Global, flags)
			case dbSet[strings.ToLower(dbName)]:
				entry, exists := u.Databases[dbName]
				if !exists {
					entry = matrixDatabaseGrant{Flags: map[string]bool{}, Tables: []matrixTableGrant{}}
				}
				if table == "*" {
					mergeFlags(entry.Flags, flags)
				} else {
					// Table grants are surfaced on the database cell as well.
					mergeFlags(entry.Flags, flags)
					entry.Tables = append(entry.Tables, matrixTableGrant{Table: table, Flags: flags})
				}
				u.Databases[dbName] = entry
			}
		}
		grantRows.Close()
		// Global privileges are inherited by every database that does not
		// define its own grant. Keep both states visible in the UI.
		for _, dbName := range databases {
			entry, exists := u.Databases[dbName]
			if !exists {
				entry = matrixDatabaseGrant{Flags: map[string]bool{}, Tables: []matrixTableGrant{}}
			}
			entry.Inherited = len(u.Global) > 0
			u.Databases[dbName] = entry
		}
		resp.Users = append(resp.Users, u)
	}
	writeJSON(w, http.StatusOK, resp)
}
