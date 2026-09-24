package main

import "net/http"

type schemaTableColumns struct {
	Name    string   `json:"name"`
	Columns []string `json:"columns"`
}

type databaseSchemaResponse struct {
	Tables []schemaTableColumns `json:"tables"`
}

// databaseSchema returns every table and its columns in one round trip, used to
// power SQL autocomplete in the frontend.
func (s *Server) databaseSchema(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, _, ok := s.params(w, r)
	if !ok {
		return
	}
	rows, err := db.QueryContext(r.Context(), `
		SELECT TABLE_NAME, COLUMN_NAME
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = ?
		ORDER BY TABLE_NAME, ORDINAL_POSITION`, dbName)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer rows.Close()

	order := make([]string, 0)
	index := map[string]*schemaTableColumns{}
	for rows.Next() {
		var table, column string
		if err := rows.Scan(&table, &column); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		t, ok := index[table]
		if !ok {
			t = &schemaTableColumns{Name: table, Columns: []string{}}
			index[table] = t
			order = append(order, table)
		}
		t.Columns = append(t.Columns, column)
	}
	out := make([]schemaTableColumns, 0, len(order))
	for _, name := range order {
		out = append(out, *index[name])
	}
	writeJSON(w, http.StatusOK, databaseSchemaResponse{Tables: out})
}
