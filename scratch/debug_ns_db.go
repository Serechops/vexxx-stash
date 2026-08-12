package main

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/stashapp/stash/pkg/sqlite"
)

func main() {
	appData := os.Getenv("APPDATA")
	homeDir, _ := os.UserHomeDir()
	candidates := []string{
		filepath.Join("c:\\stash", "apihub", "newsensations_catalog.db"),
		filepath.Join(homeDir, ".stash", "apihub", "newsensations_catalog.db"),
		filepath.Join(appData, "Stash", "apihub", "newsensations_catalog.db"),
		filepath.Join(appData, "stash", "apihub", "newsensations_catalog.db"),
	}

	for _, dbPath := range candidates {
		info, err := os.Stat(dbPath)
		if err != nil {
			fmt.Printf("Path %s: NOT FOUND (%v)\n", dbPath, err)
			continue
		}
		fmt.Printf("Path %s: FOUND (%d bytes, mod %v)\n", dbPath, info.Size(), info.ModTime())

		db, err := sql.Open("sqlite3ex", dbPath)
		if err != nil {
			fmt.Printf("  Error opening DB: %v\n", err)
			continue
		}

		var seriesCount, scenesCount, junctionCount int
		_ = db.QueryRow("SELECT COUNT(*) FROM ns_series").Scan(&seriesCount)
		_ = db.QueryRow("SELECT COUNT(*) FROM ns_scenes").Scan(&scenesCount)
		_ = db.QueryRow("SELECT COUNT(*) FROM ns_series_scenes").Scan(&junctionCount)
		db.Close()

		fmt.Printf("  ns_series count:        %d\n", seriesCount)
		fmt.Printf("  ns_scenes count:        %d\n", scenesCount)
		fmt.Printf("  ns_series_scenes count: %d\n", junctionCount)
	}
}
