package main

import (
	"context"
	"database/sql"
	"net/http"
	"sort"
	"strings"
)

type erdTable struct {
	Name string `json:"name"`
}

type erdEdge struct {
	Constraint string `json:"constraint"`
	FromTable  string `json:"fromTable"`
	FromColumn string `json:"fromColumn"`
	ToTable    string `json:"toTable"`
	ToColumn   string `json:"toColumn"`
	// Kind is "foreign_key" for a real database constraint and "inferred" for a
	// relationship detected from application-level conventions (for example a
	// `user_id` column that points at `users.id`).
	Kind string `json:"kind"`
	// Confidence is only set for inferred relationships.
	Confidence string `json:"confidence,omitempty"`
}

type erdResponse struct {
	Tables []erdTable `json:"tables"`
	Edges  []erdEdge  `json:"edges"`
}

type erdColumnMeta struct {
	Name     string
	Type     string
	Nullable bool
}

type erdTableMeta struct {
	Name         string
	Columns      []erdColumnMeta
	columnByName map[string]erdColumnMeta
	PrimaryKey   []string
	UniqueSingle map[string]bool
}

func newErdTableMeta(name string) erdTableMeta {
	return erdTableMeta{
		Name:         name,
		Columns:      []erdColumnMeta{},
		columnByName: map[string]erdColumnMeta{},
		PrimaryKey:   []string{},
		UniqueSingle: map[string]bool{},
	}
}

func (t *erdTableMeta) addColumn(c erdColumnMeta) {
	t.Columns = append(t.Columns, c)
	t.columnByName[strings.ToLower(c.Name)] = c
}

// erd returns the tables of a database and their relationships. Real foreign
// keys are reported first; additional relationships are inferred from common
// application-level naming conventions because many applications do not declare
// database-level foreign keys.
func (s *Server) erd(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, _, ok := s.params(w, r)
	if !ok {
		return
	}
	ctx := r.Context()

	meta, tables, err := loadErdMeta(ctx, db, dbName)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}

	rows, err := loadErdForeignKeyRows(ctx, db, dbName)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}

	explicit := make(map[string]bool, len(rows))
	for _, e := range rows {
		explicit[erdColumnKey(e.FromTable, e.FromColumn)] = true
	}

	resp := erdResponse{
		Tables: tables,
		Edges:  groupErdForeignKeys(rows),
	}
	resp.Edges = append(resp.Edges, inferErdEdges(meta, explicit)...)

	writeJSON(w, http.StatusOK, resp)
}

func loadErdMeta(ctx context.Context, db *sql.DB, dbName string) ([]*erdTableMeta, []erdTable, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT TABLE_NAME FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
		ORDER BY TABLE_NAME`, dbName)
	if err != nil {
		return nil, nil, err
	}
	metas := []*erdTableMeta{}
	tables := []erdTable{}
	byName := map[string]*erdTableMeta{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return nil, nil, err
		}
		t := newErdTableMeta(name)
		metas = append(metas, &t)
		byName[name] = &t
		tables = append(tables, erdTable{Name: name})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, nil, err
	}
	rows.Close()

	colRows, err := db.QueryContext(ctx, `
		SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ?
		ORDER BY TABLE_NAME, ORDINAL_POSITION`, dbName)
	if err != nil {
		return nil, nil, err
	}
	for colRows.Next() {
		var table, name, typ, nullable string
		if err := colRows.Scan(&table, &name, &typ, &nullable); err != nil {
			colRows.Close()
			return nil, nil, err
		}
		if t := byName[table]; t != nil {
			t.addColumn(erdColumnMeta{
				Name:     name,
				Type:     typ,
				Nullable: strings.EqualFold(nullable, "YES"),
			})
		}
	}
	if err := colRows.Err(); err != nil {
		colRows.Close()
		return nil, nil, err
	}
	colRows.Close()

	idxRows, err := db.QueryContext(ctx, `
		SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME
		FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = ?
		ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, dbName)
	if err != nil {
		return nil, nil, err
	}
	type indexMeta struct {
		table   *erdTableMeta
		name    string
		unique  bool
		columns []string
	}
	indexes := map[string]*indexMeta{}
	order := []*indexMeta{}
	for idxRows.Next() {
		var table, name string
		var column sql.NullString
		var nonUnique int
		if err := idxRows.Scan(&table, &name, &nonUnique, &column); err != nil {
			idxRows.Close()
			return nil, nil, err
		}
		t := byName[table]
		if t == nil {
			continue
		}
		key := table + "\x00" + name
		idx := indexes[key]
		if idx == nil {
			idx = &indexMeta{table: t, name: name, unique: nonUnique == 0, columns: []string{}}
			indexes[key] = idx
			order = append(order, idx)
		}
		// Functional indexes have no COLUMN_NAME; they cannot participate in
		// the naming-based inference.
		if column.Valid {
			idx.columns = append(idx.columns, column.String)
		}
	}
	if err := idxRows.Err(); err != nil {
		idxRows.Close()
		return nil, nil, err
	}
	idxRows.Close()

	for _, idx := range order {
		if strings.EqualFold(idx.name, "PRIMARY") {
			idx.table.PrimaryKey = append([]string{}, idx.columns...)
		}
		if idx.unique && len(idx.columns) == 1 {
			idx.table.UniqueSingle[strings.ToLower(idx.columns[0])] = true
		}
	}
	return metas, tables, nil
}

func loadErdForeignKeyRows(ctx context.Context, db *sql.DB, dbName string) ([]erdEdge, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
		FROM information_schema.KEY_COLUMN_USAGE
		WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_SCHEMA = ?
		  AND REFERENCED_TABLE_NAME IS NOT NULL
		ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`, dbName, dbName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []erdEdge{}
	for rows.Next() {
		var e erdEdge
		if err := rows.Scan(&e.Constraint, &e.FromTable, &e.FromColumn, &e.ToTable, &e.ToColumn); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// groupErdForeignKeys collapses composite keys into one edge per constraint so
// the diagram shows one relationship instead of one line per key column.
func groupErdForeignKeys(rows []erdEdge) []erdEdge {
	out := []erdEdge{}
	index := map[string]int{}
	for _, e := range rows {
		key := e.FromTable + "\x00" + e.Constraint + "\x00" + e.ToTable
		if i, ok := index[key]; ok {
			out[i].FromColumn += ", " + e.FromColumn
			out[i].ToColumn += ", " + e.ToColumn
			continue
		}
		e.Kind = "foreign_key"
		index[key] = len(out)
		out = append(out, e)
	}
	return out
}

func erdColumnKey(table, column string) string {
	return strings.ToLower(table) + "\x00" + strings.ToLower(column)
}

// erdRefSuffixes are common application-level ways of naming a reference
// column. The suffix also tells us which column on the target table to prefer.
var erdRefSuffixes = []string{"_number", "_id", "_uuid", "_guid", "_code", "_no"}

func erdRefSuffix(name string) (suffix, base string) {
	lower := strings.ToLower(strings.TrimSpace(name))
	if lower == "id" {
		return "", ""
	}
	for _, s := range erdRefSuffixes {
		if strings.HasSuffix(lower, s) && len(lower) > len(s) {
			return s, lower[:len(lower)-len(s)]
		}
	}
	return "", ""
}

var erdIrregularSingular = map[string]string{
	"people":   "person",
	"men":      "man",
	"women":    "woman",
	"children": "child",
	"teeth":    "tooth",
	"feet":     "foot",
	"mice":     "mouse",
	"geese":    "goose",
	"data":     "data",
	"news":     "news",
	"series":   "series",
	"species":  "species",
}

func singularizeErdName(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	if singular, ok := erdIrregularSingular[name]; ok {
		return singular
	}
	switch {
	case strings.HasSuffix(name, "ies") && len(name) > 3:
		return name[:len(name)-3] + "y"
	case strings.HasSuffix(name, "sses") && len(name) > 4:
		return name[:len(name)-2]
	case strings.HasSuffix(name, "ches"), strings.HasSuffix(name, "shes"),
		strings.HasSuffix(name, "xes"), strings.HasSuffix(name, "zes"):
		return name[:len(name)-2]
	case strings.HasSuffix(name, "ses") && len(name) > 3:
		// Statuses -> status (drop "es"), but cases -> case (drop "s").
		if trimmed := name[:len(name)-2]; strings.HasSuffix(trimmed, "us") || strings.HasSuffix(trimmed, "ss") {
			return trimmed
		}
		return name[:len(name)-1]
	case strings.HasSuffix(name, "s") && !strings.HasSuffix(name, "ss") &&
		!strings.HasSuffix(name, "us") && !strings.HasSuffix(name, "is"):
		return name[:len(name)-1]
	}
	return name
}

func stripErdTablePrefix(name string) string {
	for _, prefix := range []string{"tbl_", "t_"} {
		if strings.HasPrefix(name, prefix) && len(name) > len(prefix) {
			return name[len(prefix):]
		}
	}
	return name
}

// erdTableMatchScore returns 0 when the table cannot match the reference base.
// Higher scores are more specific: an exact table name beats a plural or a
// prefixed alias.
func erdTableMatchScore(table, base string) int {
	name := strings.ToLower(strings.TrimSpace(table))
	base = strings.ToLower(strings.TrimSpace(base))
	if name == base {
		return 100
	}
	stripped := stripErdTablePrefix(name)
	if stripped != name {
		if stripped == base {
			return 80
		}
		if singularizeErdName(stripped) == base {
			return 70
		}
	}
	if singularizeErdName(name) == base {
		return 90
	}
	if singularizeErdName(base) == name && base != name {
		return 75
	}
	return 0
}

func findErdTarget(metas []*erdTableMeta, base string) (*erdTableMeta, int) {
	bestScore := 0
	var best *erdTableMeta
	for _, meta := range metas {
		score := erdTableMatchScore(meta.Name, base)
		if score > bestScore {
			bestScore = score
			best = meta
		}
	}
	return best, bestScore
}

func erdTargetCandidates(suffix string) []string {
	switch suffix {
	case "_id":
		return []string{"id"}
	case "_uuid":
		return []string{"uuid", "guid"}
	case "_guid":
		return []string{"guid", "uuid"}
	case "_code":
		return []string{"code"}
	case "_no":
		return []string{"no"}
	case "_number":
		return []string{"number"}
	}
	return nil
}

func chooseErdTargetColumn(t *erdTableMeta, suffix string) (name string, unique, exact, ok bool) {
	var nonUniqueID *erdColumnMeta
	for _, candidate := range erdTargetCandidates(suffix) {
		lower := strings.ToLower(candidate)
		col, exists := t.columnByName[lower]
		if !exists {
			continue
		}
		if t.UniqueSingle[lower] {
			return col.Name, true, true, true
		}
		if suffix == "_id" && lower == "id" {
			c := col
			nonUniqueID = &c
		}
		// If the named column exists but is not unique, do not fall through to a
		// different column (for example country_code -> countries.id).
		if candidate != "id" {
			return "", false, false, false
		}
	}
	// Prefer a non-standard single-column primary key over a non-unique `id`
	// column when both are present. This is a fallback, not a name match.
	if suffix == "_id" && len(t.PrimaryKey) == 1 {
		lower := strings.ToLower(t.PrimaryKey[0])
		if col, exists := t.columnByName[lower]; exists {
			return col.Name, true, false, true
		}
	}
	if nonUniqueID != nil {
		return nonUniqueID.Name, false, true, true
	}
	return "", false, false, false
}

func erdTypeFamily(typ string) string {
	typ = strings.ToLower(strings.TrimSpace(typ))
	if i := strings.IndexAny(typ, "( "); i >= 0 {
		typ = typ[:i]
	}
	switch typ {
	case "tinyint", "smallint", "mediumint", "int", "integer", "bigint", "bit", "bool", "boolean", "serial":
		return "int"
	case "decimal", "numeric", "dec", "fixed", "float", "double", "real":
		return "number"
	case "char", "varchar", "tinytext", "text", "mediumtext", "longtext", "enum", "set", "uuid":
		return "string"
	case "binary", "varbinary", "tinyblob", "blob", "mediumblob", "longblob":
		return "binary"
	case "date", "datetime", "timestamp", "time", "year":
		return "time"
	default:
		return typ
	}
}

func erdTypesCompatible(from, to string) bool {
	a, b := erdTypeFamily(from), erdTypeFamily(to)
	if a == b {
		return true
	}
	return (a == "int" && b == "number") || (a == "number" && b == "int")
}

// inferErdEdges finds application-level relationships using column naming,
// target keys and type compatibility. It never overrides a real foreign key.
func inferErdEdges(metas []*erdTableMeta, explicit map[string]bool) []erdEdge {
	out := []erdEdge{}
	for _, t := range metas {
		for _, col := range t.Columns {
			if explicit[erdColumnKey(t.Name, col.Name)] {
				continue
			}
			suffix, base := erdRefSuffix(col.Name)
			if suffix == "" {
				continue
			}

			target, score := findErdTarget(metas, base)
			if target == nil && suffix == "_id" && base == "parent" {
				// A common self-reference convention: categories.parent_id.
				target, score = t, 60
			}
			if target == nil {
				continue
			}

			targetCol, unique, exact, ok := chooseErdTargetColumn(target, suffix)
			if !ok || !erdTypesCompatible(col.Type, target.columnByName[strings.ToLower(targetCol)].Type) {
				continue
			}
			if strings.EqualFold(t.Name, target.Name) && strings.EqualFold(col.Name, targetCol) {
				continue
			}

			confidence := "medium"
			if exact && unique && score >= 90 {
				confidence = "high"
			}
			out = append(out, erdEdge{
				FromTable:  t.Name,
				FromColumn: col.Name,
				ToTable:    target.Name,
				ToColumn:   targetCol,
				Kind:       "inferred",
				Confidence: confidence,
			})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].FromTable != out[j].FromTable {
			return out[i].FromTable < out[j].FromTable
		}
		if out[i].FromColumn != out[j].FromColumn {
			return out[i].FromColumn < out[j].FromColumn
		}
		return out[i].ToTable < out[j].ToTable
	})
	return out
}
