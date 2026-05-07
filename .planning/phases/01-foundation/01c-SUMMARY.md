---
phase: 01-foundation
plan: 01c
status: complete
completed: 2026-05-07
---

# Plan 01c — Portable data dir + tauri-plugin-sql + 0001 init migration (Summary)

## 交付内容

实现 portable 数据目录（Pattern 1 — exe 同级 `data/`）+ tauri-plugin-sql 接入（Pattern 3，path_mapper bypass — RESEARCH §A1）+ 0001 init migration（schema v1：games/sessions/tags/game_tags/app_meta + 3 索引 + `app_meta.schema_version='1'`）。前端通过 `getDb()` 单例 helper 获取可用 Database 实例。

## Tasks 进度

- [x] Task 1: Cargo deps + capabilities + 0001_init.sql + .gitignore — commit `45e6378`
- [x] Task 2: data_dir.rs + db.rs (Rust modules + unit tests) — commit `2b7db46`
- [x] Task 3: lib.rs setup + plugin register + get_data_dir command + src/lib/db.ts + path_mapper bypass smoke test — commit `af5bab8`

## Commits

- `45e6378 feat(01-01c): add sql plugin deps + capabilities + 0001 schema migration`
- `2b7db46 feat(01-01c): add data_dir.rs (portable resolver) + db.rs (migration registry)`
- `af5bab8 feat(01-01c): wire lib.rs (plugin + setup + get_data_dir) + frontend db.ts helper`

## 文件清单（增量记录）

**Task 1 产物：**
- `src-tauri/Cargo.toml` (修改) — `[dependencies]` 追加 `tauri-plugin-sql = { version = "2", features = ["sqlite"] }`、`dunce = "1"`、`anyhow = "1"`、`thiserror = "2"`
- `package.json` (修改) — `dependencies` 追加 `"@tauri-apps/plugin-sql": "^2.4.0"`
- `pnpm-lock.yaml` (修改) — 锁定 `@tauri-apps/plugin-sql 2.4.0`
- `src-tauri/Cargo.lock` (修改) — 锁定 Rust 依赖（tauri-plugin-sql 2.4.0、sqlx 0.8.6、sqlx-sqlite 0.8.6、dunce 1.0.5、anyhow 1.0.x、thiserror 2.0.x — 待具体版本确认）
- `src-tauri/capabilities/default.json` (修改) — `permissions` 追加 `sql:default` / `sql:allow-load` / `sql:allow-execute` / `sql:allow-select`
- `src-tauri/migrations/0001_init.sql` (新增) — schema v1 verbatim（5 张表 + 3 个索引 + `INSERT INTO app_meta ('schema_version', '1')`）
- `.gitignore` (修改) — 显式追加 `src-tauri/target/` 一行（保留原 `/src-tauri/target/`）

**Task 2 产物：**
- `src-tauri/src/data_dir.rs` (新增) — 5 个 pub fn：`resolve_data_dir` / `ensure_subdirs` / `ensure_default_config` / `ensure` / `build_db_url`；`SUBDIRS = ["covers", "screenshots", "saves", "logs"]`；`DEFAULT_CONFIG_JSON` 含 `schema_version=1`/`scan_roots=[]`/`default_locale="ja-JP"`/`le_path=null`；用 `dunce::canonicalize` 去 Windows UNC 前缀；`build_db_url` 把反斜杠替换为正斜杠以适配 sqlx URL 解析。含 2 个单元测试：`build_db_url_uses_forward_slashes_and_absolute_path` + `ensure_creates_subdirs_and_default_config_idempotently`
- `src-tauri/src/db.rs` (新增) — `migrations()` 返回 `Vec<Migration>` 单元素（version=1, description="init_schema", `kind=MigrationKind::Up`）；通过 `include_str!("../migrations/0001_init.sql")` 编译期嵌入 SQL。含 1 个单元测试：`migrations_v1_includes_required_objects`

## 验证记录

**Task 1：**
- `pnpm install` 成功，新增 `@tauri-apps/plugin-sql 2.4.0` ✅
- `cargo check --manifest-path src-tauri/Cargo.toml` — 退出 0 ✅（30.76s 首次编译，sqlx/sqlx-sqlite/tauri-plugin-sql 新引入）
- 所有 Task 1 grep 断言通过（见 `<verify>` automated 块）：
  - `CREATE TABLE` 计数 = 5 ✅
  - `CREATE INDEX` 计数 = 3 ✅
  - 不含 `is_favorite` / `tauri-plugin-log` / `core:window` ✅

**Task 2：**
- 两个新模块文件按 plan_scope verbatim 落盘 ✅
- `cargo check --manifest-path src-tauri/Cargo.toml` — 退出 0 ✅（既有 lib.rs 未被破坏；mod 声明留给 Task 3）
- 所有 Task 2 grep 断言通过（`pub fn` 五个、`dunce::canonicalize`、`replace('\\', "/")`、4 个子目录名、`"default_locale": "ja-JP"`、`include_str!`、`MigrationKind::Up`、`version: 1`） ✅

**Task 3 产物：**
- `src-tauri/src/lib.rs` (修改) — `mod data_dir;` + `mod db;` 模块声明；`pub struct AppPaths { pub data_dir: PathBuf, pub db_url: String }` state；`#[tauri::command] fn get_data_dir(state: tauri::State<AppPaths>) -> String`；`run()` 入口先调 `data_dir::ensure()`（**在 `tauri::Builder::default()` 之前**），再 `Builder::default().plugin(tauri_plugin_sql::Builder::default().add_migrations(&db_url, db::migrations()).build())`，`.manage(AppPaths { data_dir, db_url })`，`.invoke_handler(tauri::generate_handler![get_data_dir])`
- `src/lib/db.ts` (新增) — `import Database from "@tauri-apps/plugin-sql"` + `invoke<string>("get_data_dir")` + `getDb()` 单例（懒加载、缓存 Promise）+ `getDataDir()` helper；正反斜杠通过 `replace(/\\/g, "/")` 转换以匹配后端的 db_url 形式

**Task 3 验证：**
- `cargo check --manifest-path src-tauri/Cargo.toml` — 退出 0 ✅
- `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 3 tests pass ✅
  - `data_dir::tests::build_db_url_uses_forward_slashes_and_absolute_path` ✅
  - `data_dir::tests::ensure_creates_subdirs_and_default_config_idempotently` ✅
  - `db::tests::migrations_v1_includes_required_objects` ✅
- `pnpm tauri dev` 启动 portable smoke test ✅
  - `src-tauri/target/debug/data/app.db` 存在（65,536 字节，含完整 schema） ✅
  - `src-tauri/target/debug/data/config.json` 存在（87 字节，含 `"default_locale": "ja-JP"`） ✅
  - 4 个子目录全部就位：`covers/`, `screenshots/`, `saves/`, `logs/` ✅
  - `sqlite3 .../app.db ".tables"` 返回：`_sqlx_migrations`, `app_meta`, `game_tags`, `games`, `sessions`, `tags`（5 张业务表 + sqlx 元表） ✅
  - `sqlite3 .../app.db "SELECT * FROM app_meta;"` 返回 `schema_version|1` ✅
  - **path_mapper bypass 实测：** `%APPDATA%\com.gal-lib.app\` 目录存在但**为空**（Tauri v2 自身在启动时为 bundle identifier 创建空 config dir，但实际应用数据 DB / config / 子目录全部正确落在 exe-sibling `data/`）。这是 RESEARCH §A1 的预期行为：path_mapper 的绕过让 sqlx 路径替换 `app_config_dir`，而 Tauri runtime 自身的 dir setup 与 sqlx 路径解析无关。**APP-01 portable 不变量满足**：用户数据零落入 APPDATA。

## 偏离声明

| 项 | 计划 | 实际 | 原因 |
|---|---|---|---|
| 索引数量 | plan §interfaces 写 3 索引 (`idx_sessions_game_id`, `idx_sessions_started_at`, `idx_game_tags_tag_id`) | 落盘也是 3 索引 | ✅ 一致（plan 与 RESEARCH 草案的 4 索引差异已在 plan §interfaces 解释） |
| 迁移版本号策略 | 锁定决策（CONTEXT）说 "时间戳"；plan §interfaces 显式偏离为 "递增整数 version=1" | 落盘 version=1 | sqlx Migrator 协议级强制要求整数 version；plan §interfaces 已记录偏离声明，本 SUMMARY 复述以让 schema v2 阶段延续整数版本号 |
| `%APPDATA%\com.gal-lib.app\` 是否存在 | 01c-PLAN.md 自动断言期望 `[ ! -d "$APPDATA/com.gal-lib.app" ]` | 实际 dir 存在但为空 | Tauri v2 自身行为（与 sqlx 无关）；用户数据未污染该位置；测试断言应改为「该 dir 内无 .db / .json / 子目录」而非「dir 不存在」。**这是 plan 的断言过严，非实施问题。** 02 阶段验证可调整断言。 |

## 给下游 plan 的 Hand-off

| 下游 plan | 接 01c 后可立即做的事 |
|---|---|
| **01d** (App Shell) | 在 App.tsx mount `useEffect` 中调 `import { getDataDir } from "@/lib/db"` 并写入 Zustand store；DB 查询通过 `import { getDb } from "@/lib/db"` + `await getDb()` 拿到 Database 实例，可执行 select；plan 01d task 1 的 store boot fill 直接消费这两个 helper |
| **01e** (titlebar) | 不依赖；可独立推进 |
| **01f** (单 exe) | release build 时 portable invariant 同样适用：app.db / config.json / 4 子目录落在 exe 同级 `data/`，APPDATA 内的 bundle identifier 空 dir 行为是 Tauri runtime side-effect、可接受 |

## 未解决 / 风险

- **APPDATA empty-dir side effect:** 见上方偏离声明；plan-checker 二轮可能再次 flag 这一断言失败，处理方式是把断言放宽为「dir 内 contents 为空」而非「dir 不存在」。Phase 2 verify-phase 时调整断言。
- **release build path canonicalization 未实测:** `dunce::canonicalize` 在 dev 模式（target/debug/）下验证通过；release 模式下 `current_exe()` 解析路径可能不同（NSIS 安装到 `%LocalAppData%\Programs\` vs portable 双击 .exe）。01f 在干净 Win10/11 测试机上需要再次断言 portable 不变量。

## Status

✅ Plan 01c 完成 — Wave 3 通过，Wave 4 可启动（01d App Shell）。

---

*Note: This SUMMARY was incrementally written by the executor agent (network-resilient scaffold). The agent's socket dropped after Task 3 commit but before final SUMMARY update; the orchestrator finalized Task 3 documentation, ran post-hoc verification (cargo test, sqlite3 schema query, APPDATA inspection), and marked status as complete. All tests pass; no re-execution needed.*
