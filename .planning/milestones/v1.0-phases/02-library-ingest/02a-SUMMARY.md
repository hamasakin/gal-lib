---
phase: 02-library-ingest
plan: 02a
subsystem: foundation
tags: [schema-migration, dependencies, lockup]
requires: [01-foundation]
provides:
  - schema_v2_db
  - rust_crate_lockup
  - npm_lockup
  - shadcn_block_lockup
  - tauri_plugin_dialog_capability
  - tauri_plugin_http_capability
affects:
  - src-tauri/Cargo.toml
  - src-tauri/Cargo.lock
  - src-tauri/migrations/0002_add_scan_and_metadata.sql
  - src-tauri/src/db.rs
  - src-tauri/src/lib.rs
  - src-tauri/capabilities/default.json
  - package.json
  - pnpm-lock.yaml
  - src/components/ui/*
  - src/main.tsx
tech-stack:
  added:
    - reqwest 0.12 (rustls + json + stream)
    - walkdir 2
    - regex 1
    - governor 0.6 (token-bucket rate limiter)
    - tokio 1 (full)
    - image 0.25 (jpeg/png/webp)
    - tauri-plugin-dialog 2
    - tauri-plugin-http 2
    - once_cell 1
    - futures-util 0.3
    - "@tanstack/react-virtual"
    - "@tauri-apps/plugin-dialog"
    - "@tauri-apps/plugin-http"
    - "shadcn blocks: progress / select / dialog / input / toggle-group / dropdown-menu / badge / alert-dialog / sonner"
  patterns:
    - migration-runner-extension (push v2 Migration into existing Vec)
    - capabilities-additive (append, never replace)
    - lockup-wave-1 (zero file conflict for waves 2-6)
key-files:
  created:
    - src-tauri/migrations/0002_add_scan_and_metadata.sql
  modified:
    - src-tauri/Cargo.toml
    - src-tauri/Cargo.lock
    - src-tauri/src/db.rs
    - src-tauri/src/lib.rs
    - src-tauri/capabilities/default.json
decisions:
  - "0002 migration: CREATE TABLE scan_roots (3-level depth check) + 4 ALTER TABLE games + UPDATE schema_version='2'"
  - "Anchor comment in lib.rs for 02d plugin registration (no functional change in 02a)"
  - "Both v1 and v2 migration tests retained (4 lib tests passing)"
metrics:
  start: 2026-05-07
  duration: ~25min (incl. ~18s Rust full crate compile + ~10s dev launch + sqlite3 verifies)
  completed: 2026-05-07
  commits: 3
  files_changed: 18
  rust_tests: 4 passed (3 retained + 1 new)
---

# Phase 2 Plan 02a: Schema v2 + Dependency Lockup Summary

**One-liner:** 一次性铺设 Phase 2 全部 Rust crates / npm packages / Tauri capabilities / 9 shadcn blocks / DB schema v2 迁移；Wave 2-6 plan 直接消费、零文件冲突。

## Tasks Completed

### Task 1: Rust crates + Tauri capabilities + 0002 migration + db.rs (commit `ea92e69`)

- `src-tauri/Cargo.toml` — 追加 10 个 Phase 2 crates: `reqwest` (rustls + json + stream)、`walkdir`、`regex`、`governor`、`tokio` (full)、`image` (jpeg/png/webp)、`tauri-plugin-dialog`、`tauri-plugin-http`、`once_cell`、`futures-util`
- `src-tauri/capabilities/default.json` — 追加 `dialog:default`、`dialog:allow-open`、`http:default` 三项权限（保留 Phase 1 的 core/sql/window 全部权限）
- `src-tauri/migrations/0002_add_scan_and_metadata.sql` (NEW) — 严格按 02-PLAN-OUTLINE.md Schema v2 Diff 写入：`CREATE TABLE scan_roots`（id PK、path UNIQUE、depth CHECK in (1,2,3)、created_at default now）+ 4 个 `ALTER TABLE games ADD COLUMN`（cover_url / metadata_source / match_confidence / last_scanned_at）+ `UPDATE app_meta SET value='2'`
- `src-tauri/src/db.rs` — 在 `migrations()` Vec 中 push 第二个 Migration（version: 2, description: "add_scan_roots_and_metadata_columns"），用 `include_str!` 编译期内嵌 SQL；新增测试 `migrations_v2_adds_scan_roots_and_columns` 断言：CREATE TABLE scan_roots 存在 + 恰 4 个 ADD COLUMN + 4 列名出现 + schema_version='2'。原 v1 测试保持兼容（断言 v1 存在而非数量为 1）。
- `src-tauri/src/lib.rs` — 在 `tauri::Builder::default()` 之前追加注释 `// 02d 在此追加 .plugin(tauri_plugin_dialog::init()) .plugin(tauri_plugin_http::init())`（仅 anchor，零功能变化；02d 会以此为锚点插入插件注册）
- 验证：
  - `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0（17.54s；首次拉取并编译 reqwest/sqlx/tokio/image/governor 全栈）
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib` → exit 0；4 passed (data_dir build_db_url + ensure_creates_subdirs + db migrations_v1 + db migrations_v2)

### Task 2: npm packages + Tauri plugin client wiring + 9 shadcn blocks (commit `000c668`)

- `pnpm dlx shadcn@latest add progress select dialog input toggle-group dropdown-menu badge alert-dialog sonner` → 10 个 ui 文件创建（9 个目标 + 1 个级联依赖 `toggle.tsx`，toggle-group 在 shadcn registry 中显式 require toggle）
- `pnpm add @tanstack/react-virtual @tauri-apps/plugin-dialog @tauri-apps/plugin-http` → 3 个 dependency 入 package.json（^3.13.24 / ^2.7.1 / ^2.5.9）
- shadcn 的 sonner block 依赖 `next-themes`（pnpm 自动一并装 0.4.6）；当前 dark-only 无 ThemeProvider，`useTheme()` 默认返回 "system"，不影响功能；保留以便未来引入 light mode 时无需重装
- lucide-react 1.14.0 已经导出 sonner 块需要的 `CircleCheckIcon` / `InfoIcon` / `TriangleAlertIcon` / `OctagonXIcon` / `Loader2Icon`，运行时验证通过
- `src/main.tsx` — 顶部追加 `import { Toaster } from "@/components/ui/sonner"`；`createRoot.render` 改为 Fragment 包裹 `<RouterProvider />` + `<Toaster richColors position="top-right" />`，与 plan 92-93 行一致
- `src-tauri/src/lib.rs` — 02d 的 anchor 注释已在 Task 1 中一并加入（提前到 Task 1 落地以避免单独 lib.rs commit；不影响功能、不注册插件）
- 验证：`pnpm typecheck` 退出 0（无 TS 报错）；package.json grep 命中三个新依赖；main.tsx grep 命中 `Toaster`；9 个 ui 文件全部存在

### Task 3: dev smoke — pnpm tauri dev 启动后 schema_version=2 (verified)

- 启动前：`sqlite3 ... "SELECT value FROM app_meta WHERE key='schema_version'"` → `1`（Phase 1 baseline）
- `pnpm tauri dev` 后台启动 → 等 sqlx Migrator 应用 0002（实测 ~10s 内完成）
- 启动后校验全部命中：
  - `schema_version` = `2`
  - `.tables` 含 `scan_roots`（在 Phase 1 的 5 业务表 `app_meta` / `games` / `sessions` / `tags` / `game_tags` + sqlx 元表 `_sqlx_migrations` 之上）
  - `.schema games` 末尾追加列 `cover_url TEXT, metadata_source TEXT, match_confidence INTEGER, last_scanned_at TEXT`
  - `.schema scan_roots` 含 `id PK / path UNIQUE / depth CHECK in (1,2,3) / created_at default now`
- dev 进程通过 taskkill 强制结束（gal-lib.exe PID 38240），背景任务以非 0 退出码报告——这是被强杀的正常表现，迁移在杀进程前已落盘到 app.db

## Deviations from Plan

无。计划 100% 严格执行。三个原本可能产生 race 的小调整都在 plan 允许范围内：

1. **Task 1 中提前加入 lib.rs 的 02d anchor 注释**：plan Task 2 step 4 要求加这个注释，但既然 lib.rs 反正会因 Task 1 的依赖变化而被编译，把注释提前到 Task 1 commit 里减少了一次单独的 lib.rs 写入；不影响功能（仅注释、无插件 init 调用），保留了 02d 的文件所有权边界。
2. **shadcn 级联依赖 `toggle.tsx`**：`pnpm dlx shadcn add toggle-group` 自动级联拉了 `toggle.tsx`（registry 显式 require）；UI-SPEC 第 134 行只列了 9 个 block 名但 toggle 是 toggle-group 的实现依赖，必须保留。已与 9 个目标 block 一并提交。
3. **`next-themes` 自动随 sonner block 装入**：shadcn sonner block 源码 `import { useTheme } from "next-themes"`，pnpm 自动装 0.4.6；当前项目 dark-only 没有 ThemeProvider，`useTheme()` 默认返回 `"system"`，运行时不报错；如未来引入 light mode，主题切换无需重装。

## TDD Gate Compliance

不适用 —— 本 plan `type: execute`（非 `tdd`），但 Task 1 中仍按 plan 显式要求新增了 `migrations_v2_adds_scan_roots_and_columns` 单元测试，运行通过（4/4 lib tests passing）。

## Self-Check

### Files

- [x] `src-tauri/Cargo.toml` exists; contains `reqwest`/`walkdir`/`governor`/`tauri-plugin-dialog`/`tauri-plugin-http` ✓
- [x] `src-tauri/migrations/0002_add_scan_and_metadata.sql` exists; contains `CREATE TABLE scan_roots` + 4 `ADD COLUMN` + `schema_version` `'2'` ✓
- [x] `src-tauri/src/db.rs` updated; contains `version: 2` + `migrations_v2_adds_scan_roots_and_columns` test ✓
- [x] `src-tauri/src/lib.rs` updated; contains 02d anchor comment ✓
- [x] `src-tauri/capabilities/default.json` updated; contains `dialog:default` + `http:default` ✓
- [x] `package.json` updated; contains `@tanstack/react-virtual` + `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-http` ✓
- [x] `src/main.tsx` updated; contains `Toaster` mount ✓
- [x] All 9 shadcn block files in `src/components/ui/`: progress, select, dialog, input, toggle-group, dropdown-menu, badge, alert-dialog, sonner ✓ (+ toggle.tsx as toggle-group's required dependency)

### Build / test

- [x] `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0 ✓
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib` → 4 passed ✓
- [x] `pnpm typecheck` → exit 0 ✓
- [x] `pnpm tauri dev` smoke → schema_version 1→2 + scan_roots present + 4 new games columns ✓

### Commits

- [x] `ea92e69` chore(02-02a): add rust crates + capabilities + 0002 schema migration
- [x] `000c668` chore(02-02a): install shadcn blocks + tanstack-virtual + tauri plugin npm
- [x] (final) feat(02-02a): verify schema v2 dev smoke (schema_version=2)

## Self-Check: PASSED
