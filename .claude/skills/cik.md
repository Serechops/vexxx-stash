---
name: cik
description: >
  Token-frugal repo ingestion workflow using the `cik` CLI. Use when orienting
  in a new repo, looking up symbol definitions, finding callers, or reading
  large source files. Cuts context cost 60-90% vs raw Read/Grep.
---

# cik — Context Is Key

Prefer `cik` over raw `Read`/`Grep` for code exploration. These tools answer
in tens of tokens; grep fan-outs and full-file reads cost thousands.

## Recommended workflow

### 1. Orient (once per session)
```
cik map [root] [--budget 2000]
```
Budget-capped annotated file tree with key symbols and import-rank. Injected
automatically at session start if the SessionStart hook is wired. Call
`cik map --fresh` after significant file changes.

### 2. Find definitions (replaces grep for "where is X defined?")
```
cik def <name>          # exact match
cik def <name> --fuzzy  # FTS5 prefix search
```
Returns `file:line  kind  name  (exported?)` — ~10 tokens per result.
Build the index first if you haven't: `cik index`.

### 3. Find usages / callers
```
cik refs    <name>            # all files that reference the name
cik refs    <name> --callers  # callers only (excludes defining files)
```

### 4. Read a large file cheaply — skeleton view
```
cik skel <file>
```
Keeps imports, signatures, types, doc comments. Elides function bodies,
replacing them with `… N lines (start-end)` markers. A 2,000-line file
becomes ~200-400 lines. Then use `Read` with `offset`/`limit` to fetch
only the body lines you actually need.

### 5. List public API
```
cik exports [root] [-k fn|class|type|iface|struct|enum]
```

### 6. Check coverage
```
cik stats [root]   # files/symbols/refs in the index
cik languages      # supported file types
```

### 7. Recall durable facts (session knowledge)
```
cik recall [query] [--root .]   # FTS5 search or list recent facts
cik learn "<fact>" [--root .]   # store a fact with provenance
cik forget <id>                 # delete by ID shown in recall output
```
Facts are injected automatically at session start. Stale entries are flagged
when the source file changes. Be specific — include symbol names and file paths.

### 8. Directory summaries
```
cik summarize [root]   # generate per-dir summaries via Claude (needs API key)
cik dirs [--root .]    # list stored summaries
```
Summaries are content-hash cached; only changed directories are re-summarized.
Injected at session start alongside the repo map.

## Decision guide

| Goal | Use |
|---|---|
| Understand repo structure | `cik map` |
| "Where is `processPayment` defined?" | `cik def processPayment` |
| "What calls `validateToken`?" | `cik refs validateToken --callers` |
| Read a 1,000-line file for one function | `cik skel file.ts`, then `Read file.ts offset=N limit=M` |
| Read a 50-line file | `Read` directly — `cik skel` adds no value |
| Search by approximate name | `cik def partial --fuzzy` |
| First session in repo | `cik index && cik map` |
| Remember an architectural fact | `cik learn "fact" --file src/auth.ts` |
| What did I learn last session? | `cik recall` |
| What does src/payments/ do? | `cik dirs` or `cik summarize` |

## Setup

```sh
# In your project:
npm install context-is-key
npx cik install          # adds hooks to .claude/settings.json
npx cik index            # build symbol index
```

`cik install` wires the SessionStart hook (auto-injects `cik map`) and the
PreToolUse hook (warns before reading large files).
