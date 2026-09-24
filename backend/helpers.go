package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type apiError struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func writeErr(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, apiError{Error: err.Error()})
}

func decodeJSON(r *http.Request, v any) error {
	if r.Body == nil {
		return fmt.Errorf("empty request body")
	}
	dec := json.NewDecoder(r.Body)
	return dec.Decode(v)
}

// ---- identifier helpers -------------------------------------------------

var identRe = regexp.MustCompile(`^[A-Za-z0-9_$]+$`)

func validIdent(s string) bool {
	return identRe.MatchString(s)
}

func quoteIdent(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
}

func qualify(db, table string) string {
	return quoteIdent(db) + "." + quoteIdent(table)
}

func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?, ", n), ", ")
}

// ---- row scanning -------------------------------------------------------

func normalizeValue(v any) any {
	switch t := v.(type) {
	case nil:
		return nil
	case []byte:
		return string(t)
	case time.Time:
		return t.Format("2006-01-02 15:04:05")
	case int64, float64, bool, string:
		return t
	default:
		return fmt.Sprintf("%v", t)
	}
}

// scanRows materialises up to maxRows rows into JSON friendly values.
func scanRows(rows *sql.Rows, maxRows int) (columns []string, data [][]any, truncated bool, err error) {
	columns, err = rows.Columns()
	if err != nil {
		return nil, nil, false, err
	}
	data = make([][]any, 0)
	for rows.Next() {
		if maxRows > 0 && len(data) >= maxRows {
			truncated = true
			break
		}
		vals := make([]any, len(columns))
		ptrs := make([]any, len(columns))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, nil, false, err
		}
		row := make([]any, len(columns))
		for i, v := range vals {
			row[i] = normalizeValue(v)
		}
		data = append(data, row)
	}
	return columns, data, truncated, rows.Err()
}

// ---- statement classification ------------------------------------------

func isQueryStatement(s string) bool {
	for {
		s = strings.TrimSpace(s)
		switch {
		case strings.HasPrefix(s, "--"), strings.HasPrefix(s, "#"):
			if i := strings.IndexByte(s, '\n'); i >= 0 {
				s = s[i+1:]
				continue
			}
			return false
		case strings.HasPrefix(s, "/*"):
			if i := strings.Index(s, "*/"); i >= 0 {
				s = s[i+2:]
				continue
			}
			return false
		}
		break
	}
	upper := strings.ToUpper(strings.TrimSpace(s))
	for _, p := range []string{"SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "WITH", "TABLE", "VALUES"} {
		if strings.HasPrefix(upper, p) {
			if len(upper) == len(p) {
				return true
			}
			c := upper[len(p)]
			if c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '(' {
				return true
			}
		}
	}
	return false
}

// ---- middleware ---------------------------------------------------------

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s -> %d (%s)", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Millisecond))
	})
}

// spaHandler serves static files and falls back to index.html for client routing.
func spaHandler(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(dir, filepath.Clean(r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}
