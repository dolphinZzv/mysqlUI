package main

import "testing"

func TestNormalizeFKAction(t *testing.T) {
	for _, in := range []string{"", "cascade", "SET NULL", "restrict", "no action", "set default"} {
		if _, ok := normalizeFKAction(in); !ok {
			t.Errorf("normalizeFKAction(%q) rejected", in)
		}
	}
	for _, in := range []string{"DROP", "CASCADE; DROP TABLE x", "SET"} {
		if _, ok := normalizeFKAction(in); ok {
			t.Errorf("normalizeFKAction(%q) accepted", in)
		}
	}
}

func TestTrimStatement(t *testing.T) {
	cases := map[string]string{
		"SELECT 1;":     "SELECT 1",
		" SELECT 1 ;; ": "SELECT 1",
		"":              "",
	}
	for in, want := range cases {
		if got := trimStatement(in); got != want {
			t.Errorf("trimStatement(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestTimerMillis(t *testing.T) {
	cases := []struct {
		in   any
		want float64
		ok   bool
	}{
		{int64(1_000_000_000), 1, true},
		{uint64(2_000_000_000), 2, true},
		{"3000000000", 3, true},
		{[]byte("4000000000"), 4, true},
		{"not-a-number", 0, false},
		{nil, 0, false},
	}
	for _, c := range cases {
		got, ok := timerMillis(c.in)
		if ok != c.ok || got != c.want {
			t.Errorf("timerMillis(%v) = (%v, %v), want (%v, %v)", c.in, got, ok, c.want, c.ok)
		}
	}
}
