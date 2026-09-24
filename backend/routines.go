package main

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// =========================================================================
// Stored routines, triggers, events
// =========================================================================

type routineInfo struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Returns  string `json:"returns"`
	Definer  string `json:"definer"`
	Security string `json:"security"`
	Comment  string `json:"comment"`
	Created  string `json:"created"`
	Modified string `json:"modified"`
}

func (s *Server) listRoutines(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, _, ok := s.params(w, r)
	if !ok {
		return
	}
	rows, err := db.QueryContext(r.Context(), `
		SELECT ROUTINE_NAME, ROUTINE_TYPE, COALESCE(DATA_TYPE,''), COALESCE(DEFINER,''),
		       COALESCE(SECURITY_TYPE,''), COALESCE(ROUTINE_COMMENT,''),
		       COALESCE(DATE_FORMAT(CREATED,'%Y-%m-%d %H:%i:%s'),''),
		       COALESCE(DATE_FORMAT(LAST_ALTERED,'%Y-%m-%d %H:%i:%s'),'')
		FROM information_schema.ROUTINES
		WHERE ROUTINE_SCHEMA = ?
		ORDER BY ROUTINE_TYPE, ROUTINE_NAME`, dbName)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer rows.Close()
	out := make([]routineInfo, 0)
	for rows.Next() {
		var it routineInfo
		if err := rows.Scan(&it.Name, &it.Type, &it.Returns, &it.Definer, &it.Security, &it.Comment, &it.Created, &it.Modified); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		out = append(out, it)
	}
	writeJSON(w, http.StatusOK, out)
}

type triggerInfo struct {
	Name    string `json:"name"`
	Event   string `json:"event"`
	Table   string `json:"table"`
	Timing  string `json:"timing"`
	Definer string `json:"definer"`
	Created string `json:"created"`
}

func (s *Server) listTriggers(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, _, ok := s.params(w, r)
	if !ok {
		return
	}
	rows, err := db.QueryContext(r.Context(), `
		SELECT TRIGGER_NAME, COALESCE(EVENT_MANIPULATION,''), COALESCE(EVENT_OBJECT_TABLE,''),
		       COALESCE(ACTION_TIMING,''), COALESCE(DEFINER,''),
		       COALESCE(DATE_FORMAT(CREATED,'%Y-%m-%d %H:%i:%s'),'')
		FROM information_schema.TRIGGERS
		WHERE TRIGGER_SCHEMA = ?
		ORDER BY TRIGGER_NAME`, dbName)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer rows.Close()
	out := make([]triggerInfo, 0)
	for rows.Next() {
		var it triggerInfo
		if err := rows.Scan(&it.Name, &it.Event, &it.Table, &it.Timing, &it.Definer, &it.Created); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		out = append(out, it)
	}
	writeJSON(w, http.StatusOK, out)
}

type eventInfo struct {
	Name     string `json:"name"`
	Status   string `json:"status"`
	Interval string `json:"interval"`
	Starts   string `json:"starts"`
	Ends     string `json:"ends"`
	Definer  string `json:"definer"`
	Comment  string `json:"comment"`
}

func (s *Server) listEvents(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, _, ok := s.params(w, r)
	if !ok {
		return
	}
	rows, err := db.QueryContext(r.Context(), `
		SELECT EVENT_NAME, COALESCE(STATUS,''), COALESCE(INTERVAL_VALUE,''), COALESCE(INTERVAL_FIELD,''),
		       COALESCE(DATE_FORMAT(STARTS,'%Y-%m-%d %H:%i:%s'),''),
		       COALESCE(DATE_FORMAT(ENDS,'%Y-%m-%d %H:%i:%s'),''),
		       COALESCE(DEFINER,''), COALESCE(EVENT_COMMENT,'')
		FROM information_schema.EVENTS
		WHERE EVENT_SCHEMA = ?
		ORDER BY EVENT_NAME`, dbName)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer rows.Close()
	out := make([]eventInfo, 0)
	for rows.Next() {
		var (
			it       eventInfo
			val, fld string
		)
		if err := rows.Scan(&it.Name, &it.Status, &val, &fld, &it.Starts, &it.Ends, &it.Definer, &it.Comment); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		if val != "" {
			it.Interval = "EVERY " + val + " " + fld
		}
		out = append(out, it)
	}
	writeJSON(w, http.StatusOK, out)
}

// routineDefinition returns SHOW CREATE output for a procedure/function.
func (s *Server) routineDefinition(w http.ResponseWriter, r *http.Request) {
	s.definition(w, r, strings.ToUpper(r.PathValue("kind")), r.PathValue("name"))
}

func (s *Server) triggerDefinition(w http.ResponseWriter, r *http.Request) {
	s.definition(w, r, "TRIGGER", r.PathValue("name"))
}

func (s *Server) eventDefinition(w http.ResponseWriter, r *http.Request) {
	s.definition(w, r, "EVENT", r.PathValue("name"))
}

func (s *Server) definition(w http.ResponseWriter, r *http.Request, kind, name string) {
	_, db, dbName, _, ok := s.params(w, r)
	if !ok {
		return
	}
	if !validIdent(name) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid name %q", name))
		return
	}
	var q string
	switch kind {
	case "PROCEDURE", "FUNCTION":
		q = "SHOW CREATE " + kind + " " + qualify(dbName, name)
	case "TRIGGER", "EVENT":
		q = "SHOW CREATE " + kind + " " + quoteIdent(name)
	default:
		writeErr(w, http.StatusBadRequest, fmt.Errorf("unsupported kind %q", kind))
		return
	}
	rows, err := db.QueryContext(r.Context(), q)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer rows.Close()
	cols, data, _, err := scanRows(rows, 0)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err)
		return
	}
	if len(data) == 0 {
		writeErr(w, http.StatusNotFound, errors.New("definition not found"))
		return
	}
	ddl := ""
	if len(cols) >= 2 && len(data[0]) >= 2 {
		ddl = str(data[0][1])
	}
	writeJSON(w, http.StatusOK, map[string]any{"columns": cols, "ddl": ddl, "row": data[0]})
}

func (s *Server) dropRoutine(w http.ResponseWriter, r *http.Request) {
	s.dropDefinition(w, r, strings.ToUpper(r.PathValue("kind")), r.PathValue("name"))
}

func (s *Server) dropTrigger(w http.ResponseWriter, r *http.Request) {
	s.dropDefinition(w, r, "TRIGGER", r.PathValue("name"))
}

func (s *Server) dropEvent(w http.ResponseWriter, r *http.Request) {
	s.dropDefinition(w, r, "EVENT", r.PathValue("name"))
}

func (s *Server) dropDefinition(w http.ResponseWriter, r *http.Request, kind, name string) {
	_, db, dbName, _, ok := s.params(w, r)
	if !ok {
		return
	}
	if !validIdent(name) {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid name %q", name))
		return
	}
	var q string
	switch kind {
	case "PROCEDURE", "FUNCTION":
		q = "DROP " + kind + " " + qualify(dbName, name)
	case "TRIGGER", "EVENT":
		q = "DROP " + kind + " " + quoteIdent(name)
	default:
		writeErr(w, http.StatusBadRequest, fmt.Errorf("unsupported kind %q", kind))
		return
	}
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// executeDDL runs a user supplied DDL/DML statement (used to create routines,
// triggers, events, views, ...).
func (s *Server) executeDDL(w http.ResponseWriter, r *http.Request) {
	_, db, _, _, ok := s.params(w, r)
	if !ok {
		return
	}
	var in struct {
		SQL string `json:"sql"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	stmt := strings.TrimSpace(in.SQL)
	if stmt == "" {
		writeErr(w, http.StatusBadRequest, errors.New("sql is required"))
		return
	}
	if isQueryStatement(stmt) {
		rows, err := db.QueryContext(r.Context(), stmt)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err)
			return
		}
		defer rows.Close()
		cols, data, _, err := scanRows(rows, 1000)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"columns": cols, "rows": data})
		return
	}
	res, err := db.ExecContext(r.Context(), stmt)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	affected, _ := res.RowsAffected()
	writeJSON(w, http.StatusOK, map[string]any{"affected": affected})
}
