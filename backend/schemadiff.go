package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

type schemaColumn struct {
	Name       string  `json:"name"`
	ColumnType string  `json:"columnType"`
	Nullable   bool    `json:"nullable"`
	Key        string  `json:"key"`
	Extra      string  `json:"extra"`
	Default    *string `json:"default"`
	Comment    string  `json:"comment"`
}

type schemaIndex struct {
	Name    string   `json:"name"`
	Unique  bool     `json:"unique"`
	Columns []string `json:"columns"`
}

type schemaTable struct {
	Columns []schemaColumn
	Indexes []schemaIndex
}

type columnChange struct {
	Name   string       `json:"name"`
	Source schemaColumn `json:"source"`
	Target schemaColumn `json:"target"`
}

type schemaDiffResponse struct {
	ColumnsAdded   []schemaColumn `json:"columnsAdded"`
	ColumnsRemoved []schemaColumn `json:"columnsRemoved"`
	ColumnsChanged []columnChange `json:"columnsChanged"`
	IndexesAdded   []schemaIndex  `json:"indexesAdded"`
	IndexesRemoved []schemaIndex  `json:"indexesRemoved"`
	DDL            []string       `json:"ddl"`
}

func loadSchema(ctx context.Context, db *sql.DB, schema, table string) (*schemaTable, error) {
	out := &schemaTable{Columns: []schemaColumn{}, Indexes: []schemaIndex{}}

	rows, err := db.QueryContext(ctx, `
		SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COALESCE(COLUMN_KEY,''),
		       COALESCE(EXTRA,''), COLUMN_DEFAULT, COALESCE(COLUMN_COMMENT,'')
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		ORDER BY ORDINAL_POSITION`, schema, table)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var (
			c        schemaColumn
			nullable string
			def      sql.NullString
		)
		if err := rows.Scan(&c.Name, &c.ColumnType, &nullable, &c.Key, &c.Extra, &def, &c.Comment); err != nil {
			rows.Close()
			return nil, err
		}
		c.Nullable = strings.EqualFold(nullable, "YES")
		if def.Valid {
			v := def.String
			c.Default = &v
		}
		out.Columns = append(out.Columns, c)
	}
	rows.Close()
	if len(out.Columns) == 0 {
		return nil, fmt.Errorf("table %s.%s not found", schema, table)
	}

	idxRows, err := db.QueryContext(ctx, `
		SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME
		FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		ORDER BY INDEX_NAME, SEQ_IN_INDEX`, schema, table)
	if err != nil {
		return nil, err
	}
	defer idxRows.Close()
	indexMap := map[string]*schemaIndex{}
	order := []string{}
	for idxRows.Next() {
		var (
			name    string
			nonUniq int
			column  string
		)
		if err := idxRows.Scan(&name, &nonUniq, &column); err != nil {
			return nil, err
		}
		idx, ok := indexMap[name]
		if !ok {
			idx = &schemaIndex{Name: name, Unique: nonUniq == 0, Columns: []string{}}
			indexMap[name] = idx
			order = append(order, name)
		}
		idx.Columns = append(idx.Columns, column)
	}
	for _, name := range order {
		out.Indexes = append(out.Indexes, *indexMap[name])
	}
	return out, nil
}

func columnDDL(c schemaColumn) string {
	def := quoteIdent(c.Name) + " " + c.ColumnType
	if c.Nullable {
		def += " NULL"
	} else {
		def += " NOT NULL"
	}
	if c.Default != nil {
		def += " DEFAULT " + defaultLiteral(*c.Default, c.ColumnType)
	}
	if strings.Contains(strings.ToLower(c.Extra), "auto_increment") {
		def += " AUTO_INCREMENT"
	}
	if strings.TrimSpace(c.Comment) != "" {
		def += " COMMENT " + sqlValueLiteral(c.Comment)
	}
	return def
}

func normalizeExtra(s string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(s), "DEFAULT_GENERATED", ""))
}

func sameColumn(a, b schemaColumn) bool {
	if !strings.EqualFold(strings.TrimSpace(a.ColumnType), strings.TrimSpace(b.ColumnType)) {
		return false
	}
	if a.Nullable != b.Nullable {
		return false
	}
	if normalizeExtra(a.Extra) != normalizeExtra(b.Extra) {
		return false
	}
	if strings.TrimSpace(a.Comment) != strings.TrimSpace(b.Comment) {
		return false
	}
	switch {
	case a.Default == nil && b.Default == nil:
		return true
	case a.Default == nil || b.Default == nil:
		return false
	default:
		return strings.TrimSpace(*a.Default) == strings.TrimSpace(*b.Default)
	}
}

func indexColumnsEqual(a, b schemaIndex) bool {
	if a.Unique != b.Unique || len(a.Columns) != len(b.Columns) {
		return false
	}
	for i := range a.Columns {
		if !strings.EqualFold(a.Columns[i], b.Columns[i]) {
			return false
		}
	}
	return true
}

func indexDDL(schema, table string, idx schemaIndex, add bool) string {
	target := qualify(schema, table)
	cols := make([]string, len(idx.Columns))
	for i, c := range idx.Columns {
		cols[i] = quoteIdent(c)
	}
	colList := strings.Join(cols, ", ")
	if strings.EqualFold(idx.Name, "PRIMARY") {
		if add {
			return fmt.Sprintf("ALTER TABLE %s ADD PRIMARY KEY (%s)", target, colList)
		}
		return fmt.Sprintf("ALTER TABLE %s DROP PRIMARY KEY", target)
	}
	if add {
		kind := "INDEX"
		if idx.Unique {
			kind = "UNIQUE INDEX"
		}
		return fmt.Sprintf("ALTER TABLE %s ADD %s %s (%s)", target, kind, quoteIdent(idx.Name), colList)
	}
	return fmt.Sprintf("ALTER TABLE %s DROP INDEX %s", target, quoteIdent(idx.Name))
}

// schemaDiff compares two tables and returns the differences plus the DDL needed
// to make the target match the source.
func (s *Server) schemaDiff(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	var in struct {
		Source struct {
			Database string `json:"database"`
			Table    string `json:"table"`
		} `json:"source"`
		Target struct {
			Database string `json:"database"`
			Table    string `json:"table"`
		} `json:"target"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	for _, ref := range []struct{ db, table string }{
		{in.Source.Database, in.Source.Table},
		{in.Target.Database, in.Target.Table},
	} {
		if !validIdent(ref.db) || !validIdent(ref.table) {
			writeErr(w, http.StatusBadRequest, errors.New("invalid source/target table"))
			return
		}
	}

	ctx := r.Context()
	src, err := loadSchema(ctx, db, in.Source.Database, in.Source.Table)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	tgt, err := loadSchema(ctx, db, in.Target.Database, in.Target.Table)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}

	resp := schemaDiffResponse{
		ColumnsAdded:   []schemaColumn{},
		ColumnsRemoved: []schemaColumn{},
		ColumnsChanged: []columnChange{},
		IndexesAdded:   []schemaIndex{},
		IndexesRemoved: []schemaIndex{},
		DDL:            []string{},
	}

	srcCols := map[string]schemaColumn{}
	for _, c := range src.Columns {
		srcCols[strings.ToLower(c.Name)] = c
	}
	tgtCols := map[string]schemaColumn{}
	for _, c := range tgt.Columns {
		tgtCols[strings.ToLower(c.Name)] = c
	}

	for _, c := range src.Columns {
		if t, ok := tgtCols[strings.ToLower(c.Name)]; !ok {
			resp.ColumnsAdded = append(resp.ColumnsAdded, c)
			resp.DDL = append(resp.DDL, "ALTER TABLE "+qualify(in.Target.Database, in.Target.Table)+" ADD COLUMN "+columnDDL(c))
		} else if !sameColumn(c, t) {
			resp.ColumnsChanged = append(resp.ColumnsChanged, columnChange{Name: c.Name, Source: c, Target: t})
			resp.DDL = append(resp.DDL, "ALTER TABLE "+qualify(in.Target.Database, in.Target.Table)+" MODIFY COLUMN "+columnDDL(c))
		}
	}
	for _, c := range tgt.Columns {
		if _, ok := srcCols[strings.ToLower(c.Name)]; !ok {
			resp.ColumnsRemoved = append(resp.ColumnsRemoved, c)
			resp.DDL = append(resp.DDL, "ALTER TABLE "+qualify(in.Target.Database, in.Target.Table)+" DROP COLUMN "+quoteIdent(c.Name))
		}
	}

	srcIdx := map[string]schemaIndex{}
	for _, i := range src.Indexes {
		srcIdx[strings.ToLower(i.Name)] = i
	}
	tgtIdx := map[string]schemaIndex{}
	for _, i := range tgt.Indexes {
		tgtIdx[strings.ToLower(i.Name)] = i
	}
	for _, i := range src.Indexes {
		t, ok := tgtIdx[strings.ToLower(i.Name)]
		if !ok {
			resp.IndexesAdded = append(resp.IndexesAdded, i)
			resp.DDL = append(resp.DDL, indexDDL(in.Target.Database, in.Target.Table, i, true))
		} else if !indexColumnsEqual(i, t) {
			resp.IndexesRemoved = append(resp.IndexesRemoved, t)
			resp.IndexesAdded = append(resp.IndexesAdded, i)
			resp.DDL = append(resp.DDL, indexDDL(in.Target.Database, in.Target.Table, t, false))
			resp.DDL = append(resp.DDL, indexDDL(in.Target.Database, in.Target.Table, i, true))
		}
	}
	for _, i := range tgt.Indexes {
		if _, ok := srcIdx[strings.ToLower(i.Name)]; !ok {
			resp.IndexesRemoved = append(resp.IndexesRemoved, i)
			resp.DDL = append(resp.DDL, indexDDL(in.Target.Database, in.Target.Table, i, false))
		}
	}

	writeJSON(w, http.StatusOK, resp)
}
