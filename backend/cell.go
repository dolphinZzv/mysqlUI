package main

import (
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
)

const maxCellBytes = 8 << 20 // 8 MiB

type cellValueResponse struct {
	IsNull    bool   `json:"isNull"`
	Size      int64  `json:"size"`
	MIME      string `json:"mime"`
	Base64    string `json:"base64"`
	Truncated bool   `json:"truncated"`
}

// cellValue returns the raw bytes of a single cell (base64 encoded) so the UI
// can preview binary/blob/json content that the grid truncates.
func (s *Server) cellValue(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok {
		return
	}
	if table == "" {
		writeErr(w, http.StatusBadRequest, errors.New("table is required"))
		return
	}
	var in struct {
		Column     string         `json:"column"`
		PrimaryKey map[string]any `json:"primaryKey"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	if !validIdent(in.Column) {
		writeErr(w, http.StatusBadRequest, errors.New("invalid column"))
		return
	}
	if len(in.PrimaryKey) == 0 {
		writeErr(w, http.StatusBadRequest, errors.New("primaryKey is required"))
		return
	}
	where, vals, err := buildWhere(in.PrimaryKey)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	col := quoteIdent(in.Column)
	q := "SELECT LENGTH(" + col + "), SUBSTRING(" + col + ", 1, " + itoa(maxCellBytes) + ") FROM " +
		qualify(dbName, table) + " WHERE " + where + " LIMIT 1"

	var length sql.NullInt64
	var data []byte
	if err := db.QueryRowContext(r.Context(), q, vals...).Scan(&length, &data); err != nil {
		writeErr(w, http.StatusBadGateway, err)
		return
	}
	if !length.Valid {
		writeJSON(w, http.StatusOK, cellValueResponse{IsNull: true})
		return
	}
	if data == nil {
		data = []byte{}
	}
	writeJSON(w, http.StatusOK, cellValueResponse{
		Size:      length.Int64,
		MIME:      http.DetectContentType(data),
		Base64:    base64.StdEncoding.EncodeToString(data),
		Truncated: int64(len(data)) < length.Int64,
	})
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
