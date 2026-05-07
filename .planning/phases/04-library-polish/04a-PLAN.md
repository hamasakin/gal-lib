---
phase: 04-library-polish
plan: 04a
type: execute
wave: 1
depends_on: []
files_modified:
  - src-tauri/migrations/0004_add_brand_year_favorite.sql
  - src-tauri/src/db.rs
  - package.json
  - pnpm-lock.yaml
  - src/components/ui/textarea.tsx
  - src/components/ui/tabs.tsx
  - src/components/ui/popover.tsx
  - src/components/ui/command.tsx
autonomous: true
requirements: []
must_haves:
  truths:
    - "schema 升到 v4: games 增 3 列 (brand, release_year, is_favorite)"
    - "4 个新 shadcn blocks 安装 (textarea, tabs, popover, command)"
    - "npm 装 react-markdown + remark-gfm"
    - "cargo check + cargo test --lib 全绿"
    - "pnpm tauri dev 启动后 schema_version=4"
---

# Plan 04a — Schema v4 + shadcn blocks + npm packages

## Tasks

<task name="Task 1: schema v4 migration">

<read_first>
- D:\project\gal-lib\src-tauri\src\db.rs
- D:\project\gal-lib\.planning\phases\04-library-polish\04-PLAN-OUTLINE.md (Schema v4 Diff)
</read_first>

<action>

1. **`src-tauri/migrations/0004_add_brand_year_favorite.sql`** verbatim from OUTLINE
2. **`src-tauri/src/db.rs`** push 4th Migration version=4 description="add_brand_year_favorite"; add test `migrations_v4_adds_brand_year_favorite` asserting SQL contains `brand TEXT` + `release_year INTEGER` + `is_favorite INTEGER NOT NULL DEFAULT 0` + `schema_version = '4'`
3. cargo check + cargo test --lib green

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/migrations/0004_add_brand_year_favorite.sql && \
grep -q "is_favorite" src-tauri/migrations/0004_add_brand_year_favorite.sql && \
grep -q "release_year" src-tauri/migrations/0004_add_brand_year_favorite.sql && \
grep -q "schema_version = '4'" src-tauri/migrations/0004_add_brand_year_favorite.sql && \
grep -q "version: 4" src-tauri/src/db.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib
</automated>
</verify>

</task>

<task name="Task 2: shadcn blocks + npm packages + dev smoke for schema v4">

<action>

1. `pnpm dlx shadcn@latest add textarea tabs popover command`
2. `pnpm add react-markdown remark-gfm`
3. `pnpm typecheck` green
4. `pnpm tauri dev` smoke (kill after 15s) → `sqlite3 src-tauri/target/debug/data/app.db "SELECT value FROM app_meta WHERE key='schema_version'"` returns `4`

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/components/ui/textarea.tsx && \
test -f src/components/ui/tabs.tsx && \
test -f src/components/ui/popover.tsx && \
test -f src/components/ui/command.tsx && \
grep -q "react-markdown" package.json && \
grep -q "remark-gfm" package.json && \
pnpm typecheck && \
sqlite3 src-tauri/target/debug/data/app.db "SELECT value FROM app_meta WHERE key='schema_version'" | grep -q "^4$"
</automated>
</verify>

</task>

## Commits

- `chore(04-04a): 0004 schema migration (brand + release_year + is_favorite)`
- `chore(04-04a): install shadcn blocks (textarea, tabs, popover, command) + react-markdown`
- `chore(04-04a): verify schema v4 dev smoke`
