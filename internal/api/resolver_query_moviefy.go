package api

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/mattn/go-sqlite3"
	"github.com/stashapp/stash/internal/manager/config"
)

// SearchMovieFyDatabase searches the external moviefy.db for movies
func (r *queryResolver) SearchMovieFyDatabase(ctx context.Context, input MovieFySearchInput) (*MovieFySearchResult, error) {
	// Get database path from config
	dbPath := config.GetInstance().GetMovieFyDatabasePath()

	emptyResult := func(mode string) *MovieFySearchResult {
		return &MovieFySearchResult{
			Movies: []*MovieFyResult{},
			Pagination: &MovieFyPagination{
				Page:    1,
				PerPage: 40,
				Total:   0,
				Pages:   0,
			},
			Mode: mode,
		}
	}

	if dbPath == "" {
		return emptyResult("basic"), nil
	}

	// Check if database exists
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		return emptyResult("basic"), nil
	}

	// Open database connection (read-only)
	db, err := sql.Open("sqlite3", dbPath+"?mode=ro")
	if err != nil {
		return nil, fmt.Errorf("failed to open moviefy database: %w", err)
	}
	defer db.Close()

	// Set pagination defaults
	page := 1
	perPage := 40
	if input.Page != nil && *input.Page > 0 {
		page = *input.Page
	}
	if input.PerPage != nil && *input.PerPage > 0 {
		perPage = *input.PerPage
		if perPage > 100 {
			perPage = 100
		}
	}
	offset := (page - 1) * perPage

	// Prepare search term
	searchTerm := strings.TrimSpace(input.Search)
	if searchTerm == "" {
		return &MovieFySearchResult{
			Movies: []*MovieFyResult{},
			Pagination: &MovieFyPagination{
				Page:    page,
				PerPage: perPage,
				Total:   0,
				Pages:   0,
			},
			Mode: "premium",
		}, nil
	}

	// Count total results
	var total int
	countQuery := `
		SELECT COUNT(*) FROM movies 
		WHERE name LIKE ?
	`
	likePattern := "%" + searchTerm + "%"
	err = db.QueryRowContext(ctx, countQuery, likePattern).Scan(&total)
	if err != nil {
		return nil, fmt.Errorf("failed to count results: %w", err)
	}

	// Query movies with pagination
	query := `
		SELECT 
			id,
			name,
			url,
			front_image
		FROM movies 
		WHERE name LIKE ?
		ORDER BY CASE WHEN url LIKE '%adultdvdempire.com%' THEN 0 ELSE 1 END, name ASC
		LIMIT ? OFFSET ?
	`

	rows, err := db.QueryContext(ctx, query, likePattern, perPage, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to query movies: %w", err)
	}
	defer rows.Close()

	var movies []*MovieFyResult
	for rows.Next() {
		var id int64
		var name string
		var url, frontImage sql.NullString

		err := rows.Scan(&id, &name, &url, &frontImage)
		if err != nil {
			continue
		}

		m := &MovieFyResult{
			ID:   fmt.Sprintf("%d", id),
			Name: name,
		}

		if url.Valid {
			m.URL = &url.String

			// Calculate domain from URL
			if u, err := os.UserHomeDir(); err == nil && u != "" {
				// Just a placeholder usage to satisfy imports if needed,
				// but actually we need net/url for domain parsing.
				// Since we don't have net/url imported, we'll do simple string manipulation
				// or just skip domain calculation for now to keep diff small and safe.
				// Actually, let's implement a simple domain extractor.
				parts := strings.Split(url.String, "/")
				if len(parts) > 2 {
					m.Domain = &parts[2]
				}
			}
		}
		if frontImage.Valid {
			m.FrontImage = &frontImage.String
		}

		movies = append(movies, m)
	}

	pages := int(math.Ceil(float64(total) / float64(perPage)))

	return &MovieFySearchResult{
		Movies: movies,
		Pagination: &MovieFyPagination{
			Page:    page,
			PerPage: perPage,
			Total:   total,
			Pages:   pages,
		},
		Mode: "premium",
	}, nil
}

// MovieFyConfig returns the current MovieFy configuration
func (r *queryResolver) MovieFyConfig(ctx context.Context) (*MovieFyConfig, error) {
	dbPath := config.GetInstance().GetMovieFyDatabasePath()

	var pathPtr *string
	if dbPath != "" {
		pathPtr = &dbPath
	}

	exists := false
	if dbPath != "" {
		if _, err := os.Stat(dbPath); err == nil {
			exists = true
		}
	}

	return &MovieFyConfig{
		DatabasePath:   pathPtr,
		DatabaseExists: exists,
	}, nil
}

// ConfigureMovieFy sets the MovieFy database path
func (r *mutationResolver) ConfigureMovieFy(ctx context.Context, input MovieFyConfigInput) (bool, error) {
	// Validate the path exists and is a valid SQLite database
	dbPath := filepath.Clean(input.DatabasePath)

	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		return false, fmt.Errorf("database file does not exist: %s", dbPath)
	}

	// Try to open the database to validate it
	db, err := sql.Open("sqlite3", dbPath+"?mode=ro")
	if err != nil {
		return false, fmt.Errorf("invalid SQLite database: %w", err)
	}
	defer db.Close()

	// Verify it has the expected table structure
	var tableName string
	err = db.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name='movies'").Scan(&tableName)
	if err != nil {
		return false, fmt.Errorf("database does not contain 'movies' table")
	}

	// Save the path to config using the setter
	config.GetInstance().SetMovieFyDatabasePath(dbPath)
	if err := config.GetInstance().Write(); err != nil {
		return false, fmt.Errorf("failed to save configuration: %w", err)
	}

	return true, nil
}
