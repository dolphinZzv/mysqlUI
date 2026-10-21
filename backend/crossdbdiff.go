package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
)

type databaseObject struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	CreateSQL string `json:"createSql,omitempty"`
}

type databaseTableChange struct {
	Table     string              `json:"table"`
	Type      string              `json:"type"`
	Status    string              `json:"status"`
	Diff      *schemaDiffResponse `json:"diff,omitempty"`
	CreateSQL string              `json:"createSql,omitempty"`
}

type crossDatabaseDiffResponse struct {
	Source        string                `json:"source"`
	Target        string                `json:"target"`
	TablesAdded   []databaseObject      `json:"tablesAdded"`
	TablesRemoved []databaseObject      `json:"tablesRemoved"`
	TablesChanged []databaseTableChange `json:"tablesChanged"`
	DDL           []string              `json:"ddl"`
	Warnings      []string              `json:"warnings"`
	SourceTables  int                   `json:"sourceTables"`
	TargetTables  int                   `json:"targetTables"`
}

type dbObjectRef struct {
	Name string
	Type string
}

func listDatabaseObjects(ctx context.Context, db *sql.DB, schema string) ([]dbObjectRef, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []dbObjectRef{}
	for rows.Next() {
		var name, kind string
		if err := rows.Scan(&name, &kind); err != nil {
			return nil, err
		}
		out = append(out, dbObjectRef{Name: name, Type: kind})
	}
	return out, rows.Err()
}

func showCreateForObject(ctx context.Context, db *sql.DB, schema, name, kind string) (string, error) {
	query := "SHOW CREATE TABLE " + qualify(schema, name)
	if strings.EqualFold(kind, "VIEW") {
		query = "SHOW CREATE VIEW " + qualify(schema, name)
	}
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return "", err
	}
	if !rows.Next() {
		return "", fmt.Errorf("no definition returned for %s", name)
	}
	vals := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		return "", err
	}
	for i, c := range cols {
		if strings.EqualFold(c, "Create Table") || strings.EqualFold(c, "Create View") {
			if text, ok := normalizeValue(vals[i]).(string); ok {
				return text, nil
			}
		}
	}
	if len(vals) > 1 {
		if s, ok := normalizeValue(vals[1]).(string); ok {
			return s, nil
		}
	}
	return "", fmt.Errorf("create statement not found for %s", name)
}

func sourceDependencies(ctx context.Context, db *sql.DB, schema string) map[string][]string {
	deps := map[string][]string{}
	rows, err := db.QueryContext(ctx, `
		SELECT TABLE_NAME, REFERENCED_TABLE_NAME
		FROM information_schema.KEY_COLUMN_USAGE
		WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`, schema)
	if err != nil {
		return deps
	}
	defer rows.Close()
	for rows.Next() {
		var table, ref string
		if rows.Scan(&table, &ref) == nil && !strings.EqualFold(table, ref) {
			found := false
			for _, existing := range deps[table] {
				if existing == ref {
					found = true
					break
				}
			}
			if !found {
				deps[table] = append(deps[table], ref)
			}
		}
	}
	return deps
}

// topoSortTables orders referenced tables before the tables that reference them.
func topoSortTables(names []string, deps map[string][]string) []string {
	wanted := map[string]bool{}
	for _, n := range names {
		wanted[strings.ToLower(n)] = true
	}
	visited := map[string]int{} // 1 visiting, 2 done
	out := []string{}
	var visit func(string)
	visit = func(name string) {
		key := strings.ToLower(name)
		if visited[key] == 2 {
			return
		}
		if visited[key] == 1 {
			return // dependency cycle: keep declaration order
		}
		visited[key] = 1
		for _, dep := range deps[name] {
			if wanted[strings.ToLower(dep)] {
				visit(dep)
			}
		}
		visited[key] = 2
		out = append(out, name)
	}
	for _, name := range names {
		visit(name)
	}
	return out
}

func viewCreateOrReplace(createSQL string) string {
	trimmed := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(createSQL), ";"))
	upper := strings.ToUpper(trimmed)
	if strings.HasPrefix(upper, "CREATE ") && !strings.HasPrefix(upper, "CREATE OR REPLACE ") {
		return "CREATE OR REPLACE " + trimmed[len("CREATE "):]
	}
	return trimmed
}

func (s *Server) crossDatabaseDiff(w http.ResponseWriter, r *http.Request) {
	var in struct {
		SourceConnectionID string `json:"sourceConnectionId"`
		SourceDatabase     string `json:"sourceDatabase"`
		TargetConnectionID string `json:"targetConnectionId"`
		TargetDatabase     string `json:"targetDatabase"`
		IncludeDrops       bool   `json:"includeDrops"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if !validIdent(in.SourceDatabase) || !validIdent(in.TargetDatabase) {
		writeErr(w, http.StatusBadRequest, errors.New("invalid source or target database"))
		return
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
	srcObjects, err := listDatabaseObjects(ctx, srcDB, in.SourceDatabase)
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("source schema: %w", err))
		return
	}
	tgtObjects, err := listDatabaseObjects(ctx, tgtDB, in.TargetDatabase)
	if err != nil {
		writeErr(w, http.StatusBadGateway, fmt.Errorf("target schema: %w", err))
		return
	}
	srcMap := map[string]dbObjectRef{}
	for _, obj := range srcObjects {
		srcMap[strings.ToLower(obj.Name)] = obj
	}
	tgtMap := map[string]dbObjectRef{}
	for _, obj := range tgtObjects {
		tgtMap[strings.ToLower(obj.Name)] = obj
	}

	resp := crossDatabaseDiffResponse{
		Source:        in.SourceConnectionID + ":" + in.SourceDatabase,
		Target:        in.TargetConnectionID + ":" + in.TargetDatabase,
		TablesAdded:   []databaseObject{},
		TablesRemoved: []databaseObject{},
		TablesChanged: []databaseTableChange{},
		DDL:           []string{},
		Warnings:      []string{},
		SourceTables:  len(srcObjects),
		TargetTables:  len(tgtObjects),
	}

	// Added objects: fetch definitions and order tables by foreign-key deps.
	var addedTables []string
	var addedViews []databaseObject
	for _, obj := range srcObjects {
		if _, exists := tgtMap[strings.ToLower(obj.Name)]; exists {
			continue
		}
		createSQL, err := showCreateForObject(ctx, srcDB, in.SourceDatabase, obj.Name, obj.Type)
		if err != nil {
			resp.Warnings = append(resp.Warnings, fmt.Sprintf("Could not read definition for %s: %v", obj.Name, err))
			continue
		}
		item := databaseObject{Name: obj.Name, Type: obj.Type, CreateSQL: createSQL}
		resp.TablesAdded = append(resp.TablesAdded, item)
		if strings.EqualFold(obj.Type, "VIEW") {
			addedViews = append(addedViews, item)
		} else {
			addedTables = append(addedTables, obj.Name)
		}
	}
	deps := sourceDependencies(ctx, srcDB, in.SourceDatabase)
	orderedAdded := topoSortTables(addedTables, deps)
	createByName := map[string]databaseObject{}
	for _, item := range resp.TablesAdded {
		createByName[strings.ToLower(item.Name)] = item
	}
	for _, name := range orderedAdded {
		if item, ok := createByName[strings.ToLower(name)]; ok {
			resp.DDL = append(resp.DDL, strings.TrimSpace(strings.TrimSuffix(item.CreateSQL, ";")))
		}
	}
	for _, view := range addedViews {
		resp.DDL = append(resp.DDL, strings.TrimSpace(strings.TrimSuffix(view.CreateSQL, ";")))
	}

	// Changed objects.
	for _, obj := range srcObjects {
		targetObj, exists := tgtMap[strings.ToLower(obj.Name)]
		if !exists {
			continue
		}
		srcCreate, err := showCreateForObject(ctx, srcDB, in.SourceDatabase, obj.Name, obj.Type)
		if err != nil {
			resp.Warnings = append(resp.Warnings, fmt.Sprintf("Could not read source definition for %s: %v", obj.Name, err))
			continue
		}
		if !strings.EqualFold(obj.Type, targetObj.Type) {
			change := databaseTableChange{Table: obj.Name, Type: obj.Type, Status: "type-changed", CreateSQL: srcCreate}
			resp.TablesChanged = append(resp.TablesChanged, change)
			resp.Warnings = append(resp.Warnings, fmt.Sprintf("%s is a %s in source but a %s in target; drop and recreate is required.", obj.Name, obj.Type, targetObj.Type))
			if in.IncludeDrops {
				if strings.EqualFold(targetObj.Type, "VIEW") {
					resp.DDL = append(resp.DDL, "DROP VIEW IF EXISTS "+quoteIdent(obj.Name))
				} else {
					resp.DDL = append(resp.DDL, "DROP TABLE IF EXISTS "+quoteIdent(obj.Name))
				}
				resp.DDL = append(resp.DDL, strings.TrimSpace(strings.TrimSuffix(srcCreate, ";")))
			}
			continue
		}
		if strings.EqualFold(obj.Type, "VIEW") {
			tgtCreate, err := showCreateForObject(ctx, tgtDB, in.TargetDatabase, targetObj.Name, targetObj.Type)
			if err != nil {
				resp.Warnings = append(resp.Warnings, fmt.Sprintf("Could not read target definition for %s: %v", obj.Name, err))
				continue
			}
			if strings.TrimSpace(srcCreate) != strings.TrimSpace(tgtCreate) {
				resp.TablesChanged = append(resp.TablesChanged, databaseTableChange{
					Table: obj.Name, Type: obj.Type, Status: "changed", CreateSQL: srcCreate,
				})
				resp.DDL = append(resp.DDL, viewCreateOrReplace(srcCreate))
			}
			continue
		}
		srcSchema, err := loadSchema(ctx, srcDB, in.SourceDatabase, obj.Name)
		if err != nil {
			resp.Warnings = append(resp.Warnings, fmt.Sprintf("Could not load source schema for %s: %v", obj.Name, err))
			continue
		}
		tgtSchema, err := loadSchema(ctx, tgtDB, in.TargetDatabase, targetObj.Name)
		if err != nil {
			resp.Warnings = append(resp.Warnings, fmt.Sprintf("Could not load target schema for %s: %v", obj.Name, err))
			continue
		}
		diff := diffSchemaTable(srcSchema, tgtSchema, in.TargetDatabase, obj.Name)
		if len(diff.ColumnsAdded)+len(diff.ColumnsRemoved)+len(diff.ColumnsChanged)+len(diff.IndexesAdded)+len(diff.IndexesRemoved) == 0 {
			continue
		}
		resp.TablesChanged = append(resp.TablesChanged, databaseTableChange{
			Table: obj.Name, Type: obj.Type, Status: "changed", Diff: &diff,
		})
		resp.DDL = append(resp.DDL, diff.DDL...)

		// Removing a target column or index can lose data; make that explicit.
		if len(diff.ColumnsRemoved) > 0 {
			names := make([]string, len(diff.ColumnsRemoved))
			for i, c := range diff.ColumnsRemoved {
				names[i] = c.Name
			}
			resp.Warnings = append(resp.Warnings, fmt.Sprintf("%s drops target column(s): %s. Data in them will be lost.", obj.Name, strings.Join(names, ", ")))
		}
	}

	// Removed objects: only dropped when explicitly enabled, in reverse
	// dependency order so referencing tables go first.
	var removedTables []string
	for _, obj := range tgtObjects {
		if _, exists := srcMap[strings.ToLower(obj.Name)]; exists {
			continue
		}
		createSQL, _ := showCreateForObject(ctx, tgtDB, in.TargetDatabase, obj.Name, obj.Type)
		resp.TablesRemoved = append(resp.TablesRemoved, databaseObject{Name: obj.Name, Type: obj.Type, CreateSQL: createSQL})
		if !strings.EqualFold(obj.Type, "VIEW") {
			removedTables = append(removedTables, obj.Name)
		}
	}
	if len(resp.TablesRemoved) > 0 {
		if in.IncludeDrops {
			ordered := topoSortTables(removedTables, sourceDependencies(ctx, tgtDB, in.TargetDatabase))
			for i := len(ordered) - 1; i >= 0; i-- {
				resp.DDL = append(resp.DDL, "DROP TABLE IF EXISTS "+quoteIdent(ordered[i]))
			}
			for _, obj := range resp.TablesRemoved {
				if strings.EqualFold(obj.Type, "VIEW") {
					resp.DDL = append(resp.DDL, "DROP VIEW IF EXISTS "+quoteIdent(obj.Name))
				}
			}
		} else {
			resp.Warnings = append(resp.Warnings, fmt.Sprintf("Target has %d object(s) that do not exist in source; enable “drop extra objects” to remove them.", len(resp.TablesRemoved)))
		}
	}
	sort.Slice(resp.TablesAdded, func(i, j int) bool { return resp.TablesAdded[i].Name < resp.TablesAdded[j].Name })
	sort.Slice(resp.TablesRemoved, func(i, j int) bool { return resp.TablesRemoved[i].Name < resp.TablesRemoved[j].Name })
	sort.Slice(resp.TablesChanged, func(i, j int) bool { return resp.TablesChanged[i].Table < resp.TablesChanged[j].Table })
	writeJSON(w, http.StatusOK, resp)
}
