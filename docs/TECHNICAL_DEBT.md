# Technical Debt Documentation

This document catalogs known technical workarounds in the Stash codebase, explaining why they exist and potential paths to resolution.

## Backend Technical Debt

### 1. Scraper YAML Unmarshaling (pkg/scraper/mapped.go)

**Location**: Lines 166, 225, 279, 335, 389

**Pattern**: Multiple `UnmarshalYAML` methods use a map-unmarshal-then-remarshal pattern.

**Why It Exists**: Go's YAML libraries cannot natively handle struct composition where:
- A parent struct has an embedded `mappedConfig` for arbitrary key-value pairs
- The same struct has explicitly typed child fields (Tags, Performers, Studio, etc.)

Standard unmarshaling would fail to distinguish between arbitrary config keys and known sub-fields.

**Current Solution**:
```go
func (s *mappedSceneScraperConfig) UnmarshalYAML(unmarshal func(interface{}) error) error {
    // 1. Unmarshal to generic map
    // 2. Extract known fields (Tags, Performers, etc.) to separate map
    // 3. Delete known fields from parent map
    // 4. Re-marshal and unmarshal the child-specific fields
    // 5. Re-marshal and unmarshal remaining fields to embedded mappedConfig
}
```

**Assessment**: **Acceptable workaround** - This is the standard approach for handling YAML inheritance in Go. Alternatives would require:
- Custom YAML parser implementation
- Breaking changes to scraper configuration format
- Using a different serialization format (JSON doesn't have this issue but loses YAML readability)

**Recommendation**: Document as intentional design pattern, update comments from "HACK" to "Workaround: YAML inheritance handling".

---

### 2. Stash Scraper ID Passthrough (pkg/scraper/stash.go)

**Location**: Lines 57, 277

**Pattern**: External stash server IDs are stored in the URL field.

**Why It Exists**: The `ScrapedPerformer` and `ScrapedScene` models don't have a generic "source ID" field. When scraping from another Stash instance, we need to preserve the source entity ID for potential follow-up operations.

**Current Solution**:
```go
func (p stashFindPerformerNamePerformer) toPerformer() *models.ScrapedPerformer {
    return &models.ScrapedPerformer{
        Name: &p.Name,
        // Store ID in URL field for later lookup
        URL: &p.ID,
    }
}
```

**Assessment**: **Necessary workaround** - Adding a dedicated `SourceID` field to scraped models would be cleaner but requires:
- GraphQL schema changes
- Model changes across all scraper types
- Updates to all scrapers that consume these models

**Recommendation**: 
- Short-term: Update comment to clarify intent
- Long-term: Add optional `SourceID` field to scraped model types

**Proposed Schema Addition**:
```graphql
type ScrapedPerformer {
    # ... existing fields ...
    source_id: String  # ID from source system for cross-reference
}
```

---

### 3. Group Filter CTE Pattern (pkg/sqlite/group_filter.go)

**Location**: Line 160

**Pattern**: Uses CTE (Common Table Expression) for complex filtered joins.

**Why It Exists**: When filtering groups by performers (who appear in scenes within the group), we need to:
1. Join groups → groups_scenes → performers_scenes
2. Filter performers_scenes by specific performer IDs
3. Apply filter parameters to the join condition

SQLite and goqu have limitations:
- Can't apply positional parameters to JOIN ON clauses directly
- Can't INNER JOIN on top of a LEFT JOIN in certain configurations

**Current Solution**:
```go
f.addWith(`groups_performers AS (
    SELECT groups_scenes.group_id, performers_scenes.performer_id
    FROM groups_scenes
    INNER JOIN performers_scenes ON groups_scenes.scene_id = performers_scenes.scene_id
    WHERE performers_scenes.performer_id IN (?, ?, ?)
)`, args...)
f.addLeftJoin("groups_performers", "", "groups.id = groups_performers.group_id")
```

**Assessment**: **Correct solution** - CTEs are the proper SQL pattern for this use case. The "hack" comment is misleading; this is actually better SQL design than deeply nested subqueries.

**Recommendation**: Change comment from "Hack" to:
```go
// Use CTE for performer filtering - cleaner than nested subqueries
// and works around goqu's join parameter limitations
```

---

### 4. URL Multi-Value Handling (pkg/scraper/mapped.go)

**Location**: Line 93

**Pattern**: Special handling for URLs field to set as multi-value.

**Why It Exists**: The URLs field is the only field that can legitimately have multiple values from a single scrape operation. Other fields are single-value.

**Current Solution**:
```go
isMulti := isMulti != nil && isMulti(k)
if isMulti {
    ret = ret.setMultiValue(0, k, result)
} else {
    for i, text := range result {
        ret = ret.setSingleValue(i, k, text)
    }
}
```

**Assessment**: **Correct behavior** - This isn't a hack, it's handling a legitimate business requirement.

**Recommendation**: Update comment to clarify this is intentional multi-value handling, not a workaround.

---

## Frontend Technical Debt

### 5. TypeScript Gallery Component Casts (ui/v2.5/src/components/Scenes/)

**Location**: 
- SceneWallPanel.tsx line 137
- SceneMarkerWallPanel.tsx line 129

**Pattern**: Type assertions for react-photo-gallery component.

**Why It Exists**: The react-photo-gallery library's TypeScript definitions don't support custom photo properties. Our `IScenePhoto` and `IMarkerPhoto` interfaces extend the base Photo type with additional fields.

**Current Solution**:
```typescript
const MarkerGallery = Gallery as unknown as GalleryI<IMarkerPhoto>;
```

**Assessment**: **Acceptable TypeScript workaround** - This is a common pattern when library types are less flexible than the library's actual capabilities.

**Alternatives**:
- Fork and patch @types/react-photo-gallery (maintenance burden)
- Use a different gallery library (migration effort)
- Create wrapper component that handles type transformation (additional complexity)

**Recommendation**: Keep as-is, document in component JSDoc.

---

### 6. Client-Side Exclude Filtering (ui/v2.5/src/components/*/Select.tsx)

**Location**: 
- TagSelect.tsx line 87
- StudioSelect.tsx line 88
- SceneSelect.tsx line 89
- GroupSelect.tsx line 92
- GallerySelect.tsx line 98

**Pattern**: ~~Filtering excluded IDs on the client after fetching from server.~~ **RESOLVED**

**Why It Existed**: The GraphQL queries for finding tags/studios/etc. didn't support an `excludeIds` parameter. When a select component needed to exclude already-selected items, it filtered the response client-side.

**Resolution**: Added `exclude_ids` to `FindFilterType` in GraphQL schema and backend implementation:
- Schema: `graphql/schema/types/filters.graphql` - Added `exclude_ids: [ID!]`
- Model: `pkg/models/find_filter.go` - Added `ExcludeIds` field
- Query: `pkg/sqlite/query.go` - Added `applyExcludeIDs` helper function
- Stores: Applied exclude filtering in `tag.go`, `studio.go`, `group.go`, `scene.go`
- Frontend: Updated `ListFilterModel` to include `excludeIds` in `makeFindFilter()`
- Components: Updated TagSelect, StudioSelect, GroupSelect, SceneSelect to use backend filtering

---

## Priority Recommendations

### High Priority (Fix Soon)
1. ~~**Client-Side Exclude Filtering**~~ - ✅ Fixed with schema change

### Low Priority (Document and Accept)
1. **YAML Unmarshaling** - Working solution for real limitation
2. **Stash Scraper ID Passthrough** - Would require breaking changes
3. **CTE Pattern** - Actually correct, just needs comment update
4. **TypeScript Gallery Casts** - Common library interop pattern

### Comment Updates Only
1. **URL Multi-Value Handling** - Not actually a hack
2. **CTE Pattern** - Better described as "proper SQL pattern"

---

## Tracking

| Item | Status | Target Version |
|------|--------|----------------|
| Exclude IDs Filter | Backlog | TBD |
| YAML Comments | To Update | Next Release |
| CTE Comments | To Update | Next Release |
| ScrapedModel SourceID | Backlog | TBD |
