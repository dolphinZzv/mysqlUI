package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestSchemaVersionStoreCRUD(t *testing.T) {
	path := filepath.Join(t.TempDir(), "schema-versions.json")
	store, err := NewSchemaVersionStore(path)
	if err != nil {
		t.Fatalf("NewSchemaVersionStore: %v", err)
	}
	v1, err := store.Add(SchemaSnapshot{ConnectionID: "c1", Database: "db", Name: "v1", Tables: []snapshotTable{{Name: "users"}}})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if v1.ID == "" || v1.CreatedAt.IsZero() {
		t.Fatalf("snapshot missing id/createdAt: %#v", v1)
	}
	if _, err := store.Add(SchemaSnapshot{ConnectionID: "c1", Database: "other", Name: "v2"}); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if _, err := store.Add(SchemaSnapshot{ConnectionID: "c2", Database: "db", Name: "other"}); err != nil {
		t.Fatalf("Add: %v", err)
	}

	if got := len(store.List("c1", "")); got != 2 {
		t.Errorf("List(c1) = %d, want 2", got)
	}
	if got := len(store.List("c1", "db")); got != 1 {
		t.Errorf("List(c1, db) = %d, want 1", got)
	}
	if _, ok := store.Get("c1", v1.ID); !ok {
		t.Error("Get should find the snapshot")
	}
	if _, ok := store.Get("c2", v1.ID); ok {
		t.Error("Get must be scoped to the connection")
	}

	// Persist and reload.
	reloaded, err := NewSchemaVersionStore(path)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if len(reloaded.List("c1", "db")) != 1 {
		t.Error("snapshot was not persisted")
	}

	if err := store.Delete("c1", v1.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, ok := store.Get("c1", v1.ID); ok {
		t.Error("snapshot should have been deleted")
	}
	if err := store.Delete("c1", "missing"); err == nil {
		t.Error("deleting a missing snapshot should fail")
	}
}

func TestDiffDatabases(t *testing.T) {
	base := []snapshotTable{
		{
			Name:      "users",
			Type:      "BASE TABLE",
			CreateSQL: "CREATE TABLE `users` (`id` int NOT NULL, `name` varchar(50))",
			Columns: []schemaColumn{
				{Name: "id", ColumnType: "int", Nullable: false},
				{Name: "name", ColumnType: "varchar(50)", Nullable: true},
			},
			Indexes: []schemaIndex{{Name: "PRIMARY", Unique: true, Columns: []string{"id"}}},
		},
		{
			Name: "legacy",
			Type: "BASE TABLE",
		},
	}
	target := []snapshotTable{
		{
			Name:      "users",
			Type:      "BASE TABLE",
			CreateSQL: "CREATE TABLE `users` (`id` int NOT NULL, `name` varchar(100), `email` varchar(255))",
			Columns: []schemaColumn{
				{Name: "id", ColumnType: "int", Nullable: false},
				{Name: "name", ColumnType: "varchar(100)", Nullable: true},
				{Name: "email", ColumnType: "varchar(255)", Nullable: true},
			},
			Indexes: []schemaIndex{
				{Name: "PRIMARY", Unique: true, Columns: []string{"id"}},
				{Name: "idx_email", Unique: true, Columns: []string{"email"}},
			},
		},
		{
			Name:      "orders",
			Type:      "BASE TABLE",
			CreateSQL: "CREATE TABLE `orders` (`id` int NOT NULL)",
		},
	}

	diff := diffDatabases(base, target, "db")
	if len(diff.TablesAdded) != 1 || diff.TablesAdded[0].Name != "orders" {
		t.Errorf("tables added = %#v", diff.TablesAdded)
	}
	if len(diff.TablesRemoved) != 1 || diff.TablesRemoved[0].Name != "legacy" {
		t.Errorf("tables removed = %#v", diff.TablesRemoved)
	}
	if len(diff.TablesChanged) != 1 {
		t.Fatalf("tables changed = %#v", diff.TablesChanged)
	}
	users := diff.TablesChanged[0]
	if users.Table != "users" {
		t.Errorf("changed table = %q", users.Table)
	}
	if len(users.ColumnsAdded) != 1 || users.ColumnsAdded[0].Name != "email" {
		t.Errorf("columns added = %#v", users.ColumnsAdded)
	}
	if len(users.ColumnsChanged) != 1 || users.ColumnsChanged[0].Name != "name" {
		t.Errorf("columns changed = %#v", users.ColumnsChanged)
	}
	if len(users.IndexesAdded) != 1 || users.IndexesAdded[0].Name != "idx_email" {
		t.Errorf("indexes added = %#v", users.IndexesAdded)
	}

	joined := strings.Join(diff.DDL, "\n")
	for _, want := range []string{"CREATE TABLE `orders`", "DROP TABLE `db`.`legacy`", "ADD COLUMN `email`", "ADD UNIQUE INDEX `idx_email`"} {
		if !strings.Contains(joined, want) {
			t.Errorf("DDL missing %q:\n%s", want, joined)
		}
	}
}

func TestDiffDatabasesNoChanges(t *testing.T) {
	same := []snapshotTable{{
		Name:      "t",
		Columns:   []schemaColumn{{Name: "id", ColumnType: "int", Nullable: false}},
		Indexes:   []schemaIndex{{Name: "PRIMARY", Unique: true, Columns: []string{"id"}}},
		CreateSQL: "CREATE TABLE `t` (`id` int NOT NULL)",
	}}
	diff := diffDatabases(same, same, "db")
	if len(diff.TablesAdded) != 0 || len(diff.TablesRemoved) != 0 || len(diff.TablesChanged) != 0 || len(diff.DDL) != 0 {
		t.Errorf("expected no differences, got %#v", diff)
	}
}
