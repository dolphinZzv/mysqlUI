package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// ---- paths --------------------------------------------------------------

func dataDir() string {
	if d := strings.TrimSpace(os.Getenv("MYSQLUI_DATA_DIR")); d != "" {
		return d
	}
	return "data"
}

func pidFilePath() string {
	if p := strings.TrimSpace(os.Getenv("MYSQLUI_PID_FILE")); p != "" {
		return p
	}
	return filepath.Join(dataDir(), "mysqlui.pid")
}

func logFilePath() string {
	if p := strings.TrimSpace(os.Getenv("MYSQLUI_LOG_FILE")); p != "" {
		return p
	}
	return filepath.Join(dataDir(), "mysqlui.log")
}

func listenAddr() string {
	if a := strings.TrimSpace(os.Getenv("MYSQLUI_ADDR")); a != "" {
		return a
	}
	return ":8787"
}

func executablePath() string {
	exe, err := os.Executable()
	if err != nil {
		return "mysqlui"
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	if abs, err := filepath.Abs(exe); err == nil {
		return abs
	}
	return exe
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "error: %v\n", err)
	os.Exit(1)
}

// ---- pid helpers --------------------------------------------------------

func readPID() (int, error) {
	data, err := os.ReadFile(pidFilePath())
	if err != nil {
		return 0, err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 0 {
		return 0, errors.New("invalid pid file")
	}
	return pid, nil
}

func writePID(pid int) error {
	path := pidFilePath()
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return os.WriteFile(path, []byte(strconv.Itoa(pid)+"\n"), 0o644)
}

// ---- CLI ----------------------------------------------------------------

func usage() {
	fmt.Print(`MySQL UI ` + version + ` - MySQL/MariaDB management tool

Usage:
  mysqlui [serve]            Run in the foreground (default)
  mysqlui start              Start as a background daemon
  mysqlui stop               Stop the daemon
  mysqlui restart            Restart the daemon
  mysqlui status             Show daemon status
  mysqlui install-service    Install as a system service (systemd / launchd)
  mysqlui help               Show this help
  mysqlui --version          Print the version

Environment:
  MYSQLUI_ADDR        Listen address          (default ":8787")
  MYSQLUI_DATA_DIR    Data directory          (default "data")
  MYSQLUI_PID_FILE    PID file                (default <data>/mysqlui.pid)
  MYSQLUI_LOG_FILE    Daemon log file         (default <data>/mysqlui.log)
`)
}

// handleDaemonCommand returns true when the process should exit without
// starting the HTTP server.
func handleDaemonCommand(args []string) bool {
	if len(args) == 0 {
		return false
	}
	switch args[0] {
	case "serve", "run", "server":
		return false
	case "start":
		startDaemon()
		return true
	case "stop":
		stopDaemon()
		return true
	case "restart":
		stopDaemon()
		startDaemon()
		return true
	case "status":
		statusDaemon()
		return true
	case "install-service", "service":
		installService(args[1:])
		return true
	case "help", "--help", "-h":
		usage()
		return true
	case "--version", "-version", "-v", "version":
		fmt.Printf("mysqlui %s\n", version)
		return true
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", args[0])
		usage()
		os.Exit(2)
		return true
	}
}

func startDaemon() {
	if pid, err := readPID(); err == nil && processAlive(pid) {
		fmt.Printf("mysqlui is already running (pid %d)\n", pid)
		return
	}

	logPath := logFilePath()
	if dir := filepath.Dir(logPath); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			fatal(err)
		}
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		fatal(err)
	}
	defer logFile.Close()

	cmd := exec.Command(executablePath(), "serve")
	cmd.Env = append(os.Environ(), "MYSQLUI_DAEMON=1")
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Stdin = nil
	detach(cmd)

	if err := cmd.Start(); err != nil {
		fatal(err)
	}
	pid := cmd.Process.Pid
	if err := writePID(pid); err != nil {
		fatal(err)
	}
	_ = cmd.Process.Release()

	fmt.Printf("mysqlui started (pid %d)\n", pid)
	fmt.Printf("  address: %s\n", listenAddr())
	fmt.Printf("  log:     %s\n", logPath)
	fmt.Printf("  pid:     %s\n", pidFilePath())
}

func stopDaemon() {
	pid, err := readPID()
	if err != nil {
		fmt.Println("mysqlui is not running (no pid file)")
		return
	}
	if !processAlive(pid) {
		_ = os.Remove(pidFilePath())
		fmt.Println("mysqlui is not running (removed stale pid file)")
		return
	}

	proc, err := os.FindProcess(pid)
	if err != nil {
		fatal(err)
	}
	if err := terminateProcess(proc); err != nil {
		fatal(err)
	}
	fmt.Printf("stopping mysqlui (pid %d)...\n", pid)

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if !processAlive(pid) {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if processAlive(pid) {
		_ = proc.Kill()
		fmt.Println("mysqlui did not stop gracefully; sent kill")
	}
	_ = os.Remove(pidFilePath())
	fmt.Println("mysqlui stopped")
}

func statusDaemon() {
	pid, err := readPID()
	if err != nil {
		fmt.Println("status: stopped (no pid file)")
		return
	}
	if !processAlive(pid) {
		fmt.Println("status: stopped (stale pid file)")
		return
	}
	fmt.Printf("status:  running (pid %d)\n", pid)
	fmt.Printf("address: %s\n", listenAddr())
	fmt.Printf("pidfile: %s\n", pidFilePath())
	fmt.Printf("log:     %s\n", logFilePath())
}

// ---- service installation ----------------------------------------------

func installService(args []string) {
	system := false
	printOnly := false
	for _, a := range args {
		switch a {
		case "--system":
			system = true
		case "--print":
			printOnly = true
		}
	}

	switch runtime.GOOS {
	case "linux":
		installSystemd(system, printOnly)
	case "darwin":
		installLaunchd(printOnly)
	default:
		fmt.Println("Automatic service installation is supported on Linux (systemd) and macOS (launchd).")
		fmt.Println("On Windows, register a service manually, for example:")
		fmt.Printf("  sc.exe create mysqlui binPath= \"%s serve\" start= auto\n", executablePath())
		fmt.Println("  sc.exe start mysqlui")
	}
}

func installSystemd(system, printOnly bool) {
	exe := executablePath()
	dataAbs, _ := filepath.Abs(dataDir())
	wd, _ := os.Getwd()
	wanted := "default.target"
	path := ""
	if system {
		wanted = "multi-user.target"
		path = "/etc/systemd/system/mysqlui.service"
	} else {
		home, _ := os.UserHomeDir()
		path = filepath.Join(home, ".config", "systemd", "user", "mysqlui.service")
	}

	unit := fmt.Sprintf(`[Unit]
Description=MySQL UI - MySQL/MariaDB management tool
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=%s serve
WorkingDirectory=%s
Environment=MYSQLUI_DATA_DIR=%s
Environment=MYSQLUI_ADDR=%s
Restart=on-failure
RestartSec=3

[Install]
WantedBy=%s
`, exe, wd, dataAbs, listenAddr(), wanted)

	if printOnly {
		fmt.Print(unit)
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		fatal(err)
	}
	if err := os.WriteFile(path, []byte(unit), 0o644); err != nil {
		fatal(fmt.Errorf("cannot write %s (try sudo): %w", path, err))
	}
	fmt.Printf("Installed systemd unit: %s\n\n", path)
	if system {
		fmt.Println("Enable and start it with:")
		fmt.Println("  sudo systemctl daemon-reload")
		fmt.Println("  sudo systemctl enable --now mysqlui")
	} else {
		fmt.Println("Enable and start it with:")
		fmt.Println("  systemctl --user daemon-reload")
		fmt.Println("  systemctl --user enable --now mysqlui")
		fmt.Println("  # keep running after logout: sudo loginctl enable-linger $USER")
	}
}

func xmlEscape(s string) string {
	return strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&apos;",
	).Replace(s)
}

func installLaunchd(printOnly bool) {
	exe := executablePath()
	dataAbs, _ := filepath.Abs(dataDir())
	logAbs := filepath.Join(dataAbs, "mysqlui.log")
	home, _ := os.UserHomeDir()
	path := filepath.Join(home, "Library", "LaunchAgents", "com.mysqlui.agent.plist")

	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.mysqlui.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>%s</string>
    <string>serve</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MYSQLUI_DATA_DIR</key>
    <string>%s</string>
    <key>MYSQLUI_ADDR</key>
    <string>%s</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>%s</string>
  <key>StandardErrorPath</key>
  <string>%s</string>
</dict>
</plist>
`, xmlEscape(exe), xmlEscape(dataAbs), xmlEscape(listenAddr()), xmlEscape(logAbs), xmlEscape(logAbs))

	if printOnly {
		fmt.Print(plist)
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		fatal(err)
	}
	if err := os.WriteFile(path, []byte(plist), 0o644); err != nil {
		fatal(err)
	}
	fmt.Printf("Installed launchd agent: %s\n\n", path)
	fmt.Println("Load and start it with:")
	fmt.Printf("  launchctl load -w %s\n", path)
	fmt.Println("Stop it with:")
	fmt.Printf("  launchctl unload -w %s\n", path)
}
