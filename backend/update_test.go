package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestVersionNewer(t *testing.T) {
	cases := []struct {
		latest, current string
		want            bool
	}{
		{"v0.5.0", "v0.4.1", true},
		{"0.5.0", "v0.5.0", false},
		{"v0.5.1", "v0.5.0", true},
		{"v0.10.0", "v0.9.9", true},
		{"v1.0.0", "v0.99.99", true},
		{"v0.5.0-rc1", "v0.5.0", false},
		{"dev", "v0.5.0", false},
		{"v0.5.0", "dev", false},
		{"not-a-version", "v0.5.0", false},
	}
	for _, c := range cases {
		if got := versionNewer(c.latest, c.current); got != c.want {
			t.Errorf("versionNewer(%q, %q) = %v, want %v", c.latest, c.current, got, c.want)
		}
	}
}

func TestUpdateSettings(t *testing.T) {
	s := normalizeUpdateSettings(updateSettings{Enabled: true, IntervalMinutes: 0})
	if s.IntervalMinutes != defaultUpdateIntervalMinutes {
		t.Errorf("default interval = %d, want %d", s.IntervalMinutes, defaultUpdateIntervalMinutes)
	}
	s = normalizeUpdateSettings(updateSettings{Enabled: true, IntervalMinutes: -5})
	if s.IntervalMinutes != defaultUpdateIntervalMinutes {
		t.Errorf("negative interval = %d, want %d", s.IntervalMinutes, defaultUpdateIntervalMinutes)
	}
	s = normalizeUpdateSettings(updateSettings{Enabled: true, IntervalMinutes: 100000})
	if s.IntervalMinutes != 24*60 {
		t.Errorf("max interval = %d, want %d", s.IntervalMinutes, 24*60)
	}
}

func TestUpdateManagerConfigure(t *testing.T) {
	dir := t.TempDir()
	m := newUpdateManager(dir)
	if !m.saved.Enabled || m.saved.IntervalMinutes != defaultUpdateIntervalMinutes {
		t.Fatalf("unexpected defaults: %+v", m.saved)
	}
	if err := m.configure(false, 30); err != nil {
		t.Fatalf("configure: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "updates.json"))
	if err != nil {
		t.Fatalf("read settings: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("settings file is empty")
	}

	reloaded := newUpdateManager(dir)
	if reloaded.saved.Enabled || reloaded.saved.IntervalMinutes != 30 {
		t.Errorf("reloaded settings = %+v", reloaded.saved)
	}
}

func TestUpdateStatusDevBuild(t *testing.T) {
	old := version
	version = "dev"
	defer func() { version = old }()

	m := newUpdateManager(t.TempDir())
	m.latest = &releaseInfo{TagName: "v9.9.9", HTMLURL: "https://example.test"}
	st := m.status()
	if st.UpdateAvailable {
		t.Error("dev builds should not report an automatic update")
	}
	if !st.DevBuild || !st.Enabled || st.IntervalMinutes != defaultUpdateIntervalMinutes {
		t.Errorf("unexpected status: %+v", st)
	}
}
