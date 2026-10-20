package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseGrantObject(t *testing.T) {
	cases := []struct{ in, db, table string }{
		{"*.*", "*", "*"},
		{"`mydb`.*", "mydb", "*"},
		{"`mydb`.`users`", "mydb", "users"},
		{"mydb.users", "mydb", "users"},
	}
	for _, tc := range cases {
		db, table := parseGrantObject(tc.in)
		if db != tc.db || table != tc.table {
			t.Errorf("parseGrantObject(%q) = %q,%q; want %q,%q", tc.in, db, table, tc.db, tc.table)
		}
	}
}

func TestParsePrivilegeListAndFlags(t *testing.T) {
	privs := parsePrivilegeList("SELECT, INSERT (id, name), UPDATE, GRANT OPTION")
	want := []string{"SELECT", "INSERT", "UPDATE", "GRANT OPTION"}
	if len(privs) != len(want) {
		t.Fatalf("privileges = %#v", privs)
	}
	for i := range want {
		if privs[i] != want[i] {
			t.Fatalf("privileges[%d] = %q, want %q", i, privs[i], want[i])
		}
	}
	flags := flagsFromPrivileges(privs)
	if !flags["SELECT"] || !flags["GRANT OPTION"] || flags["DELETE"] {
		t.Fatalf("unexpected flags: %#v", flags)
	}
	all := flagsFromPrivileges([]string{"ALL PRIVILEGES"})
	for _, flag := range matrixFlags {
		if !all[flag] {
			t.Errorf("ALL PRIVILEGES should include %q", flag)
		}
	}
}

func TestGrantRegexParsing(t *testing.T) {
	line := "GRANT SELECT, INSERT ON `shop`.* TO 'reader'@'%'"
	m := grantRe.FindStringSubmatch(line)
	if m == nil {
		t.Fatal("grant line did not match")
	}
	db, table := parseGrantObject(m[2])
	if db != "shop" || table != "*" {
		t.Fatalf("object = %q.%q", db, table)
	}
	flags := flagsFromPrivileges(parsePrivilegeList(m[1]))
	if !flags["SELECT"] || !flags["INSERT"] {
		t.Fatalf("flags = %#v", flags)
	}
}

func TestBackupFileIDSafeResolve(t *testing.T) {
	dir := t.TempDir()
	m := &backupManager{settings: backupSettings{Directory: dir}}
	rel := filepath.Join("conn", "db-20240101-010101.sql")
	id := backupFileID(rel)
	got, err := m.resolve(id)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if got != filepath.Join(dir, rel) {
		t.Fatalf("resolved path = %q", got)
	}
	if _, err := m.resolve("not-base64!!"); err == nil {
		t.Error("expected error for invalid id")
	}
	escape := backupFileID("../outside.sql")
	if _, err := m.resolve(escape); err == nil {
		t.Error("expected traversal to be rejected")
	}
}

func TestBackupListParsesDatabase(t *testing.T) {
	dir := t.TempDir()
	connDir := filepath.Join(dir, "prod")
	if err := os.MkdirAll(connDir, 0o755); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(connDir, "shop-20240102-030405.sql")
	if err := os.WriteFile(path, []byte("SELECT 1;\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	m := &backupManager{settings: backupSettings{Directory: dir}}
	files, err := m.listFiles()
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 {
		t.Fatalf("files = %#v", files)
	}
	if files[0].Database != "shop" || files[0].Connection != "prod" || files[0].Size == 0 {
		t.Fatalf("unexpected metadata: %#v", files[0])
	}
}

func TestRewriteDumpDatabase(t *testing.T) {
	stmt := "CREATE DATABASE IF NOT EXISTS `shop`; USE `shop`; INSERT INTO `shop`.`users` (`id`) VALUES ('`shop`.x');"
	got := rewriteDumpDatabase(stmt, "shop", "restore_db")
	if !strings.Contains(got, "CREATE DATABASE IF NOT EXISTS `restore_db`") {
		t.Errorf("create database not rewritten: %s", got)
	}
	if !strings.Contains(got, "USE `restore_db`") {
		t.Errorf("use not rewritten: %s", got)
	}
	if !strings.Contains(got, "INSERT INTO `restore_db`.`users`") {
		t.Errorf("qualified table not rewritten: %s", got)
	}
	if !strings.Contains(got, "VALUES ('`shop`.x')") {
		t.Errorf("string literal should be preserved: %s", got)
	}
}
