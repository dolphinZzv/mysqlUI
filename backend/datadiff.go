package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

type dataDiffRequest struct {
	SourceDatabase string `json:"sourceDatabase"`
	SourceTable    string `json:"sourceTable"`
	TargetDatabase string `json:"targetDatabase"`
	TargetTable    string `json:"targetTable"`
}

type dataDiffResponse struct {
	Source       string   `json:"source"`
	Target       string   `json:"target"`
	KeyColumns   []string `json:"keyColumns"`
	SourceRows   int      `json:"sourceRows"`
	TargetRows   int      `json:"targetRows"`
	OnlyInSource int      `json:"onlyInSource"`
	OnlyInTarget int      `json:"onlyInTarget"`
	Changed      int      `json:"changed"`
	Truncated    bool     `json:"truncated"`
	SQL          string   `json:"sql"`
}

func dataSQLValue(v any) string {
	switch x := v.(type) {
	case nil:
		return "NULL"
	case []byte:
		return quoteSQLString(string(x))
	case string:
		return quoteSQLString(x)
	case int64:
		return fmt.Sprintf("%d", x)
	case float64:
		return fmt.Sprintf("%v", x)
	case bool:
		if x {
			return "1"
		}
		return "0"
	default:
		return quoteSQLString(fmt.Sprintf("%v", x))
	}
}

func dataKey(values []any) string {
	parts := make([]string, len(values))
	for i, v := range values {
		if v == nil {
			parts[i] = "\x00NULL"
		} else {
			parts[i] = fmt.Sprintf("%v", v)
		}
	}
	return strings.Join(parts, "\x00")
}

func dataRows(ctx context.Context, db *sql.DB, schema, table string, pk []string) ([]string, [][]any, bool, error) {
	order := ""
	if len(pk) > 0 {
		quoted := make([]string, len(pk))
		for i, c := range pk {
			quoted[i] = quoteIdent(c)
		}
		order = " ORDER BY " + strings.Join(quoted, ", ")
	}
	rows, err := db.QueryContext(ctx, "SELECT * FROM "+qualify(schema, table)+order+" LIMIT 5001")
	if err != nil {
		return nil, nil, false, err
	}
	defer rows.Close()
	columns, data, _, err := scanRows(rows, 0)
	if err != nil {
		return nil, nil, false, err
	}
	return columns, data, len(data) > 5000, nil
}

func columnIndex(columns []string) map[string]int {
	m := make(map[string]int, len(columns))
	for i, c := range columns {
		m[strings.ToLower(c)] = i
	}
	return m
}

func (s *Server) dataDiff(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	var in dataDiffRequest
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if !validIdent(in.SourceDatabase) || !validIdent(in.SourceTable) || !validIdent(in.TargetDatabase) || !validIdent(in.TargetTable) {
		writeErr(w, http.StatusBadRequest, errors.New("invalid source or target table name"))
		return
	}
	ctx := r.Context()
	pk := primaryKeyColumns(ctx, db, in.SourceDatabase, in.SourceTable)
	if len(pk) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("source table has no primary key; data diff requires one"))
		return
	}
	srcCols, srcRows, srcTruncated, err := dataRows(ctx, db, in.SourceDatabase, in.SourceTable, pk)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	dstCols, dstRows, dstTruncated, err := dataRows(ctx, db, in.TargetDatabase, in.TargetTable, pk)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	srcIdx := columnIndex(srcCols)
	dstIdx := columnIndex(dstCols)
	pkSrc := make([]int, len(pk))
	pkDst := make([]int, len(pk))
	for i, c := range pk {
		si, okS := srcIdx[strings.ToLower(c)]
		di, okD := dstIdx[strings.ToLower(c)]
		if !okS || !okD {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("primary key column %q is missing from one of the tables", c))
			return
		}
		pkSrc[i] = si
		pkDst[i] = di
	}
	// Common columns are the only ones we can compare/insert safely.
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

	resp := dataDiffResponse{
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
	keyLiteral := func(obj map[string]any) string {
		parts := make([]string, len(pk))
		for i, c := range pk {
			parts[i] = quoteIdent(c) + " = " + dataSQLValue(obj[c])
		}
		return strings.Join(parts, " AND ")
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
			for _, c := range common {
				if containsString(pk, c) {
					continue
				}
				sets = append(sets, quoteIdent(c)+" = "+dataSQLValue(src[c]))
			}
			appendSQL(fmt.Sprintf("UPDATE %s SET %s WHERE %s;",
				qualify(in.TargetDatabase, in.TargetTable), strings.Join(sets, ", "), keyLiteral(src)))
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
	writeJSON(w, http.StatusOK, resp)
}

func containsString(list []string, value string) bool {
	for _, item := range list {
		if strings.EqualFold(item, value) {
			return true
		}
	}
	return false
}
