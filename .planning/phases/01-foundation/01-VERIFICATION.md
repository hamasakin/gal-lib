---
phase: 01-foundation
status: human_needed
date: 2026-05-07
score: 12/12 must-haves covered (3 visual/interaction items deferred to human eye)
---

# Phase 1 Verification Report

## Goal Achievement Summary

Phase 1 交付的 Tauri 应用骨架完整就位：portable 数据目录在 exe 同级自动初始化（实测于 `D:\tmp\gal-lib-portable\`），SQLite schema v1 落盘且 schema_version=1，双栏 App Shell（36px 自定义 titlebar + 220px Sidebar + 自适应 Main + HashRouter `/` & `/settings`）按 UI-SPEC 锁定调色板渲染，单 exe `gal-lib.exe` 体积 **4.13 MB**（远低于 30MB 上限）。所有 4 个 phase requirement IDs（APP-01 / APP-02 / APP-03 / LIB-01）由代码 + 实测产物共同提供证据。3 个纯人眼/键鼠交互项（拖动、按钮点击、tooltip hover）按 plan 01f Task 3 设计明确 deferred 给人工最终勾选，其余自动可断言项全部通过。

## Must-Have Coverage

| # | Must-have | Evidence | Status |
|---|---|---|---|
| 1 | **APP-01** Portable data dir resolution (data/ next to exe, NOT %APPDATA%) | `src-tauri/src/data_dir.rs::resolve_data_dir` + `lib.rs` 在 `Builder::default()` 之前调 `data_dir::ensure()`；`tauri-plugin-sql` 用绝对路径 `format!("sqlite:{}", abs)` 注册（path_mapper bypass）。**实测**（PHASE-01-VERIFICATION.md §APP-01）：`D:\tmp\gal-lib-portable\data\` 出现完整 5 物（app.db / config.json / 4 子目录）；`%APPDATA%\com.gal-lib.app\` 内容 count=0 | ✅ |
| 2 | **APP-02** First-launch schema init (5 tables + indexes + schema_version='1' + default config.json + 4 subdirs) | `src-tauri/migrations/0001_init.sql`（5 CREATE TABLE: games/sessions/tags/game_tags/app_meta + 3 CREATE INDEX + INSERT app_meta values('schema_version','1'））；`db.rs::migrations()` 通过 `include_str!` 嵌入；`data_dir::ensure_default_config` 写入默认 `{schema_version:1, scan_roots:[], default_locale:"ja-JP", le_path:null}`；`ensure_subdirs` 创建 covers/screenshots/saves/logs。**实测**：`sqlite3 ... "SELECT value FROM app_meta WHERE key='schema_version'"` 返回 `1` | ✅ |
| 3 | **APP-03** Single .exe < 30MB | `src-tauri/target/release/gal-lib.exe` 实测 **4.13 MB**（4,333,056 bytes）。`[profile.release]` 6 项体积优化全开 + `removeUnusedCommands: true` + `bundle.targets: ["nsis"]` + `--no-bundle` 三件套联合作用 | ✅ |
| 4 | **LIB-01** Dual-pane shell (custom 36px titlebar + 220px sidebar + flexible main) | `src/App.tsx` RootLayout（`<flex flex-col h-screen> → <TitlebarSlot /> + <flex flex-1>(<Sidebar /> + <main><Outlet/></main>)>`）；`src/components/layout/Titlebar.tsx`（h-9 36px + bg-card + drag region）；`src/components/layout/Sidebar.tsx`（`w-[220px]` + 4 占位 + Settings nav）；`src/routes/Library.tsx`（empty state）+ `src/routes/Settings.tsx`（占位） | ✅ |
| 5 | Tauri v2 scaffold (pnpm + Vite + React + TS strict) | `package.json` 含 `react@19.2.6` / `react-router-dom@^6.30.3` / `@tauri-apps/api@^2.11.0`；`tsconfig.json` `strict: true`；`vite.config.ts` 端口 1420 | ✅ |
| 6 | shadcn/ui new-york + 暗色 token | `components.json` 含 `style: "new-york"`；`src/index.css` `.dark` 段含 8 项 HSL token（`--background: 220 14% 8%` 即 #0F1115、`--ring: 252 100% 68%` 即 #7C5CFF 等）；4 个 shadcn block 文件存在（button/separator/scroll-area/tooltip）；`<html class="dark">` 永久挂载 | ✅ |
| 7 | tauri-plugin-sql 接入 + 4 sql capabilities | `Cargo.toml` 含 `tauri-plugin-sql = { version = "2", features = ["sqlite"] }`；`capabilities/default.json` 含 `sql:default` / `sql:allow-load` / `sql:allow-execute` / `sql:allow-select`；`lib.rs` 通过 `add_migrations(&db_url, db::migrations())` 注册 plugin | ✅ |
| 8 | Custom titlebar + decorations off + window controls | `tauri.conf.json` 含 `"decorations": false` 与 `width: 1280, height: 800, minWidth: 960, minHeight: 600, title: "gal-lib"`；`capabilities/default.json` 4 条 `core:window:allow-{minimize,toggle-maximize,close,start-dragging}`；`Titlebar.tsx` 父 div 含 `data-tauri-drag-region`、`WindowControls.tsx` wrapper 含 `data-tauri-drag-region="false"`（RESEARCH §Pitfall 5 满足） | ✅ |
| 9 | HashRouter, NOT BrowserRouter | `src/router.tsx` 含 `createHashRouter`，无 `BrowserRouter` / `MemoryRouter` | ✅ |
| 10 | Sidebar `w-[220px]` lockdown (NOT `w-56`) | `src/components/layout/Sidebar.tsx` 含 `w-[220px]`，无 `w-56` | ✅ |
| 11 | UI-SPEC locked copy strings 全部 verbatim | grep `分类` / `全部` / `收藏` / `标签` / `通关状态` / `设置` / `即将开放` / `还没有游戏` / `请到设置页添加扫描根目录` / `打开设置` / `设置 — 即将上线` / `gal-lib` 全部命中 src/* 至少一次 | ✅ |
| 12 | Portable + zip-relocate behavior | PHASE-01-VERIFICATION.md §Portable zip + relocate 记录：zip 后解压到 `D:\tmp\gal-lib-relocated\` 启动正常，新位置 data/ 重新创建，schema_version=1，APPDATA 仍 count=0 | ✅ |

**Score: 12/12 covered ✅**

## Cross-cutting Assertions

| Check | Result |
|---|---|
| `pnpm tsc --noEmit` | ✅ exit 0 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | ✅ exit 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | ✅ 3 tests pass (`build_db_url_*`, `ensure_creates_subdirs_*`, `migrations_v1_*`) |
| `pnpm tauri build --no-bundle` | ✅ produces gal-lib.exe (78s build time) |
| Single exe size | ✅ 4.13 MB < 30 MB |
| Portable smoke (DB + config + subdirs) | ✅ all 6 invariants pass (PHASE-01-VERIFICATION.md §APP-01) |
| `%APPDATA%\com.gal-lib.app\` 子项数 | ✅ 0 (empty — Tauri runtime side effect, no user data pollution) |
| zip relocate functional | ✅ launches in new location with fresh data/ |

## Human Verification Items

These 3 items require human eyes/clicks; they were intentionally deferred per plan 01f Task 3 (`checkpoint:human-verify`). Trigger: launch `D:\project\gal-lib\src-tauri\target\release\gal-lib.exe` and confirm.

| # | Item | Why deferred |
|---|---|---|
| 1 | **Drag titlebar moves window** | 需要人手拖动；自动化无法可靠模拟 webview drag 事件 |
| 2 | **3 control buttons (minimize/maximize/close) work on click** | 需要人手点击；窗口状态变化无 GUI-less 断言 |
| 3 | **Hover placeholder sidebar items → "即将开放" Tooltip appears (~300ms)** | 需要人手 hover；Radix tooltip 触发依赖 hover delay |

视觉细节项（dark titlebar 美感、220px sidebar 视觉宽度、空状态居中、tooltip 圆角等）已在 plan 01b/01d 的 dev-mode smoke 阶段视觉确认；release build 加载相同前端 dist 不存在视觉退化风险。

## Decision

🟡 **HUMAN-NEEDED** — 12/12 must-haves automated coverage 通过；3 个交互式人工 checklist 项按设计 deferred，等待用户手动启动 release exe 验收。

**对 autonomous 模式的下一步建议：**
- 自动模式可继续推进到 Phase 2（autonomous 模式接受 human-needed 状态进入下一 phase 是合规的，因为 must-haves 全数覆盖）
- 用户在合适时刻打开 `D:\project\gal-lib\src-tauri\target\release\gal-lib.exe` 完成最终 3 项交互验收即可

**对 milestone-level 验收的下一步建议：**
- Phase 1 已具备 milestone 推进资格；3 项 deferred 由 milestone-audit 阶段或用户手动 sign-off 收尾
