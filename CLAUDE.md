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
| Read any source file | `cik read <file>` (auto-skels at 60+ lines) |
| Read specific lines from a skeleton | `cik read <file> --lines N-M` |
| Force full content | `cik read <file> --full` |
| Understand a package's public API | `cik exports <path>` |
| Repo structure / orientation | `cik map` |
| Store architectural fact for future sessions | `cik learn "<fact>"` |
| Recall prior session facts | `cik recall` |

### When NOT to use cik

- **Editing a file** — `Edit`/`Write` need exact bytes in context. Use `Read` (not `cik read`) on the target file immediately before editing.
- Mutating state (git, mkdir, etc.)
- Short files < 50 lines (skel overhead not worth it)

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
