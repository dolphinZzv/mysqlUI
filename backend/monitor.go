package main

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
)

// =========================================================================
// Server monitor
// =========================================================================

type processInfo struct {
	ID      int64  `json:"id"`
	User    string `json:"user"`
	Host    string `json:"host"`
	DB      string `json:"db"`
	Command string `json:"command"`
	Time    int64  `json:"time"`
	State   string `json:"state"`
	Info    string `json:"info"`
}

func (s *Server) monitorProcessList(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	rows, err := db.QueryContext(r.Context(), `
		SELECT ID, COALESCE(USER,''), COALESCE(HOST,''), COALESCE(DB,''),
		       COALESCE(COMMAND,''), COALESCE(TIME,0), COALESCE(STATE,''), COALESCE(INFO,'')
		FROM information_schema.PROCESSLIST
		ORDER BY ID`)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer rows.Close()

	out := make([]processInfo, 0)
	for rows.Next() {
		var p processInfo
		if err := rows.Scan(&p.ID, &p.User, &p.Host, &p.DB, &p.Command, &p.Time, &p.State, &p.Info); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) monitorKill(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	pid, err := strconv.ParseInt(r.PathValue("pid"), 10, 64)
	if err != nil || pid <= 0 {
		writeErr(w, http.StatusBadRequest, errInvalidPid)
		return
	}
	kind := "KILL"
	if strings.EqualFold(r.URL.Query().Get("query"), "true") {
		kind = "KILL QUERY"
	}
	if _, err := db.ExecContext(r.Context(), kind+" "+strconv.FormatInt(pid, 10)); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "pid": pid, "mode": kind})
}

func (s *Server) monitorStatus(w http.ResponseWriter, r *http.Request) {
	s.showKeyValues(w, r, "SHOW GLOBAL STATUS")
}

func (s *Server) monitorVariables(w http.ResponseWriter, r *http.Request) {
	s.showKeyValues(w, r, "SHOW GLOBAL VARIABLES")
}

type nameValue struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

func (s *Server) showKeyValues(w http.ResponseWriter, r *http.Request, query string) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	rows, err := db.QueryContext(r.Context(), query)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	defer rows.Close()

	out := make([]nameValue, 0, 256)
	for rows.Next() {
		var nv nameValue
		if err := rows.Scan(&nv.Name, &nv.Value); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		out = append(out, nv)
	}
	writeJSON(w, http.StatusOK, out)
}

type monitorOverview struct {
	Version              string  `json:"version"`
	Uptime               int64   `json:"uptime"`
	ThreadsConnected     int64   `json:"threadsConnected"`
	ThreadsRunning       int64   `json:"threadsRunning"`
	Questions            int64   `json:"questions"`
	SlowQueries          int64   `json:"slowQueries"`
	QPS                  float64 `json:"qps"`
	BytesReceived        int64   `json:"bytesReceived"`
	BytesSent            int64   `json:"bytesSent"`
	Connections          int64   `json:"connections"`
	AbortedConnects      int64   `json:"abortedConnects"`
	InnodbBufferPoolSize int64   `json:"innodbBufferPoolSize"`
	InnodbRowLockWaits   int64   `json:"innodbRowLockWaits"`
}

func (s *Server) monitorOverview(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}

	rows, err := db.QueryContext(r.Context(), "SHOW GLOBAL STATUS")
	if err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	stats := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			stats[strings.ToLower(k)] = v
		}
	}
	rows.Close()

	get := func(key string) int64 {
		if v, ok := stats[key]; ok {
			if n, err := strconv.ParseInt(v, 10, 64); err == nil {
				return n
			}
		}
		return 0
	}

	out := monitorOverview{
		Uptime:               get("uptime"),
		ThreadsConnected:     get("threads_connected"),
		ThreadsRunning:       get("threads_running"),
		Questions:            get("questions"),
		SlowQueries:          get("slow_queries"),
		BytesReceived:        get("bytes_received"),
		BytesSent:            get("bytes_sent"),
		Connections:          get("connections"),
		AbortedConnects:      get("aborted_connects"),
		InnodbBufferPoolSize: get("innodb_buffer_pool_size"),
		InnodbRowLockWaits:   get("innodb_row_lock_waits"),
	}
	if out.Uptime > 0 {
		out.QPS = float64(out.Questions) / float64(out.Uptime)
	}
	_ = db.QueryRowContext(r.Context(), "SELECT VERSION()").Scan(&out.Version)
	writeJSON(w, http.StatusOK, out)
}

var errInvalidPid = errors.New("invalid process id")
