package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDataDirAndPaths(t *testing.T) {
	t.Setenv("MYSQLUI_DATA_DIR", "")
	t.Setenv("MYSQLUI_PID_FILE", "")
	t.Setenv("MYSQLUI_LOG_FILE", "")

	if got := dataDir(); got != "data" {
		t.Errorf("dataDir() = %q, want data", got)
	}
	if got, want := pidFilePath(), filepath.Join("data", "mysqlui.pid"); got != want {
		t.Errorf("pidFilePath() = %q, want %q", got, want)
	}
	if got, want := logFilePath(), filepath.Join("data", "mysqlui.log"); got != want {
		t.Errorf("logFilePath() = %q, want %q", got, want)
	}

	t.Setenv("MYSQLUI_DATA_DIR", "/tmp/mysqlui")
	if got, want := pidFilePath(), filepath.Join("/tmp/mysqlui", "mysqlui.pid"); got != want {
		t.Errorf("pidFilePath() = %q, want %q", got, want)
	}

	t.Setenv("MYSQLUI_PID_FILE", "/run/mysqlui.pid")
	if got := pidFilePath(); got != "/run/mysqlui.pid" {
		t.Errorf("pidFilePath() override = %q", got)
	}
	t.Setenv("MYSQLUI_LOG_FILE", "/var/log/mysqlui.log")
	if got := logFilePath(); got != "/var/log/mysqlui.log" {
		t.Errorf("logFilePath() override = %q", got)
	}
}

func TestListenAddr(t *testing.T) {
	t.Setenv("MYSQLUI_ADDR", "")
	if got := listenAddr(); got != ":8787" {
		t.Errorf("listenAddr() = %q, want :8787", got)
	}
	t.Setenv("MYSQLUI_ADDR", "127.0.0.1:9000")
	if got := listenAddr(); got != "127.0.0.1:9000" {
		t.Errorf("listenAddr() = %q", got)
	}
}

func TestWriteReadPID(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("MYSQLUI_PID_FILE", filepath.Join(dir, "mysqlui.pid"))

	if err := writePID(4321); err != nil {
		t.Fatalf("writePID: %v", err)
	}
	pid, err := readPID()
	if err != nil {
		t.Fatalf("readPID: %v", err)
	}
	if pid != 4321 {
		t.Errorf("readPID() = %d, want 4321", pid)
	}
}

func TestReadPIDMissing(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("MYSQLUI_PID_FILE", filepath.Join(dir, "nope.pid"))
	if _, err := readPID(); err == nil {
		t.Error("expected error for missing pid file")
	}
}

func TestXMLEscape(t *testing.T) {
	got := xmlEscape(`a&b<c>d"e'f`)
	want := "a&amp;b&lt;c&gt;d&quot;e&apos;f"
	if got != want {
		t.Errorf("xmlEscape() = %q, want %q", got, want)
	}
}

func TestProcessAliveSelf(t *testing.T) {
	if !processAlive(os.Getpid()) {
		t.Error("current process should be alive")
	}
}
