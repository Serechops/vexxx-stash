package api

import (
	"context"

	"github.com/99designs/gqlgen/graphql"
	"github.com/stashapp/stash/pkg/models"
	"github.com/stashapp/stash/pkg/session"
	"github.com/stashapp/stash/pkg/txn"
	"github.com/vektah/gqlparser/v2/ast"
	"github.com/vektah/gqlparser/v2/gqlerror"
)

// viewerAllowedMutations lists mutations that viewers can access
var viewerAllowedMutations = map[string]bool{
	// Self-service account operations
	"changeOwnPassword":   true,
	"regenerateOwnAPIKey": true,

	// Login/logout (handled by session, not permission-guarded)
	// Note: actual login/logout is handled by HTTP handlers, not GraphQL
}

// adminOnlyMutations lists mutations that require admin role
// If a mutation is not in this list and not in viewerAllowedMutations,
// it defaults to requiring admin (modify) permission
var adminOnlyMutations = map[string]bool{
	// User management
	"userCreate":           true,
	"userUpdate":           true,
	"userDestroy":          true,
	"userRegenerateAPIKey": true,
	"sessionDestroy":       true,
	"sessionDestroyByUser": true,

	// System configuration
	"configureGeneral":       true,
	"configureInterface":     true,
	"configureDefaults":      true,
	"configureScraping":      true,
	"configureDLNA":          true,
	"configureUI":            true,
	"generateAPIKey":         true,
	"enableDLNA":             true,
	"disableDLNA":            true,
	"addTempDLNAIP":          true,
	"removeTempDLNAIP":       true,
	"setDefaultFilter":       true,
	"deleteDefaultFilter":    true,

	// Dangerous operations
	"shutdown":      true,
	"stopAllJobs":   true,
	"migrate":       true,
	"backup":        true,
	"anonymiseDatabase": true,

	// Plugin management
	"reloadPlugins":              true,
	"runPluginTask":              true,
	"runPluginOperation":         true,
	"setPluginsEnabled":          true,
	"installPackages":            true,
	"uninstallPackages":          true,
	"updatePackages":             true,

	// Scraper management
	"reloadScrapers":    true,

	// System tasks
	"metadataScan":            true,
	"metadataIdentify":        true,
	"metadataAutoTag":         true,
	"metadataClean":           true,
	"metadataCleanGenerated":  true,
	"metadataGenerate":        true,
	"metadataExport":          true,
	"exportObjects":           true,
	"importObjects":           true,
	"stashBoxBatchPerformerTag": true,
	"stashBoxBatchStudioTag":    true,
	"migrateHashNaming":       true,
	"migrateSceneScreenshots": true,
	"migrateBlobs":            true,
	"optimiseDatabase":        true,

	// Scene-level generation/modification
	"sceneGenerateScreenshot": true,
	"sceneGenerateGallery":    true,

	// Job control
	"stopJob":       true,

	// File operations
	"moveFiles":          true,
	"deleteFiles":        true,
}

// MutationMiddleware creates a gqlgen middleware that checks user permissions
// before allowing mutation execution
func MutationMiddleware(userRepo models.UserReader, txnMgr models.TxnManager) graphql.OperationMiddleware {
	return func(ctx context.Context, next graphql.OperationHandler) graphql.ResponseHandler {
		oc := graphql.GetOperationContext(ctx)

		// Only check mutations
		if oc.Operation == nil || oc.Operation.Operation != ast.Mutation {
			return next(ctx)
		}

		// Get current user
		userID := session.GetCurrentUserID(ctx)

		// If no user is logged in, let the existing auth middleware handle it
		if userID == nil {
			return next(ctx)
		}

		// Look up the user to get their role
		var user *models.User
		var findErr error
		if err := txn.WithDatabase(ctx, txnMgr, func(ctx context.Context) error {
			user, findErr = userRepo.FindByUsername(ctx, *userID)
			return findErr
		}); err != nil || user == nil {
			// User not found in database, might be legacy single-user mode
			// Allow the mutation (backward compatibility)
			return next(ctx)
		}

		// Admin users can do anything
		if user.IsAdmin() {
			return next(ctx)
		}

		// For viewer users, check each mutation field
		// Get mutation field names from the operation
		for _, selection := range oc.Operation.SelectionSet {
			if field, ok := selection.(*ast.Field); ok {
				mutationName := field.Name

				// Check if viewer is allowed
				if !viewerAllowedMutations[mutationName] {
					// Block viewer from this mutation
					return graphql.OneShot(&graphql.Response{
						Errors: gqlerror.List{{
							Message: "Not Authorized: 'Viewer' users cannot perform this action",
							Path:    graphql.GetPath(ctx),
						}},
					})
				}
			}
		}

		return next(ctx)
	}
}
