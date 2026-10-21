package main

import (
	"strings"
	"testing"
)

func TestDetectDelimiter(t *testing.T) {
	cases := map[string]string{
		"a,b,c\n1,2,3":     ",",
		"a\tb\tc\n1\t2\t3": "\t",
		"a;b;c":            ";",
		"a|b|c":            "|",
		"single":           ",",
	}
	for input, want := range cases {
		if got := detectDelimiter(input); got != want {
			t.Errorf("detectDelimiter(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestDecodeImportText(t *testing.T) {
	utf8Data := []byte("name,city\n张三,北京\n")
	decoded, encoding := decodeImportText(utf8Data)
	if encoding != "utf-8" || string(decoded) != string(utf8Data) {
		t.Fatalf("utf8 decode = %q, %q", decoded, encoding)
	}
	bom := append([]byte{0xEF, 0xBB, 0xBF}, utf8Data...)
	decoded, encoding = decodeImportText(bom)
	if encoding != "utf-8-bom" || string(decoded) != string(utf8Data) {
		t.Fatalf("bom decode = %q, %q", decoded, encoding)
	}
}

func TestParseMapping(t *testing.T) {
	mapping, err := parseMapping(`["id","name"]`)
	if err != nil || len(mapping) != 2 || mapping[1] != "name" {
		t.Fatalf("parseMapping = %#v, %v", mapping, err)
	}
	if _, err := parseMapping(`["bad name"]`); err == nil {
		t.Error("expected invalid identifier error")
	}
}

func TestMapImportColumns(t *testing.T) {
	table := []string{"id", "name", "email"}
	cols, err := mapImportColumns([]string{"id", "name"}, table, nil)
	if err != nil || len(cols) != 2 || cols[1] != "name" {
		t.Fatalf("header mapping = %#v, %v", cols, err)
	}
	cols, err = mapImportColumns([]string{"a", "b"}, table, []string{"email", "name"})
	if err != nil || cols[0] != "email" || cols[1] != "name" {
		t.Fatalf("explicit mapping = %#v, %v", cols, err)
	}
	if _, err := mapImportColumns([]string{"a"}, table, []string{"missing"}); err == nil {
		t.Error("expected unknown target column error")
	}
	if _, err := mapImportColumns([]string{"a", "b"}, table, []string{"id"}); err == nil {
		t.Error("expected length mismatch error")
	}
}

func TestRenameCreateTable(t *testing.T) {
	in := "CREATE TABLE `shop` (\n  `id` int NOT NULL\n)"
	out := renameCreateTable(in, "shop", "shop_copy")
	if out != "CREATE TABLE `shop_copy` (\n  `id` int NOT NULL\n)" {
		t.Fatalf("renameCreateTable = %q", out)
	}
}

func TestKeysetCondition(t *testing.T) {
	cond, args := keysetCondition([]string{"id"}, []any{10})
	if cond != "((`id` > ?))" || len(args) != 1 || args[0] != 10 {
		t.Fatalf("single key condition = %q, %#v", cond, args)
	}
	cond, args = keysetCondition([]string{"a", "b"}, []any{1, "x"})
	if len(args) != 3 || args[0] != 1 || args[1] != 1 || args[2] != "x" {
		t.Fatalf("composite args = %#v, cond=%q", args, cond)
	}
	if !strings.Contains(cond, "`a` = ? AND `b` > ?") {
		t.Fatalf("composite condition = %q", cond)
	}
}

func TestKeysetTokenRoundTrip(t *testing.T) {
	token := encodeKeysetToken([]any{int64(42), "name"})
	values, err := decodeKeysetToken(token)
	if err != nil {
		t.Fatal(err)
	}
	if len(values) != 2 {
		t.Fatalf("values = %#v", values)
	}
	if _, err := decodeKeysetToken("!!!"); err == nil {
		t.Error("expected invalid token error")
	}
}

func TestTransactionSafeStatement(t *testing.T) {
	for _, stmt := range []string{"SELECT 1", "UPDATE t SET a=1 WHERE id=2", "DELETE FROM t WHERE id=1", "INSERT INTO t VALUES (1)", "WITH x AS (SELECT 1) SELECT * FROM x"} {
		if !transactionSafeStatement(stmt) {
			t.Errorf("expected safe: %s", stmt)
		}
	}
	for _, stmt := range []string{"CREATE TABLE t (id int)", "ALTER TABLE t ADD c int", "DROP TABLE t", "TRUNCATE TABLE t", "BEGIN", "COMMIT", "SET autocommit=1"} {
		if transactionSafeStatement(stmt) {
			t.Errorf("expected unsafe: %s", stmt)
		}
	}
}

func TestTopoSortTables(t *testing.T) {
	deps := map[string][]string{"orders": {"users"}, "items": {"orders"}}
	got := topoSortTables([]string{"items", "orders", "users"}, deps)
	index := map[string]int{}
	for i, name := range got {
		index[name] = i
	}
	if !(index["users"] < index["orders"] && index["orders"] < index["items"]) {
		t.Fatalf("topo order = %#v", got)
	}
}
