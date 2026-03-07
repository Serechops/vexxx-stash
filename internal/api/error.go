package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/99designs/gqlgen/graphql"
	"github.com/stashapp/stash/pkg/logger"
	"github.com/vektah/gqlparser/v2/gqlerror"
)

// isInternalError determines if an error is an internal error that should be
// sanitized before being returned to the client. Internal errors include
// database errors, filesystem errors, and connection errors that may leak
// implementation details such as file paths, table names, or SQL statements.
func isInternalError(err error) bool {
	if err == nil {
		return false
	}

	// Database errors
	if errors.Is(err, sql.ErrConnDone) || errors.Is(err, sql.ErrTxDone) {
		return true
	}

	// Check error message patterns that indicate internal errors
	msg := err.Error()
	internalPatterns := []string{
		"sql:",
		"database",
		"SQLITE",
		"sqlite",
		"no such table",
		"constraint failed",
		"UNIQUE constraint",
		"FOREIGN KEY constraint",
		"open ",  // filesystem open errors
		"read ",  // filesystem read errors
		"write ", // filesystem write errors
		"permission denied",
		"connection refused",
		"dial tcp",
		"i/o timeout",
	}

	for _, pattern := range internalPatterns {
		if strings.Contains(msg, pattern) {
			return true
		}
	}

	return false
}

// errorCode returns a stable error code string for categorizing errors
// in GraphQL error extensions. Clients can use these codes for programmatic
// error handling.
func errorCode(err error) string {
	if errors.Is(err, ErrNotAuthenticated) {
		return "UNAUTHENTICATED"
	}
	if errors.Is(err, ErrNotAuthorized) {
		return "FORBIDDEN"
	}
	if errors.Is(err, ErrNotSupported) {
		return "NOT_SUPPORTED"
	}
	if errors.Is(err, ErrInput) {
		return "BAD_INPUT"
	}
	if errors.Is(err, context.Canceled) {
		return "CANCELLED"
	}
	if errors.Is(err, sql.ErrNoRows) {
		return "NOT_FOUND"
	}
	if isInternalError(err) {
		return "INTERNAL_ERROR"
	}
	return "UNKNOWN"
}

// sanitizeErrorMessage returns a user-safe error message. Internal errors
// are replaced with a generic message to avoid leaking implementation details
// like SQL statements, file paths, or connection strings.
func sanitizeErrorMessage(err error) string {
	if errors.Is(err, ErrNotAuthenticated) {
		return "authentication required"
	}
	if errors.Is(err, ErrNotAuthorized) {
		return "insufficient permissions"
	}
	if errors.Is(err, sql.ErrNoRows) {
		return "not found"
	}
	if isInternalError(err) {
		return "an internal error occurred"
	}
	// For non-internal errors, return the original message
	// (these are typically user-facing validation errors, input errors, etc.)
	return err.Error()
}

func gqlErrorHandler(ctx context.Context, e error) *gqlerror.Error {
	if !errors.Is(ctx.Err(), context.Canceled) {
		// Log the full error with context for debugging
		fc := graphql.GetFieldContext(ctx)
		if fc != nil {
			logger.Errorf("%s: %v", fc.Path(), e)

			// log the args in debug level
			logger.DebugFunc(func() (string, []interface{}) {
				var args interface{}
				args = fc.Args

				s, _ := json.Marshal(args)
				if len(s) > 0 {
					args = string(s)
				}

				return "%s: %v", []interface{}{
					fc.Path(),
					args,
				}
			})
		}
	}

	// Build a sanitized error for the client response
	gqlErr := graphql.DefaultErrorPresenter(ctx, e)

	// Add error code to extensions for programmatic client handling
	code := errorCode(e)
	if gqlErr.Extensions == nil {
		gqlErr.Extensions = make(map[string]interface{})
	}
	gqlErr.Extensions["code"] = code

	// Sanitize the message to avoid leaking internal details
	if isInternalError(e) {
		gqlErr.Message = sanitizeErrorMessage(e)
	}

	return gqlErr
}
