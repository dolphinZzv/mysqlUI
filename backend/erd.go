package main

import "net/http"

type erdTable struct {
	Name string `json:"name"`
}

type erdEdge struct {
	Constraint string `json:"constraint"`
	FromTable  string `json:"fromTable"`
	FromColumn string `json:"fromColumn"`
	ToTable    string `json:"toTable"`
	ToColumn   string `json:"toColumn"`
}

type erdResponse struct {
	Tables []erdTable `json:"tables"`
	Edges  []erdEdge  `json:"edges"`
}

// erd returns the tables of a database and their foreign-key relationships.
func (s *Server) erd(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, _, ok := s.params(w, r)
	if !ok {
		return
	}
	ctx := r.Context()

	resp := erdResponse{Tables: []erdTable{}, Edges: []erdEdge{}}

	tables, err := db.QueryContext(ctx, `
		SELECT TABLE_NAME FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
		ORDER BY TABLE_NAME`, dbName)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	for tables.Next() {
		var name string
		if err := tables.Scan(&name); err == nil {
			resp.Tables = append(resp.Tables, erdTable{Name: name})
		}
	}
	tables.Close()

	edges, err := db.QueryContext(ctx, `
		SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
		FROM information_schema.KEY_COLUMN_USAGE
		WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
		ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`, dbName)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer edges.Close()
	for edges.Next() {
		var e erdEdge
		if err := edges.Scan(&e.Constraint, &e.FromTable, &e.FromColumn, &e.ToTable, &e.ToColumn); err == nil {
			resp.Edges = append(resp.Edges, e)
		}
	}
	writeJSON(w, http.StatusOK, resp)
}
