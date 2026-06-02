//go:build windows

package main

import (
	"os"
	"os/exec"
)

// restart launches a new instance of the current binary and immediately exits
// the current process. Windows does not support syscall.Exec (in-place process
// replacement), so we spawn a child process instead. The child inherits stdin,
// stdout and stderr, and receives the same command-line arguments.
func restart() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	cmd := exec.Command(exe, os.Args[1:]...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	os.Exit(0)
	return nil // unreachable
}
