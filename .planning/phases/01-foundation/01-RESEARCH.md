# Phase 1: Foundation - Research

**Researched:** 2026-05-07
**Domain:** Tauri v2 桌面应用脚手架 + portable 数据层 + SQLite migration + dual-pane shell + 单 exe 打包
**Confidence:** HIGH（核心栈版本与 API 已通过 npm registry / Cargo registry / 官方源码逐一验证；少数行为推论已标注）

## Summary

Phase 1 是从零搭建 Tauri v2 + React + TS 项目骨架，目标是双击单 exe 后自动初始化 portable 数据目录、写入 SQLite schema v1、呈现双栏 shell。最大的非显然技术风险是 **tauri-plugin-sql 的路径解析强制相对于 `app_config_dir`**（即 `%APPDATA%`），与项目锁定的 "exe 同级 data/" portable 模式冲突。研究通过阅读插件源码（`wrapper.rs::path_mapper`）发现一个未文档化但稳定的绕过方式：传入 **绝对路径作为 sqlite: 后的字符串**，由于 Rust `PathBuf::push` 在 push 绝对路径时会替换原路径，绝对路径会绕过 `app_config_dir` 拼接 — 这是实现 portable 的关键机制。

第二大坑是 Tauri 默认不支持 portable 单 exe 分发：`pnpm tauri build` 默认产 NSIS 安装器（`-setup.exe`）或 MSI；要拿 portable 单 exe 必须用 `--no-bundle` 拿 `target/release/<app>.exe`。但 WebView2 Runtime 是外部依赖（Win10 1803+ 自带，Win11 内置），不打进 exe — 这恰好让产物保持 < 30MB。

第三是 React Router：项目 CONTEXT 锁定 v6，但 npm latest 已是 v7；HashRouter v6 在 Tauri 内可正常工作（因为 hash 不发到服务器，避免 Tauri 自定义协议下的刷新问题）。

**Primary recommendation：** 按 PLAN-OUTLINE 已规划的 6 个 plan（01a–01f）执行，重点关注 01c（portable + DB）的绝对路径技巧、01e（titlebar + decorations:false + 权限 capability）、01f（`pnpm tauri build --no-bundle` + Cargo opt-level="s" 实现 < 30MB）。

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Build Tooling & Stack Versions**
- 包管理器：**pnpm**
- Tauri 主版本：**Tauri v2**
- 前端构建工具：**Vite**
- TypeScript 严格模式：**strict: true**

**Backend & Database**
- SQLite 库：**tauri-plugin-sql (sqlx 后端)**
- 迁移策略：**嵌入 SQL 文件**，放置于 `src-tauri/migrations/`，按时间戳命名
- 连接策略：**单连接**
- Schema 版本控制：`app_meta(key TEXT PRIMARY KEY, value TEXT)` 表，存 `schema_version`

**Frontend App Shell**
- 状态管理：**Zustand**
- 路由：**react-router-dom v6（HashRouter）**
- UI 组件库底座：**shadcn/ui**
- 字体：中文默认 + 系统字体栈（不引入 i18n）
- Tailwind 版本：**v3.x**

**Portable Data Layout & Init**
- 数据目录：**exe 同级 `data/`**（通过 Tauri Rust API 取 exe parent dir）
- 首次初始化：静默自动创建
- 配置文件：JSON (`data/config.json`)
- 子目录：`data/{app.db, config.json, covers/, screenshots/, saves/, logs/}`

**UI 锁定**（来自 UI-SPEC）：
- 双栏布局：220px Sidebar + 自适应 Main，36px 自定义 titlebar
- 暗色模式 only（galgame 夜间使用偏好）
- 调色板：`#0F1115`（主背景）/ `#181B22`（侧栏/titlebar）/ `#21252E`（hover）/ `#2A2F3A`（border）/ `#E5E7EB`（主文字）/ `#9CA3AF`（弱化文字）/ `#7C5CFF`（accent，仅用于 focus ring + 选中标记）/ `#EF4444`（destructive，仅 close 按钮 hover）
- 字号：14/13/18/13 (Body/Label/Heading/Display)
- 系统字体栈：`ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif`
- 窗口默认 1280×800，最小 960×600
- 文案契约（UI-SPEC § Copywriting）逐字锁定，不允许 emoji/感叹号/单部分文案
- shadcn/ui CLI 默认 `new-york` style + CSS 变量主题

### Claude's Discretion

- `src/`（前端）和 `src-tauri/`（Rust 后端）内部子模块分组结构
- App Shell 占位文案的边距、配色细节（在 UI-SPEC 规定范围内）
- 数据库初版 schema 的列细节（核心表外的字段、索引、外键）
- 前端 CSS 变量命名约定
- Rust crate 选择（除 tauri-plugin-sql 外，如日志 / 错误处理 crate）

### Deferred Ideas (OUT OF SCOPE)

- 系统托盘（Phase 3）
- 实际可点击的导航与分类筛选（Phase 4）
- 游戏卡片网格虚拟化（Phase 2）
- 设置页交互（Phase 4，本期仅占位路由）
- 错误边界与全局错误提示组件（待出现实际数据流后再加）
- 自动更新（明确 Out of Scope）
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| APP-01 | Portable 模式：所有用户数据放 exe 同目录 `data/` | § Architecture Patterns（Portable Data Dir Resolution）+ § Pitfalls（path_mapper 绕过技巧） |
| APP-02 | 首次启动自动初始化 DB schema、默认 config、目录结构 | § Standard Stack（tauri-plugin-sql Migration）+ § Code Examples（首次启动 init flow）+ § Architecture Patterns（schema v1） |
| APP-03 | 单 .exe 分发，< 30MB | § Single-Exe Bundle（`--no-bundle` + Cargo opt-level=s + LTO）+ § Pitfalls（WebView2 外部依赖） |
| LIB-01 | 双栏布局（左侧边栏 + 右侧主区） | § Architecture Patterns（Layout）+ § Code Examples（Sidebar + Main + ScrollArea） |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Portable 数据目录解析（exe parent） | Rust 后端 | — | `std::env::current_exe()` 与文件系统 IO 必须在 Rust 侧；前端无 fs 权限 |
| 数据目录创建 / 子目录初始化 | Rust 后端（`setup` hook） | — | 在窗口出现前完成，确保 React 启动时数据层就绪 |
| SQLite migration 注册与执行 | Rust 后端（`tauri_plugin_sql::Builder`） | — | 插件在 Rust 侧定义 `Vec<Migration>`，sqlx Migrator 执行 |
| SQL 查询接口（前端） | 前端（`@tauri-apps/plugin-sql`） | Rust（IPC 路由 commands::execute/select） | 前端调用 `Database.load()` → IPC → Rust sqlx 执行 |
| 路由 / 页面渲染 | 前端（React + react-router-dom HashRouter） | — | 经典 SPA |
| 状态管理（占位 store） | 前端（Zustand） | — | 客户端状态 |
| 主题 / 样式（暗色调色板） | 前端（Tailwind + CSS vars） | — | 纯样式层 |
| 自定义 titlebar 渲染 | 前端（React 组件） | — | DOM + `data-tauri-drag-region` 属性 |
| 窗口控制（min/max/close） | 前端调用 → Rust 执行 | Rust（核心 window 插件） | 前端 `getCurrentWindow().minimize()` → IPC → Rust API |
| 应用入口与窗口创建 | Rust 后端（`tauri.conf.json` + `Builder`） | — | Rust 主进程负责窗口生命周期 |
| 单 exe 打包 | Rust 工具链（cargo + Tauri bundler） | — | 编译期 |

## Standard Stack

### Core (Rust 后端)

| Crate | Version | Purpose | Why Standard |
|-------|---------|---------|--------------|
| `tauri` | 2.11.1 [VERIFIED: crates.io 2026-05-07] | 应用框架 | 锁定 v2 主线；当前最新稳定 |
| `tauri-build` | 2.x（与 tauri 同步） | 构建脚本 | 必须依赖 |
| `tauri-plugin-sql` | 2.4.0 [VERIFIED: crates.io 2026-05-07] | SQLite + sqlx 集成 + migration | CONTEXT 锁定；唯一官方 SQL 插件 |
| `serde` | 1.x | JSON 序列化 | Rust 生态事实标准（Tauri 自带依赖） |
| `serde_json` | 1.x | JSON 处理 | 用于 `data/config.json` 读写 |
| `anyhow` | 1.0.102 [VERIFIED: crates.io 2026-05-07] | 应用层错误处理 | Tauri command 返回类型友好 |
| `thiserror` | 2.0.18 [VERIFIED: crates.io 2026-05-07] | 库层错误类型派生 | 标记数据层错误便于上层映射 |
| `tracing` | 0.1.44 [VERIFIED: crates.io 2026-05-07] | 结构化日志 | 比 `log` crate 更现代；与 tauri-plugin-log 兼容 |
| `tauri-plugin-log` | 2.x [CITED: v2.tauri.app/plugin/logging] | 日志输出到文件 + console + 文件轮转 | 将日志写到 `data/logs/`，支持 size 轮转 |
| `dunce` | 1.0.5 [VERIFIED: crates.io 2026-05-07] | Windows 路径规范化 | `current_exe()` 在 Windows 可能返回 UNC 路径（`\\?\C:\...`），sqlx connect 不喜欢；用 `dunce::canonicalize` 转回常规形式 |

### Core (前端)

| Package | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@tauri-apps/api` | 2.11.0 [VERIFIED: npm registry 2026-05-07] | Tauri JS API（`getCurrentWindow`） | 必需 |
| `@tauri-apps/cli` | 2.11.1 [VERIFIED: npm registry 2026-05-07] | `pnpm tauri dev/build` 命令 | dev 依赖 |
| `@tauri-apps/plugin-sql` | 2.4.0 [VERIFIED: npm registry 2026-05-07] | 前端 `Database.load()` API | 与 Rust 端版本同步 |
| `react` | 19.2.6 [VERIFIED: npm registry 2026-05-07] | UI 库 | 当前最新 stable，配合 Vite |
| `react-dom` | 19.2.6 | DOM render | 配套 |
| `react-router-dom` | 6.30.3 [VERIFIED: npm registry 2026-05-07] | 路由（HashRouter） | CONTEXT 锁定 v6（latest 是 7.15.0，但项目锁 v6） |
| `zustand` | 5.0.x [ASSUMED: 网络问题未直连验证；training 知识 5.x 系当前主线] | 状态管理 | CONTEXT 锁定 |
| `tailwindcss` | 3.4.19 [VERIFIED: npm registry 2026-05-07] | 原子化 CSS | CONTEXT 锁定 v3.x；shadcn 旧版（new-york style 默认）兼容 v3 |
| `postcss` + `autoprefixer` | 8.x / 10.x | Tailwind v3 编译链 | 标准 |
| `@vitejs/plugin-react` | 5.0.13 [VERIFIED: npm registry 2026-05-07] | Vite React 插件 | 当前最新 |
| `vite` | 8.0.10 [VERIFIED: npm registry 2026-05-07] | dev server + 打包 | 注意：Vite 8 是较新主版本，Tauri create-tauri-app 模板可能仍用 Vite 6/7；若模板默认低于 8 也可接受，与 Tauri 兼容性以模板为准 |
| `typescript` | 5.x [VERIFIED: training + npm semver]（具体补丁号 init 后由模板锁定） | TS strict | 必需 |

### shadcn/ui 组件（Phase 1 仅 4 个 block）

| Block | Source | Purpose |
|-------|--------|---------|
| `button` | shadcn 官方 registry | titlebar 控制按钮 + 空状态 CTA |
| `separator` | shadcn 官方 registry | 侧栏分隔线 |
| `scroll-area` | shadcn 官方 registry | 侧栏 + 主区滚动容器 |
| `tooltip` | shadcn 官方 registry | 占位项 "即将开放" hover |

依赖会自动拉入：`@radix-ui/react-slot`、`@radix-ui/react-separator`、`@radix-ui/react-scroll-area`、`@radix-ui/react-tooltip`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react`。

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `tauri-plugin-sql` (sqlx) | `tauri-plugin-rusqlite2` 或直接用 `rusqlite` | sqlx 异步 + migration 内建；rusqlite 同步、更小体积，但 migration 需自己写 — CONTEXT 已锁 sqlx 路径，不动 |
| HashRouter | BrowserRouter / MemoryRouter | Tauri 用 `tauri://` / `https://tauri.localhost` 自定义协议；BrowserRouter 在生产构建后路径刷新有坑（已有 GitHub issue），HashRouter 安全 [CITED: github.com/tauri-apps/tauri/discussions/7899] |
| WAL journal mode | 默认 DELETE 模式 | WAL 性能更好但产生 `-wal/-shm` 兄弟文件；portable 模式下用户复制 `data/` 到新机器时这两个文件也要一起带，否则丢未 checkpoint 的写入。**v1 建议用默认 DELETE 模式**，等扫描/会话写入压力起来再考虑 [VERIFIED: sqlite.org/wal] |
| `tauri-plugin-log` | `tracing-subscriber` + 直接写文件 | 插件提供 IPC 桥（前端也能输出到同一日志），文件轮转/级别配置开箱即用 |
| Tailwind v4 | Tailwind v3 | shadcn/ui 当前主流模板仍以 v3 为基线；CONTEXT 已锁定 v3.x，不动 |

### Installation 命令（按执行顺序）

```bash
# 01a: 项目初始化
pnpm create tauri-app gal-lib
# 选择: TypeScript / pnpm / React / TypeScript

# 01b: Tailwind + shadcn
cd gal-lib
pnpm add -D tailwindcss@^3 postcss autoprefixer
pnpm dlx tailwindcss init -p
# tsconfig 增加 path alias 后:
pnpm add -D @types/node
pnpm dlx shadcn@latest init      # 选 new-york / Slate base / CSS vars yes
pnpm dlx shadcn@latest add button separator scroll-area tooltip

# 01c: SQL plugin + 状态/日志/错误
cd src-tauri
cargo add tauri-plugin-sql --features sqlite
cargo add anyhow thiserror tracing tauri-plugin-log dunce
cd ..
pnpm add @tauri-apps/plugin-sql

# 01d: 前端运行时
pnpm add zustand react-router-dom@^6
```

**Version verification 已完成 [VERIFIED: 2026-05-07 via `npm view` and `cargo search --registry crates-io`]：**
- `@tauri-apps/cli` → 2.11.1
- `@tauri-apps/api` → 2.11.0
- `@tauri-apps/plugin-sql` → 2.4.0
- `tauri` → 2.11.1
- `tauri-plugin-sql` → 2.4.0
- `anyhow` → 1.0.102
- `thiserror` → 2.0.18
- `tracing` → 0.1.44
- `dunce` → 1.0.5
- `react` → 19.2.6
- `react-router-dom` → 6.30.3
- `tailwindcss` → 3.4.19
- `vite` → 8.0.10
- `@vitejs/plugin-react` → 5.0.13
- `create-tauri-app` → 4.6.2

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                          User double-clicks gal-lib.exe              │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
       ┌────────────────────────────────────────────────┐
       │  Rust main → tauri::Builder                    │
       │   ├─ 1. resolve_data_dir() (current_exe→parent)│
       │   ├─ 2. ensure data/ + subdirs (create_dir_all)│
       │   ├─ 3. tauri-plugin-log init → data/logs/     │
       │   ├─ 4. tauri-plugin-sql Builder               │
       │   │     .add_migrations("sqlite:<ABS>", v1)    │
       │   ├─ 5. setup hook: load default config.json   │
       │   └─ 6. window 1280x800, decorations:false     │
       └──────────────────────────┬─────────────────────┘
                                  │
                  ┌───────────────┴────────────────┐
                  ▼                                ▼
       ┌──────────────────────┐       ┌────────────────────────────┐
       │  WebView2 boots      │       │  data/ on disk             │
       │  Vite-built bundle   │       │   ├─ app.db (schema v1)    │
       │   ├─ React tree      │       │   ├─ config.json           │
       │   ├─ HashRouter (/, │       │   ├─ covers/  (empty)      │
       │   │   /settings)     │       │   ├─ screenshots/ (empty)  │
       │   ├─ <Layout>        │       │   ├─ saves/ (empty)        │
       │   │   ├─ Titlebar    │       │   └─ logs/                 │
       │   │   ├─ Sidebar     │       │       └─ gal-lib.log       │
       │   │   └─ <Outlet/>   │       └────────────────────────────┘
       │   └─ shadcn UI       │                  ▲
       └──────────────────────┘                  │
                  │                              │
                  └──── IPC ─────────────────────┘
                  Database.load("sqlite:<ABS>") → DbPool
                  getCurrentWindow().{min/max/close}
```

数据流：用户双击 → Rust setup hook 在窗口创建前完成数据目录与 DB 初始化 → tauri-plugin-sql 注册 migration v1 但**不立即连接** → WebView2 加载 React → React 在 useEffect / store 初始化时调 `Database.load()` 触发 plugin 连接 + migration 执行 → 后续业务查询走 sqlx pool。

### Recommended Project Structure

```
gal-lib/
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml          # 可选；非 monorepo 可省
├── tsconfig.json                # 含 paths: { "@/*": ["src/*"] }
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts               # alias "@" → src/
├── tailwind.config.ts           # darkMode: ["class"]; theme.extend.colors 引 CSS var
├── postcss.config.js
├── components.json              # shadcn 配置（new-york / cssVariables: true / baseColor: "slate"）
├── index.html
├── src/                         # 前端
│   ├── main.tsx                 # createRoot + RouterProvider
│   ├── App.tsx                  # <RootLayout> 不在 router 内的总根
│   ├── index.css                # @tailwind base/components/utilities + :root vars
│   ├── styles/
│   │   └── titlebar.css         # 仅 titlebar 与 drag-region 局部样式
│   ├── routes/
│   │   ├── Library.tsx          # "/" empty state
│   │   └── Settings.tsx         # "/settings" 即将上线占位
│   ├── components/
│   │   ├── ui/                  # shadcn-generated: button.tsx, separator.tsx, scroll-area.tsx, tooltip.tsx
│   │   └── layout/
│   │       ├── RootLayout.tsx   # Titlebar + Sidebar + Main grid
│   │       ├── Titlebar.tsx     # data-tauri-drag-region wrapper
│   │       ├── WindowControls.tsx # 三个按钮
│   │       └── Sidebar.tsx
│   ├── lib/
│   │   ├── utils.ts             # shadcn cn() helper
│   │   └── db.ts                # Database.load wrapper（懒加载单例）
│   └── store/
│       └── useAppStore.ts       # Zustand placeholder
├── src-tauri/                   # 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/
│   │   └── default.json         # 主窗口的 ACL（window + sql 权限）
│   ├── icons/                   # 32/128/256 png + ico
│   ├── migrations/
│   │   └── 0001_init.sql        # v1 schema（include_str! 嵌入）
│   └── src/
│       ├── main.rs              # bootstrap → lib::run
│       ├── lib.rs               # tauri::Builder pipeline
│       ├── data_dir.rs          # resolve_data_dir() + ensure subdirs
│       ├── db.rs                # migration vec + helpers
│       ├── config.rs            # config.json schema + 默认值
│       └── error.rs             # AppError (thiserror)
└── data/                        # 运行时生成；.gitignore
```

### Pattern 1: Portable Data Dir Resolution (`src-tauri/src/data_dir.rs`)

**What:** 解析 exe 同级 `data/` 目录路径，并确保所有子目录存在。
**When:** 必须在 `tauri::Builder` 之前调用（在 `main()` 内或 `setup` hook 早期），因为 SQL plugin 的 migration 注册需要绝对路径作为参数。
**Critical:** Dev 模式下 `current_exe()` 指向 `target/debug/gal-lib.exe`，把 data/ 创建在 target/debug/ 下不影响功能但用户预期"项目根/data/"。建议 release 用 `current_exe`，dev 用 `cargo` 工作目录或 `CARGO_MANIFEST_DIR` env 派生 — 但**不推荐**为此引入 `#[cfg]` 分支；直接接受 dev 模式 data/ 在 target/debug/ 是最干净的，避免 dev/prod 行为分裂。

```rust
// Source: pattern derived from std::env::current_exe + dunce::canonicalize
// (no single canonical Tauri docs reference; verified via Rust stdlib + dunce crate docs)
use std::path::PathBuf;

pub fn resolve_data_dir() -> Result<PathBuf, std::io::Error> {
    // current_exe() returns full path to running binary.
    // .parent() returns its containing folder.
    // dunce::canonicalize strips Windows UNC \\?\ prefix that breaks sqlx connection strings.
    let exe = std::env::current_exe()?;
    let exe_dir = exe.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "exe has no parent")
    })?;
    let data = exe_dir.join("data");
    let canonical = dunce::canonicalize(exe_dir).unwrap_or_else(|_| exe_dir.to_path_buf());
    Ok(canonical.join("data"))
}

pub fn ensure_subdirs(data_dir: &std::path::Path) -> std::io::Result<()> {
    for sub in ["covers", "screenshots", "saves", "logs"] {
        std::fs::create_dir_all(data_dir.join(sub))?;
    }
    Ok(())
}
```

### Pattern 2: tauri-plugin-sql Absolute Path Bypass (核心)

**What:** 让 tauri-plugin-sql 把 SQLite 文件放在 exe 同级 `data/app.db`，而不是默认的 `%APPDATA%\<bundleid>\app.db`。
**Why it works:** [VERIFIED: github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/src/wrapper.rs#L319-L333] 插件的 `path_mapper` 实现是：
```rust
fn path_mapper(mut app_path: std::path::PathBuf, connection_string: &str) -> String {
    app_path.push(connection_string.split_once(':').expect(...).1);
    format!("sqlite:{}", app_path.to_str().expect(...))
}
```
Rust `PathBuf::push` 文档保证：**"如果 push 的路径是绝对路径，则替换原 path"** [VERIFIED: doc.rust-lang.org/std/path/struct.PathBuf.html#method.push]。所以传 `Database.load("sqlite:C:\\Users\\foo\\gal-lib\\data\\app.db")`（绝对路径）会让 `app_path.push(...)` 直接丢弃 `app_config_dir`，最终 sqlx 连的就是绝对路径。

**Caveat (LOW confidence on long-term stability):** 这是 `path_mapper` 当前实现的副作用，并非官方文档承诺的 API。理论上未来插件版本若改成 `app_path.join(filename)` 后做归一化，可能仍保留这个行为；若改成 `format!("sqlite:{}/{}", app_path, filename)` 字符串拼接，则会破坏。**缓解：** 在 02a 任务中加入"启动时验证 db 实际路径在 data/ 内"的断言（可读 sqlite_master 后用 `PRAGMA database_list` 验证），若假设破裂能立刻发现。

```rust
// Source: composed from path_mapper internals + tauri-plugin-sql Builder API
pub fn build_db_url(data_dir: &std::path::Path) -> String {
    let abs = data_dir.join("app.db");
    // sqlx connection string forward-slash safe on Windows; PathBuf to_string_lossy preserves slashes
    format!("sqlite:{}", abs.to_string_lossy().replace('\\', "/"))
}
```

### Pattern 3: SQL Plugin Registration with Migrations

**What:** Rust 侧注册 migration，前端调 `Database.load(<same db_url>)` 触发执行。
**When:** 在 `tauri::Builder` 链里 `.plugin(...)` 之前调 `add_migrations`。

```rust
// Source: https://v2.tauri.app/plugin/sql/ + verified against plugin source lib.rs
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

const INIT_SQL: &str = include_str!("../migrations/0001_init.sql");

pub fn run() -> anyhow::Result<()> {
    let data_dir = data_dir::resolve_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    data_dir::ensure_subdirs(&data_dir)?;

    let db_url = build_db_url(&data_dir);  // "sqlite:C:/.../data/app.db"

    let migrations = vec![Migration {
        version: 1,
        description: "init_schema",
        sql: INIT_SQL,
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default()
            .target(tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::Folder { path: data_dir.join("logs"), file_name: Some("gal-lib".into()) }
            ))
            .build())
        .plugin(SqlBuilder::default()
            .add_migrations(&db_url, migrations)
            .build())
        .setup(move |app| {
            // 把 db_url 放到 state，前端通过命令读取
            app.manage(AppPaths { data_dir: data_dir.clone(), db_url: db_url.clone() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![cmd::get_db_url])
        .run(tauri::generate_context!())?;
    Ok(())
}
```

前端：

```ts
// src/lib/db.ts
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

let dbPromise: Promise<Database> | null = null;

export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = invoke<string>("get_db_url").then((url) => Database.load(url));
  }
  return dbPromise;
}
```

### Pattern 4: Custom Titlebar with `data-tauri-drag-region`

**What:** 关闭原生 window decorations，画自己的 36px titlebar。
**Critical pitfall:** [VERIFIED: v2.tauri.app/learn/window-customization] **`data-tauri-drag-region` 不会自动传播到子元素。** 子元素若想可拖拽必须各自标注，否则在那个子元素上鼠标按下窗口不会移动。最稳模式：在 titlebar 外层 div 上加属性，但**所有内容（app 名、按钮区）作为兄弟节点放在它上面通过 CSS grid 定位**，让 drag region div 占据剩余空白；按钮自身不需要 `data-tauri-drag-region`。

```tsx
// src/components/layout/Titlebar.tsx
// Source: https://v2.tauri.app/learn/window-customization
import { WindowControls } from "./WindowControls";

export function Titlebar() {
  return (
    <header className="titlebar h-9 flex items-center select-none bg-[#181B22] border-b border-[#2A2F3A]">
      {/* drag region: 占据除按钮以外的所有空间 */}
      <div data-tauri-drag-region className="flex-1 h-full px-3 flex items-center text-[13px] font-medium text-[#E5E7EB]">
        gal-lib
      </div>
      <WindowControls />
    </header>
  );
}
```

```tsx
// src/components/layout/WindowControls.tsx
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

export function WindowControls() {
  const w = getCurrentWindow();
  return (
    <div className="flex h-full">
      <button onClick={() => w.minimize()} className="w-11 h-full hover:bg-[#21252E]"><Minus size={14} /></button>
      <button onClick={() => w.toggleMaximize()} className="w-11 h-full hover:bg-[#21252E]"><Square size={12} /></button>
      <button onClick={() => w.close()} className="w-11 h-full hover:bg-[#EF4444]"><X size={14} /></button>
    </div>
  );
}
```

```json
// src-tauri/capabilities/default.json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "sql:default",
    "sql:allow-load",
    "sql:allow-execute",
    "sql:allow-select",
    "sql:allow-close",
    "log:default"
  ]
}
```

### Pattern 5: Dark-First Theme via CSS Variables (no light mode)

UI-SPEC 锁定暗色 only。但 shadcn/ui 默认生成 `:root` 浅色 + `.dark` 深色双层。**推荐做法：保留 `.dark` 类（向前兼容 future light-mode），在 `<html class="dark">` 上常驻**，这样不必改 shadcn 默认 token 名，未来要加 light 直接去掉 class。

```css
/* src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* shadcn defaults (light) — 保留以备未来扩展，不会被使用 */
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    /* ...其余 shadcn 默认值 */
  }

  .dark {
    /* gal-lib 暗色 token — 由 UI-SPEC 锁定 */
    --background: 220 14% 8%;       /* #0F1115 */
    --foreground: 220 13% 91%;      /* #E5E7EB */
    --card: 220 13% 12%;            /* #181B22 */
    --card-foreground: 220 13% 91%;
    --popover: 220 13% 12%;
    --popover-foreground: 220 13% 91%;
    --primary: 252 100% 68%;        /* #7C5CFF accent */
    --primary-foreground: 220 13% 91%;
    --secondary: 220 13% 16%;       /* #21252E surface elevated */
    --secondary-foreground: 220 13% 91%;
    --muted: 220 13% 16%;
    --muted-foreground: 215 14% 64%;/* #9CA3AF */
    --accent: 220 13% 16%;
    --accent-foreground: 220 13% 91%;
    --destructive: 0 84% 60%;       /* #EF4444 */
    --destructive-foreground: 220 13% 91%;
    --border: 220 13% 20%;          /* #2A2F3A */
    --input: 220 13% 20%;
    --ring: 252 100% 68%;           /* focus ring = accent */
    --radius: 0.375rem;             /* 6px (controls scale) */
  }

  html, body {
    font-family: ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }
}
```

```html
<!-- index.html -->
<html lang="zh-CN" class="dark">
  ...
</html>
```

`tailwind.config.ts`：

```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],  // 关键：依赖 html.dark 类（生产中常驻）
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        // ...其余 shadcn 标准 token
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
```

### Pattern 6: HashRouter + RootLayout

```tsx
// src/main.tsx
import { createRoot } from "react-dom/client";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { RootLayout } from "@/components/layout/RootLayout";
import { Library } from "@/routes/Library";
import { Settings } from "@/routes/Settings";
import "./index.css";

const router = createHashRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <Library /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(<RouterProvider router={router} />);
```

```tsx
// src/components/layout/RootLayout.tsx
import { Outlet } from "react-router-dom";
import { Titlebar } from "./Titlebar";
import { Sidebar } from "./Sidebar";

export function RootLayout() {
  return (
    <div className="grid h-screen grid-rows-[36px_1fr] grid-cols-[220px_1fr] bg-background text-foreground">
      <div className="col-span-2"><Titlebar /></div>
      <div className="row-start-2"><Sidebar /></div>
      <main className="row-start-2 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
```

### Anti-Patterns to Avoid

- **不要在前端 React useEffect 里做数据目录创建** — 那时窗口已显示，DB init 失败用户已经看到空 shell。所有 fs 初始化必须在 Rust `setup` hook 中完成。
- **不要用 BrowserRouter** — Tauri 自定义协议下硬刷会找不到路径 [CITED: github.com/tauri-apps/tauri/issues/10931]。
- **不要把 sqlite WAL `-wal/-shm` 文件放进 .gitignore 又指望 portable 复制能整齐** — 简单起见，v1 用默认 DELETE 模式。
- **不要在 `data-tauri-drag-region` 元素上放可点击控件** — 拖拽会偷走 click 事件。把控件放在兄弟节点。
- **不要试图把 WebView2 runtime 打进 exe** — Tauri 不支持，且 fixedRuntime 模式会让产物 +180MB（爆 30MB 上限）。依赖系统级 WebView2（Win10 1803+ / Win11 自带）。
- **不要在 `pnpm tauri build` 没加 `--no-bundle` 时检查产物体积** — 默认产 NSIS 安装器（独立 exe ≈ 几 MB 但 nsis-setup.exe 包含完整 webview 引导）。Phase 1 验收的"单 exe"是 `target/release/gal-lib.exe`。

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite migration 框架（版本号 + up/down） | 自己写 schema_version 检查 + SQL 顺序执行 | `tauri-plugin-sql` `add_migrations` + sqlx Migrator | sqlx 已内置 `_sqlx_migrations` 表追踪、事务包裹、并发安全 [VERIFIED: docs.rs/sqlx] |
| 跨平台路径处理 | 手动 `format!("{}/{}", ...)` | `std::path::PathBuf` + `dunce::canonicalize` | Windows UNC、相对/绝对、分隔符差异已被 stdlib 解决 |
| 暗色调色板 token 映射 | 自己定义颜色变量名 | shadcn/ui CSS variable convention（`--primary`、`--muted-foreground`...） | 生态约定；后续加 shadcn 组件不会冲突 |
| 自定义滚动条样式 | 手写 `::-webkit-scrollbar` | shadcn `<ScrollArea>`（Radix） | 跨平台一致 + 无障碍 + 原生滚动 fallback |
| Tooltip 弹出层 | 自己写 absolute + 计算定位 | shadcn `<Tooltip>`（Radix Popper） | 边界检测、a11y、portal 都内置 |
| 错误传播 Rust→JS | 自定义 String 错误 + JSON.parse | `thiserror` + `serde::Serialize` + `tauri::command` 的 `Result<T, AppError>` | tauri 自动序列化 Result Error 到 JS reject |
| 日志文件轮转 | 手动检查文件大小 + rename | `tauri-plugin-log` `Target::Folder` + 内置 size rotation | 经过测试；和前端 `console.log` 联通 |
| 状态管理样板 | useReducer + Context provider 链 | `zustand` `create((set) => ...)` | 零样板，已锁定 |

**Key insight:** Phase 1 是脚手架阶段，最容易踩的坑是"已经有标准答案的事被自己重写"——尤其是 migration 框架和 ScrollArea 这类带边界条件的小组件。每一个偏离都是后续 Phase 的技术债。

## Runtime State Inventory

> N/A — Phase 1 是 greenfield 项目，无既有运行时状态需要迁移。

## Common Pitfalls

### Pitfall 1: tauri-plugin-sql 默认走 `app_config_dir`

**What goes wrong:** 调 `Database.load("sqlite:app.db")` 后，DB 实际写到 `%APPDATA%\<bundle_id>\app.db`，而非 exe 同级 `data/app.db`，违反 APP-01。
**Why it happens:** 插件 `path_mapper` 内部强制把 `sqlite:` 后的字符串当文件名 push 到 `app.path().app_config_dir()`。
**How to avoid:** 始终传**绝对路径**字符串（如 `sqlite:C:/full/path/data/app.db`），利用 `PathBuf::push(absolute)` 替换语义绕过。
**Warning signs:** `data/app.db` 文件不出现，但 `%APPDATA%\com.gal-lib.app\` 出现 → 路径未传绝对。

### Pitfall 2: Dev 模式下 `current_exe()` 指向 target/debug

**What goes wrong:** `cargo tauri dev` 时数据落到 `target/debug/data/`，开发者多次清 build 会丢数据。
**Why it happens:** dev 与 release 二进制位置不同；`current_exe()` 严格反映当前进程位置。
**How to avoid:** 接受这个行为（最简单），把 `target/debug/data/` 加到 `.gitignore`。或者在 dev 用 `CARGO_MANIFEST_DIR` env 派生项目根 — 但**不推荐**引入 `#[cfg(debug_assertions)]` 分支，因为这导致 dev/prod 行为分裂、生产 bug 难复现。
**Warning signs:** 用户报告"运行后什么都不显示"但开发本地正常 — 检查 release exe 是否真的指向 exe 同级。

### Pitfall 3: WebView2 Runtime 不在 exe 内

**What goes wrong:** 在没装 WebView2 的旧 Win10（1803 之前）或精简版系统，双击 exe 闪退。
**Why it happens:** Tauri 不打包 WebView2 runtime；依赖系统提供。
**How to avoid:** 文档明确"系统要求 Win10 1803+"。Win10 1803 → 2018 年发布，2026 年现实使用率已极低（绝大多数设备已升 Win11 或近期 Win10），**接受作为已知限制**。如果未来需要"零依赖"，再考虑 fixedRuntime 模式（+180MB，超 30MB 上限，得放弃此约束）。
**Warning signs:** Win 旧版用户反馈 exe 双击无响应或弹出 "WebView2 missing"。

### Pitfall 4: HashRouter v6 vs v7 API 差异

**What goes wrong:** 安装时 `pnpm add react-router-dom` 默认会装最新（7.x），代码按 v6 写的会报 `createHashRouter` 找不到或 props 签名不同。
**Why it happens:** RR 7 重写了 Router API 入口（统一 `createMemoryRouter`/`createBrowserRouter`/`createHashRouter` 仍存在但 export 路径变化）。
**How to avoid:** **明确锁定版本** `pnpm add react-router-dom@^6`；不写 `latest` 也不写 `*`。
**Warning signs:** TS 报 `Module has no exported member 'createHashRouter'` 或 `RouterProvider` props 类型错误。

### Pitfall 5: `data-tauri-drag-region` 不向子元素传播

**What goes wrong:** Titlebar 外层 div 加了属性，里面 `<span>gal-lib</span>` 区域无法拖拽。
**Why it happens:** [VERIFIED: v2.tauri.app/learn/window-customization] 文档明确 "data-tauri-drag-region will only work on the element to which it is directly applied"。
**How to avoid:** 让 drag region div 自身成为占空间的元素（用 grid / flex-1），文字内容直接放在它内部作为它的子节点（drag region 含子节点的结构是允许的，只要属性在父上）；或者每个子节点都加属性。**最简模式**：drag div 用 `flex-1`、文字作为 drag div 的直接 children（不嵌另一个未标记的 div），按钮区作为兄弟。
**Warning signs:** titlebar 部分区域不能拖拽 / 标题文字下没拖拽手感。

### Pitfall 6: 单 exe < 30MB 难度

**What goes wrong:** 默认 release build 出来 8–15MB（Tauri 自身），加 sqlx + sqlite 静态链接 + frontend 体积，未优化下可能 25–35MB，临界。
**Why it happens:** Cargo 默认 `[profile.release]` 不开 LTO、不 strip、opt-level=3 是大小不敏感的。sqlx-sqlite 默认带 bundled SQLite C 库（≈ 1MB+）。
**How to avoid:** [VERIFIED: v2.tauri.app/concept/size]
```toml
# src-tauri/Cargo.toml
[profile.release]
codegen-units = 1
lto = true
opt-level = "s"        # "z" 可能更小，需测；"s" 是更平衡的起点
panic = "abort"
strip = true
incremental = false
```
+ frontend 用 Vite 默认 esbuild 压缩（自动 minify）。+ tauri.conf.json: `"build": { "removeUnusedCommands": true }`（Tauri 2.4+，[VERIFIED: v2.tauri.app/concept/size]）。+ 用 `pnpm tauri build --no-bundle` 跳过 NSIS/MSI 包装。
**Warning signs:** `target/release/gal-lib.exe` 单文件 > 30MB → 升级到 nightly Rust + `trim-paths = "all"` + `rustflags = ["-Cdebuginfo=0"]` 再压一轮。

### Pitfall 7: Windows 路径分隔符与 sqlx connection string

**What goes wrong:** sqlx connect 时 `sqlite:C:\Users\...\app.db` 解析失败（反斜杠在 URI 中可能被当作转义/路径不合规）。
**Why it happens:** sqlx 的 connection string 走 URL 解析路径；Windows 反斜杠在 URL 上下文里非标准。
**How to avoid:** 构造 URL 时把 `\` 替换为 `/`：`abs_path.to_string_lossy().replace('\\', "/")`。SQLite 在 Windows 上能正确接受正斜杠路径。
**Warning signs:** `Database.load` reject 错误信息含 "invalid URL" 或 "no such file" 但路径明明存在。

### Pitfall 8: shadcn dark mode token 写在 `:root` 还是 `.dark`

**What goes wrong:** 直接覆盖 `:root` 的 token 导致 shadcn 组件用浅色配色但被深色背景污染（视觉脏）。
**Why it happens:** Tailwind 的 `darkMode: ["class"]` 只在 `.dark` 选择器下应用 dark 变体；`:root` 没有 `.dark` 类时 Tailwind 走浅色。
**How to avoid:** 保留 shadcn 默认 `:root` light token，把项目调色板写在 `.dark` 选择器里，HTML 根元素常驻 `class="dark"`。

## Code Examples

### `src-tauri/migrations/0001_init.sql` (schema v1 草案)

```sql
-- Source: composed from CONTEXT.md + REQUIREMENTS.md (APP-02 + Claude's discretion for column details)
PRAGMA foreign_keys = ON;

-- 元数据键值表（schema 版本号 + 应用首次启动时间等）
CREATE TABLE app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 游戏主表
CREATE TABLE games (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  path                TEXT    NOT NULL UNIQUE,            -- 游戏目录绝对路径
  name                TEXT    NOT NULL,                   -- 原文标题（Bangumi/VNDB primary）
  name_cn             TEXT,                               -- 中文标题（可选）
  executable_path     TEXT,                               -- 启动 exe 绝对路径
  cover_path          TEXT,                               -- 相对 data/covers/ 的文件名
  bangumi_id          TEXT,
  vndb_id             TEXT,
  total_playtime_sec  INTEGER NOT NULL DEFAULT 0,
  last_played_at      TEXT,                               -- ISO-8601
  status              TEXT    NOT NULL DEFAULT 'unplayed' CHECK(status IN ('unplayed','playing','cleared','dropped')),
  rating              INTEGER CHECK(rating IS NULL OR (rating >= 1 AND rating <= 10)),
  notes               TEXT,
  is_favorite         INTEGER NOT NULL DEFAULT 0,         -- 0/1（SQLite bool 惯例）
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 会话记录表
CREATE TABLE sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  started_at    TEXT    NOT NULL,
  ended_at      TEXT,                                     -- 可空：进行中
  duration_sec  INTEGER NOT NULL DEFAULT 0
);

-- 标签表
CREATE TABLE tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT
);

-- 游戏-标签关联表
CREATE TABLE game_tags (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (game_id, tag_id)
);

-- 索引（v1 起步：覆盖最高频查询）
CREATE INDEX idx_sessions_game_id     ON sessions(game_id);
CREATE INDEX idx_sessions_started_at  ON sessions(started_at);
CREATE INDEX idx_games_status         ON games(status);
CREATE INDEX idx_games_last_played_at ON games(last_played_at);
-- name 搜索 v1 不加索引（Phase 4 引入 FTS5 时一并设计）

-- 写入 schema_version
INSERT INTO app_meta (key, value) VALUES ('schema_version', '1');
INSERT INTO app_meta (key, value) VALUES ('initialized_at',
  strftime('%Y-%m-%dT%H:%M:%fZ','now'));
```

**索引取舍说明：**
- `sessions(game_id)`：详情页查会话历史最高频。
- `sessions(started_at)`：Phase 5 统计图表按时间聚合。
- `games(status)`：侧栏"通关状态"派生分类筛选（Phase 4）。
- `games(last_played_at)`：默认排序"最近游玩"（Phase 4 LIB-04）。
- `games.name` 不加索引：v1 数据量小，扫描可接受；Phase 4 全文搜索（LIB-03）会引入 FTS5 虚表，与普通索引冲突，故 v1 不预设。
- `games.path` UNIQUE 自动建索引；增量扫描去重（SCAN-08）依赖此约束。

### `src-tauri/Cargo.toml` 关键片段

```toml
[package]
name = "gal-lib"
version = "0.1.0"
edition = "2021"
rust-version = "1.77.2"  # tauri-plugin-sql 最低要求

[lib]
name = "gal_lib_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
tauri-plugin-log = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
thiserror = "2"
tracing = "0.1"
dunce = "1"

[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
panic = "abort"
strip = true
```

### `src-tauri/tauri.conf.json` 关键字段

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "gal-lib",
  "version": "0.1.0",
  "identifier": "com.gal-lib.app",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist",
    "removeUnusedCommands": true
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "gal-lib",
        "width": 1280,
        "height": 800,
        "minWidth": 960,
        "minHeight": 600,
        "decorations": false,
        "resizable": true,
        "center": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.ico"
    ],
    "windows": {
      "webviewInstallMode": { "type": "downloadBootstrapper" }
    }
  }
}
```

**对 APP-03 单 exe 的策略：** `pnpm tauri build --no-bundle` 不走 bundler 输出 NSIS，直接拿 `src-tauri/target/release/gal-lib.exe`。`bundle.targets: ["nsis"]` 只在以后想发安装包时启用 — Phase 1 验收用 `--no-bundle` exe。

### `src/routes/Library.tsx` 空状态

```tsx
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function Library() {
  const navigate = useNavigate();
  return (
    <div className="h-full flex flex-col items-center justify-center gap-6 p-8">
      <h2 className="text-[18px] font-semibold leading-[1.4]">还没有游戏</h2>
      <p className="text-[14px] text-muted-foreground">请到设置页添加扫描根目录</p>
      <Button variant="ghost" onClick={() => navigate("/settings")}>打开设置</Button>
    </div>
  );
}
```

### `src/routes/Settings.tsx` 占位

```tsx
export function Settings() {
  return (
    <div className="h-full flex items-center justify-center text-muted-foreground">
      设置 — 即将上线
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tauri v1 `app.allowlist.fs.scope` | Tauri v2 capabilities + per-plugin permissions | Tauri 2.0 GA (2024-10) | 必须显式声明每个权限到 `capabilities/*.json` |
| Tauri v1 `tauri::api::path::BaseDirectory::App` | Tauri v2 `app.path().app_config_dir()` | Tauri 2.0 | 老教程的 `BaseDirectory::App` 已废弃 |
| react-router v6 `useRoutes` 内嵌路由 | createXxxRouter + RouterProvider | RR 6.4 (2022-09) | 数据 API 模式（loader/action）；v6 仍支持但推荐 createXxxRouter |
| shadcn/ui CLI 老版本生成 `tailwind.config.js` | 当前 CLI 默认 TS 配置 + cssVariables 推荐 | shadcn 0.8+ | 当前 init 提示项与几年前博客差异大；以官方 docs 为准 |
| 手写 `panic_hook` 捕错 | `tauri-plugin-log` 自动捕获 + Rust `tracing` | tauri-plugin-log 2.x | 错误自动写文件 + 暴露给前端 |

**Deprecated/outdated:**
- `tauri::api::*` 模块：v2 全部移到 `tauri::path` / `tauri::process` 等单独命名空间。
- `appWindow` 单例从 `@tauri-apps/api/window` 顶层导出 → 现在是 `getCurrentWindow()` 函数。
- `@tauri-apps/api/dialog/fs/notification` → 各拆为独立 plugin (`@tauri-apps/plugin-dialog` 等)。

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `PathBuf::push(absolute_path)` 在 Tauri 插件内部稳定地绕过 `app_config_dir` 拼接 | Pattern 2 | 若插件未来用字符串拼接代替 `PathBuf::push`，DB 会写错位置；缓解：启动时用 `PRAGMA database_list` 验证 |
| A2 | Vite 8 与 create-tauri-app 4.6.2 模板默认版本兼容 | Standard Stack | 若模板锁定 Vite 6/7，按模板版本即可，无需强升 — 这并非阻塞 |
| A3 | zustand 5.x 是当前主线（npm registry 因网络未直连验证） | Standard Stack | 极低风险；锁 `^5` 安装时 lockfile 会确定具体版本 |
| A4 | tauri-plugin-log 2.x 的 `Target::Folder` API 接受运行时绝对路径 | Pattern 3 | 若不支持需改为先改工作目录再用相对路径；缓解：02a 任务先验证一次日志写入路径 |
| A5 | Win10 1803 之前用户在中文 galgame 玩家圈占比 < 1% | Pitfall 3 | 若实际占比高，需要 fixedRuntime 模式但会爆 30MB；建议向用户确认目标平台 |
| A6 | 默认 SQLite DELETE journal mode 在 portable 复制场景下足够（无 `-wal/-shm` 文件） | Alternatives | 若后续高并发写入瓶颈，需切 WAL 并文档化 portable 复制要带三个文件 |
| A7 | shadcn `new-york` style + slate base color 是当前 init 的标准默认 | Standard Stack | 若 CLI 默认变更，影响仅是命令交互不同；非阻塞 |

**Note on A1:** 这是 Phase 1 最重要的假设。Plan 01c 必须在实施时**实测**验证 — 跑一次 `pnpm tauri dev`，启动后通过 Rust 日志或 SQL 查询确认 db 文件落在 `target/debug/data/app.db`（dev 模式下）；若发现落在 `%APPDATA%\com.gal-lib.app\` 则假设破裂，**降级方案**：放弃 tauri-plugin-sql 的 `Database.load` 自动管理，改为在 Rust 侧直接用 sqlx 建立连接并通过 `tauri::command` 暴露查询接口（更多样板代码但完全可控）。

## Open Questions

1. **`pnpm tauri build --no-bundle` 出来的单 exe 是否依赖外部 DLL？**
   - What we know: 默认动态链接 MSVC runtime + 系统 WebView2 客户端；Rust stdlib + sqlx-sqlite 默认 bundled（静态）。
   - What's unclear: Visual C++ Redistributable 是否需要用户预装。Tauri 文档暗示需要，但现代 Win10/11 默认有。
   - Recommendation: Plan 01f 验收时在一台干净 Win10/Win11 VM（或同事电脑）上测试 — 双击 exe 是否提示缺 DLL。若提示，可考虑静态链接 MSVC（`-C target-feature=+crt-static`，但 sqlx 可能不兼容） 或文档说明 VCRedist 依赖。

2. **是否应该在 Phase 1 引入 GitHub Actions CI 跑 `tauri build`？**
   - What we know: ROADMAP 与 CONTEXT 未提到 CI。
   - What's unclear: 是否本地手工 build 即可。
   - Recommendation: Phase 1 先不做（不阻塞功能）；建立基础的 `pnpm typecheck` + `pnpm lint` 脚本就够。CI 可以在 v1 release 前再补。

3. **icons/ 资源从哪里来？**
   - What we know: tauri.conf.json 要求至少 32x32.png / 128x128.png / icon.ico。
   - What's unclear: 项目暂无 logo 设计。
   - Recommendation: Plan 01f 用占位 logo（Tauri 自带模板默认图标即可），美术 logo 留 Phase 4/5 替换。

4. **"data/" 目录是否应该加到 .gitignore？**
   - What we know: 它是运行时生成、用户特定数据。
   - What's unclear: 但 dev 模式下 data/ 创建在 `target/debug/`（已被 .gitignore），不会污染 git。生产用户的 data/ 也不进 git。
   - Recommendation: 仍然把根目录 `/data/` 加 .gitignore 防御性，避免开发者意外 cd 到 src-tauri/ 后 cargo 工作目录改变导致 data/ 误生成在仓库根。

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | pnpm + Vite + TS | ✓ | 24.14.0 | — |
| pnpm | 包管理器 | ✓ | 9.15.0 | — |
| Rust toolchain | Tauri build | ✓ | 1.92.0 (cargo 1.92.0) | — |
| WebView2 Runtime | Tauri 运行时 | ✓ (Win11 内置) | — | downloadBootstrapper（未装时联网下载） |
| Microsoft Visual C++ Build Tools | Rust 链接器 | ASSUMED ✓ | — | Tauri prerequisites 自动安装 |
| Cargo registry 访问 | crates.io 拉依赖 | ⚠ 镜像 | rsproxy-sparse | 已配置使用 rsproxy 国内镜像；正常工作但需注意 `cargo search` 默认使用本地配置 — 已在调研中用 `--registry crates-io` 强制走官方 |
| npm registry 访问 | npm 包安装 | ⚠ 偶发 ECONNRESET | registry.npmmirror.com | 大部分包正常；少数包（如 zustand 直连）受网络影响，已锁定版本范围 |

**Missing dependencies with no fallback:** 无。
**Missing dependencies with fallback:** 无（所有阻塞性工具均已就位）。

**Note on China network:** Rust toolchain 已配置 rsproxy 镜像，npm 已配置 npmmirror。CI 或新机器初始化需注意 `~/.cargo/config.toml` 与 `.npmrc` 是否携带这些配置。

## Security Domain

> `security_enforcement: true`, ASVS Level 1 enabled per `.planning/config.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | 单用户离线应用，无登录 |
| V3 Session Management | no | 无会话概念（Tauri local IPC 内部信任） |
| V4 Access Control | yes | Tauri capabilities ACL — 严格限制前端能调用的命令 |
| V5 Input Validation | yes（轻量） | Phase 1 仅有路径输入（在 Phase 2/4 才大量引入用户输入）；但 SQL migration 必须用参数化（plugin 已强制） |
| V6 Cryptography | no | Phase 1 不存储凭证；未来 v2 若做 API key 加密再启用 |
| V7 Error Handling | yes | `thiserror` 派生类型化错误；不向 UI 泄漏内部路径 / 堆栈 |
| V12 File / Resources | yes | 数据目录限定 exe 同级 `data/`；任何 fs 操作必须走 Rust 侧（前端零 fs 权限） |
| V14 Configuration | yes | `tauri.conf.json` 严格 CSP、Cargo profile.release 已 strip 符号 |

### Known Threat Patterns for Tauri 2 + SQLite

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via 扫描路径 / 用户输入标题 | Tampering | 全部走 sqlx 参数绑定（`?` placeholder + bind values）；tauri-plugin-sql 的 `execute(query, values)` 已强制 |
| 任意文件读取（前端绕过 fs 权限） | InfoDisclosure | Phase 1 不安装 `tauri-plugin-fs`；前端无 fs 能力。Phase 2/3 引入时按目录白名单限定 scope |
| Tauri command 滥用（前端调任意 Rust fn） | EoP | `capabilities/default.json` 显式列出允许的 plugin 权限；自定义 commands 必须显式 `tauri::generate_handler!` 注册 |
| 路径穿越（用户提供 `..` 路径） | Tampering | Phase 1 无用户路径输入；Plan 01c 解析 exe 同级时不接受外部参数 |
| 日志泄漏敏感信息 | InfoDisclosure | tracing 配置不打印完整路径含用户名；Phase 1 数据简单，待 Phase 2/3 引入用户路径再审 |
| WebView 自定义协议下 XSS | Tampering | tauri.conf.json `security.csp` 暂为 null（dev 友好）；**建议 Phase 2 之前补 CSP**（restrictive default），列入 deferred |

**Block-on-high (`security_block_on: high`):**
- SQL 参数化：HIGH（如绕过将允许任意 SQL 执行）— Phase 1 仅 migration 静态 SQL，已天然安全；Phase 2 引入用户标题查询时必须强制参数化。
- ACL 最小化：HIGH — Phase 1 capabilities 不允许出现 `core:default` 之外的过宽权限（如不需要的 `tauri-plugin-shell`、`tauri-plugin-fs` 全开）。
- CSP：MEDIUM — Phase 1 可暂留 null（Vite dev 友好），但**Plan 01f 必须在产物配置加 restrictive CSP**：`"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lain.bgm.tv https://s2.vndb.org"`（lain.bgm.tv 是 Bangumi 封面 CDN，s2.vndb.org 是 VNDB；Phase 2 起会用到）— Phase 1 可写"自身 only"，Phase 2 再放宽。

## Sources

### Primary (HIGH confidence)
- [Tauri v2 Configuration Files](https://v2.tauri.app/develop/configuration-files/) — `tauri.conf.json` schema、bundle、window
- [Tauri v2 SQL Plugin](https://v2.tauri.app/plugin/sql/) — Migration、Builder、Database.load
- [Tauri v2 Window Customization](https://v2.tauri.app/learn/window-customization/) — drag region 行为、getCurrentWindow API
- [Tauri v2 App Size](https://v2.tauri.app/concept/size/) — Cargo profile 优化、removeUnusedCommands
- [Tauri v2 Windows Installer](https://v2.tauri.app/distribute/windows-installer/) — NSIS / MSI / WebView2 install mode
- [Tauri v2 Permissions](https://v2.tauri.app/security/permissions/) + [Capabilities](https://v2.tauri.app/security/capabilities/) — ACL 模型
- [tauri-plugin-sql v2 source: lib.rs](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/src/lib.rs) — Migration struct, Builder
- [tauri-plugin-sql v2 source: wrapper.rs](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/sql/src/wrapper.rs) — `path_mapper` 函数 + `DbPool::connect`
- [shadcn/ui Vite installation](https://ui.shadcn.com/docs/installation/vite) — TS path、vite alias、init
- [Rust std::path::PathBuf::push](https://doc.rust-lang.org/std/path/struct.PathBuf.html#method.push) — 绝对路径替换语义
- [SQLite WAL documentation](https://sqlite.org/wal.html) — WAL 模式 portable 复制 caveat

### Secondary (MEDIUM confidence)
- [GitHub Discussion: Tauri Portable Database Directory](https://github.com/tauri-apps/tauri/discussions/8719) — current_exe + create_dir_all 模式
- [GitHub Discussion: react-router with Tauri](https://github.com/tauri-apps/tauri/discussions/7899) — HashRouter 推荐
- [GitHub Issue: React route after tauri2 packaging](https://github.com/tauri-apps/tauri/issues/10931) — BrowserRouter 在 Tauri 生产模式刷新坑
- [GitHub Discussion: Tauri standalone binary](https://github.com/tauri-apps/tauri/discussions/3048) — `--no-bundle` 拿 raw exe
- [GitHub Discussion: WebView2 in Windows exe](https://github.com/tauri-apps/tauri/discussions/4774) — WebView2 不可打包

### Tertiary (LOW confidence — 参考但需实施时验证)
- [Aptabase: Complete guide to logging with Tauri](https://aptabase.com/blog/complete-guide-tauri-log) — tauri-plugin-log 配置示例
- [DEV Community: Tauri 2.0 Sqlite DB React](https://dev.to/focuscookie/tauri-20-sqlite-db-react-2aem) — 端到端示例代码（仅作参考）

## Recommended Plan Breakdown

PLAN-OUTLINE 已定义 6 个 plan（01a–01f），与本研究结论高度一致。**确认采用**：

| Plan | Wave | Why parallel-safe |
|------|------|---|
| 01a Tauri scaffold | 1 | 创建项目根；其他都依赖 |
| 01b Tailwind + shadcn theme | 2 | 只动 `src/index.css`、`tailwind.config.ts`、`components.json`、`src/components/ui/` |
| 01c Portable + DB | 2 | 只动 `src-tauri/{Cargo.toml, src/data_dir.rs, src/db.rs, migrations/, src/lib.rs}` — 与 01b 文件零交集 |
| 01d App Shell layout | 3 | 依赖 01b（用 shadcn 组件）+ 01c（前端 db.ts wrapper 占位）；只动 `src/{main.tsx, App.tsx, routes/*, components/layout/Sidebar.tsx, components/layout/RootLayout.tsx}` |
| 01e Custom titlebar | 3 | 依赖 01b（shadcn Button + colors）；只动 `src/components/layout/{Titlebar, WindowControls}.tsx`、`src/styles/titlebar.css`、`tauri.conf.json` 的 window/decorations 字段 |
| 01f Single-exe build | 4 | 依赖所有；调 Cargo profile + bundle config + icons + 验收 |

**Wave 结构与并行性观察：**
- Wave 1: 01a（独立）
- Wave 2: 01b ‖ 01c（无文件交集）
- Wave 3: 01d ‖ 01e（无文件交集；01d 改 src/main.tsx + components/layout/{RootLayout,Sidebar}.tsx，01e 改 components/layout/{Titlebar,WindowControls}.tsx + styles/titlebar.css + tauri.conf.json window 字段）
- Wave 4: 01f（依赖一切）

**串行写 tauri.conf.json 的安全保证：** 01a → 01e → 01f 三个 wave 依次写不同字段；wave 顺序严格保证不冲突。但若 01e 与 01a 同 wave 会冲突 — 现在已经 wave 分隔，安全。

## Metadata

**Confidence breakdown:**
- Standard stack 版本: HIGH — npm + crates.io 直接验证（除 zustand 因网络失败标 ASSUMED）
- 架构模式（portable + DB + titlebar）: HIGH — 关键模式经源码阅读验证（path_mapper / drag region）
- Pitfall（path_mapper 绝对路径绕过）: HIGH on mechanism, MEDIUM on long-term stability — 是源码副作用而非文档承诺
- Schema v1 草案: MEDIUM — 列设计基于需求合理推断，未见外部权威示范；准备好接受 Phase 2 实施时调整
- < 30MB 体积达成: MEDIUM — Cargo 优化是已验证手段，但具体最终体积取决于 sqlx + 前端 bundle 实际大小，需 01f 实测确认
- Security: HIGH — ASVS Level 1 范围内 Phase 1 风险面小（无网络、无认证、无用户输入解析）

**Research date:** 2026-05-07
**Valid until:** 2026-06-07（30 天；Tauri / shadcn / React 生态稳定，但 tauri-plugin-sql 的 path_mapper 行为是核心假设，建议 30 天后或插件升大版本时复查）
