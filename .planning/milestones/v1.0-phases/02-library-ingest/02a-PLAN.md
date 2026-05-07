---
phase: 02-library-ingest
plan: 02a
type: execute
wave: 1
depends_on: []
files_modified:
  - src-tauri/Cargo.toml
  - src-tauri/migrations/0002_add_scan_and_metadata.sql
  - src-tauri/src/db.rs
  - src-tauri/capabilities/default.json
  - package.json
  - pnpm-lock.yaml
  - src/components/ui/progress.tsx
  - src/components/ui/select.tsx
  - src/components/ui/dialog.tsx
  - src/components/ui/input.tsx
  - src/components/ui/toggle-group.tsx
  - src/components/ui/dropdown-menu.tsx
  - src/components/ui/badge.tsx
  - src/components/ui/alert-dialog.tsx
  - src/components/ui/sonner.tsx
autonomous: true
requirements: []
must_haves:
  truths:
    - "Phase 2 所需的全部 Rust crates、npm packages、Tauri capabilities、shadcn blocks 一次性就位"
    - "schema 迁移到 v2: scan_roots 表新建 + games 4 列 + app_meta.schema_version=2"
    - "cargo check 退出 0、pnpm typecheck 退出 0、pnpm tauri dev 启动后 schema_version=2 验证"
  artifacts:
    - path: src-tauri/Cargo.toml
      contains: "reqwest"
    - path: src-tauri/migrations/0002_add_scan_and_metadata.sql
      contains: "CREATE TABLE scan_roots"
    - path: src-tauri/src/db.rs
      contains: "version: 2"
    - path: package.json
      contains: "@tanstack/react-virtual"
    - path: src-tauri/capabilities/default.json
      contains: "dialog:default"
---

# Plan 02a — Schema v2 + Dependency Lockup

## Objective

为 Phase 2 一次性铺设全部 Rust crate / npm package / Tauri capability / shadcn block / DB schema 升级；后续 plan 直接消费、不再回头改 deps。

## Context

- Phase 1 (01a-01f) 全部完成；当前 schema_version=1
- 02-CONTEXT.md 已锁定全部技术决策；02-UI-SPEC.md 已锁定 9 个新 shadcn block 清单
- 本 plan 是 Wave 1 唯一 plan，零依赖，零文件冲突

## Tasks

<task name="Task 1: Rust crates + Tauri capabilities + 0002 migration + db.rs">

<read_first>
- D:\project\gal-lib\src-tauri\Cargo.toml
- D:\project\gal-lib\src-tauri\src\db.rs
- D:\project\gal-lib\src-tauri\capabilities\default.json
- D:\project\gal-lib\.planning\phases\02-library-ingest\02-CONTEXT.md
- D:\project\gal-lib\.planning\phases\02-library-ingest\02-PLAN-OUTLINE.md (Schema v2 Diff section)
</read_first>

<action>

1. **`src-tauri/Cargo.toml`** — 在 `[dependencies]` 段（保留 Phase 1 已有的 tauri/serde/serde_json/tauri-plugin-sql/dunce/anyhow/thiserror）追加：
```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "json", "stream"] }
walkdir = "2"
regex = "1"
governor = "0.6"
tokio = { version = "1", features = ["full"] }
image = { version = "0.25", default-features = false, features = ["jpeg", "png", "webp"] }
tauri-plugin-dialog = "2"
tauri-plugin-http = "2"
once_cell = "1"
futures-util = "0.3"
```

2. **`src-tauri/capabilities/default.json`** — 在 `permissions` 数组追加（保留 Phase 1 已有的 core:default + sql:* + core:window:*）：
```json
"dialog:default",
"dialog:allow-open",
"http:default"
```

3. **`src-tauri/migrations/0002_add_scan_and_metadata.sql`** (NEW) — verbatim：
```sql
CREATE TABLE scan_roots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  depth INTEGER NOT NULL DEFAULT 1 CHECK(depth IN (1, 2, 3)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE games ADD COLUMN cover_url TEXT;
ALTER TABLE games ADD COLUMN metadata_source TEXT;
ALTER TABLE games ADD COLUMN match_confidence INTEGER;
ALTER TABLE games ADD COLUMN last_scanned_at TEXT;

UPDATE app_meta SET value = '2' WHERE key = 'schema_version';
```

4. **`src-tauri/src/db.rs`** — 在 `migrations()` 返回的 Vec 末尾 push 第二个 Migration：
```rust
pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init_schema",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_scan_roots_and_metadata_columns",
            sql: include_str!("../migrations/0002_add_scan_and_metadata.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
```
保留现有 `tests::migrations_v1_includes_required_objects`；新增测试 `migrations_v2_adds_scan_roots_and_columns` 断言 SQL 含 `CREATE TABLE scan_roots` + 4 个 `ADD COLUMN` + schema_version='2'。

5. 跑：
```
cd D:\project\gal-lib
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
```
两者退出 0。

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
grep -q "reqwest" src-tauri/Cargo.toml && \
grep -q "walkdir" src-tauri/Cargo.toml && \
grep -q "governor" src-tauri/Cargo.toml && \
grep -q "tauri-plugin-dialog" src-tauri/Cargo.toml && \
grep -q "tauri-plugin-http" src-tauri/Cargo.toml && \
grep -q "dialog:default" src-tauri/capabilities/default.json && \
grep -q "http:default" src-tauri/capabilities/default.json && \
test -f src-tauri/migrations/0002_add_scan_and_metadata.sql && \
grep -q "CREATE TABLE scan_roots" src-tauri/migrations/0002_add_scan_and_metadata.sql && \
grep -c "ADD COLUMN" src-tauri/migrations/0002_add_scan_and_metadata.sql | grep -q "^4$" && \
grep -q "schema_version = '2'" src-tauri/migrations/0002_add_scan_and_metadata.sql && \
grep -q "version: 2" src-tauri/src/db.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib
</automated>
</verify>

</task>

<task name="Task 2: npm packages + Tauri plugin client wiring + 9 shadcn blocks">

<read_first>
- D:\project\gal-lib\package.json
- D:\project\gal-lib\src\main.tsx
- D:\project\gal-lib\components.json
</read_first>

<action>

1. **shadcn blocks** — 跑：
```
cd D:\project\gal-lib
pnpm dlx shadcn@latest add progress select dialog input toggle-group dropdown-menu badge alert-dialog sonner
```
（应 prompt 全部 default；如 init 不再问就直接装）

2. **npm 直接 add** — 跑：
```
pnpm add @tanstack/react-virtual @tauri-apps/plugin-dialog @tauri-apps/plugin-http
```

3. **`src/main.tsx`** — 在顶部追加 Sonner Toaster mount（在 `<RouterProvider>` 旁；`Toaster` 是无源元素需挂在 root 才能被 sonner 调用消费）。修改 main.tsx 的 render 块为：
```tsx
import { Toaster } from "@/components/ui/sonner";
// ...
createRoot(rootEl).render(
  <>
    <RouterProvider router={router} />
    <Toaster richColors position="top-right" />
  </>
);
```

4. **`src-tauri/src/lib.rs`** — **不在本 plan 改**（02d 一次性写入 commands + plugins）。本 plan 仅追加注释占位，确保 02d 能找到 anchor：在 `tauri::Builder::default()` 之前加注释 `// 02d 在此追加 .plugin(tauri_plugin_dialog::init()) .plugin(tauri_plugin_http::init())`

5. 跑：
```
pnpm typecheck
```
退出 0。

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/components/ui/progress.tsx && \
test -f src/components/ui/select.tsx && \
test -f src/components/ui/dialog.tsx && \
test -f src/components/ui/input.tsx && \
test -f src/components/ui/toggle-group.tsx && \
test -f src/components/ui/dropdown-menu.tsx && \
test -f src/components/ui/badge.tsx && \
test -f src/components/ui/alert-dialog.tsx && \
test -f src/components/ui/sonner.tsx && \
grep -q "@tanstack/react-virtual" package.json && \
grep -q "@tauri-apps/plugin-dialog" package.json && \
grep -q "@tauri-apps/plugin-http" package.json && \
grep -q "Toaster" src/main.tsx && \
pnpm typecheck
</automated>
</verify>

</task>

<task name="Task 3: dev smoke — pnpm tauri dev 启动后 app.db schema_version=2">

<read_first>
- D:\project\gal-lib\src-tauri\target\debug\data\app.db (existing — should auto-migrate to v2 on next launch)
</read_first>

<action>

1. 跑：
```
cd D:\project\gal-lib
pnpm tauri dev
```
后台启动，等 ~15s 让 sqlx Migrator 应用 0002 migration。

2. 校验：
```
sqlite3 src-tauri/target/debug/data/app.db "SELECT value FROM app_meta WHERE key='schema_version'"
```
应返回 `2`。

3. 校验 scan_roots 表存在：
```
sqlite3 src-tauri/target/debug/data/app.db ".tables"
```
应含 `scan_roots`（在 Phase 1 的 5 业务表 + sqlx 元表基础上）。

4. 校验 games 表新列：
```
sqlite3 src-tauri/target/debug/data/app.db ".schema games"
```
应含 `cover_url TEXT` / `metadata_source TEXT` / `match_confidence INTEGER` / `last_scanned_at TEXT`。

5. Kill the dev process。

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
sqlite3 src-tauri/target/debug/data/app.db "SELECT value FROM app_meta WHERE key='schema_version'" | grep -q "^2$" && \
sqlite3 src-tauri/target/debug/data/app.db ".tables" | grep -q "scan_roots" && \
sqlite3 src-tauri/target/debug/data/app.db ".schema games" | grep -q "cover_url" && \
sqlite3 src-tauri/target/debug/data/app.db ".schema games" | grep -q "metadata_source" && \
sqlite3 src-tauri/target/debug/data/app.db ".schema games" | grep -q "match_confidence" && \
sqlite3 src-tauri/target/debug/data/app.db ".schema games" | grep -q "last_scanned_at"
</automated>
</verify>

</task>

## Commit Protocol

3 atomic commits:
- `chore(02-02a): add rust crates + capabilities + 0002 schema migration`
- `chore(02-02a): install shadcn blocks + tanstack-virtual + tauri plugin npm`
- `feat(02-02a): verify schema v2 dev smoke (schema_version=2)`

## Success

✅ schema_version=2 / scan_roots 表存在 / games 4 新列 / Rust 全部 crate 安装 / 9 shadcn block 文件 / npm 全部包 / tsc + cargo check 双绿。
