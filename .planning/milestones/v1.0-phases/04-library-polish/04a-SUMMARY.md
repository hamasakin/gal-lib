---
phase: 04-library-polish
plan: 04a
subsystem: db-and-tooling
tags: [schema, migration, shadcn, npm, lockup]
requires: [phase-03 schema v3]
provides:
  - schema-v4
  - shadcn-textarea
  - shadcn-tabs
  - shadcn-popover
  - shadcn-command
  - shadcn-input-group
  - react-markdown
  - remark-gfm
affects: [04b, 04c, 04d, 04e, 04f]
tech-stack:
  added: [react-markdown@^10.1.0, remark-gfm@^4.0.1]
  patterns:
    - "embedded include_str! migration registry (rusqlite/sqlx-driven)"
    - "shadcn CLI block-add (one-shot)"
key-files:
  created:
    - src-tauri/migrations/0004_add_brand_year_favorite.sql
    - src/components/ui/textarea.tsx
    - src/components/ui/tabs.tsx
    - src/components/ui/popover.tsx
    - src/components/ui/command.tsx
    - src/components/ui/input-group.tsx
  modified:
    - src-tauri/src/db.rs
    - package.json
    - pnpm-lock.yaml
decisions:
  - "schema_version v4 test assertion uses split-contains (`'schema_version'` AND `''4''`) — same shape as v2/v3 tests; PLAN.md's literal `schema_version = '4'` string never appears in OUTLINE SQL (which uses `WHERE key = 'schema_version'`)."
  - "shadcn add invoked with `printf 'n\\n…' | …` to default-skip overwrites; popover/tabs/textarea were already on disk from Phase 3 but untracked, now committed alongside command + input-group."
metrics:
  duration_minutes: ~15
  completed_at: 2026-05-07T15:15:14Z
  commits: 3
  files_created: 6
  files_modified: 3
  cargo_tests_passed: 37
---

# Phase 4 Plan 04a: Schema v4 + shadcn blocks + npm packages Summary

**One-liner:** Phase-4 lockup — SQLite migration 0004 adds `brand` / `release_year` / `is_favorite` to `games` (schema_version → 4), plus 4 new shadcn UI primitives (textarea, tabs, popover, command — pulling input-group transitively) and react-markdown + remark-gfm npm deps for downstream Detail/Library/Settings polish plans (04b–04f).

## Tasks Completed

### Task 1 — schema v4 migration  (commit `e306861`)

- **`src-tauri/migrations/0004_add_brand_year_favorite.sql`** — verbatim per OUTLINE Schema-v4-Diff:
  ```sql
  ALTER TABLE games ADD COLUMN brand TEXT;
  ALTER TABLE games ADD COLUMN release_year INTEGER;
  ALTER TABLE games ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
  UPDATE app_meta SET value = '4' WHERE key = 'schema_version';
  ```
- **`src-tauri/src/db.rs`** — registered the V4 Migration entry (`description: "add_brand_year_favorite"`) via `include_str!`. New `migrations_v4_adds_brand_year_favorite` test pins exact `len == 4`, `ADD COLUMN` count == 3, presence of all 3 column declarations, and `schema_version` bump. Loosened `migrations_v3_…` from `assert_eq!(len, 3)` to `assert!(len >= 3)` so adding v4 doesn't retroactively break it.
- `cargo check --manifest-path src-tauri/Cargo.toml` — clean (4 pre-existing dead-code warnings in `metadata`, `ingest`, `launch::orchestrator` — unrelated to this plan).
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` — **37 passed / 0 failed** (prior 36 + 1 new v4 test).

### Task 2a — shadcn blocks + npm packages  (commit `e92560c`)

- `pnpm dlx shadcn@latest add textarea tabs popover command` (with `printf 'n\\n…'` stdin for default-skip on overwrite prompts):
  - Created: `command.tsx` + `input-group.tsx` (input-group is command's composite dep — it ships the search-style header that Command uses).
  - Skipped (already on disk from Phase 3, identical content): `textarea.tsx`, `tabs.tsx`, `popover.tsx`, `dialog.tsx`, `button.tsx`, `input.tsx`. The first three were P3-untracked → now committed in this commit.
- `pnpm add react-markdown remark-gfm` → `react-markdown ^10.1.0` + `remark-gfm ^4.0.1` in `dependencies`.
- `pnpm typecheck` — clean (no errors).

### Task 2b — dev smoke for schema v4  (folded into final docs commit)

- Started `pnpm tauri dev` from a clean `src-tauri/target/debug/data/app.db` at schema_version=3.
- After full Rust rebuild + Vite dev-server-ready (Vite ready in 567 ms; `gal-lib.exe` running with portable data_dir resolved), killed the process tree.
- `sqlite3 src-tauri/target/debug/data/app.db "SELECT value FROM app_meta WHERE key='schema_version'"` → **`4`** ✓
- Migration applied cleanly with no errors in the Tauri startup log; existing rows preserved (additive ADD COLUMN, idempotent on UPDATE).

## Plan Verify (Plan 04a `<verify>` blocks)

### Task 1 verify

| Check                                                    | Status |
|----------------------------------------------------------|--------|
| `migrations/0004_add_brand_year_favorite.sql` exists     | ✓      |
| sql contains `is_favorite`                               | ✓      |
| sql contains `release_year`                              | ✓      |
| sql bumps `schema_version` → `'4'`                       | ✓ (split-grep; see Deviation 1 below) |
| `db.rs` registers `version: 4`                           | ✓      |
| `cargo check`                                            | ✓      |
| `cargo test --lib` (37 passed)                           | ✓      |

### Task 2 verify

| Check                                                    | Status |
|----------------------------------------------------------|--------|
| `src/components/ui/textarea.tsx` exists                  | ✓      |
| `src/components/ui/tabs.tsx` exists                      | ✓      |
| `src/components/ui/popover.tsx` exists                   | ✓      |
| `src/components/ui/command.tsx` exists                   | ✓      |
| `react-markdown` in `package.json`                       | ✓      |
| `remark-gfm` in `package.json`                           | ✓      |
| `pnpm typecheck`                                         | ✓      |
| dev db `schema_version=4` after `tauri dev` smoke        | ✓      |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] v4 test assertion mismatch with OUTLINE SQL form**

- **Found during:** Task 1 — first `cargo test --lib` run.
- **Issue:** PLAN.md instructed the test to assert the literal substring `schema_version = '4'`. But OUTLINE Schema-v4-Diff uses `UPDATE app_meta SET value = '4' WHERE key = 'schema_version'`, where the comparison is `key = 'schema_version'` and the new value is `'4'` — those two never appear concatenated as `schema_version = '4'`. Test panicked: `v4 sql bumps schema_version to '4'`.
- **Fix:** Adopted the same split-contains pattern v2 and v3 tests already use:
  ```rust
  assert!(m4.sql.contains("schema_version") && m4.sql.contains("'4'"), …);
  ```
- **Files modified:** `src-tauri/src/db.rs` (single-line change inside the new test).
- **Commit:** `e306861` (the fix lived inside the same commit that introduced the new test — it would have been pointless to commit a known-failing test).
- **Note:** Plan's `<verify><automated>` block has the identical literal-string `grep -q "schema_version = '4'"` pitfall. I ran the equivalent split-grep (`grep -q "schema_version"` AND `grep -q "'4'"`) which passed. No SQL change was needed — only the assertion phrasing.

**2. [Rule 3 — Blocking] shadcn CLI overwrite prompt (`dialog.tsx already exists`)**

- **Found during:** Task 2 first invocation of `pnpm dlx shadcn@latest add textarea tabs popover command`.
- **Issue:** `command` block transitively pulls `dialog`, which already exists in `src/components/ui/dialog.tsx` from earlier phases. shadcn CLI prompted interactively `Would you like to overwrite? (y/N)` and blocked. `--yes` does NOT auto-answer overwrite prompts (the flag only skips component-selection confirmations).
- **Fix:** Re-invoked with `printf 'n\nn\nn\nn\nn\n' | pnpm dlx …` to feed default-N answers via stdin. Result: skipped 6 already-present files, created `command.tsx` + `input-group.tsx`. No existing component was overwritten.
- **Files modified:** none beyond plan intent — just an invocation strategy.
- **Commit:** folded into `e92560c`.

**3. [Rule 2 — Missing] `input-group.tsx` not declared in plan `files_modified`**

- **Found during:** Task 2 — shadcn output reported `Created 2 files: command.tsx + input-group.tsx`.
- **Issue:** `command` block now ships as a Command + InputGroup composite (shadcn upstream change). `input-group.tsx` is a hard dependency of `command.tsx`. PLAN.md only listed `command.tsx`.
- **Fix:** Added `input-group.tsx` to the same Task 2 commit (`e92560c`) and to this SUMMARY's `key-files.created`. No code in this plan consumes it — it just sits ready for downstream plans (04e Detail tag picker is the likely consumer via `<Command>`).

## Authentication Gates

None.

## Tech Stack Additions

| Package         | Version     | Purpose                                                   |
|-----------------|-------------|-----------------------------------------------------------|
| react-markdown  | ^10.1.0     | Render markdown in 04e Detail page notes preview          |
| remark-gfm      | ^4.0.1      | GFM extensions (tables, task-lists, strikethrough)        |

| Component (UI)  | Source       | Likely consumer                                           |
|-----------------|--------------|-----------------------------------------------------------|
| textarea        | shadcn       | 04e Detail notes editor; 04f Settings tag form            |
| tabs            | shadcn       | 04e Detail page section switcher                          |
| popover         | shadcn       | 04d sidebar filter pickers; 04e tag combobox shell        |
| command         | shadcn       | 04e Detail tag picker (combobox / fuzzy-select)           |
| input-group     | shadcn (transitive) | shadcn `command` internal — ready for downstream  |

## Schema v4 Diff (applied)

```sql
ALTER TABLE games ADD COLUMN brand TEXT;
ALTER TABLE games ADD COLUMN release_year INTEGER;
ALTER TABLE games ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
UPDATE app_meta SET value = '4' WHERE key = 'schema_version';
```

- All adds are additive (SQLite < 3.25 ALTER TABLE constraint respected).
- `is_favorite` defaults to 0 → safe for pre-existing rows on upgrade from v3.
- `brand` / `release_year` are nullable → backfill is 04b's job (search/sidebar work).

## Decisions Made

1. **Test assertion form** matches v2/v3 split-contains pattern, not the literal-string variant in PLAN/verify scripts (see Deviation 1).
2. **Default-skip on shadcn overwrite prompts** — never overwrite an existing UI primitive in this plan; downstream plans can do targeted overrides if needed.
3. **input-group.tsx committed alongside command.tsx** — it's a transitive shadcn dep, treating it like a vendored asset (committed, tracked, not generated at install time).

## Known Stubs

None — this plan only ships infrastructure (migration + UI primitives + npm deps); no rendering paths or mock data introduced.

## Threat Flags

None — schema additions are scoped to `games` (already-trusted local-only table), no new endpoints, no new auth surface, no new file-access pattern.

## Deferred Items

- **D-04a-1 (vite/postcss @import order warning)** — pre-existing P1/P3 carryover; logged in `.planning/phases/04-library-polish/deferred-items.md`. Not introduced by 04a.

## Self-Check: PASSED

Verified:
- `src-tauri/migrations/0004_add_brand_year_favorite.sql` — FOUND
- `src-tauri/src/db.rs` v4 registration — FOUND
- `src/components/ui/{textarea,tabs,popover,command,input-group}.tsx` — all FOUND
- `package.json` contains `react-markdown` + `remark-gfm` — FOUND
- Commit `e306861` (schema v4 migration) — FOUND in `git log`
- Commit `e92560c` (shadcn blocks + npm) — FOUND in `git log`
- Live dev `schema_version=4` — confirmed via `sqlite3` query
