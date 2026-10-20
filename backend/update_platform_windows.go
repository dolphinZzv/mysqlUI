//go:build windows

package main

import (
	"errors"
	"os"
)

func replaceExecutable(exe, tmp string) error {
	old := exe + ".old"
	_ = os.Remove(old)
	if err := os.Rename(exe, old); err != nil {
		return err
	}
	if err := os.Rename(tmp, exe); err != nil {
		_ = os.Rename(old, exe)
		return err
	}
	_ = os.Remove(old)
	return nil
}

func restartProcess() error {
	return errors.New("automatic restart is not supported on Windows; restart mysqlui manually")
}

func canRestartProcess() bool { return false }
