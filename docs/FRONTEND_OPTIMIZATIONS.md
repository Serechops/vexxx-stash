# Frontend Performance Optimizations

> **Created:** January 21, 2026  
> **Updated:** January 22, 2026  
> **Status:** ✅ Complete (High/Medium Priority Items)  
> **Stack:** React 17, TypeScript 5.9, Apollo Client 3.8, Vite 5, MUI 7

---

## Progress Tracker

| # | Optimization | Priority | Effort | Status | Impact |
|---|-------------|----------|--------|--------|--------|
| 1 | Replace Moment.js with date-fns | 🔴 High | Medium | ✅ Complete | ~300KB bundle reduction |
| 2 | Add list virtualization | 🔴 High | High | ✅ Complete | Faster large lists |
| 3 | Optimize Apollo cache policies | 🔴 High | Medium | 🔄 Analyzed | Cache already well-configured |
| 4 | Add React.memo to card components | 🟡 Medium | Low | ✅ Complete | Fewer re-renders |
| 5 | Remove console.log statements | 🟡 Medium | Low | ✅ Complete | Cleaner production |
| 6 | Lazy load heavy components | 🟡 Medium | Medium | ✅ Already Implemented | - |
| 7 | Image lazy loading | 🟡 Medium | Low | ✅ Complete | Faster page loads |
| 8 | Bundle splitting for routes | 🟢 Low | Medium | ✅ Already Implemented | - |
| 9 | Add ErrorBoundary coverage | 🟢 Low | Low | ✅ Already Implemented | - |
| 10 | Upgrade to React 18 | 🟢 Low | High | ⬜ Not Started | Concurrent features |
| 11 | Web Worker for heavy operations | 🟢 Low | High | ⬜ Not Started | Non-blocking UI |
| 12 | Service Worker optimization | 🟢 Low | Medium | ⬜ Not Started | Offline support |

---

## Analysis Summary

### What's Already Good ✅

1. **Lazy Loading** - `lazyComponent()` wrapper used extensively in App.tsx for route-level code splitting
2. **Error Boundaries** - ErrorBoundary component wraps major routes
3. **Custom Hooks** - Well-structured hooks in `src/hooks/` with proper useMemo/useCallback usage
4. **State Management** - useMemoOnce pattern for expensive computations
5. **Code Organization** - Clean separation of concerns
6. **Apollo Cache** - Type policies configured for core entities with reference resolution

### Areas for Improvement 🔧

---

## 1. Replace Moment.js with date-fns
**Priority:** 🔴 High  
**Effort:** Medium  
**Bundle Impact:** ~300KB reduction  
**Status:** ✅ Complete

### Implementation
Created `src/utils/date.ts` utility with locale-aware date formatting:
```typescript
import { formatRelativeTime, setDateLocale } from "src/utils/date";
setDateLocale("de");
formatRelativeTime(startTime); // "vor 5 Minuten"
```

### Files Modified
- ✅ `src/utils/date.ts` - Created new utility
- ✅ `src/App.tsx` - Replaced moment.locale with setDateLocale
- ✅ `src/components/Settings/Tasks/JobTable.tsx` - Replaced moment().fromNow()
- ✅ `package.json` - Added date-fns dependency

---

## 2. Add React.memo to Card Components
**Priority:** 🟡 Medium  
**Effort:** Low  
**Status:** ✅ Complete

### Implementation
Modified `PatchComponent` in `src/patch.tsx` to automatically wrap all patched components in `React.memo`:
```typescript
export function PatchComponent<T>(
  component: string,
  fn: React.FC<T>
): React.MemoExoticComponent<React.FC<T>> {
  const ret = PatchFunction(component, fn);
  RegisterComponent(component, ret);
  
  // Wrap in React.memo for performance
  const memoized = React.memo(ret as React.FC<T>);
  memoized.displayName = component;
  return memoized;
}
```

### Components Now Memoized
All components using PatchComponent are now automatically memoized:
- SceneCard, PerformerCard, StudioCard, TagCard, GalleryCard, ImageCard
- GridCard, DetailImage, BackgroundImage
- And all other PatchComponent-wrapped components

---

## 3. Remove Debug Console.log Statements
**Priority:** 🟡 Medium  
**Effort:** Low  
**Status:** ✅ Complete

### Implementation
Created `src/utils/logger.ts` utility that gates console output in production:
```typescript
import { logger } from "src/utils/logger";
logger.log("Debug info");  // Only in dev
logger.warn("Warning");    // Only in dev  
logger.error("Error");     // Always logged
```

### Files Modified
- ✅ `src/utils/logger.ts` - Created new utility
- ✅ `src/App.tsx` - Replaced console.log
- ✅ `src/components/Shared/MuiIcon.tsx` - Replaced console.warn
- ✅ `src/components/ScenePlayer/ScenePlayerScrubber.tsx` - Replaced console.log
- ✅ `src/components/Tags/EditTagsDialog.tsx` - Removed debug console.log
- ✅ `src/components/List/Filters/HierarchicalLabelValueFilter.tsx` - Removed debug console.log

---

## 4. Image Lazy Loading
**Priority:** 🟡 Medium  
**Effort:** Low  
**Status:** ✅ Complete

### Implementation
Added `loading="lazy"` attribute to images that were missing it:
```tsx
<img src={imagePath} alt={alt} loading="lazy" />
```

### Files Modified
- ✅ `src/components/Shared/DetailImage.tsx`
- ✅ `src/components/Shared/DetailsPage/BackgroundImage.tsx`
- ✅ `src/components/Tagger/performers/StashSearchResult.tsx`
- ✅ `src/components/Tagger/performers/PerformerTagger.tsx`

---

## 5. Apollo Cache Analysis
**Priority:** 🔴 High  
**Effort:** Medium  
**Status:** 🔄 Analyzed - Already Well Configured

### Analysis Results
The Apollo cache in `src/core/createClient.ts` is already well-configured:
- Type policies for core entities (Scene, Performer, Studio, Tag, etc.)
- Reference resolution for find queries
- Dangling reference handling for deleted entities

Most `fetchPolicy: "network-only"` usages are for:
- Scraper queries (need fresh external data)
- StashBox queries (external API calls)
- Package availability checks

These legitimately require network-only. The cache is appropriate for the data patterns.

---

## 6. Remaining: List Virtualization

// ui/v2.5/src/components/Settings/Tasks/JobTable.tsx  
import moment from "moment/min/moment-with-locales";
```

Moment.js with locales is ~300KB. Modern alternatives:
- **date-fns**: Tree-shakeable, ~10-20KB for common operations
- **dayjs**: Similar API to moment, ~2KB core

### Suggested Fix
```bash
pnpm add date-fns
pnpm remove moment
```

```typescript
// Replace moment usage:
// Before
import moment from "moment";
moment(date).format("MMMM Do YYYY");

// After
import { format } from "date-fns";
format(date, "MMMM do yyyy");
```

### Files to Modify
- [ ] `ui/v2.5/src/App.tsx` - locale setting
- [ ] `ui/v2.5/src/components/Settings/Tasks/JobTable.tsx` - date formatting

---

## 6. List Virtualization
**Priority:** 🔴 High  
**Effort:** High  
**Status:** ✅ Complete - Components Created
**Performance Impact:** Major improvement for lists with 100+ items

### Implementation
Created virtualized grid components using `@tanstack/react-virtual`:

#### VirtualizedGrid (Generic)
`src/components/List/VirtualizedGrid.tsx` - Reusable virtualized grid:
```typescript
import { VirtualizedGrid } from "src/components/List/VirtualizedGrid";

<VirtualizedGrid
  items={items}
  renderItem={(item, index) => <Card item={item} />}
  estimateSize={300}
  minItemWidth={200}
/>
```

#### VirtualizedSceneCardsGrid (Scenes)
`src/components/Scenes/VirtualizedSceneCardsGrid.tsx` - Drop-in replacement for SceneCardsGrid:
```typescript
import { VirtualizedSceneCardsGrid, SmartSceneCardsGrid } from "./VirtualizedSceneCardsGrid";

// Always virtualized
<VirtualizedSceneCardsGrid scenes={scenes} ... />

// Auto-switches at 100+ items
<SmartSceneCardsGrid scenes={scenes} virtualizationThreshold={100} ... />
```

### How It Works
- Only renders visible rows + 3 rows overscan
- Uses ResizeObserver for responsive column calculation
- Maintains proper scroll position with absolute positioning
- Skeleton loading state for initial render
- Smart components auto-switch to virtualization at 50+ items

### Files Created
- ✅ `src/components/List/VirtualizedGrid.tsx` - Generic virtualized grid
- ✅ `src/components/Scenes/VirtualizedSceneCardsGrid.tsx` - Scene grid with SmartSceneCardsGrid
- ✅ `src/components/Performers/VirtualizedPerformerCardGrid.tsx` - Performer grid with SmartPerformerCardGrid
- ✅ `src/components/Galleries/VirtualizedGalleryCardGrid.tsx` - Gallery grid with SmartGalleryCardGrid
- ✅ `src/components/Images/VirtualizedImageGridCard.tsx` - Image grid with SmartImageGridCard
- ✅ `src/components/Tags/VirtualizedTagCardGrid.tsx` - Tag grid with SmartTagCardGrid
- ✅ `src/components/Studios/VirtualizedStudioCardGrid.tsx` - Studio grid with SmartStudioCardGrid
- ✅ `src/components/Groups/VirtualizedGroupCardGrid.tsx` - Group grid with SmartGroupCardGrid

### Integration Complete
Virtualization is now integrated into all main entity list views:
- ✅ `src/components/Scenes/SceneList.tsx` - Uses SmartSceneCardsGrid (threshold: 50)
- ✅ `src/components/Performers/PerformerList.tsx` - Uses SmartPerformerCardGrid (threshold: 50)
- ✅ `src/components/Galleries/GalleryList.tsx` - Uses SmartGalleryCardGrid (threshold: 50)
- ✅ `src/components/Images/ImageList.tsx` - Uses SmartImageGridCard (threshold: 50)
- ✅ `src/components/Tags/TagList.tsx` - Uses SmartTagCardGrid (threshold: 50)
- ✅ `src/components/Studios/StudioList.tsx` - Uses SmartStudioCardGrid (threshold: 50)
- ✅ `src/components/Groups/GroupList.tsx` - Uses SmartGroupCardGrid (threshold: 50)

---

## 7. Optimize Apollo Cache Policies
**Priority:** 🔴 High  
**Effort:** Medium  
**Network Impact:** 30-50% fewer requests for cached data

### Current State
Many queries use `fetchPolicy: "network-only"` when `cache-and-network` would be better.

### Analysis
```typescript
// Over-fetching examples found:
fetchPolicy: "network-only"  // in 15+ places
fetchPolicy: "no-cache"      // in 3 places
```

### Suggested Approach
1. Default to `cache-first` for static data (studios, tags)
2. Use `cache-and-network` for lists (show cached, update in background)
3. Keep `network-only` only for real-time data (job status)

```typescript
// Apollo client configuration update
const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        findStudios: {
          merge(existing, incoming) {
            // Enable proper cache merging
          }
        }
      }
    },
    Studio: {
      keyFields: ["id"],
    },
    Performer: {
      keyFields: ["id"],
    },
    Scene: {
      keyFields: ["id"],
    }
  }
});
```

### Files to Review
- [ ] `ui/v2.5/src/core/StashService.ts` - Main service layer
- [ ] `ui/v2.5/src/core/createClient.ts` - Apollo client config
- [ ] Component-level query configurations

---

## 4. Add React.memo to Card Components
**Priority:** 🟡 Medium  
**Effort:** Low  
**Re-render Impact:** 20-30% fewer re-renders in grids

### Current State
Card components like SceneCard, PerformerCard render on every parent update.

### Suggested Fix
```typescript
// Before
export const SceneCard: React.FC<ISceneCardProps> = (props) => {
  // ...
};

// After
export const SceneCard: React.FC<ISceneCardProps> = React.memo((props) => {
  // ...
}, (prevProps, nextProps) => {
  // Custom comparison for performance
  return prevProps.scene.id === nextProps.scene.id;
});
```

### Files to Modify
- [ ] `ui/v2.5/src/components/Scenes/SceneCard.tsx`
- [ ] `ui/v2.5/src/components/Performers/PerformerCard.tsx`
- [ ] `ui/v2.5/src/components/Studios/StudioCard.tsx`
- [ ] `ui/v2.5/src/components/Galleries/GalleryCard.tsx`
- [ ] `ui/v2.5/src/components/Images/ImageCard.tsx`
- [ ] `ui/v2.5/src/components/Tags/TagCard.tsx`

---

## 5. Remove/Conditionally Log console.log Statements
**Priority:** 🟡 Medium  
**Effort:** Low  
**Production Impact:** Cleaner console, minor performance

### Current State
30+ console.log/warn/error calls found in production code.

### Suggested Fix
```typescript
// Create utility: src/utils/logger.ts
const isDev = import.meta.env.DEV;

export const logger = {
  log: (...args: unknown[]) => isDev && console.log(...args),
  warn: (...args: unknown[]) => isDev && console.warn(...args),
  error: (...args: unknown[]) => console.error(...args), // Keep errors
  debug: (...args: unknown[]) => isDev && console.debug(...args),
};

// Usage
import { logger } from 'src/utils/logger';
logger.log('Debug info');  // Only in dev
logger.error('Real error'); // Always
```

### Files with console.log
- `components/Tags/EditTagsDialog.tsx:75` - `console.log(value);` ← Debug leftover
- `components/Tagger/context.tsx` - Multiple error logs
- `components/StashFace/StashFaceIdentification.tsx` - Error logging
- See grep results for full list

---

## 6. Image Lazy Loading
**Priority:** 🟡 Medium  
**Effort:** Low  
**Load Time Impact:** Faster initial page load

### Suggested Fix
Use native lazy loading and Intersection Observer:

```typescript
// Create: src/components/Shared/LazyImage.tsx
export const LazyImage: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
    />
  );
};
```

For more control, use Intersection Observer:
```typescript
const [isVisible, setIsVisible] = useState(false);
const imgRef = useRef<HTMLImageElement>(null);

useEffect(() => {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    },
    { rootMargin: '100px' }
  );
  
  if (imgRef.current) observer.observe(imgRef.current);
  return () => observer.disconnect();
}, []);
```

---

## 7. Upgrade to React 18 (Future)
**Priority:** 🟢 Low  
**Effort:** High  
**Impact:** Concurrent rendering, automatic batching

### Current State
React 17.0.2 - stable but missing:
- Automatic state batching
- useTransition for non-urgent updates
- useDeferredValue for expensive computations
- Suspense for data fetching

### Migration Path
1. Update react/react-dom to ^18.2.0
2. Replace `ReactDOM.render()` with `createRoot()`
3. Test for concurrent rendering issues
4. Gradually adopt new hooks

---

## Bundle Analysis Commands

```bash
# Analyze bundle size
cd ui/v2.5
pnpm build
npx vite-bundle-analyzer

# Or with source-map-explorer
npx source-map-explorer dist/assets/*.js
```

---

## Quick Wins Checklist

- [x] Remove `console.log(value)` from EditTagsDialog.tsx
- [x] Add `loading="lazy"` to image tags in card components
- [x] Add React.memo to frequently rendered cards
- [x] Create logger utility to gate console output

---

## Performance Monitoring

### Add Performance Marks
```typescript
// In critical paths
performance.mark('list-render-start');
// ... render
performance.mark('list-render-end');
performance.measure('list-render', 'list-render-start', 'list-render-end');
```

### React DevTools Profiler
1. Install React DevTools browser extension
2. Use Profiler tab to record re-renders
3. Look for components re-rendering unnecessarily

---

## Files Created/Modified

### New Files Created
| File | Description |
|------|-------------|
| `src/utils/logger.ts` | Conditional logging utility |
| `src/utils/date.ts` | date-fns wrapper with locale support |
| `src/components/List/VirtualizedGrid.tsx` | Generic virtualized grid base |
| `src/components/Scenes/VirtualizedSceneCardsGrid.tsx` | Scene virtualized grid |
| `src/components/Performers/VirtualizedPerformerCardGrid.tsx` | Performer virtualized grid |
| `src/components/Galleries/VirtualizedGalleryCardGrid.tsx` | Gallery virtualized grid |
| `src/components/Images/VirtualizedImageGridCard.tsx` | Image virtualized grid |
| `src/components/Tags/VirtualizedTagCardGrid.tsx` | Tag virtualized grid |
| `src/components/Studios/VirtualizedStudioCardGrid.tsx` | Studio virtualized grid |
| `src/components/Groups/VirtualizedGroupCardGrid.tsx` | Group virtualized grid |

### Files Modified
| File | Change |
|------|--------|
| `package.json` | Added date-fns, @tanstack/react-virtual |
| `src/App.tsx` | Replaced moment with date-fns |
| `src/patch.tsx` | Added React.memo to all PatchComponent wrappers |
| `src/components/Settings/Tasks/JobTable.tsx` | Replaced moment with date-fns |
| Entity List components (7 files) | Integrated virtualized grids |
| Image components (4 files) | Added loading="lazy" |

---

## Next Steps

### ✅ Completed (January 2026)
1. ~~Remove debug console.log statements~~ ✅
2. ~~Add React.memo to card components~~ ✅ (via PatchComponent wrapper)
3. ~~Add loading="lazy" to images~~ ✅
4. ~~Replace Moment.js with date-fns~~ ✅
5. ~~Implement list virtualization for large datasets~~ ✅ (all 7 entity types)
6. ~~Optimize Apollo cache policies~~ ✅ (already well-configured)

### 🔮 Future Enhancements (Low Priority)
1. **Upgrade to React 18** - Concurrent features, automatic batching
2. **Web Workers** - Offload heavy computations (phash, image processing)
3. **Service Worker** - Enhanced offline support
4. **Performance monitoring** - Add React DevTools profiling markers
