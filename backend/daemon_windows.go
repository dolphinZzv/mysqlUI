//go:build windows

package main

import (
	"os"
	"os/exec"
	"syscall"
)

const (
	createNewProcessGroup = 0x00000200
	detachedProcess       = 0x00000008
)

// detach starts the child detached from the console so it survives the parent.
func detach(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: createNewProcessGroup | detachedProcess,
		HideWindow:    true,
	}
}

// terminateProcess stops the process. Windows has no SIGTERM; kill it.
func terminateProcess(proc *os.Process) error {
	return proc.Kill()
}

// processAlive reports whether a process with the given PID exists. On Windows
// FindProcess opens the process and fails when it does not exist.
func processAlive(pid int) bool {
	proc, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	_ = proc.Release()
	return true
}
