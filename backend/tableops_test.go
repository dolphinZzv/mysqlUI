package main

import "testing"

func TestValidIdent(t *testing.T) {
	valid := []string{"users", "col_1", "a$b", "ABC123"}
	invalid := []string{"", "a b", "a;b", "a-b", "a`b", "a'b", "a.b"}
	for _, s := range valid {
		if !validIdent(s) {
			t.Errorf("validIdent(%q) = false, want true", s)
		}
	}
	for _, s := range invalid {
		if validIdent(s) {
			t.Errorf("validIdent(%q) = true, want false", s)
		}
	}
}

func TestParseOrderSQL(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"", "", false},
		{"name", " ORDER BY `name` ASC", false},
		{"-created_at", " ORDER BY `created_at` DESC", false},
		{"+id", " ORDER BY `id` ASC", false},
		{"a,-b", " ORDER BY `a` ASC, `b` DESC", false},
		{"name; DROP TABLE x", "", true},
		{"na me", "", true},
		{"a`b", "", true},
	}
	for _, c := range cases {
		got, err := parseOrderSQL(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("parseOrderSQL(%q) expected error, got %q", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseOrderSQL(%q) unexpected error: %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("parseOrderSQL(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestBuildFilterSQL(t *testing.T) {
	conds := []filterCondition{
		{Column: "name", Op: "=", Value: "Alice"},
		{Column: "age", Op: ">", Value: 18},
	}
	where, vals, err := buildFilterSQL(conds)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := " WHERE `name` = ? AND `age` > ?"
	if where != want {
		t.Errorf("where = %q, want %q", where, want)
	}
	if len(vals) != 2 || vals[0] != "Alice" {
		t.Errorf("unexpected values: %#v", vals)
	}

	// IN operator expands placeholders.
	where, vals, err = buildFilterSQL([]filterCondition{
		{Column: "status", Op: "in", Value: []any{"a", "b", "c"}},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if want := " WHERE `status` IN (?, ?, ?)"; where != want {
		t.Errorf("where = %q, want %q", where, want)
	}
	if len(vals) != 3 {
		t.Errorf("expected 3 values, got %d", len(vals))
	}

	// NULL operators emit no placeholder.
	where, vals, err = buildFilterSQL([]filterCondition{{Column: "bio", Op: "is null"}})
	if err != nil || where != " WHERE `bio` IS NULL" || len(vals) != 0 {
		t.Errorf("is null: where=%q vals=%v err=%v", where, vals, err)
	}

	// Injection attempt is rejected.
	if _, _, err := buildFilterSQL([]filterCondition{{Column: "name; DROP", Op: "=", Value: 1}}); err == nil {
		t.Error("expected error for invalid column")
	}
	// Unknown operator is rejected.
	if _, _, err := buildFilterSQL([]filterCondition{{Column: "name", Op: "hax", Value: 1}}); err == nil {
		t.Error("expected error for unknown operator")
	}
}

func TestQuoteSQLString(t *testing.T) {
	cases := map[string]string{
		"hello": "'hello'",
		"a'b":   "'a\\'b'",
		"a\\b":  "'a\\\\b'",
		"a\nb":  "'a\\nb'",
		"":      "''",
	}
	for in, want := range cases {
		if got := quoteSQLString(in); got != want {
			t.Errorf("quoteSQLString(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSQLValueLiteral(t *testing.T) {
	cases := []struct {
		in   any
		want string
	}{
		{nil, "NULL"},
		{true, "1"},
		{false, "0"},
		{int64(42), "42"},
		{float64(1.5), "1.5"},
		{"x", "'x'"},
		{[]byte("y"), "'y'"},
	}
	for _, c := range cases {
		if got := sqlValueLiteral(c.in); got != c.want {
			t.Errorf("sqlValueLiteral(%#v) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestBuildColumnDef(t *testing.T) {
	cases := []struct {
		name    string
		in      columnDefInput
		want    string
		wantErr bool
	}{
		{
			name: "auto increment pk",
			in:   columnDefInput{Name: "id", Type: "int", Nullable: false, AutoIncrement: true},
			want: "`id` int NOT NULL AUTO_INCREMENT",
		},
		{
			name: "varchar with length and default",
			in:   columnDefInput{Name: "status", Type: "varchar", Length: "20", Nullable: false, HasDefault: true, Default: "new"},
			want: "`status` varchar(20) NOT NULL DEFAULT 'new'",
		},
		{
			name: "decimal default numeric",
			in:   columnDefInput{Name: "price", Type: "decimal", Length: "10,2", Nullable: true, HasDefault: true, Default: "0.00"},
			want: "`price` decimal(10,2) NULL DEFAULT 0.00",
		},
		{
			name: "timestamp default function",
			in:   columnDefInput{Name: "created_at", Type: "timestamp", Nullable: false, HasDefault: true, Default: "CURRENT_TIMESTAMP"},
			want: "`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP",
		},
		{
			name: "unsigned and comment",
			in:   columnDefInput{Name: "age", Type: "int", Nullable: true, Unsigned: true, Comment: "years"},
			want: "`age` int unsigned NULL COMMENT 'years'",
		},
		{
			name:    "invalid name",
			in:      columnDefInput{Name: "a;b", Type: "int"},
			wantErr: true,
		},
		{
			name:    "invalid type",
			in:      columnDefInput{Name: "x", Type: "int); DROP TABLE t"},
			wantErr: true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := buildColumnDef(c.in)
			if c.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %q", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != c.want {
				t.Errorf("buildColumnDef() = %q, want %q", got, c.want)
			}
		})
	}
}

func TestIsQueryStatement(t *testing.T) {
	queries := []string{
		"SELECT 1",
		"  select * from t",
		"-- comment\nSELECT 1",
		"/* c */ SHOW TABLES",
		"WITH x AS (SELECT 1) SELECT * FROM x",
		"DESC users",
		"EXPLAIN SELECT 1",
	}
	for _, q := range queries {
		if !isQueryStatement(q) {
			t.Errorf("isQueryStatement(%q) = false, want true", q)
		}
	}
	nonQueries := []string{
		"INSERT INTO t VALUES (1)",
		"UPDATE t SET a = 1",
		"DELETE FROM t",
		"CREATE TABLE t (id int)",
		"DROP TABLE t",
		"",
	}
	for _, q := range nonQueries {
		if isQueryStatement(q) {
			t.Errorf("isQueryStatement(%q) = true, want false", q)
		}
	}
}

func TestPlaceholders(t *testing.T) {
	if got := placeholders(0); got != "" {
		t.Errorf("placeholders(0) = %q", got)
	}
	if got := placeholders(1); got != "?" {
		t.Errorf("placeholders(1) = %q", got)
	}
	if got := placeholders(3); got != "?, ?, ?" {
		t.Errorf("placeholders(3) = %q", got)
	}
}
