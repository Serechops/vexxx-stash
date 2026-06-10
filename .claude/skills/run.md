---
name: run
description: >
  Start the Stash dev server. Launches Go backend + Vite frontend
  concurrently via pnpm. Use when asked to run, start, or preview the app.
---

# Run — Stash Dev Server

Run both backend and frontend together:

```bash
cd ui/v2.5 && pnpm run dev
```

This uses `concurrently` to start:
- **Backend** — Go binary on `:9999` (rebuilt via `make server-start`)
- **Frontend** — Vite dev server on `:3000` with HMR

Open: http://localhost:3000

## Frontend only (if backend already running)

```bash
cd ui/v2.5 && pnpm run start
```

## Common checks before running

```bash
cd ui/v2.5 && pnpm run check    # TypeScript errors
cd ui/v2.5 && pnpm run validate  # lint + format
```
