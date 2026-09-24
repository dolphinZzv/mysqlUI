//go:build !windows

package main

import (
	"os"
	"os/exec"
	"syscall"
)

// detach puts the child into its own session so it survives the parent exiting.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}

// terminateProcess asks the process to stop gracefully (SIGTERM).
func terminateProcess(proc *os.Process) error {
	return proc.Signal(syscall.SIGTERM)
}

// processAlive reports whether a process with the given PID exists.
func processAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	if err == nil {
		return true
	}
	// EPERM means the process exists but belongs to another user.
	return err == syscall.EPERM
}
