package main

import (
	"bytes"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/xuri/excelize/v2"
	"golang.org/x/text/encoding/simplifiedchinese"
)

func decodeImportText(data []byte) ([]byte, string) {
	if bytes.HasPrefix(data, []byte{0xEF, 0xBB, 0xBF}) {
		return data[3:], "utf-8-bom"
	}
	if utf8.Valid(data) {
		return data, "utf-8"
	}
	if decoded, err := simplifiedchinese.GB18030.NewDecoder().Bytes(data); err == nil {
		return decoded, "gb18030"
	}
	return data, "unknown"
}

func detectDelimiter(sample string) string {
	if idx := strings.IndexByte(sample, '\n'); idx >= 0 {
		sample = sample[:idx]
	}
	candidates := []string{",", "\t", ";", "|"}
	best := ","
	bestCount := 0
	for _, c := range candidates {
		n := strings.Count(sample, c)
		if n > bestCount {
			best, bestCount = c, n
		}
	}
	return best
}

func parseMapping(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var mapping []string
	if err := json.Unmarshal([]byte(raw), &mapping); err != nil {
		return nil, fmt.Errorf("invalid mapping: %w", err)
	}
	for _, c := range mapping {
		if !validIdent(c) {
			return nil, fmt.Errorf("invalid target column %q", c)
		}
	}
	return mapping, nil
}

func mapImportColumns(source []string, tableCols []string, mapping []string) ([]string, error) {
	if len(mapping) == 0 {
		if len(source) == 0 {
			return tableCols, nil
		}
		out := make([]string, len(source))
		for i, c := range source {
			name := strings.TrimSpace(strings.TrimPrefix(c, "\ufeff"))
			if !validIdent(name) {
				return nil, fmt.Errorf("invalid column name %q in header", c)
			}
			out[i] = name
		}
		return out, nil
	}
	if len(mapping) != len(source) {
		return nil, fmt.Errorf("mapping has %d column(s) but the file has %d", len(mapping), len(source))
	}
	if len(tableCols) == 0 {
		return mapping, nil
	}
	known := map[string]bool{}
	for _, c := range tableCols {
		known[strings.ToLower(c)] = true
	}
	for _, c := range mapping {
		if c != "" && !known[strings.ToLower(c)] {
			return nil, fmt.Errorf("mapped column %q does not exist in the table", c)
		}
	}
	return mapping, nil
}

func (s *Server) importPreview(w http.ResponseWriter, r *http.Request) {
	_, db, dbName, table, ok := s.params(w, r)
	if !ok || table == "" {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxStructuredImportBytes)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid upload: %w", err))
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, errors.New("missing file field"))
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxStructuredImportBytes))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err)
		return
	}
	ext := strings.ToLower(filepath.Ext(header.Filename))
	hasHeader := parseBool(r.FormValue("hasHeader"), true)
	tableCols, _ := tableColumns(r.Context(), db, dbName, table)

	var source []string
	var previewRows [][]string
	delimiter := ""
	encoding := "utf-8"
	if ext == ".xlsx" || ext == ".xls" {
		f, err := excelize.OpenReader(bytes.NewReader(data))
		if err != nil {
			writeErr(w, http.StatusBadRequest, fmt.Errorf("invalid Excel file: %w", err))
			return
		}
		defer f.Close()
		sheets := f.GetSheetList()
		if len(sheets) == 0 {
			writeErr(w, http.StatusBadRequest, errors.New("Excel workbook has no sheets"))
			return
		}
		rows, err := f.GetRows(sheets[0])
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if len(rows) > 0 {
			dataRows := rows
			if hasHeader {
				source = rows[0]
				dataRows = rows[1:]
			} else {
				source = tableCols
			}
			for _, row := range dataRows {
				if len(previewRows) >= 20 {
					break
				}
				previewRows = append(previewRows, row)
			}
		}
		encoding = "excel"
	} else {
		decoded, enc := decodeImportText(data)
		encoding = enc
		delimiter = r.FormValue("delimiter")
		if delimiter == "" || delimiter == "auto" {
			delimiter = detectDelimiter(string(decoded))
		}
		reader := csv.NewReader(bytes.NewReader(decoded))
		reader.Comma = []rune(delimiter)[0]
		reader.FieldsPerRecord = -1
		reader.LazyQuotes = true
		for {
			rec, err := reader.Read()
			if err == io.EOF {
				break
			}
			if err != nil {
				writeErr(w, http.StatusBadRequest, fmt.Errorf("cannot parse file: %w", err))
				return
			}
			if len(source) == 0 {
				if hasHeader {
					source = rec
					continue
				}
				source = tableCols
			}
			if len(previewRows) >= 20 {
				break
			}
			previewRows = append(previewRows, rec)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sourceColumns":     source,
		"targetColumns":     tableCols,
		"rows":              previewRows,
		"detectedDelimiter": delimiter,
		"encoding":          encoding,
	})
}
