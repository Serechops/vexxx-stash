# Stash — Claude Working Instructions

## Code Exploration: Use `cik` First

This repo has 1500+ files. Use `cik` for all code exploration — it cuts context 60–90% vs raw Read/Grep.

### Decision rules

| Goal | Tool |
|---|---|
| Find where symbol is defined | `cik def <name>` |
| Approximate / partial name | `cik def <name> --fuzzy` |
| What calls a function | `cik refs <name> --callers` |
| All usages across repo | `cik refs <name>` |
| Read a file > ~100 lines | `cik skel <file>`, then `Read` only needed bodies |
| Read a file < ~50 lines | `Read` directly |
| Understand a package's public API | `cik exports <path>` |
| Repo structure / orientation | `cik map` |
| Store architectural fact for future sessions | `cik learn "<fact>"` |
| Recall prior session facts | `cik recall` |

### When NOT to use cik

- Editing a file (Edit/Write need exact bytes in context — `Read` the target first)
- Short files < 50 lines (skel overhead not worth it)
- Mutating state (git, mkdir, etc.)

### Workflow pattern for any non-trivial task

1. `cik def` / `cik refs` to locate relevant symbols (~10 tokens each)
2. `cik skel` on large files to get signatures
3. `Read` with `offset`/`limit` only on the specific body sections needed
4. Edit/Write as normal

## Stack

- Backend: Go (`pkg/`, `internal/`)
- Frontend: TypeScript/React (`ui/v2.5/src/`)
- DB layer: SQLite (`pkg/sqlite/`)
- GraphQL API (`internal/api/`)
