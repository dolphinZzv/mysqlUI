package main

import (
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
