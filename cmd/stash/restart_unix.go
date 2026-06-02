//go:build !windows

package main

import (
	"os"
	"syscall"
)

// restart replaces the current process image with a fresh copy of the same
// binary by calling syscall.Exec. On successful exec the current process
// ceases to exist and no further Go code is executed. The function only
// returns an error when the exec call itself fails.
func restart() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return syscall.Exec(exe, os.Args, os.Environ())
}
