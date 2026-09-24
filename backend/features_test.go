package main

import (
	"strings"
	"testing"
	"time"
)

func TestAuthTokenRoundTrip(t *testing.T) {
	a := &authManager{
		enabled:  true,
		password: "secret",
		secret:   []byte("0123456789012345678901234567890123456789"),
		ttl:      time.Hour,
	}
	token := a.issueToken()
	if !a.validToken(token) {
		t.Fatal("issued token should be valid")
	}
	if a.validToken(token + "x") {
		t.Error("tampered token should be invalid")
	}
	if a.validToken("garbage") {
		t.Error("garbage token should be invalid")
	}
	if a.validToken("") {
		t.Error("empty token should be invalid")
	}

	// A token issued with a different secret must not validate.
	other := &authManager{secret: []byte("another-secret-another-secret-123456"), ttl: time.Hour}
	if a.validToken(other.issueToken()) {
		t.Error("token from another secret should be invalid")
	}

	// Expired tokens are rejected.
	expired := &authManager{secret: a.secret, ttl: -time.Minute}
	if a.validToken(expired.issueToken()) {
		t.Error("expired token should be invalid")
	}
}

func TestNormalizePrivileges(t *testing.T) {
	got, err := normalizePrivileges([]string{"select", "  Insert "})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 || got[0] != "SELECT" || got[1] != "INSERT" {
		t.Errorf("unexpected privileges: %#v", got)
	}
	if _, err := normalizePrivileges([]string{"SELECT", "DROP DATABASE"}); err == nil {
		t.Error("expected error for unsupported privilege")
	}
	if _, err := normalizePrivileges(nil); err == nil {
		t.Error("expected error for empty privileges")
	}
}

func TestUserAndObjectSpec(t *testing.T) {
	spec, err := userSpec("root", "localhost")
	if err != nil || spec != "'root'@'localhost'" {
		t.Errorf("userSpec = %q, err=%v", spec, err)
	}
	// Quoting must neutralise injection attempts.
	spec, err = userSpec("ro'ot", "%")
	if err != nil || spec != "'ro\\'ot'@'%'" {
		t.Errorf("userSpec escaped = %q, err=%v", spec, err)
	}
	if _, err := userSpec("", "localhost"); err == nil {
		t.Error("expected error for empty user")
	}

	obj, err := objectSpec("mydb", "users")
	if err != nil || obj != "`mydb`.`users`" {
		t.Errorf("objectSpec = %q, err=%v", obj, err)
	}
	obj, _ = objectSpec("mydb", "")
	if obj != "`mydb`.*" {
		t.Errorf("objectSpec db only = %q", obj)
	}
	obj, _ = objectSpec("*", "")
	if obj != "*.*" {
		t.Errorf("objectSpec all = %q", obj)
	}
	if _, err := objectSpec("my db", "t"); err == nil {
		t.Error("expected error for invalid db name")
	}
}

func TestColumnDDL(t *testing.T) {
	def := "x"
	c := schemaColumn{Name: "id", ColumnType: "int", Nullable: false, Extra: "auto_increment", Default: nil}
	want := "`id` int NOT NULL AUTO_INCREMENT"
	if got := columnDDL(c); got != want {
		t.Errorf("columnDDL = %q, want %q", got, want)
	}

	c = schemaColumn{Name: "status", ColumnType: "varchar(20)", Nullable: true, Default: &def}
	want = "`status` varchar(20) NULL DEFAULT 'x'"
	if got := columnDDL(c); got != want {
		t.Errorf("columnDDL = %q, want %q", got, want)
	}
}

func TestIndexDDL(t *testing.T) {
	idx := schemaIndex{Name: "PRIMARY", Unique: true, Columns: []string{"id"}}
	if got := indexDDL("db", "t", idx, true); got != "ALTER TABLE `db`.`t` ADD PRIMARY KEY (`id`)" {
		t.Errorf("primary add = %q", got)
	}
	if got := indexDDL("db", "t", idx, false); got != "ALTER TABLE `db`.`t` DROP PRIMARY KEY" {
		t.Errorf("primary drop = %q", got)
	}
	idx = schemaIndex{Name: "idx_name", Unique: false, Columns: []string{"a", "b"}}
	if got := indexDDL("db", "t", idx, true); got != "ALTER TABLE `db`.`t` ADD INDEX `idx_name` (`a`, `b`)" {
		t.Errorf("index add = %q", got)
	}
}

func TestSameColumn(t *testing.T) {
	d1 := "CURRENT_TIMESTAMP"
	a := schemaColumn{Name: "c", ColumnType: "timestamp", Nullable: false, Extra: "DEFAULT_GENERATED", Default: &d1}
	b := schemaColumn{Name: "c", ColumnType: "timestamp", Nullable: false, Extra: "", Default: &d1}
	if !sameColumn(a, b) {
		t.Error("DEFAULT_GENERATED should be ignored when comparing")
	}
	c := schemaColumn{Name: "c", ColumnType: "datetime", Nullable: false, Default: &d1}
	if sameColumn(a, c) {
		t.Error("different types should not be equal")
	}
}

func TestScanSQL(t *testing.T) {
	collect := func(in string) []string {
		var out []string
		err := scanSQL(strings.NewReader(in), func(stmt string) error {
			out = append(out, stmt)
			return nil
		})
		if err != nil {
			t.Fatalf("scanSQL(%q) error: %v", in, err)
		}
		return out
	}

	if got := collect("SELECT 1; SELECT 2;"); len(got) != 2 || got[0] != "SELECT 1" || got[1] != "SELECT 2" {
		t.Errorf("basic split = %#v", got)
	}

	if got := collect("INSERT INTO t VALUES ('a;b');"); len(got) != 1 || got[0] != "INSERT INTO t VALUES ('a;b')" {
		t.Errorf("string with semicolon = %#v", got)
	}

	if got := collect("SELECT /* ; */ 1;"); len(got) != 1 || !strings.Contains(got[0], "SELECT") {
		t.Errorf("block comment = %#v", got)
	}

	if got := collect("SELECT `we;ird` FROM t;"); len(got) != 1 || got[0] != "SELECT `we;ird` FROM t" {
		t.Errorf("backtick identifier = %#v", got)
	}

	// trailing statement without delimiter
	if got := collect("SELECT 1"); len(got) != 1 || got[0] != "SELECT 1" {
		t.Errorf("trailing = %#v", got)
	}

	// DELIMITER directive for routines
	multi := "DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; END//\nDELIMITER ;\nSELECT 3;"
	got := collect(multi)
	if len(got) != 2 {
		t.Fatalf("delimiter split = %#v", got)
	}
	if !strings.Contains(got[0], "CREATE PROCEDURE p() BEGIN SELECT 1; END") {
		t.Errorf("routine statement = %q", got[0])
	}
	if got[1] != "SELECT 3" {
		t.Errorf("after delimiter = %q", got[1])
	}
}

func TestParseBoolAndPlaceholders(t *testing.T) {
	if !parseBool("true", false) || parseBool("false", true) || !parseBool("", true) {
		t.Error("parseBool behaved unexpectedly")
	}
	if placeholdersN(3) != "?,?,?" {
		t.Errorf("placeholdersN(3) = %q", placeholdersN(3))
	}
}
