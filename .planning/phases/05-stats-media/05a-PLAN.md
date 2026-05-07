---
phase: 05-stats-media
plan: 05a
type: execute
wave: 1
depends_on: []
files_modified:
  - src-tauri/Cargo.toml
  - src-tauri/migrations/0005_add_screenshots_and_saves.sql
  - src-tauri/src/db.rs
  - package.json
  - pnpm-lock.yaml
autonomous: true
requirements: []
must_haves:
  truths:
    - "schema 升到 v5: games 增 screenshot_interval_sec + save_path; 新建 screenshots 表 + save_backups 表 + 2 索引"
    - "Rust crates: screenshots = 0.8, png = 0.17"
    - "npm: recharts ^2.12"
    - "cargo check + cargo test --lib 全绿；pnpm typecheck 全绿"
    - "pnpm tauri dev 后 schema_version=5"
---

# Plan 05a — Schema v5 + crates + recharts

## Tasks

<task name="Task 1: schema v5 + Cargo deps + recharts">

<read_first>
- D:\project\gal-lib\src-tauri\Cargo.toml
- D:\project\gal-lib\src-tauri\src\db.rs
- D:\project\gal-lib\.planning\phases\05-stats-media\05-PLAN-OUTLINE.md (Schema v5 Diff)
</read_first>

<action>

1. **`src-tauri/Cargo.toml`** append:
```toml
screenshots = "0.8"
png = "0.17"
```

2. **`src-tauri/migrations/0005_add_screenshots_and_saves.sql`** verbatim from OUTLINE.

3. **`src-tauri/src/db.rs`** push 5th Migration version=5 description="add_screenshots_and_saves"; add test `migrations_v5_adds_screenshots_and_saves` asserting SQL contains `CREATE TABLE screenshots` + `CREATE TABLE save_backups` + `screenshot_interval_sec` + `save_path` + `schema_version = '5'`.

4. **`package.json`** — `pnpm add recharts`.

5. cargo check + cargo test --lib green; pnpm typecheck green.

6. Smoke: `pnpm tauri dev`, kill after 15s, verify schema_version=5.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
grep -q "screenshots.*0.8" src-tauri/Cargo.toml && \
grep -q "^png" src-tauri/Cargo.toml && \
test -f src-tauri/migrations/0005_add_screenshots_and_saves.sql && \
grep -q "CREATE TABLE screenshots" src-tauri/migrations/0005_add_screenshots_and_saves.sql && \
grep -q "CREATE TABLE save_backups" src-tauri/migrations/0005_add_screenshots_and_saves.sql && \
grep -q "schema_version = '5'" src-tauri/migrations/0005_add_screenshots_and_saves.sql && \
grep -q "version: 5" src-tauri/src/db.rs && \
grep -q "recharts" package.json && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib && \
pnpm typecheck && \
sqlite3 src-tauri/target/debug/data/app.db "SELECT value FROM app_meta WHERE key='schema_version'" | grep -q "^5$"
</automated>
</verify>

</task>

## Commit

`chore(05-05a): schema v5 (screenshots + saves) + crates (screenshots, png) + recharts`
