package main

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// =========================================================================
// Users & privileges
// =========================================================================

type userInfo struct {
	User          string `json:"user"`
	Host          string `json:"host"`
	Plugin        string `json:"plugin"`
	AccountLocked string `json:"accountLocked"`
}

var allowedPrivileges = map[string]bool{
	"ALL PRIVILEGES": true, "ALL": true, "USAGE": true,
	"SELECT": true, "INSERT": true, "UPDATE": true, "DELETE": true,
	"CREATE": true, "DROP": true, "ALTER": true, "INDEX": true, "REFERENCES": true,
	"CREATE VIEW": true, "SHOW VIEW": true, "TRIGGER": true, "EXECUTE": true,
	"EVENT": true, "LOCK TABLES": true, "CREATE ROUTINE": true, "ALTER ROUTINE": true,
	"CREATE TEMPORARY TABLES": true, "FILE": true, "PROCESS": true, "RELOAD": true,
	"SHUTDOWN": true, "SUPER": true, "REPLICATION CLIENT": true, "REPLICATION SLAVE": true,
	"CREATE USER": true, "GRANT OPTION": true, "SHOW DATABASES": true,
	"CREATE TABLESPACE": true, "CREATE ROLE": true, "DROP ROLE": true,
}

func normalizePrivileges(list []string) ([]string, error) {
	if len(list) == 0 {
		return nil, errors.New("at least one privilege is required")
	}
	out := make([]string, 0, len(list))
	for _, p := range list {
		up := strings.ToUpper(strings.Join(strings.Fields(p), " "))
		if !allowedPrivileges[up] {
			return nil, fmt.Errorf("unsupported privilege %q", p)
		}
		out = append(out, up)
	}
	return out, nil
}

func userSpec(user, host string) (string, error) {
	if strings.TrimSpace(user) == "" {
		return "", errors.New("user is required")
	}
	if strings.TrimSpace(host) == "" {
		host = "%"
	}
	return quoteSQLString(user) + "@" + quoteSQLString(host), nil
}

func objectSpec(database, table string) (string, error) {
	db := strings.TrimSpace(database)
	tbl := strings.TrimSpace(table)
	switch {
	case db == "" || db == "*":
		return "*.*", nil
	case tbl == "" || tbl == "*":
		if !validIdent(db) {
			return "", fmt.Errorf("invalid database name %q", db)
		}
		return quoteIdent(db) + ".*", nil
	default:
		if !validIdent(db) || !validIdent(tbl) {
			return "", fmt.Errorf("invalid object %q.%q", db, tbl)
		}
		return qualify(db, tbl), nil
	}
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	rows, err := db.QueryContext(r.Context(), `
		SELECT User, Host, COALESCE(plugin,''), COALESCE(account_locked,'N')
		FROM mysql.user ORDER BY User, Host`)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer rows.Close()
	out := make([]userInfo, 0)
	for rows.Next() {
		var u userInfo
		if err := rows.Scan(&u.User, &u.Host, &u.Plugin, &u.AccountLocked); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		out = append(out, u)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) userGrants(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	spec, err := userSpec(r.PathValue("user"), r.PathValue("host"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	rows, err := db.QueryContext(r.Context(), "SHOW GRANTS FOR "+spec)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer rows.Close()
	out := make([]string, 0)
	for rows.Next() {
		var g string
		if err := rows.Scan(&g); err == nil {
			out = append(out, g)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	var in struct {
		User     string `json:"user"`
		Host     string `json:"host"`
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	spec, err := userSpec(in.User, in.Host)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	q := "CREATE USER " + spec
	if in.Password != "" {
		q += " IDENTIFIED BY " + quoteSQLString(in.Password)
	}
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true})
}

func (s *Server) alterUser(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	var in struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	spec, err := userSpec(r.PathValue("user"), r.PathValue("host"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if in.Password == "" {
		writeErr(w, http.StatusBadRequest, errors.New("password is required"))
		return
	}
	if _, err := db.ExecContext(r.Context(), "ALTER USER "+spec+" IDENTIFIED BY "+quoteSQLString(in.Password)); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) dropUser(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	spec, err := userSpec(r.PathValue("user"), r.PathValue("host"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if _, err := db.ExecContext(r.Context(), "DROP USER "+spec); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) grantPrivileges(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	var in struct {
		Privileges      []string `json:"privileges"`
		Database        string   `json:"database"`
		Table           string   `json:"table"`
		WithGrantOption bool     `json:"withGrantOption"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	privs, err := normalizePrivileges(in.Privileges)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	spec, err := userSpec(r.PathValue("user"), r.PathValue("host"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	obj, err := objectSpec(in.Database, in.Table)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	q := "GRANT " + strings.Join(privs, ", ") + " ON " + obj + " TO " + spec
	if in.WithGrantOption {
		q += " WITH GRANT OPTION"
	}
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) revokePrivileges(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	var in struct {
		Privileges []string `json:"privileges"`
		Database   string   `json:"database"`
		Table      string   `json:"table"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	privs, err := normalizePrivileges(in.Privileges)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	spec, err := userSpec(r.PathValue("user"), r.PathValue("host"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	obj, err := objectSpec(in.Database, in.Table)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	q := "REVOKE " + strings.Join(privs, ", ") + " ON " + obj + " FROM " + spec
	if _, err := db.ExecContext(r.Context(), q); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
