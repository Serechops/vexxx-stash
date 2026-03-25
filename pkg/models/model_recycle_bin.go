package models

import "time"

// RecycleBinEntry holds a full snapshot of an entity captured just before
// it was deleted.  The snapshot includes all scalar columns plus the
// entity's join-table relations (aliases, tag IDs, performer IDs, etc.) so
// that a Restore can reconstruct it entirely.
type RecycleBinEntry struct {
	ID          int                    `json:"id"`
	EntityType  string                 `json:"entity_type"`
	EntityID    int                    `json:"entity_id"`
	EntityName  string                 `json:"entity_name"`
	DeletedData map[string]interface{} `json:"deleted_data"`
	DeletedAt   time.Time              `json:"deleted_at"`
	GroupID     *string                `json:"group_id"`
}
