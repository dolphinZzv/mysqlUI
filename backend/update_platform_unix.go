//go:build !windows

package main

import (
	"os"
	"syscall"
)

// replaceExecutable atomically swaps the running binary. The running process
// keeps using the old inode until it is restarted.
func replaceExecutable(exe, tmp string) error {
	return os.Rename(tmp, exe)
}

// restartProcess replaces the current process image with the new binary.
// Listening sockets are close-on-exec, so the new process can bind the port.
func restartProcess() error {
	exe := executablePath()
	return syscall.Exec(exe, os.Args, os.Environ())
}

func canRestartProcess() bool { return true }
