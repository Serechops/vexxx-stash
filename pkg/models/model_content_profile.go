package models

import (
	"time"
)

// ContentProfile stores computed user preference weights for intelligent recommendations.
// A profile aggregates weighted preferences across tags, performers, studios, and physical attributes.
type ContentProfile struct {
	ID          int       `json:"id"`
	ProfileType string    `json:"profile_type"` // "user" (global), "performer", "studio"
	ProfileKey  *string   `json:"profile_key"`  // For sub-profiles, stores the entity ID
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	ProfileData *string   `json:"profile_data"` // JSON blob for flexible storage

	// Loaded relationships - populated via Load* methods
	TagWeights       []TagWeight       `json:"tag_weights"`
	PerformerWeights []PerformerWeight `json:"performer_weights"`
	StudioWeights    []StudioWeight    `json:"studio_weights"`
	AttributeWeights []AttributeWeight `json:"attribute_weights"`
}

// TagWeight represents a weighted preference for a specific tag.
type TagWeight struct {
	ProfileID int     `json:"profile_id" db:"profile_id"`
	TagID     int     `json:"tag_id" db:"tag_id"`
	Weight    float64 `json:"weight" db:"weight"`
}

// PerformerWeight represents a weighted preference for a specific performer.
type PerformerWeight struct {
	ProfileID   int     `json:"profile_id" db:"profile_id"`
	PerformerID int     `json:"performer_id" db:"performer_id"`
	Weight      float64 `json:"weight" db:"weight"`
}

// StudioWeight represents a weighted preference for a specific studio.
type StudioWeight struct {
	ProfileID int     `json:"profile_id" db:"profile_id"`
	StudioID  int     `json:"studio_id" db:"studio_id"`
	Weight    float64 `json:"weight" db:"weight"`
}

// AttributeWeight represents a weighted preference for a performer attribute value.
type AttributeWeight struct {
	ProfileID      int     `json:"profile_id" db:"profile_id"`
	AttributeName  string  `json:"attribute_name" db:"attribute_name"`
	AttributeValue string  `json:"attribute_value" db:"attribute_value"`
	Weight         float64 `json:"weight" db:"weight"`
}

// NewContentProfile creates a new ContentProfile with default values.
func NewContentProfile() ContentProfile {
	currentTime := time.Now()
	profileType := "user"
	return ContentProfile{
		ProfileType: profileType,
		CreatedAt:   currentTime,
		UpdatedAt:   currentTime,
	}
}

// ContentProfilePartial represents partial updates to a ContentProfile.
type ContentProfilePartial struct {
	ProfileType OptionalString
	ProfileKey  OptionalString
	ProfileData OptionalString
	UpdatedAt   OptionalTime
}

// NewContentProfilePartial creates a new ContentProfilePartial with UpdatedAt set.
func NewContentProfilePartial() ContentProfilePartial {
	return ContentProfilePartial{
		UpdatedAt: NewOptionalTime(time.Now()),
	}
}

// RecommendationResult represents a single recommendation with scoring metadata.
type RecommendationResult struct {
	Type             string            `json:"type"`               // "scene", "performer", "studio"
	ID               string            `json:"id"`                 // Local entity ID (0 if from StashDB only)
	StashID          *string           `json:"stash_id"`           // StashDB ID for external content
	Name             string            `json:"name"`               // Display name
	Score            float64           `json:"score"`              // Recommendation score (0-1, higher = better match)
	Reason           string            `json:"reason"`             // Human-readable explanation
	ImageURL         *string           `json:"image_url"`          // Preview image URL
	Scene            *Scene            `json:"scene"`              // Populated if type is "scene"
	StashDBScene     *ScrapedScene     `json:"stash_db_scene"`     // Populated if type is "stashdb_scene"
	Performer        *Performer        `json:"performer"`          // Populated if type is "performer"
	StashDBPerformer *ScrapedPerformer `json:"stash_db_performer"` // Populated if type is "stashdb_performer"
}

// RecommendationOptions configures recommendation queries.
type RecommendationOptions struct {
	Limit           *int                  `json:"limit"`            // Max results to return
	Source          *RecommendationSource `json:"source"`           // LOCAL, STASHDB, or BOTH
	ExcludeOwned    *bool                 `json:"exclude_owned"`    // For StashDB, filter out already-owned content
	MinScore        *float64              `json:"min_score"`        // Minimum score threshold
	TagWeight       *float64              `json:"tag_weight"`       // Weight override for tags (0-1)
	PerformerWeight *float64              `json:"performer_weight"` // Weight override for performers (0-1)
	StudioWeight    *float64              `json:"studio_weight"`    // Weight override for studios (0-1)
}

// RecommendationSource indicates where recommendations should be sourced from.
type RecommendationSource string

const (
	RecommendationSourceLocal   RecommendationSource = "LOCAL"
	RecommendationSourceStashDB RecommendationSource = "STASHDB"
	RecommendationSourceBoth    RecommendationSource = "BOTH"
)

// WeightedTag pairs a Tag with its recommendation weight.
type WeightedTag struct {
	Tag    *Tag    `json:"tag"`
	Weight float64 `json:"weight"`
}

// WeightedPerformer pairs a Performer with its recommendation weight.
type WeightedPerformer struct {
	Performer *Performer `json:"performer"`
	Weight    float64    `json:"weight"`
}

// WeightedStudio pairs a Studio with its recommendation weight.
type WeightedStudio struct {
	Studio *Studio `json:"studio"`
	Weight float64 `json:"weight"`
}

// WeightedAttribute pairs an attribute name/value with its weight.
type WeightedAttribute struct {
	Name   string  `json:"name"`
	Value  string  `json:"value"`
	Weight float64 `json:"weight"`
}
