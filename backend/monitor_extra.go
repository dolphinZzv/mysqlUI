package main

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"strings"
)

func queryMaps(ctx context.Context, db *sql.DB, query string) ([]map[string]any, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, data, _, err := scanRows(rows, 0)
	if err != nil {
		return nil, err
	}
	out := make([]map[string]any, 0, len(data))
	for _, row := range data {
		item := make(map[string]any, len(columns))
		for i, col := range columns {
			item[col] = row[i]
		}
		out = append(out, item)
	}
	return out, nil
}

type replicationResponse struct {
	Role     string           `json:"role"`
	Master   []map[string]any `json:"master"`
	Replica  []map[string]any `json:"replica"`
	Replicas []map[string]any `json:"replicas"`
	Error    string           `json:"error,omitempty"`
}

// replicationStatus reports primary/replica state on MySQL 5.7, 8.x and
// MariaDB. Newer servers renamed SHOW SLAVE/MASTER STATUS, so both spellings
// are attempted.
func (s *Server) replicationStatus(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	resp := replicationResponse{Role: "standalone", Master: []map[string]any{}, Replica: []map[string]any{}, Replicas: []map[string]any{}}

	replica, err := queryMaps(ctx, db, "SHOW REPLICA STATUS")
	if err != nil || len(replica) == 0 {
		if alt, altErr := queryMaps(ctx, db, "SHOW SLAVE STATUS"); altErr == nil {
			replica = alt
		} else if err == nil {
			err = altErr
		}
	}
	if len(replica) > 0 {
		resp.Replica = replica
		resp.Role = "replica"
	}

	master, masterErr := queryMaps(ctx, db, "SHOW MASTER STATUS")
	if masterErr != nil || len(master) == 0 {
		if alt, err := queryMaps(ctx, db, "SHOW BINARY LOG STATUS"); err == nil {
			master = alt
		}
	}
	if len(master) > 0 {
		resp.Master = master
		if resp.Role == "standalone" {
			resp.Role = "primary"
		}
	}

	if replicas, err := queryMaps(ctx, db, "SHOW REPLICAS"); err == nil {
		resp.Replicas = replicas
	} else if replicas, err := queryMaps(ctx, db, "SHOW SLAVE HOSTS"); err == nil {
		resp.Replicas = replicas
	}

	if resp.Role == "standalone" && err != nil {
		resp.Error = err.Error()
	}
	writeJSON(w, http.StatusOK, resp)
}

type slowQueryResponse struct {
	Enabled       bool             `json:"enabled"`
	LongQueryTime float64          `json:"longQueryTime"`
	LogFile       string           `json:"logFile"`
	Rows          []map[string]any `json:"rows"`
	Error         string           `json:"error,omitempty"`
}

func (s *Server) slowQueries(w http.ResponseWriter, r *http.Request) {
	_, db, ok := s.connDB(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	resp := slowQueryResponse{Rows: []map[string]any{}}

	var enabled int
	_ = db.QueryRowContext(ctx, "SELECT @@slow_query_log").Scan(&enabled)
	resp.Enabled = enabled != 0
	_ = db.QueryRowContext(ctx, "SELECT @@long_query_time").Scan(&resp.LongQueryTime)
	_ = db.QueryRowContext(ctx, "SELECT @@slow_query_log_file").Scan(&resp.LogFile)

	rows, err := queryMaps(ctx, db, `
		SELECT DIGEST_TEXT, COUNT_STAR, SUM_TIMER_WAIT, AVG_TIMER_WAIT, MAX_TIMER_WAIT,
		       SUM_ROWS_EXAMINED, SUM_ROWS_SENT, SUM_ROWS_AFFECTED,
		       FIRST_SEEN, LAST_SEEN
		FROM performance_schema.events_statements_summary_by_digest
		WHERE DIGEST_TEXT IS NOT NULL
		ORDER BY SUM_TIMER_WAIT DESC
		LIMIT 50`)
	if err != nil {
		resp.Error = err.Error()
		// The slow query log may still be useful in the UI even when
		// performance_schema is not available.
		writeJSON(w, http.StatusOK, resp)
		return
	}
	for _, row := range rows {
		for _, key := range []string{"SUM_TIMER_WAIT", "AVG_TIMER_WAIT", "MAX_TIMER_WAIT"} {
			if ms, ok := timerMillis(row[key]); ok {
				row[key+"_MS"] = ms
			}
		}
		if s, ok := row["DIGEST_TEXT"].(string); ok {
			row["DIGEST_TEXT"] = strings.TrimSpace(s)
		}
	}
	resp.Rows = rows
	writeJSON(w, http.StatusOK, resp)
}

func timerMillis(v any) (float64, bool) {
	var n float64
	switch t := v.(type) {
	case int64:
		n = float64(t)
	case uint64:
		n = float64(t)
	case float64:
		n = t
	case string:
		parsed, err := strconv.ParseFloat(t, 64)
		if err != nil {
			return 0, false
		}
		n = parsed
	case []byte:
		parsed, err := strconv.ParseFloat(string(t), 64)
		if err != nil {
			return 0, false
		}
		n = parsed
	default:
		return 0, false
	}
	// performance_schema timers are picoseconds.
	return n / 1e9, true
}
