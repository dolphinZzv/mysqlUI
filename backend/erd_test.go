package main

import (
	"strings"
	"testing"
)

func testErdTable(name string, pk []string, columns ...erdColumnMeta) *erdTableMeta {
	t := newErdTableMeta(name)
	for _, c := range columns {
		t.addColumn(c)
	}
	t.PrimaryKey = append([]string{}, pk...)
	for _, c := range pk {
		t.UniqueSingle[strings.ToLower(c)] = true
	}
	return &t
}

func TestSingularizeErdName(t *testing.T) {
	cases := map[string]string{
		"users":       "user",
		"orders":      "order",
		"categories":  "category",
		"addresses":   "address",
		"statuses":    "status",
		"cases":       "case",
		"people":      "person",
		"order_items": "order_item",
		"news":        "news",
	}
	for in, want := range cases {
		if got := singularizeErdName(in); got != want {
			t.Errorf("singularizeErdName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestInferErdEdgesFromColumnNames(t *testing.T) {
	users := testErdTable("users", []string{"id"},
		erdColumnMeta{Name: "id", Type: "bigint"},
		erdColumnMeta{Name: "email", Type: "varchar(255)"},
	)
	orders := testErdTable("orders", []string{"id"},
		erdColumnMeta{Name: "id", Type: "bigint"},
		erdColumnMeta{Name: "user_id", Type: "bigint"},
		erdColumnMeta{Name: "total", Type: "decimal(10,2)"},
	)
	orderItems := testErdTable("order_items", []string{"id"},
		erdColumnMeta{Name: "id", Type: "bigint"},
		erdColumnMeta{Name: "order_id", Type: "bigint"},
	)

	edges := inferErdEdges([]*erdTableMeta{users, orders, orderItems}, nil)
	if len(edges) != 2 {
		t.Fatalf("got %d inferred edges, want 2: %#v", len(edges), edges)
	}
	want := map[string]string{
		"orders.user_id":       "users.id",
		"order_items.order_id": "orders.id",
	}
	for _, e := range edges {
		key := e.FromTable + "." + e.FromColumn
		if want[key] != e.ToTable+"."+e.ToColumn {
			t.Errorf("%s -> %s.%s, want %s", key, e.ToTable, e.ToColumn, want[key])
		}
		if e.Kind != "inferred" || e.Confidence != "high" {
			t.Errorf("%s kind/confidence = %q/%q, want inferred/high", key, e.Kind, e.Confidence)
		}
	}
}

func TestInferSkipsRealForeignKeyAndIncompatibleType(t *testing.T) {
	users := testErdTable("users", []string{"id"},
		erdColumnMeta{Name: "id", Type: "bigint"},
	)
	orders := testErdTable("orders", []string{"id"},
		erdColumnMeta{Name: "id", Type: "bigint"},
		erdColumnMeta{Name: "user_id", Type: "bigint"},
		erdColumnMeta{Name: "approver_id", Type: "varchar(36)"},
	)

	explicit := map[string]bool{erdColumnKey("orders", "user_id"): true}
	edges := inferErdEdges([]*erdTableMeta{users, orders}, explicit)
	if len(edges) != 0 {
		t.Fatalf("expected no inferred edges, got %#v", edges)
	}
}

func TestInferTargetsUniqueCodeAndIrregularPlural(t *testing.T) {
	countries := testErdTable("countries", []string{"id"},
		erdColumnMeta{Name: "id", Type: "int"},
		erdColumnMeta{Name: "code", Type: "char(2)"},
	)
	countries.UniqueSingle["code"] = true
	people := testErdTable("people", []string{"id"},
		erdColumnMeta{Name: "id", Type: "bigint"},
	)
	orders := testErdTable("orders", []string{"id"},
		erdColumnMeta{Name: "id", Type: "bigint"},
		erdColumnMeta{Name: "country_code", Type: "varchar(2)"},
		erdColumnMeta{Name: "person_id", Type: "bigint"},
	)

	edges := inferErdEdges([]*erdTableMeta{countries, people, orders}, nil)
	if len(edges) != 2 {
		t.Fatalf("got %d inferred edges, want 2: %#v", len(edges), edges)
	}
	got := map[string]string{}
	for _, e := range edges {
		got[e.FromColumn] = e.ToTable + "." + e.ToColumn
	}
	if got["country_code"] != "countries.code" {
		t.Errorf("country_code -> %q, want countries.code", got["country_code"])
	}
	if got["person_id"] != "people.id" {
		t.Errorf("person_id -> %q, want people.id", got["person_id"])
	}
}

func TestInferSelfReferenceAndPrefixedTable(t *testing.T) {
	categories := testErdTable("categories", []string{"id"},
		erdColumnMeta{Name: "id", Type: "int"},
		erdColumnMeta{Name: "parent_id", Type: "int"},
	)
	users := testErdTable("t_user", []string{"id"},
		erdColumnMeta{Name: "id", Type: "int"},
	)
	posts := testErdTable("posts", []string{"id"},
		erdColumnMeta{Name: "id", Type: "int"},
		erdColumnMeta{Name: "user_id", Type: "int"},
	)

	edges := inferErdEdges([]*erdTableMeta{categories, users, posts}, nil)
	if len(edges) != 2 {
		t.Fatalf("got %d inferred edges, want 2: %#v", len(edges), edges)
	}
	got := map[string]string{}
	for _, e := range edges {
		got[e.FromTable+"."+e.FromColumn] = e.ToTable + "." + e.ToColumn
	}
	if got["categories.parent_id"] != "categories.id" {
		t.Errorf("parent_id -> %q, want categories.id", got["categories.parent_id"])
	}
	if got["posts.user_id"] != "t_user.id" {
		t.Errorf("user_id -> %q, want t_user.id", got["posts.user_id"])
	}
}

func TestInferDoesNotFallBackToWrongColumn(t *testing.T) {
	// country_code must not point at countries.id just because code is not
	// unique; a non-unique code is not a reliable relationship target.
	countries := testErdTable("countries", []string{"id"},
		erdColumnMeta{Name: "id", Type: "varchar(36)"},
		erdColumnMeta{Name: "code", Type: "varchar(36)"},
	)
	orders := testErdTable("orders", []string{"id"},
		erdColumnMeta{Name: "id", Type: "varchar(36)"},
		erdColumnMeta{Name: "country_code", Type: "varchar(36)"},
	)

	if edges := inferErdEdges([]*erdTableMeta{countries, orders}, nil); len(edges) != 0 {
		t.Fatalf("expected no edge for non-unique code, got %#v", edges)
	}
}

func TestGroupErdForeignKeys(t *testing.T) {
	rows := []erdEdge{
		{Constraint: "fk_child_parent", FromTable: "child", FromColumn: "a", ToTable: "parent", ToColumn: "a"},
		{Constraint: "fk_child_parent", FromTable: "child", FromColumn: "b", ToTable: "parent", ToColumn: "b"},
		{Constraint: "fk_child_other", FromTable: "child", FromColumn: "c", ToTable: "other", ToColumn: "id"},
	}
	edges := groupErdForeignKeys(rows)
	if len(edges) != 2 {
		t.Fatalf("got %d edges, want 2: %#v", len(edges), edges)
	}
	if edges[0].FromColumn != "a, b" || edges[0].ToColumn != "a, b" {
		t.Errorf("composite columns = %q -> %q, want a, b", edges[0].FromColumn, edges[0].ToColumn)
	}
	if edges[0].Kind != "foreign_key" || edges[1].Kind != "foreign_key" {
		t.Errorf("grouped edge kind = %q/%q, want foreign_key", edges[0].Kind, edges[1].Kind)
	}
}

func TestInferFallsBackToSinglePrimaryKey(t *testing.T) {
	accounts := testErdTable("accounts", []string{"account_key"},
		erdColumnMeta{Name: "account_key", Type: "bigint"},
	)
	orders := testErdTable("orders", []string{"id"},
		erdColumnMeta{Name: "id", Type: "bigint"},
		erdColumnMeta{Name: "account_id", Type: "bigint"},
	)

	edges := inferErdEdges([]*erdTableMeta{accounts, orders}, nil)
	if len(edges) != 1 {
		t.Fatalf("got %d inferred edges, want 1: %#v", len(edges), edges)
	}
	if edges[0].ToColumn != "account_key" {
		t.Errorf("target column = %q, want account_key", edges[0].ToColumn)
	}
	if edges[0].Confidence != "medium" {
		t.Errorf("fallback confidence = %q, want medium", edges[0].Confidence)
	}
}
