package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

func encodeKeysetToken(values []any) string {
	data, _ := json.Marshal(values)
	return base64.RawURLEncoding.EncodeToString(data)
}

func decodeKeysetToken(token string) ([]any, error) {
	if strings.TrimSpace(token) == "" {
		return nil, nil
	}
	data, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil, errors.New("invalid pagination token")
	}
	var values []any
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&values); err != nil {
		return nil, errors.New("invalid pagination token")
	}
	for i, value := range values {
		if number, ok := value.(json.Number); ok {
			if integer, err := number.Int64(); err == nil {
				values[i] = integer
				continue
			}
			if float, err := number.Float64(); err == nil {
				values[i] = float
			}
		}
	}
	return values, nil
}

// keysetCondition builds a lexicographic "greater than" predicate for a
// composite primary key: (a > ?) OR (a = ? AND b > ?) ...
func keysetCondition(pk []string, values []any) (string, []any) {
	if len(pk) == 0 || len(values) != len(pk) {
		return "", nil
	}
	terms := make([]string, 0, len(pk))
	args := make([]any, 0, len(pk)*2)
	for i := range pk {
		parts := make([]string, 0, i+1)
		for j := 0; j < i; j++ {
			parts = append(parts, quoteIdent(pk[j])+" = ?")
			args = append(args, values[j])
		}
		parts = append(parts, quoteIdent(pk[i])+" > ?")
		args = append(args, values[i])
		terms = append(terms, "("+strings.Join(parts, " AND ")+")")
	}
	return "(" + strings.Join(terms, " OR ") + ")", args
}

func primaryKeyValues(columns []string, row []any, pk []string) ([]any, error) {
	values := make([]any, len(pk))
	for i, name := range pk {
		idx := -1
		for j, column := range columns {
			if strings.EqualFold(column, name) {
				idx = j
				break
			}
		}
		if idx < 0 {
			return nil, fmt.Errorf("primary key column %q is not in the result", name)
		}
		values[i] = row[idx]
	}
	return values, nil
}
