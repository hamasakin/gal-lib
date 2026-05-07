---
phase: 03-launch-playtime
plan: 03a
type: execute
wave: 1
depends_on: []
files_modified:
  - src-tauri/Cargo.toml
  - src-tauri/migrations/0003_add_launch_and_session_status.sql
  - src-tauri/src/db.rs
autonomous: true
requirements: []
must_haves:
  truths:
    - "Phase 3 所需 Rust crates (winreg, sysinfo, windows) 一次性安装"
    - "schema 迁移到 v3：games 3 新列 (le_profile, launch_args, cwd) + sessions 2 新列 (status, exit_code) + schema_version=3"
    - "cargo check + cargo test --lib 全绿；pnpm tauri dev 启动后 schema_version=3"
  artifacts:
    - path: src-tauri/Cargo.toml
      contains: "winreg"
    - path: src-tauri/migrations/0003_add_launch_and_session_status.sql
      contains: "le_profile"
    - path: src-tauri/src/db.rs
      contains: "version: 3"
---

# Plan 03a — Schema v3 + Rust Crate Lockup

## Tasks

<task name="Task 1: Cargo deps + 0003 migration + db.rs">

<read_first>
- D:\project\gal-lib\src-tauri\Cargo.toml
- D:\project\gal-lib\src-tauri\src\db.rs
- D:\project\gal-lib\.planning\phases\03-launch-playtime\03-PLAN-OUTLINE.md (Schema v3 Diff section)
</read_first>

<action>

1. **`src-tauri/Cargo.toml`** — append to `[dependencies]`:
```toml
winreg = "0.52"
sysinfo = "0.32"
windows = { version = "0.58", features = ["Win32_System_Threading", "Win32_System_ProcessStatus", "Win32_Foundation", "Win32_System_Diagnostics_ToolHelp"] }
```

2. **`src-tauri/migrations/0003_add_launch_and_session_status.sql`** (NEW) — verbatim from OUTLINE.

3. **`src-tauri/src/db.rs`** — push 3rd Migration in `migrations()`:
```rust
Migration {
    version: 3,
    description: "add_launch_and_session_status",
    sql: include_str!("../migrations/0003_add_launch_and_session_status.sql"),
    kind: MigrationKind::Up,
},
```
Add unit test `migrations_v3_adds_launch_columns_and_session_status` asserting SQL contains `le_profile` + `launch_args` + `cwd` + `status` (in CHECK constraint) + `exit_code` + `schema_version = '3'`.

4. cargo check + cargo test --lib all green.

5. Smoke: `pnpm tauri dev`, wait 15s, kill, then:
```
sqlite3 src-tauri/target/debug/data/app.db "SELECT value FROM app_meta WHERE key='schema_version'"
```
returns `3`.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
grep -q "winreg" src-tauri/Cargo.toml && \
grep -q "sysinfo" src-tauri/Cargo.toml && \
grep -q "windows.*0.58" src-tauri/Cargo.toml && \
test -f src-tauri/migrations/0003_add_launch_and_session_status.sql && \
grep -q "le_profile" src-tauri/migrations/0003_add_launch_and_session_status.sql && \
grep -q "launch_args" src-tauri/migrations/0003_add_launch_and_session_status.sql && \
grep -q "exit_code" src-tauri/migrations/0003_add_launch_and_session_status.sql && \
grep -q "schema_version = '3'" src-tauri/migrations/0003_add_launch_and_session_status.sql && \
grep -q "version: 3" src-tauri/src/db.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib && \
sqlite3 src-tauri/target/debug/data/app.db "SELECT value FROM app_meta WHERE key='schema_version'" | grep -q "^3$"
</automated>
</verify>

</task>

## Commit

`chore(03-03a): add rust crates + 0003 schema migration (launch + session status)`
