# Stash (Vexxx Fork) — Claude Instructions

## Stack

| Layer | Location | Tech |
|---|---|---|
| Backend | `pkg/`, `internal/` | Go |
| Frontend | `ui/v2.5/src/` | TypeScript + React |
| Database | `pkg/sqlite/` | SQLite |
| API | `internal/api/` | GraphQL (gqlgen) |

## Dev Commands

```bash
# Start both backend + frontend (preferred)
cd ui/v2.5 && pnpm run dev

# Frontend only (Vite on :3000)
cd ui/v2.5 && pnpm run start

# Type check
cd ui/v2.5 && pnpm run check

# Lint + format check
cd ui/v2.5 && pnpm run validate

# Go tests
go test ./...

# Go build
make stash
```

## Frontend Conventions

**MUI vs Tailwind** — both are in use. Rule:
- MUI `Box`/`Typography`/`IconButton` etc. for structural layout that needs theme tokens (`theme.palette`, `sx` prop)
- Tailwind classes for custom components that own their full visual style (e.g. `HeroBanner`, `CinemaCard`)
- Don't mix both styling systems within a single component

**PatchComponent** — wraps top-level page and card components to allow plugin patching. Use it for any new page or card component. Don't use inside utility/shared components.

**UI preferences (non-GQL state)** — stored via `useInterfaceLocalForage`. Fields not in the GQL schema are accessed as `(data as any)?.yourKey` with `@ts-ignore` where needed. This is consistent with the existing pattern — don't fight it.

**Settings UI** — use `SelectSetting` / `BooleanSetting` from `src/components/Settings/Inputs.tsx`. Always pass `headingID` pointing to a valid key in `src/locales/en-GB.json` — raw strings silently fail.

**Scene card themes** — selectable via `sceneCardTheme` in localForage (`"overlay"` | `"flip"` | `"stashdb"` | `"cinema"`). New card variants: add component, import in `SceneCard.tsx`, add `if (theme === "yourkey")` case, add `<option>` in `SettingsInterfacePanel.tsx`, add locale key.

## This Is a Fork

Custom components and features are added alongside upstream code. Prefer extending over modifying upstream files where possible so merging upstream changes stays tractable.

## Context Management

After each discrete task completes, proactively suggest `/compact` if the conversation is getting long. Be aggressive: suggest it after any task that involved reading multiple files, a build/test cycle, or more than ~10 tool calls. Don't wait until context is already bloated — suggest early and often. When switching to a completely different area of the codebase, suggest `/clear` instead.
