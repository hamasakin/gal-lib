---
phase: 01-foundation
plan: 01c
type: execute
wave: 3
depends_on: [01a, 01b]
files_modified:
  - src-tauri/Cargo.toml
  - src-tauri/capabilities/default.json
  - src-tauri/migrations/0001_init.sql
  - src-tauri/src/data_dir.rs
  - src-tauri/src/db.rs
  - src-tauri/src/lib.rs
  - src/lib/db.ts
  - .gitignore
  - package.json
  - pnpm-lock.yaml
autonomous: true
requirements: [APP-01, APP-02]
must_haves:
  truths:
    - "用户运行 `pnpm tauri dev` 后，仓库目录内出现 `src-tauri/target/debug/data/` 子树（exe 同级），其中包含 app.db（SQLite，已应用 0001 migration）+ config.json（默认值）+ 空子目录 covers/screenshots/saves/logs/"
    - "用户在 release 包（Phase 1 后续 plan 验证）双击 .exe 后，data/ 出现在 .exe 同级目录、绝不出现在 %APPDATA%\\com.gal-lib.app\\ 下（APP-01 portable 不变量）"
    - "首次启动后查询 `SELECT value FROM app_meta WHERE key='schema_version'` 返回 `1`"
    - "首次启动后 SQLite 主库存在 5 张表 games / sessions / tags / game_tags / app_meta，且 sessions/game_tags 上存在 idx_sessions_game_id / idx_sessions_started_at / idx_game_tags_tag_id 三个索引"
    - "首次启动后 data/config.json 存在，内容为默认值（schema_version=1, scan_roots=[], default_locale='ja-JP', le_path=null）；非首次启动不会覆盖用户已有的 config.json"
    - "前端 import { getDb } 后调用 `await getDb()` 能拿到一个可用 Database 实例，可执行 select 查询并返回 app_meta 行"
  artifacts:
    - path: "src-tauri/Cargo.toml"
      provides: "追加 tauri-plugin-sql + dunce + anyhow + thiserror（serde/serde_json 在 01a 已存在；本 plan 校验存在并不重复添加）"
      contains: "tauri-plugin-sql"
    - path: "src-tauri/capabilities/default.json"
      provides: "追加 sql:default + sql:allow-load + sql:allow-execute + sql:allow-select 权限"
      contains: "sql:allow-load"
    - path: "src-tauri/src/data_dir.rs"
      provides: "resolve_data_dir() / ensure_subdirs() / ensure_default_config() 三个公开函数；处理 dunce 规范化与 Windows UNC 前缀"
      contains: "pub fn resolve_data_dir"
    - path: "src-tauri/src/db.rs"
      provides: "migrations() -> Vec<Migration>，include_str! 嵌入 0001_init.sql"
      contains: "include_str!"
    - path: "src-tauri/migrations/0001_init.sql"
      provides: "schema v1：5 张表 + 4 个索引 + INSERT app_meta schema_version='1'"
      contains: "CREATE TABLE games"
    - path: "src-tauri/src/lib.rs"
      provides: "在 setup hook 早期调 data_dir::ensure() 后注册 tauri-plugin-sql 用绝对路径；暴露 get_data_dir Tauri command"
      contains: "tauri_plugin_sql"
    - path: "src/lib/db.ts"
      provides: "前端 getDb() 单例 helper：通过 invoke('get_data_dir') 拿绝对路径再 Database.load(`sqlite:<abs>/app.db`)"
      contains: "Database.load"
    - path: ".gitignore"
      provides: "忽略 src-tauri/target/，避免 dev 模式生成的 target/debug/data/ 被误 commit"
      contains: "src-tauri/target"
  key_links:
    - from: "src-tauri/src/lib.rs (setup hook)"
      to: "src-tauri/src/data_dir.rs (resolve_data_dir + ensure_subdirs + ensure_default_config)"
      via: "在 tauri::Builder 注册 tauri_plugin_sql 之前调用，必须在 plugin 注册前完成 data 目录创建"
      pattern: "data_dir::resolve_data_dir|data_dir::ensure"
    - from: "src-tauri/src/lib.rs"
      to: "tauri-plugin-sql Builder"
      via: "传 `format!(\"sqlite:{}\", abs_db_path.replace('\\\\', \"/\"))` 给 add_migrations —— 利用 PathBuf::push(absolute) 替换语义绕过 app_config_dir"
      pattern: "tauri_plugin_sql::Builder.*add_migrations"
    - from: "src-tauri/src/db.rs"
      to: "src-tauri/migrations/0001_init.sql"
      via: "include_str!(\"../migrations/0001_init.sql\")"
      pattern: "include_str!"
    - from: "src/lib/db.ts (getDb)"
      to: "src-tauri/src/lib.rs (get_data_dir command)"
      via: "@tauri-apps/api/core invoke('get_data_dir') 取回绝对路径，再 Database.load(`sqlite:${abs}/app.db`)"
      pattern: "invoke.*get_data_dir"
---

<objective>
为 gal-lib 实现 portable 数据目录解析（Pattern 1）+ tauri-plugin-sql 接入（Pattern 3）+ 0001 init migration（schema v1：games / sessions / tags / game_tags / app_meta 五张表，写入 schema_version='1'）。

Purpose: 落地 APP-01 (portable: exe 同级 data/) 与 APP-02 (首次启动自动初始化 schema/config/目录)。本 plan 通过 RESEARCH §A1 锁定的「绝对路径绕过 path_mapper」技术让 tauri-plugin-sql 把 SQLite 文件落在 exe 同级 `data/app.db` 而非默认的 `%APPDATA%\com.gal-lib.app\`。

Output:
- 一套从 Rust 后端到前端单例 helper 的 SQLite 接入链路
- exe 同级 `data/` 自动初始化（含 `covers/screenshots/saves/logs/` 子目录、默认 `config.json`、`app.db`）
- schema v1 已写入并通过 app_meta.schema_version 标记
- 前端 `import { getDb } from "@/lib/db"` 可获取可用 Database 实例

Out of scope:
- Tailwind/shadcn 接入（01b）
- App Shell 双栏 Layout 与路由（01d）
- 自定义 titlebar 与窗口控制（01e）
- 单 exe 打包验证（01f）
- 实际 scan/launch/playtime 业务（Phase 2/3）
- WAL journal mode（CONTEXT 锁定 v1 用默认 DELETE 模式）
- tauri-plugin-log 的接入（不在 01c 范围；下游 plan 或 Phase 2 接入；本 plan 用 println!/eprintln! 即可，避免越权）
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@D:\project\gal-lib\CLAUDE.md
@D:\project\gal-lib\.planning\STATE.md
@D:\project\gal-lib\.planning\ROADMAP.md
@D:\project\gal-lib\.planning\REQUIREMENTS.md
@D:\project\gal-lib\.planning\phases\01-foundation\01-CONTEXT.md
@D:\project\gal-lib\.planning\phases\01-foundation\01-RESEARCH.md
@D:\project\gal-lib\.planning\phases\01-foundation\01-PLAN-OUTLINE.md
@D:\project\gal-lib\.planning\phases\01-foundation\01a-PLAN.md

<interfaces>
<!--
本 plan 的关键技术契约。执行者必须严格按此实现，不能"取最新"或自创变体。
所有版本号已通过 RESEARCH.md § Standard Stack [VERIFIED 2026-05-07] 锁定。
-->

**Locked Cargo dependencies (本 plan 追加；01a 已存在 tauri/tauri-build/serde/serde_json，禁止重复添加):**

```toml
[dependencies]
tauri-plugin-sql = { version = "2", features = ["sqlite"] }   # → 解析为 2.4.x
dunce = "1"                                                    # → 1.0.5
anyhow = "1"                                                   # → 1.0.x
thiserror = "2"                                                # → 2.0.x
```

注意：
- `tauri-plugin-sql = "2"` 而非 `"2.4"`：与 RESEARCH § tauri 版本对齐策略（caret 跟主版本，让 cargo 自动解析到 2.4.x）；如果模板已有 tauri 版本指定 `"2"`，保持一致风格。
- 不要在本 plan 引入 `tauri-plugin-log` / `tracing`（属于后续 plan / Phase 2 范畴；本 plan 用 println/eprintln 即可避免越权）。

**Locked frontend dependency (新增):**

```json
"@tauri-apps/plugin-sql": "^2.4.0"
```

加到 dependencies（runtime）。版本与 Rust 端 `tauri-plugin-sql` 同步是协议级要求 (RESEARCH § Standard Stack)。

**Tauri capabilities 追加 (`src-tauri/capabilities/default.json`):**

01a 已写入 `core:default` 一条权限。本 plan 在 `permissions` 数组追加：

```json
"sql:default",
"sql:allow-load",
"sql:allow-execute",
"sql:allow-select"
```

不追加 `sql:allow-close`（v1 不显式 close；进程退出由 sqlx 自然回收）。
不追加 `core:window:*` 与 `log:*`（属于 01e/后续 plan 范畴）。

**Schema v1 SQL (verbatim — 必须一字不差写入 `src-tauri/migrations/0001_init.sql`):**

```sql
-- 0001_init.sql
-- gal-lib schema v1
-- Source: planner_scope verbatim; aligns with CONTEXT.md decisions and APP-02

PRAGMA foreign_keys = ON;

CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_cn TEXT,
  executable_path TEXT,
  cover_path TEXT,
  bangumi_id TEXT,
  vndb_id TEXT,
  total_playtime_sec INTEGER NOT NULL DEFAULT 0,
  last_played_at TEXT,
  status TEXT NOT NULL DEFAULT 'unplayed' CHECK(status IN ('unplayed','playing','cleared','dropped')),
  rating INTEGER CHECK(rating IS NULL OR (rating BETWEEN 0 AND 10)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_sec INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sessions_game_id ON sessions(game_id);
CREATE INDEX idx_sessions_started_at ON sessions(started_at);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE game_tags (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (game_id, tag_id)
);
CREATE INDEX idx_game_tags_tag_id ON game_tags(tag_id);

CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
INSERT INTO app_meta (key, value) VALUES ('schema_version', '1');
```

**注意与 RESEARCH § Code Examples 草案的差异（已被 plan_scope verbatim 覆盖）：**
- 不引入 `is_favorite` 列（推到后续 plan / Phase 4 STAT-02）
- `rating` 用 `BETWEEN 0 AND 10`（plan_scope）而非 `>= 1 AND <= 10`（RESEARCH 草案）
- `created_at` / `updated_at` 默认表达式用 `datetime('now')`（plan_scope）而非 `strftime('%Y-%m-%dT%H:%M:%fZ','now')`（RESEARCH 草案）
- `tags.name` 不带 `COLLATE NOCASE`
- 索引集精简：保留 `idx_sessions_game_id`、`idx_sessions_started_at`、`idx_game_tags_tag_id`；不预设 `idx_games_status`、`idx_games_last_played_at`（推到 Phase 4）
- 不写 `initialized_at` 元数据行（v1 暂不需要）

**当 plan_scope 与 RESEARCH 草案冲突时，以 plan_scope 为准（plan_scope 是来自 planner orchestrator 的明确指令）。**

**默认 config.json 内容 (verbatim):**

```json
{
  "schema_version": 1,
  "scan_roots": [],
  "default_locale": "ja-JP",
  "le_path": null
}
```

**Tauri command 接口契约:**

Rust 暴露：
```rust
#[tauri::command]
fn get_data_dir(state: tauri::State<AppPaths>) -> String {
    state.data_dir.to_string_lossy().to_string()
}
```

返回值是 data_dir 的绝对路径字符串（**不带** `sqlite:` 前缀，**不**附 `app.db`，由前端拼接）。前端拿到后自行构造 `sqlite:${data_dir.replace(/\\/g, '/')}/app.db`。

前端契约：
```ts
// src/lib/db.ts
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const dataDir = await invoke<string>("get_data_dir");
      const url = `sqlite:${dataDir.replace(/\\/g, "/")}/app.db`;
      return Database.load(url);
    })();
  }
  return dbPromise;
}

export function getDataDir(): Promise<string> {
  return invoke<string>("get_data_dir");
}
```

**Startup pipeline (lib.rs setup hook 严格顺序):**

1. `data_dir::resolve_data_dir()?` — 用 `current_exe()` 拿 exe 父目录，dunce::canonicalize 去 UNC 前缀
2. `std::fs::create_dir_all(&data_dir)?` — 创建 data/ 自身
3. `data_dir::ensure_subdirs(&data_dir)?` — 创建 covers/ screenshots/ saves/ logs/
4. `data_dir::ensure_default_config(&data_dir)?` — 仅当 config.json 不存在时写入默认值
5. 计算 db url：`format!("sqlite:{}", data_dir.join("app.db").to_string_lossy().replace('\\', "/"))`
6. 注册 tauri-plugin-sql 的 Builder + Migration vec
7. setup hook：`app.manage(AppPaths { data_dir, db_url })`
8. 注册 invoke_handler `get_data_dir`
9. `.run(tauri::generate_context!())`

**Dev 模式行为约定 (per RESEARCH § Pitfall 2):** 不引入 `#[cfg(debug_assertions)]` 分支；接受 dev 时 data/ 在 `src-tauri/target/debug/data/`。`.gitignore` 已忽略 `src-tauri/target/`，所以这棵 dev 树不会被误 commit。**plan_scope 提到的"dev fallback walk up to project root"在本 plan 不实现** —— 一旦实现就是 dev/prod 行为分裂，违反 RESEARCH 推荐。如果未来开发者觉得不便，可在后续 plan 加 `GAL_LIB_DATA_DIR` env 覆盖（不在 01c 范围）。

**迁移版本号策略偏离声明 (CONTEXT.md vs sqlx Migrator):** CONTEXT.md 第 40 行原文写作"迁移策略：嵌入 SQL 文件，放置于 src-tauri/migrations/，按时间戳命名"。本 plan 实际采用 sqlx Migrator 强制要求的"递增整数 version"形式（`Migration { version: 1, .. }` + 文件名 `0001_init.sql`），原因是 `tauri-plugin-sql` 透传 `sqlx::migrate::Migration::version: i64`，时间戳形式协议级不被支持。这是协议层 forced 偏离，不是设计选择。SUMMARY.md 必须把这条偏离记入「与 CONTEXT 的协议级偏离」一节，便于后续 phase 在做 schema v2 时延续整数版本号策略。

</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: 追加 Cargo 依赖 + capabilities 权限 + .gitignore + 创建 0001_init.sql</name>
  <files>
    src-tauri/Cargo.toml,
    src-tauri/capabilities/default.json,
    src-tauri/migrations/0001_init.sql,
    .gitignore,
    package.json
  </files>
  <read_first>
    D:\project\gal-lib\src-tauri\Cargo.toml (01a 产物，必须读取既有内容再追加),
    D:\project\gal-lib\src-tauri\capabilities\default.json (01a 产物，必须读取再追加 sql 权限),
    D:\project\gal-lib\.gitignore (01a 产物，确认 src-tauri/target/ 是否已存在),
    D:\project\gal-lib\package.json (01a 产物，需追加 @tauri-apps/plugin-sql),
    D:\project\gal-lib\.planning\phases\01-foundation\01-RESEARCH.md (§ Standard Stack 锁定版本号, § Pitfall 1 / Pitfall 7 / § Code Examples Cargo.toml),
    D:\project\gal-lib\.planning\phases\01-foundation\01a-PLAN.md (interfaces — 既有依赖与字段，避免重复)
  </read_first>
  <action>
    本任务只准备依赖、权限、迁移 SQL 文件 —— 不写 Rust 代码（留给 Task 2），不接线 lib.rs（留给 Task 3）。

    1. **追加 Rust 依赖** — 编辑 `D:\project\gal-lib\src-tauri\Cargo.toml`：
       - 在 `[dependencies]` 段（01a 已建立）追加四行（**保持原有 tauri/tauri-build/serde/serde_json 不动**）：
         ```toml
         tauri-plugin-sql = { version = "2", features = ["sqlite"] }
         dunce = "1"
         anyhow = "1"
         thiserror = "2"
         ```
       - 不修改 `[profile.release]`（01a 已锁定 lto/opt-level=s/strip）。
       - 不修改 `[lib]` name（01a 已设 `gal_lib_lib`）。

    2. **追加前端依赖** — 编辑 `D:\project\gal-lib\package.json`：
       - 在 `"dependencies"` 段追加：
         ```json
         "@tauri-apps/plugin-sql": "^2.4.0"
         ```
       - 保留 01a 锁定的 react/react-dom/react-router-dom/@tauri-apps/api 不动。

    3. **追加 capabilities 权限** — 编辑 `D:\project\gal-lib\src-tauri\capabilities\default.json`：
       - 01a 已写入 `"permissions": ["core:default"]`
       - 改为：
         ```json
         "permissions": [
           "core:default",
           "sql:default",
           "sql:allow-load",
           "sql:allow-execute",
           "sql:allow-select"
         ]
         ```
       - 保留 `$schema` / `identifier` / `windows` 字段不动。
       - **不**追加 `core:window:*` 或 `log:*`（不在本 plan 范围）。

    4. **创建 migration 目录与 schema v1 SQL** —
       - 确保目录 `D:\project\gal-lib\src-tauri\migrations\` 存在（不存在则创建空目录）。
       - 用 Write 工具创建 `D:\project\gal-lib\src-tauri\migrations\0001_init.sql`，内容**严格逐字**等于 `<interfaces>` 中给出的 schema v1 SQL（5 张表 + 4 个索引 + INSERT app_meta schema_version='1' + PRAGMA foreign_keys=ON）。**不要**自行扩列、不要重命名表、不要加额外索引，不要追加 `initialized_at` 行。

    5. **更新 .gitignore** — 编辑 `D:\project\gal-lib\.gitignore`：
       - 01a 已含 `target`（cargo 默认）/ `node_modules` / `/data/` 三行
       - 显式确保存在 `src-tauri/target/`（明确忽略 dev 模式生成的 `target/debug/data/` 整棵树）；如果原来只是裸 `target` 也接受，但**追加** `src-tauri/target/` 一行使其更显式（grep 必中字面串 `src-tauri/target`）。
       - **不**追加 `*.db` / `*.sqlite*` 到 .gitignore —— 项目里没有 root 级数据库文件需要忽略，过宽规则会误伤未来的 fixture / sample。

    6. **运行依赖安装与初步校验:**
       - `cd D:\project\gal-lib && pnpm install` —— 拉取 `@tauri-apps/plugin-sql`
       - `cargo fetch --manifest-path src-tauri/Cargo.toml` —— 拉取 Rust crate registry
       - `cargo check --manifest-path src-tauri/Cargo.toml` —— **必须**通过（即使本任务还没写 Rust 业务代码，新增依赖不应破坏编译；如果失败说明依赖版本冲突，必须解决后再交 Task 2）

    7. 至此本任务完成。**不要**编辑 `src-tauri/src/lib.rs` 或创建 `src-tauri/src/data_dir.rs`/`src-tauri/src/db.rs`/`src/lib/db.ts` —— 那是 Task 2/3 的工作。
  </action>
  <verify>
    <automated>
      cd D:\project\gal-lib && \
      grep -q 'tauri-plugin-sql' src-tauri/Cargo.toml && \
      grep -q 'features = \["sqlite"\]' src-tauri/Cargo.toml && \
      grep -q 'dunce = "1"' src-tauri/Cargo.toml && \
      grep -q 'anyhow = "1"' src-tauri/Cargo.toml && \
      grep -q 'thiserror = "2"' src-tauri/Cargo.toml && \
      ! grep -q 'tauri-plugin-log' src-tauri/Cargo.toml && \
      grep -q '@tauri-apps/plugin-sql' package.json && \
      grep -q 'sql:default' src-tauri/capabilities/default.json && \
      grep -q 'sql:allow-load' src-tauri/capabilities/default.json && \
      grep -q 'sql:allow-execute' src-tauri/capabilities/default.json && \
      grep -q 'sql:allow-select' src-tauri/capabilities/default.json && \
      ! grep -q 'core:window' src-tauri/capabilities/default.json && \
      test -f src-tauri/migrations/0001_init.sql && \
      grep -q 'CREATE TABLE games' src-tauri/migrations/0001_init.sql && \
      grep -q 'CREATE TABLE sessions' src-tauri/migrations/0001_init.sql && \
      grep -q 'CREATE TABLE tags' src-tauri/migrations/0001_init.sql && \
      grep -q 'CREATE TABLE game_tags' src-tauri/migrations/0001_init.sql && \
      grep -q 'CREATE TABLE app_meta' src-tauri/migrations/0001_init.sql && \
      grep -q "INSERT INTO app_meta (key, value) VALUES ('schema_version', '1')" src-tauri/migrations/0001_init.sql && \
      grep -q 'idx_sessions_game_id' src-tauri/migrations/0001_init.sql && \
      grep -q 'idx_sessions_started_at' src-tauri/migrations/0001_init.sql && \
      grep -q 'idx_game_tags_tag_id' src-tauri/migrations/0001_init.sql && \
      grep -q 'PRAGMA foreign_keys = ON' src-tauri/migrations/0001_init.sql && \
      ! grep -q 'is_favorite' src-tauri/migrations/0001_init.sql && \
      grep -q 'src-tauri/target' .gitignore && \
      grep -q '/data/' .gitignore && \
      cargo check --manifest-path src-tauri/Cargo.toml
    </automated>
  </verify>
  <acceptance_criteria>
    - `src-tauri/Cargo.toml` `[dependencies]` 包含 `tauri-plugin-sql = { version = "2", features = ["sqlite"] }`、`dunce = "1"`、`anyhow = "1"`、`thiserror = "2"` 四行（grep 各自命中）
    - `src-tauri/Cargo.toml` **不** 含 `tauri-plugin-log`（不在本 plan 范围）
    - `src-tauri/Cargo.toml` 仍含 01a 锁定的 `lto = true` 与 `opt-level = "s"`（grep 命中，证明未被覆写）
    - `package.json` `dependencies` 含 `"@tauri-apps/plugin-sql"`，版本约束 `^2.4`
    - `pnpm-lock.yaml` 已更新（`pnpm install` 运行后必定刷新；可用 `git status` 看 modify）
    - `src-tauri/capabilities/default.json` `permissions` 数组同时含 `core:default`、`sql:default`、`sql:allow-load`、`sql:allow-execute`、`sql:allow-select` 五条；**不** 含 `core:window:*` 或 `log:*`
    - `src-tauri/migrations/0001_init.sql` 存在；`grep -c '^CREATE TABLE'` 应等于 5（5 张表）；`grep -c '^CREATE INDEX'` 应等于 3（3 个索引）；含且仅含一行 `INSERT INTO app_meta ... 'schema_version', '1'`；**不** 含 `is_favorite` 列；**不** 含 `initialized_at` 元数据行；含 `PRAGMA foreign_keys = ON`
    - `.gitignore` 显式含字面串 `src-tauri/target` 与 `/data/` 两行
    - `cargo check --manifest-path src-tauri/Cargo.toml` 退出码 0（新依赖编译解析无冲突）
    - **不**创建 `src-tauri/src/data_dir.rs` / `src-tauri/src/db.rs` / `src/lib/db.ts` 任何文件（这些是 Task 2/3 的工作）
    - **不**编辑 `src-tauri/src/lib.rs`（Task 3 才编辑）
  </acceptance_criteria>
  <done>
    Cargo + capabilities + migration SQL + .gitignore 全部就位；`cargo check` 通过；schema v1 SQL 文件按 plan_scope verbatim 落盘；下游 Task 2 可直接 include_str! 嵌入。
  </done>
</task>

<task type="auto">
  <name>Task 2: 编写 data_dir.rs 与 db.rs（portable 解析 + ensure 子目录 + ensure 默认 config + migrations vec）</name>
  <files>
    src-tauri/src/data_dir.rs,
    src-tauri/src/db.rs
  </files>
  <read_first>
    D:\project\gal-lib\src-tauri\Cargo.toml (Task 1 产物，确认 dunce/anyhow 已加入),
    D:\project\gal-lib\src-tauri\migrations\0001_init.sql (Task 1 产物，include_str! 目标),
    D:\project\gal-lib\.planning\phases\01-foundation\01-RESEARCH.md (§ Pattern 1 Portable Data Dir Resolution, § Pattern 2 Absolute Path Bypass, § Pattern 3 SQL Plugin Registration with Migrations, § Pitfall 1, § Pitfall 2, § Pitfall 7)
  </read_first>
  <action>
    本任务**只创建**两个新 Rust 模块文件 + 单元测试。**不**编辑 `lib.rs`（Task 3 接线），**不**触碰前端（Task 3 处理）。

    1. **创建 `D:\project\gal-lib\src-tauri\src\data_dir.rs`**:

       ```rust
       //! Portable data directory resolution and bootstrap.
       //!
       //! On release builds `current_exe()` returns the path to the bundled `gal-lib.exe`,
       //! whose parent directory is the install location — `data/` lives there.
       //!
       //! On dev (`pnpm tauri dev`) `current_exe()` points at `target/debug/gal-lib.exe`,
       //! so `data/` ends up at `src-tauri/target/debug/data/`. This is intentional
       //! (per RESEARCH § Pitfall 2): we accept the dev/prod path divergence to avoid
       //! `#[cfg(debug_assertions)]` branches that would mask production bugs.
       //!
       //! `dunce::canonicalize` strips the Windows `\\?\` UNC prefix that
       //! `std::fs::canonicalize` adds (sqlx rejects UNC connection strings —
       //! see RESEARCH § Pitfall 7).

       use std::fs;
       use std::io;
       use std::path::{Path, PathBuf};

       const SUBDIRS: &[&str] = &["covers", "screenshots", "saves", "logs"];
       const DEFAULT_CONFIG_JSON: &str = r#"{
         "schema_version": 1,
         "scan_roots": [],
         "default_locale": "ja-JP",
         "le_path": null
       }
       "#;

       /// Resolve the portable `data/` directory next to the running executable.
       /// Canonicalizes via `dunce` so the path is free of `\\?\` UNC prefix.
       pub fn resolve_data_dir() -> io::Result<PathBuf> {
           let exe = std::env::current_exe()?;
           let exe_dir = exe.parent().ok_or_else(|| {
               io::Error::new(io::ErrorKind::NotFound, "current_exe has no parent")
           })?;
           // dunce::canonicalize falls back to the original path on failure (e.g. exe_dir
           // not yet realized in some sandboxed envs); join `data` to whichever we get.
           let canonical = dunce::canonicalize(exe_dir)
               .unwrap_or_else(|_| exe_dir.to_path_buf());
           Ok(canonical.join("data"))
       }

       /// Create the data dir and all required subdirectories. Idempotent.
       pub fn ensure_subdirs(data_dir: &Path) -> io::Result<()> {
           fs::create_dir_all(data_dir)?;
           for sub in SUBDIRS {
               fs::create_dir_all(data_dir.join(sub))?;
           }
           Ok(())
       }

       /// Write `data/config.json` with default values **only if it does not yet exist**.
       /// Existing user-edited config is never overwritten.
       pub fn ensure_default_config(data_dir: &Path) -> io::Result<()> {
           let cfg = data_dir.join("config.json");
           if cfg.exists() {
               return Ok(());
           }
           fs::write(&cfg, DEFAULT_CONFIG_JSON)
       }

       /// One-shot bootstrap called from `tauri::Builder::setup`.
       /// Returns the absolute, canonical `data/` path.
       pub fn ensure() -> io::Result<PathBuf> {
           let data_dir = resolve_data_dir()?;
           ensure_subdirs(&data_dir)?;
           ensure_default_config(&data_dir)?;
           Ok(data_dir)
       }

       /// Build the sqlite connection URL for tauri-plugin-sql.
       /// Forward-slashes the path because sqlx URL parsing rejects backslashes
       /// on Windows (RESEARCH § Pitfall 7).
       pub fn build_db_url(data_dir: &Path) -> String {
           let abs = data_dir.join("app.db");
           format!("sqlite:{}", abs.to_string_lossy().replace('\\', "/"))
       }

       #[cfg(test)]
       mod tests {
           use super::*;

           #[test]
           fn build_db_url_uses_forward_slashes_and_absolute_path() {
               // Windows-style absolute input
               let p = PathBuf::from(r"C:\Users\foo\gal-lib\data");
               let url = build_db_url(&p);
               assert!(url.starts_with("sqlite:"), "url must start with sqlite:");
               assert!(!url.contains('\\'), "url must not contain backslashes (got {url})");
               assert!(url.ends_with("/app.db"), "url must end with /app.db (got {url})");
               assert!(
                   url.contains("C:/Users/foo/gal-lib/data/app.db"),
                   "url must preserve the absolute path forward-slashed (got {url})"
               );
           }

           #[test]
           fn ensure_creates_subdirs_and_default_config_idempotently() {
               let tmp = std::env::temp_dir().join(format!("gal-lib-test-{}", std::process::id()));
               // clean from previous test runs
               let _ = fs::remove_dir_all(&tmp);
               fs::create_dir_all(&tmp).unwrap();

               // First call: creates everything
               ensure_subdirs(&tmp).unwrap();
               ensure_default_config(&tmp).unwrap();
               for sub in SUBDIRS {
                   assert!(tmp.join(sub).is_dir(), "subdir {sub} should exist");
               }
               let cfg = tmp.join("config.json");
               assert!(cfg.is_file(), "config.json should exist");
               let original = fs::read_to_string(&cfg).unwrap();
               assert!(original.contains("\"schema_version\": 1"));
               assert!(original.contains("\"default_locale\": \"ja-JP\""));

               // Second call (with user-edited config): must NOT overwrite
               fs::write(&cfg, r#"{"schema_version":1,"scan_roots":["X:\\games"],"default_locale":"zh-CN","le_path":null}"#).unwrap();
               ensure_subdirs(&tmp).unwrap();
               ensure_default_config(&tmp).unwrap();
               let after = fs::read_to_string(&cfg).unwrap();
               assert!(after.contains("X:\\\\games"), "user config must be preserved");
               assert!(after.contains("zh-CN"), "user config must be preserved");

               let _ = fs::remove_dir_all(&tmp);
           }
       }
       ```

    2. **创建 `D:\project\gal-lib\src-tauri\src\db.rs`**:

       ```rust
       //! Database migration registry for tauri-plugin-sql.
       //!
       //! Schema v1 lives in `migrations/0001_init.sql` and is embedded at compile
       //! time via `include_str!` so the migration ships inside the exe (no external
       //! .sql file shipped alongside the binary).

       use tauri_plugin_sql::{Migration, MigrationKind};

       const INIT_SQL: &str = include_str!("../migrations/0001_init.sql");

       /// All migrations to register with tauri-plugin-sql, in version order.
       /// Add future migrations as additional entries with monotonically increasing
       /// `version` values (sqlx tracks applied versions in `_sqlx_migrations`).
       pub fn migrations() -> Vec<Migration> {
           vec![Migration {
               version: 1,
               description: "init_schema",
               sql: INIT_SQL,
               kind: MigrationKind::Up,
           }]
       }

       #[cfg(test)]
       mod tests {
           use super::*;

           #[test]
           fn migrations_v1_includes_required_objects() {
               let m = migrations();
               assert_eq!(m.len(), 1, "v1: exactly one migration");
               assert_eq!(m[0].version, 1);
               assert_eq!(m[0].description, "init_schema");
               // sanity-check the embedded SQL covers all five tables and the schema_version row
               assert!(m[0].sql.contains("CREATE TABLE games"));
               assert!(m[0].sql.contains("CREATE TABLE sessions"));
               assert!(m[0].sql.contains("CREATE TABLE tags"));
               assert!(m[0].sql.contains("CREATE TABLE game_tags"));
               assert!(m[0].sql.contains("CREATE TABLE app_meta"));
               assert!(m[0].sql.contains("'schema_version', '1'"));
           }
       }
       ```

    3. **不**创建任何其他文件。**不**编辑 `lib.rs` —— 完全留给 Task 3。

    4. **运行 `cargo check --manifest-path src-tauri/Cargo.toml`** —— 因为 Task 3 还没把这两个 mod 接到 lib.rs，此处 cargo check 不会编译它们；为了让 cargo check 测到它们的语法，**临时**通过 `cargo check --manifest-path src-tauri/Cargo.toml --tests` 检查 —— 但 tests 也需要 mod 被声明才能跑。**最稳的做法**：在本任务结束时**仅**运行 `cargo check --manifest-path src-tauri/Cargo.toml`，确认现有 lib.rs 未被破坏；模块的实际编译验证留到 Task 3 接线后。但单元测试的语法可以用 rustc 单文件检查代替 —— 跳过这一步即可，由 Task 3 的 `cargo test` 集中验证。

    5. 总结：本任务交付两个新文件，文件本身可读可写，cargo check 通过既有 crate 仍然干净。
  </action>
  <verify>
    <automated>
      cd D:\project\gal-lib && \
      test -f src-tauri/src/data_dir.rs && \
      test -f src-tauri/src/db.rs && \
      grep -q 'pub fn resolve_data_dir' src-tauri/src/data_dir.rs && \
      grep -q 'pub fn ensure_subdirs' src-tauri/src/data_dir.rs && \
      grep -q 'pub fn ensure_default_config' src-tauri/src/data_dir.rs && \
      grep -q 'pub fn ensure' src-tauri/src/data_dir.rs && \
      grep -q 'pub fn build_db_url' src-tauri/src/data_dir.rs && \
      grep -q 'dunce::canonicalize' src-tauri/src/data_dir.rs && \
      grep -q "replace('\\\\\\\\', \"/\")" src-tauri/src/data_dir.rs && \
      grep -q 'covers' src-tauri/src/data_dir.rs && \
      grep -q 'screenshots' src-tauri/src/data_dir.rs && \
      grep -q 'saves' src-tauri/src/data_dir.rs && \
      grep -q 'logs' src-tauri/src/data_dir.rs && \
      grep -q '"default_locale": "ja-JP"' src-tauri/src/data_dir.rs && \
      grep -q 'pub fn migrations' src-tauri/src/db.rs && \
      grep -q 'include_str!("../migrations/0001_init.sql")' src-tauri/src/db.rs && \
      grep -q 'MigrationKind::Up' src-tauri/src/db.rs && \
      grep -q 'version: 1' src-tauri/src/db.rs && \
      cargo check --manifest-path src-tauri/Cargo.toml
    </automated>
  </verify>
  <acceptance_criteria>
    - `src-tauri/src/data_dir.rs` 存在，公开 5 个函数：`resolve_data_dir`、`ensure_subdirs`、`ensure_default_config`、`ensure`、`build_db_url`
    - `data_dir.rs` 调用 `dunce::canonicalize` 处理 UNC 前缀（grep 命中）
    - `data_dir.rs` 的 `build_db_url` 把反斜杠替换为正斜杠（grep 命中 `replace('\\', "/")`）
    - `data_dir.rs` 的 `SUBDIRS` 常量含 `covers / screenshots / saves / logs` 四项
    - `data_dir.rs` 的 `DEFAULT_CONFIG_JSON` 含 `default_locale: "ja-JP"` 与 `scan_roots: []` 与 `le_path: null`
    - `data_dir.rs` 含 `#[cfg(test)] mod tests` 单测块，至少有 `build_db_url_uses_forward_slashes_and_absolute_path` 与 `ensure_creates_subdirs_and_default_config_idempotently` 两个测试函数
    - `src-tauri/src/db.rs` 存在，公开 `migrations()` 返回 `Vec<Migration>`
    - `db.rs` 通过 `include_str!("../migrations/0001_init.sql")` 嵌入 SQL（不重复手写 schema）
    - `db.rs` 含 `version: 1` + `MigrationKind::Up`
    - `db.rs` 单测断言 5 张表名 + `'schema_version', '1'` 都在 SQL 字符串里
    - `cargo check --manifest-path src-tauri/Cargo.toml` 退出码 0（既有 lib.rs 未被本任务破坏）
    - 此任务**未**修改 `src-tauri/src/lib.rs`、**未**创建 `src/lib/db.ts`（Task 3 才做）
  </acceptance_criteria>
  <done>
    portable 数据目录解析 + 默认 config 生成 + sql plugin migration vec 三块 Rust 业务逻辑就位且各自带单元测试；下游 Task 3 只需声明 mod、调 ensure()、注册 plugin、暴露 command。
  </done>
</task>

<task type="auto">
  <name>Task 3: 接线 lib.rs（声明 mod + setup hook + register sql plugin + get_data_dir command）+ 前端 db.ts helper + 实测 path_mapper bypass</name>
  <files>
    src-tauri/src/lib.rs,
    src/lib/db.ts
  </files>
  <read_first>
    D:\project\gal-lib\src-tauri\src\lib.rs (01a 产物，最小骨架；本任务覆写为含 mod 声明 + plugin 注册 + setup + command 的完整版本),
    D:\project\gal-lib\src-tauri\src\data_dir.rs (Task 2 产物),
    D:\project\gal-lib\src-tauri\src\db.rs (Task 2 产物),
    D:\project\gal-lib\src-tauri\Cargo.toml (Task 1 产物，确认 lib name 为 gal_lib_lib),
    D:\project\gal-lib\src-tauri\capabilities\default.json (Task 1 产物，确认 sql:* 权限已开),
    D:\project\gal-lib\.planning\phases\01-foundation\01-RESEARCH.md (§ Pattern 3 SQL Plugin Registration, § Pitfall 1 path_mapper bypass, § Assumptions Log A1)
  </read_first>
  <action>
    本任务把 Task 2 的 Rust 模块接进 Tauri Builder pipeline，并打通前端，最终通过实测确认 RESEARCH §A1 的 path_mapper bypass 假设成立。

    1. **完整覆写 `D:\project\gal-lib\src-tauri\src\lib.rs`**:

       ```rust
       mod data_dir;
       mod db;

       use std::path::PathBuf;

       /// State managed by Tauri; exposed to the frontend via the `get_data_dir` command.
       pub struct AppPaths {
           pub data_dir: PathBuf,
           pub db_url: String,
       }

       /// Tauri command: returns the absolute, canonicalized `data/` directory path.
       /// The frontend appends `/app.db` itself (see `src/lib/db.ts`) — keeping the
       /// command return value path-only makes it reusable for cover/screenshot/save
       /// helpers in later phases.
       #[tauri::command]
       fn get_data_dir(state: tauri::State<AppPaths>) -> String {
           state.data_dir.to_string_lossy().to_string()
       }

       #[cfg_attr(mobile, tauri::mobile_entry_point)]
       pub fn run() {
           // 1. Resolve + ensure the portable data directory BEFORE building Tauri,
           //    so tauri-plugin-sql can register the migration against an absolute
           //    on-disk path. Failure here is a hard panic — the app cannot run
           //    without writable data dir.
           let data_dir = data_dir::ensure()
               .expect("failed to initialize portable data directory");

           // 2. Construct the sqlite URL with forward-slashes and ABSOLUTE path.
           //    The plugin's path_mapper does `app_path.push(connection_string)`
           //    and PathBuf::push(absolute) replaces app_path entirely (RESEARCH §A1),
           //    bypassing the default app_config_dir join.
           let db_url = data_dir::build_db_url(&data_dir);

           // 3. Print the resolved path so dev runs visibly confirm the bypass worked.
           //    (Replaced by tauri-plugin-log in a later plan; println is sufficient
           //     for Phase 1 bring-up smoke testing.)
           eprintln!("[gal-lib] portable data_dir = {}", data_dir.display());
           eprintln!("[gal-lib] sqlite url = {}", db_url);

           let migrations = db::migrations();

           tauri::Builder::default()
               .plugin(
                   tauri_plugin_sql::Builder::default()
                       .add_migrations(&db_url, migrations)
                       .build(),
               )
               .manage(AppPaths {
                   data_dir,
                   db_url,
               })
               .invoke_handler(tauri::generate_handler![get_data_dir])
               .run(tauri::generate_context!())
               .expect("error while running tauri application");
       }
       ```

       注意：
       - `mod data_dir;` 与 `mod db;` 必须放在文件最顶端，紧跟 `mod` 声明的常规位置。
       - 不引入 `tauri_plugin_log` —— 不在本 plan 范围。
       - `#[tauri::command]` 函数 `get_data_dir` 取 `tauri::State<AppPaths>`，按值返回 `String`（自动 JSON 序列化）。
       - `data_dir::ensure()` 在 `tauri::Builder::default()` **之前**调用 —— 如 RESEARCH § Pattern 3 所示，确保 setup 阶段 plugin 注册前数据目录就绪。
       - 不在 `setup` hook 里做 ensure —— 因为 plugin 注册需要绝对 db_url，必须在 Builder 构建之前算出。

    2. **创建 `D:\project\gal-lib\src\lib\db.ts`** (前端单例 helper):

       ```ts
       import Database from "@tauri-apps/plugin-sql";
       import { invoke } from "@tauri-apps/api/core";

       let dbPromise: Promise<Database> | null = null;

       /**
        * Resolve the portable data dir (e.g. `C:/.../data` or
        * `.../target/debug/data` in dev) by calling the Rust `get_data_dir` command.
        * Path returned uses the OS-native separator; convert to forward slashes
        * before passing to sqlx via `Database.load`.
        */
       export async function getDataDir(): Promise<string> {
         return invoke<string>("get_data_dir");
       }

       /**
        * Lazy singleton accessor for the SQLite connection.
        * First call: invokes `get_data_dir`, builds `sqlite:<abs>/app.db` URL,
        * and triggers tauri-plugin-sql to open the connection (which also runs
        * pending migrations on first open).
        */
       export function getDb(): Promise<Database> {
         if (!dbPromise) {
           dbPromise = (async () => {
             const dataDir = await getDataDir();
             const url = `sqlite:${dataDir.replace(/\\/g, "/")}/app.db`;
             return Database.load(url);
           })();
         }
         return dbPromise;
       }
       ```

       注意：
       - 路径 `D:\project\gal-lib\src\lib\db.ts` —— 如果 `src/lib/` 目录不存在，先创建。
       - 不在本任务里 import 这个 helper 进 App.tsx —— App.tsx 还是 01a 留下的 "Hello gal-lib" 占位；真正的业务 import 在 01d/Phase 2。
       - `dbPromise` 单例避免反复打开连接（同一个进程的同一个 SQLite 文件多次 `Database.load` 会被 plugin 内部 dedupe，但单例显式更省事）。

    3. **运行 `pnpm tsc --noEmit`** —— TS strict 必须通过（验证 db.ts 无类型错误）。

    4. **运行 `cargo check --manifest-path src-tauri/Cargo.toml`** —— Rust 必须通过。

    5. **运行 `cargo test --manifest-path src-tauri/Cargo.toml`** —— 跑 Task 2 的单测：
       - `data_dir::tests::build_db_url_uses_forward_slashes_and_absolute_path` 必须 pass
       - `data_dir::tests::ensure_creates_subdirs_and_default_config_idempotently` 必须 pass
       - `db::tests::migrations_v1_includes_required_objects` 必须 pass

    6. **实测：path_mapper bypass + schema 初始化（关键，RESEARCH §A1 假设验证）**

       6.1. **冷启动前清理**：删除任何残留：
       ```powershell
       Remove-Item -Recurse -Force D:\project\gal-lib\src-tauri\target\debug\data -ErrorAction SilentlyContinue
       # 同时清理可能出现的 APPDATA 误写位置：
       Remove-Item -Recurse -Force "$env:APPDATA\com.gal-lib.app" -ErrorAction SilentlyContinue
       ```

       6.2. **启动 dev 模式**：`cd D:\project\gal-lib && pnpm tauri dev`
       - 等待 cargo build → vite dev → 主窗口出现（窗口里仍是 01a 留下的 `Hello gal-lib` —— 本 plan 不改 UI）
       - 看到主窗口出现后等 5 秒（让 plugin 完成首次连接 + migration 执行）

       6.3. **关键断言（必须全部成立才算通过）：**
       - `D:\project\gal-lib\src-tauri\target\debug\data\app.db` 文件**存在**（不为 0 字节）
       - `D:\project\gal-lib\src-tauri\target\debug\data\config.json` 文件**存在**且首次启动时含默认 `"default_locale": "ja-JP"`
       - 子目录全部存在：`target\debug\data\covers\`、`target\debug\data\screenshots\`、`target\debug\data\saves\`、`target\debug\data\logs\`
       - `%APPDATA%\com.gal-lib.app\` 目录**不存在**（这是 path_mapper bypass 的核心断言：APP-01 不变量）
       - 启动时 stderr 输出 `[gal-lib] portable data_dir = ...target\debug\data` 与 `[gal-lib] sqlite url = sqlite:.../target/debug/data/app.db`（确认 url 用正斜杠 + 绝对路径）

       6.4. **schema 校验**：手动 Ctrl+C 中断 dev 进程后，用 sqlite3 CLI（如已安装）或 Rust 一次性脚本验证：
       ```powershell
       # 优先用 sqlite3.exe（Windows 自带 winget 可装）
       sqlite3 D:\project\gal-lib\src-tauri\target\debug\data\app.db ".tables"
       # 期望输出（顺序可能不同）: app_meta  game_tags  games  sessions  tags  _sqlx_migrations
       sqlite3 D:\project\gal-lib\src-tauri\target\debug\data\app.db "SELECT value FROM app_meta WHERE key='schema_version'"
       # 期望输出: 1
       sqlite3 D:\project\gal-lib\src-tauri\target\debug\data\app.db "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
       # 期望输出含: idx_sessions_game_id, idx_sessions_started_at, idx_game_tags_tag_id
       ```
       如果 sqlite3 CLI 不可用，用 `cargo run --manifest-path src-tauri/Cargo.toml --example verify_schema`（不要新建 example，跳过 CLI 用 rusqlite/sqlx 一次性脚本不是 v1 范围）—— **简化做法**：在 SUMMARY.md 中记录 sqlite3 不可用，转用前端 `getDb()` + `db.select(...)` 在 dev 模式手动验证（开 DevTools → Console 跑 `(await (await import('/src/lib/db.ts')).getDb()).select("SELECT * FROM app_meta")` 看到 `[{key:'schema_version', value:'1'}]`）。

       6.5. **持久化校验（APP-02 不变量）**：再次 `pnpm tauri dev` 启动，确认：
       - `data/app.db` 不会被重新初始化（用 sqlite3 看 `_sqlx_migrations` 表只有 1 行 version=1 + 一个 success 时间戳，证明二次启动 plugin 跳过了已应用 migration）
       - `data/config.json` 的内容（如果你在 6.3 之后手动改过它）不被覆盖

    7. **写实测结果到 SUMMARY**: 在最终的 `01c-SUMMARY.md` 中记录：
       - 6.3 中 stderr 实际打印的两行（dev 模式下 data_dir 与 db url 完整字面值）
       - 6.4 中 `.tables` 与 `SELECT schema_version` 的实际输出
       - `%APPDATA%\com.gal-lib.app\` 是否存在（应为 No）
       - RESEARCH §A1 假设状态：CONFIRMED / BROKEN（如果 BROKEN 立刻停下来按 §A1 fallback 切到 sqlx 直连方案）
  </action>
  <verify>
    <automated>
      cd D:\project\gal-lib && \
      grep -q '^mod data_dir;' src-tauri/src/lib.rs && \
      grep -q '^mod db;' src-tauri/src/lib.rs && \
      grep -q 'pub struct AppPaths' src-tauri/src/lib.rs && \
      grep -q '#\[tauri::command\]' src-tauri/src/lib.rs && \
      grep -q 'fn get_data_dir' src-tauri/src/lib.rs && \
      grep -q 'data_dir::ensure()' src-tauri/src/lib.rs && \
      grep -q 'data_dir::build_db_url' src-tauri/src/lib.rs && \
      grep -q 'tauri_plugin_sql::Builder' src-tauri/src/lib.rs && \
      grep -q 'add_migrations(&db_url' src-tauri/src/lib.rs && \
      grep -q 'tauri::generate_handler!\[get_data_dir\]' src-tauri/src/lib.rs && \
      ! grep -q 'tauri_plugin_log' src-tauri/src/lib.rs && \
      test -f src/lib/db.ts && \
      grep -q 'import Database from "@tauri-apps/plugin-sql"' src/lib/db.ts && \
      grep -q "invoke<string>(\"get_data_dir\")" src/lib/db.ts && \
      grep -q 'export function getDb' src/lib/db.ts && \
      grep -q 'Database.load' src/lib/db.ts && \
      grep -q 'replace(/\\\\/g, "/")' src/lib/db.ts && \
      pnpm tsc --noEmit && \
      cargo check --manifest-path src-tauri/Cargo.toml && \
      cargo test --manifest-path src-tauri/Cargo.toml --lib && \
      # ── Portable invariant (APP-01) — automated assertion (W-3 fix) ──
      # The executor runs `pnpm tauri dev` once (background, kill after ~10s) before this verify block,
      # OR runs `cargo test --bin gal-lib -- --ignored portable_smoke` if a smoke test is added.
      # These assertions confirm the path_mapper bypass is holding in dev mode.
      test -f src-tauri/target/debug/data/app.db && \
      test -s src-tauri/target/debug/data/app.db && \
      test -f src-tauri/target/debug/data/config.json && \
      grep -q '"default_locale": "ja-JP"' src-tauri/target/debug/data/config.json && \
      test -d src-tauri/target/debug/data/covers && \
      test -d src-tauri/target/debug/data/screenshots && \
      test -d src-tauri/target/debug/data/saves && \
      test -d src-tauri/target/debug/data/logs && \
      [ ! -d "$APPDATA/com.gal-lib.app" ]
    </automated>
  </verify>
  <acceptance_criteria>
    - `src-tauri/src/lib.rs` 顶端含 `mod data_dir;` 与 `mod db;` 两行声明
    - `src-tauri/src/lib.rs` 含 `pub struct AppPaths { pub data_dir: PathBuf, pub db_url: String }`
    - `src-tauri/src/lib.rs` 含 `#[tauri::command] fn get_data_dir(state: tauri::State<AppPaths>) -> String`
    - `src-tauri/src/lib.rs` 在 `tauri::Builder::default()` **之前** 调 `data_dir::ensure()` —— grep 行号顺序：`data_dir::ensure()` 在 `tauri::Builder::default()` 之前出现（手动确认；automated grep 仅断存在）
    - `src-tauri/src/lib.rs` 用 `add_migrations(&db_url, migrations)` 注册 sql plugin
    - `src-tauri/src/lib.rs` 注册 invoke_handler `get_data_dir`
    - `src-tauri/src/lib.rs` 不引入 `tauri_plugin_log`
    - `src/lib/db.ts` 存在，含 `getDb()` 单例 + `getDataDir()` helper；正确把反斜杠替换为正斜杠
    - `pnpm tsc --noEmit` 退出码 0
    - `cargo check --manifest-path src-tauri/Cargo.toml` 退出码 0
    - `cargo test --manifest-path src-tauri/Cargo.toml --lib` 退出码 0，至少 3 个测试 pass（data_dir 两个 + db 一个）
    - **实测断言（手动观察 + SUMMARY 记录）：**
      - `pnpm tauri dev` 启动后窗口出现，stderr 打印的 `[gal-lib] portable data_dir = ...` 路径以 `target\debug\data` 结尾（dev 模式预期）
      - 启动后 `D:\project\gal-lib\src-tauri\target\debug\data\app.db` 存在且 > 0 字节
      - `D:\project\gal-lib\src-tauri\target\debug\data\config.json` 存在，含 `"default_locale": "ja-JP"`
      - 子目录 `covers/screenshots/saves/logs/` 全部存在
      - `%APPDATA%\com.gal-lib.app\` **不**存在（path_mapper bypass 验证 — APP-01 不变量的最关键断言）
      - 通过 sqlite3 CLI 或前端 DevTools `getDb().select("SELECT value FROM app_meta WHERE key='schema_version'")` 返回 `[{key:'schema_version', value:'1'}]`
      - 二次启动 dev 不会重新执行 migration（sqlx `_sqlx_migrations` 表保留首次执行记录），用户手改的 config.json 不被覆盖
  </acceptance_criteria>
  <done>
    Tauri 应用启动时自动在 exe 同级（dev 下 target/debug/）创建完整 portable data 树、SQLite app.db 已应用 schema v1、`%APPDATA%` 不出现，APP-01 与 APP-02 实测验证通过；前端 `import { getDb } from "@/lib/db"` 即可在 01d 与 Phase 2 业务里直接使用。
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| filesystem → process | `current_exe()` 返回的路径用于派生 data/ 与 sqlite URL。在 Windows portable 场景下，攻击者控制 exe 旁边的目录就等同于控制 data 目录 — 这是 portable 模式的固有 trust 模型，不在 Phase 1 内缓解 |
| frontend (WebView) → Rust commands | `get_data_dir` 命令向前端暴露绝对路径字符串。前端是同一进程，但路径泄露给可能加载的远程内容（v1 不加载远程内容；CSP=null 暂存）会有微小信息暴露面 |
| filesystem → SQLite | `data/app.db` 是用户可读写文件。其他用户进程（同账户）可直接读改，等同 portable 应用的常规边界 |
| WebView → SQLite (via plugin) | 前端 `Database.load` + `db.select/execute` 经过 tauri-plugin-sql 走 sqlx；命令权限受 `capabilities/default.json` 中 `sql:allow-load/execute/select` 的 ACL 控制 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-01 | Tampering | `data/app.db` 文件 | accept | Portable 模式下数据库与 exe 同级，假定单用户单机；同账户进程篡改是 portable 模型的固有面，不在 Phase 1 内做文件加密。后续可考虑 SQLCipher（v2 议题） |
| T-01-02 | Information Disclosure | `get_data_dir` 命令 | mitigate | 命令仅返回当前 OS 用户已知的路径（current_exe 的父目录），不泄露其它敏感信息。CSP=null 是 01a 暂存，01e 不收紧；下游 plan 加载远程内容前必须先收紧 CSP（标记为 Phase 2/3 待办） |
| T-01-03 | Denial of Service | `data_dir::ensure()` panics on failure | accept | 数据目录创建失败 → 应用启动 panic（fail-fast）。这是设计选择：portable 应用没有数据目录就完全无法运行，启动期 panic 比 silent degradation 更安全 |
| T-01-04 | Tampering | migration SQL via include_str! | mitigate | SQL 在编译期嵌入二进制，运行时无法替换文件改 schema；`tauri-plugin-sql` 内部用 sqlx Migrator 校验 checksum (RESEARCH § Don't Hand-Roll) |
| T-01-05 | Spoofing | path_mapper bypass 失效（A1 假设破裂） | mitigate | Task 3 step 6.3 的实测断言会立刻发现：如果 `%APPDATA%\com.gal-lib.app\` 出现而 `target/debug/data/app.db` 缺失，立即停下并按 RESEARCH §A1 fallback 切到 sqlx 直连方案 |
| T-01-06 | Elevation of Privilege | sql:allow-execute 暴露任意 SQL 给前端 | accept | v1 单进程单用户，前端代码与 Rust 同 trust；Phase 1 用便利换简化是可接受的。Phase 4 引入用户自定义 SQL fragment（搜索/筛选）时再考虑 prepared statement only 的更窄权限 (Phase 4 议题) |
| T-01-07 | Repudiation | 无审计日志 | accept | v1 是单用户 portable 应用，不需要审计 trail；后续 plan 加 tauri-plugin-log 后业务日志足够 |
</threat_model>

<verification>
**Plan-level checks (执行完所有 task 后整体复验):**

1. **依赖锁定校验:**
   ```powershell
   cd D:\project\gal-lib
   findstr /C:"tauri-plugin-sql" src-tauri\Cargo.toml      # 必须命中 + features=["sqlite"]
   findstr /C:"@tauri-apps/plugin-sql" package.json        # 必须命中 ^2.4
   findstr /C:"dunce" src-tauri\Cargo.toml                 # 必须命中
   findstr /C:"tauri-plugin-log" src-tauri\Cargo.toml      # 必须无命中（不在本 plan 范围）
   ```

2. **schema migration 锁定:**
   ```powershell
   findstr /C:"CREATE TABLE games" src-tauri\migrations\0001_init.sql
   findstr /C:"CREATE TABLE sessions" src-tauri\migrations\0001_init.sql
   findstr /C:"CREATE TABLE tags" src-tauri\migrations\0001_init.sql
   findstr /C:"CREATE TABLE game_tags" src-tauri\migrations\0001_init.sql
   findstr /C:"CREATE TABLE app_meta" src-tauri\migrations\0001_init.sql
   findstr /C:"'schema_version', '1'" src-tauri\migrations\0001_init.sql
   findstr /C:"is_favorite" src-tauri\migrations\0001_init.sql   # 必须无命中（不在 v1 schema）
   ```

3. **path_mapper bypass 实测断言（APP-01 不变量）:**
   ```powershell
   # 启动 pnpm tauri dev 后，等 5 秒，然后另开一个 PowerShell:
   if (Test-Path "$env:APPDATA\com.gal-lib.app") { Write-Error "APP-01 violated: %APPDATA% leaked"; exit 1 }
   if (-not (Test-Path "D:\project\gal-lib\src-tauri\target\debug\data\app.db")) { Write-Error "APP-02 violated: app.db missing"; exit 1 }
   if (-not (Test-Path "D:\project\gal-lib\src-tauri\target\debug\data\config.json")) { Write-Error "config.json missing"; exit 1 }
   foreach ($sub in "covers","screenshots","saves","logs") {
     if (-not (Test-Path "D:\project\gal-lib\src-tauri\target\debug\data\$sub")) { Write-Error "subdir $sub missing"; exit 1 }
   }
   Write-Host "APP-01 + APP-02 实测通过"
   ```

4. **schema_version SQL 校验（如果 sqlite3 CLI 可用）:**
   ```powershell
   $v = sqlite3 D:\project\gal-lib\src-tauri\target\debug\data\app.db "SELECT value FROM app_meta WHERE key='schema_version'"
   if ($v -ne "1") { Write-Error "schema_version got '$v', expected '1'"; exit 1 }
   ```

5. **Rust 单元测试 + TS strict + cargo check:**
   ```powershell
   cd D:\project\gal-lib
   cargo test --manifest-path src-tauri/Cargo.toml --lib
   cargo check --manifest-path src-tauri/Cargo.toml
   pnpm tsc --noEmit
   ```

6. **本 plan 不应越权写入未来 plan 的字段:**
   ```powershell
   findstr /C:"tailwindcss" package.json                       # 必须无命中（01b 才加）
   findstr /C:"shadcn" package.json                            # 必须无命中（01b 才加）
   findstr /C:"decorations" src-tauri\tauri.conf.json          # 必须无命中（01e 才写）
   findstr /C:"tauri-plugin-log" src-tauri\Cargo.toml          # 必须无命中（不在本 plan）
   findstr /C:"core:window:" src-tauri\capabilities\default.json # 必须无命中（01e 才加）
   ```
</verification>

<success_criteria>
1. **APP-01 (Portable) 不变量实测通过**: 启动后 `data/` 严格落在 exe 同级（dev 模式下 `src-tauri/target/debug/data/`），`%APPDATA%\com.gal-lib.app\` 不存在
2. **APP-02 (首次启动初始化) 不变量实测通过**: 首次启动后 `data/app.db` + `data/config.json` + 4 个子目录全部就位；二次启动不重复执行 migration（sqlx `_sqlx_migrations` 仅有 version=1 一行）也不覆盖用户改过的 config.json
3. **Schema v1** 在 SQL 文件中 verbatim 落盘（5 表 + 3 索引 + INSERT schema_version='1'），`include_str!` 编译期嵌入；运行时 `SELECT value FROM app_meta WHERE key='schema_version'` 返回 `1`
4. **path_mapper bypass (RESEARCH §A1)** 假设 CONFIRMED，并在 SUMMARY.md 记录实测路径输出作为证据
5. **Rust 单元测试** 三个 pass：`build_db_url_uses_forward_slashes_and_absolute_path`、`ensure_creates_subdirs_and_default_config_idempotently`、`migrations_v1_includes_required_objects`
6. **类型与编译双绿**: `pnpm tsc --noEmit` + `cargo check` + `cargo test --lib` 全部退出码 0
7. **前端 helper 就位**: `src/lib/db.ts` 暴露 `getDb()` + `getDataDir()` 单例，可被 01d 与 Phase 2 业务直接 import；本 plan 不要求 App.tsx 引入它（不越权改 UI）
8. **越界检查通过**: 本 plan 未触碰 Tailwind/shadcn/Layout/titlebar/bundle 字段，文件清单严格在 frontmatter `files_modified` 范围内
9. `cargo fetch` 与 `pnpm install` 已被运行过，`pnpm-lock.yaml` 含 `@tauri-apps/plugin-sql` 解析记录
</success_criteria>

<output>
After completion, create `D:\project\gal-lib\.planning\phases\01-foundation\01c-SUMMARY.md` 含：

- 实测的 stderr 输出两行（`[gal-lib] portable data_dir = ...` 与 `[gal-lib] sqlite url = ...`），原样粘贴作为 path_mapper bypass 的证据
- 实测时 `%APPDATA%\com.gal-lib.app\` 是否存在（**应为 No**；如果 Yes 立刻停止本 plan 并按 RESEARCH §A1 fallback 切到 sqlx 直连方案 — 重新规划）
- `sqlite3 ... ".tables"` 输出（如 sqlite3 CLI 不可用，记录改用前端 DevTools `getDb()` 验证的 console 输出截图或文字）
- `SELECT value FROM app_meta WHERE key='schema_version'` 输出 (`1`)
- 二次启动校验：`_sqlx_migrations` 仅一行 + `config.json` 内容未变
- `cargo test --lib` 三个测试的 pass 时间
- 本 plan 实际锁定的 crate 版本号（`pnpm-lock.yaml` 与 `Cargo.lock` 解析后的具体版本，例如 `tauri-plugin-sql: 2.4.0`、`@tauri-apps/plugin-sql: 2.4.0`、`dunce: 1.0.5` 等）
- RESEARCH §A1 假设状态：**CONFIRMED** 或 **BROKEN**（含具体观察）
- 任何偏离 RESEARCH 草案的事项（例如 `is_favorite` 列被 plan_scope 移到后续 plan）— 已在 `<interfaces>` 中说明
- 已知遗留：CSP=null 仍未收紧（待 Phase 2/3 加载远程元数据图片前处理）；`sql:allow-execute` 权限较宽（v1 接受，Phase 4 收紧）
</output>
