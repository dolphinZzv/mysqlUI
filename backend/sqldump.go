package main

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"strings"
)

// writeDatabaseDump streams a schema (tables, views, routines, triggers and
// events) to w. It is used by both the database and whole-server exporters so
// backups include programmable objects, not just base tables.
func writeDatabaseDump(ctx context.Context, w io.Writer, db *sql.DB, schema string) {
	fmt.Fprintf(w, "\n-- Database: %s\nCREATE DATABASE IF NOT EXISTS %s;\nUSE %s;\n\n",
		schema, quoteIdent(schema), quoteIdent(schema))

	// Base tables first so views and triggers can reference them.
	names := queryNames(ctx, db, `SELECT TABLE_NAME FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`, schema)
	for _, name := range names {
		rows, err := db.QueryContext(ctx, "SELECT * FROM "+qualify(schema, name))
		if err != nil {
			fmt.Fprintf(w, "-- skipping %s.%s: %s\n\n", schema, name, err)
			continue
		}
		columns, err := rows.Columns()
		if err != nil {
			rows.Close()
			continue
		}
		_ = streamTableSQL(w, db, schema, name, columns, rows)
		rows.Close()
	}

	// Views.
	views := queryNames(ctx, db, `SELECT TABLE_NAME FROM information_schema.VIEWS
		WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`, schema)
	for _, name := range views {
		create, err := showCreateSQL(ctx, db, "SHOW CREATE VIEW "+qualify(schema, name))
		if err != nil {
			fmt.Fprintf(w, "-- skipping view %s.%s: %s\n\n", schema, name, err)
			continue
		}
		fmt.Fprintf(w, "--\n-- View structure for `%s`\n--\nDROP VIEW IF EXISTS %s;\n%s;\n\n",
			name, qualify(schema, name), trimStatement(create))
	}

	// Stored procedures and functions.
	routineRows, err := db.QueryContext(ctx, `SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES
		WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_TYPE, ROUTINE_NAME`, schema)
	if err == nil {
		type routine struct{ name, kind string }
		var routines []routine
		for routineRows.Next() {
			var item routine
			if routineRows.Scan(&item.name, &item.kind) == nil {
				routines = append(routines, item)
			}
		}
		routineRows.Close()
		for _, item := range routines {
			kind := strings.ToUpper(item.kind)
			if kind != "PROCEDURE" && kind != "FUNCTION" {
				continue
			}
			create, err := showCreateSQL(ctx, db, "SHOW CREATE "+kind+" "+qualify(schema, item.name))
			if err != nil {
				fmt.Fprintf(w, "-- skipping %s %s.%s: %s\n\n", kind, schema, item.name, err)
				continue
			}
			fmt.Fprintf(w, "--\n-- %s `%s`\n--\nDELIMITER ;;\nDROP %s IF EXISTS %s;;\n%s;;\nDELIMITER ;\n\n",
				kind, item.name, kind, qualify(schema, item.name), trimStatement(create))
		}
	}

	// Triggers.
	triggerNames := queryNames(ctx, db, `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
		WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME`, schema)
	for _, name := range triggerNames {
		create, err := showCreateSQL(ctx, db, "SHOW CREATE TRIGGER "+qualify(schema, name))
		if err != nil {
			fmt.Fprintf(w, "-- skipping trigger %s.%s: %s\n\n", schema, name, err)
			continue
		}
		fmt.Fprintf(w, "--\n-- Trigger `%s`\n--\nDELIMITER ;;\nDROP TRIGGER IF EXISTS %s;;\n%s;;\nDELIMITER ;\n\n",
			name, qualify(schema, name), trimStatement(create))
	}

	// Events.
	eventNames := queryNames(ctx, db, `SELECT EVENT_NAME FROM information_schema.EVENTS
		WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME`, schema)
	for _, name := range eventNames {
		create, err := showCreateSQL(ctx, db, "SHOW CREATE EVENT "+qualify(schema, name))
		if err != nil {
			fmt.Fprintf(w, "-- skipping event %s.%s: %s\n\n", schema, name, err)
			continue
		}
		fmt.Fprintf(w, "--\n-- Event `%s`\n--\nDELIMITER ;;\nDROP EVENT IF EXISTS %s;;\n%s;;\nDELIMITER ;\n\n",
			name, qualify(schema, name), trimStatement(create))
	}
}

func queryNames(ctx context.Context, db *sql.DB, query string, args ...any) []string {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var name string
		if rows.Scan(&name) == nil && name != "" {
			out = append(out, name)
		}
	}
	return out
}

// showCreateSQL runs a SHOW CREATE ... statement and extracts the column whose
// name starts with "Create ". The column layout differs between views,
// routines, triggers and events, so it is looked up dynamically.
func showCreateSQL(ctx context.Context, db *sql.DB, query string) (string, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return "", err
	}
	createIdx := -1
	for i, name := range columns {
		lower := strings.ToLower(strings.TrimSpace(name))
		if strings.HasPrefix(lower, "create ") || lower == "sql original statement" {
			createIdx = i
			break
		}
	}
	if createIdx < 0 {
		return "", fmt.Errorf("SHOW CREATE did not return a CREATE column")
	}
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return "", err
		}
		return "", sql.ErrNoRows
	}
	vals := make([]any, len(columns))
	ptrs := make([]any, len(columns))
	for i := range vals {
		ptrs[i] = &vals[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		return "", err
	}
	switch v := vals[createIdx].(type) {
	case []byte:
		return string(v), nil
	case string:
		return v, nil
	default:
		return fmt.Sprintf("%v", v), nil
	}
}

func trimStatement(s string) string {
	return strings.TrimSpace(strings.TrimRight(strings.TrimSpace(s), ";"))
}
