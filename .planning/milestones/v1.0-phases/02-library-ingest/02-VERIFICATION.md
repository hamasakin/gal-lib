---
phase: 02-library-ingest
status: human_needed
date: 2026-05-07
score: 17/17 must-haves automated coverage; manual GUI smoke deferred
---

# Phase 2 Verification Report

## Goal Achievement Summary

Phase 2 交付完整 library ingest 管线：用户从 Settings 添加扫描根目录 → 触发全量/增量扫描 → 后端 walkdir 按深度遍历 + exe 启发式选可执行 + Bangumi（fallback VNDB）抓元数据 + 限速 + 重试 + 封面缓存到 data/covers/{id}.ext → 前端 ScanProgressBar 实时进度 + 虚拟化 GameGrid 卡片网格 + MetadataPicker 候选挑选 + 直接 ID 绑定。33/33 Rust 单元测试通过；前端 typecheck + vite build 全绿；schema v2 迁移在 dev 实测中从 v1 升到 v2。GUI 端到端 smoke（实际触发扫描看到卡片）需要人工启动 release 或 dev exe 完成（auto-mode 无 webview 头）。

## Must-Have Coverage

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | **SCAN-01** 用户可添加/移除扫描根目录 | `commands::add_scan_root` + `remove_scan_root` + `list_scan_roots` 已注册；前端 `Settings.tsx` 含「添加根目录」按钮 + 列表「移除」+ 确认 dialog | ✅ |
| 2 | **SCAN-02** 每根目录单独配置扫描深度 | `scan_roots.depth INTEGER CHECK(depth IN (1,2,3))` + 前端 `<Select>` 切换；`commands::add_scan_root` 接受 depth 参数 | ✅ |
| 3 | **SCAN-03** 实时进度（current_dir / completed / total） | `scan::ScanProgress` struct + `start_scan` 通过 `app.emit("scan-progress", ...)` 推送；前端 `onScanProgress` 订阅写入 Zustand；`ScanProgressBar` 渲染 | ✅ |
| 4 | **SCAN-04** "第 N 层子目录 = 一款游戏" | `scan::walker::collect_game_dirs` 使用 `WalkDir::new(root).min_depth(depth).max_depth(depth).into_iter().filter_entry(\|e\| e.file_type().is_dir())` | ✅ |
| 5 | **SCAN-05** exe 启发式打分识别 | `scan::exe_score::score_exe` 纯函数 + 4 单元测试覆盖前缀匹配 / 大小奖惩 / setup-uninst-patch 关键词减分 / redist-tools 子目录减分 | ✅ |
| 6 | **SCAN-06** 跳过/重试单个目录 | `commands::mark_skip_dir` + `ScanContext.skip: Mutex<HashSet<PathBuf>>`；前端 02f 卡片"重试"按钮调 `refresh_metadata` | ✅ |
| 7 | **SCAN-07** 低置信度让用户挑选 | `ingest::process_game` 在 confidence < 80 时不自动绑定 metadata；前端 `MetadataPicker` modal 显示候选列表 + Confidence Badge | ✅ |
| 8 | **SCAN-08** 增量扫描跳过已识别 | `scan::run_scan` 接受 `existing_paths: HashSet<PathBuf>` + `incremental: bool` 参数；mode="incremental" 时 `start_scan` 从 DB 读 SELECT path FROM games | ✅ |
| 9 | **META-01** Bangumi 元数据 | `metadata::bangumi::search` POST `https://api.bgm.tv/v0/search/subjects` + UA `gal-lib/0.1.0 (...)`; `fetch_detail` GET `/v0/subjects/{id}`；返回 Candidate 含 id/title/name_cn/cover_url/release_date/summary | ✅ |
| 10 | **META-02** VNDB fallback | `metadata::vndb::search` POST `https://api.vndb.org/kana/vn` with `filters` + `fields`；`ingest::process_game` 在 Bangumi 无 ≥80 命中时调 VNDB | ✅ |
| 11 | **META-03** 标题清洗 | `title_clean::clean_title` 5 步 pipeline + 6 单元测试（括号 / 噪声词 / 商家前缀 / 末尾日期 / 全角空格） | ✅ |
| 12 | **META-04** 封面本地缓存 | `cover_cache::cache_cover` 写 `data/covers/{game_id}.{ext}`（Content-Type 决定 jpg/png/webp）；DB `games.cover_path` 存相对路径；去重通过 game_id PK | ✅ |
| 13 | **META-05** 手动绑定 ID 修正错配 | `commands::bind_metadata` + 前端 `MetadataPicker` 含「直接绑定 ID」section + Bangumi/VNDB ToggleGroup | ✅ |
| 14 | **META-06** 单游戏重新抓取 | `commands::refresh_metadata` + 前端 `GameCard` 右键菜单 `重新抓取封面` 选项 | ✅ |
| 15 | **META-07** 限速 + 重试 | `metadata::limiter::{BANGUMI, VNDB}` governor 静态 RateLimiter；`with_retry` 指数退避 [1s, 2s, 4s] for 5xx/429 | ✅ |
| 16 | **LIB-02** 封面网格 | `GameCard` 3:4 cover + 双行标题 + 状态徽章 + hover scale；`GameGrid` CSS grid `repeat(auto-fill, minmax(200px, 1fr))` | ✅ |
| 17 | **LIB-06** 网格虚拟化 1000+ 流畅 | `@tanstack/react-virtual::useVirtualizer` 2D 模式（rows × lanes）；over-render 30 行；resize 重算 columnCount | ✅ |

**Score: 17/17 covered ✅**

## Cross-cutting Assertions

| Check | Result |
|---|---|
| `pnpm tsc --noEmit` | ✅ exit 0 |
| `pnpm vite build` | ✅ 1904 modules / 520KB JS / 30KB CSS |
| `cargo check --manifest-path src-tauri/Cargo.toml` | ✅ exit 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | ✅ 33/33 passed |
| Schema v2 dev migration | ✅ schema_version 1 → 2 verified during 02a smoke |
| 11 Tauri commands registered in `generate_handler!` | ✅ get_data_dir + 9 P2 + list_games |
| 2 new plugins registered | ✅ tauri_plugin_dialog::init() + tauri_plugin_http::init() |
| 9 new shadcn blocks installed | ✅ progress / select / dialog / input / toggle-group / dropdown-menu / badge / alert-dialog / sonner |
| Locked copy strings (UI-SPEC §Copywriting) verbatim | ✅ all strings present in src/routes/{Library,Settings}.tsx + src/components/library/* |

## Human Verification Items (deferred — auto-mode no webview head)

These end-to-end interactions need a human/QA to launch dev or release exe and click through. None block phase progression; they are part of Phase 2's known deferred-validation set per autonomous-mode policy.

| # | Item | Notes |
|---|---|---|
| 1 | Add scan root via Tauri dialog → list reflects new row + toast | Settings page interaction |
| 2 | Trigger 全量扫描 → ScanProgressBar visible + counts update + GameGrid populates | E2E flow with backend events |
| 3 | Click 取消 → confirm AlertDialog → cancelScan succeeds | Cancellation path |
| 4 | Right-click GameCard → DropdownMenu → 重新匹配元数据 → Picker opens | Card menu interaction |
| 5 | Type query in MetadataPicker → debounce → candidates populate; click 应用 → re-fetch | Modal flow |
| 6 | Live Bangumi/VNDB API actually returns ≥80 confidence on a real galgame | Network-dependent; Bangumi UA-gated, may need real network |
| 7 | Cover image actually downloads + displays from data/covers/ | File-system + webview convertFileSrc path |
| 8 | Virtualization smooth at 1000+ cards (LIB-06 perceived performance) | Performance check; depends on actual library size |

## Decision

🟡 **HUMAN-NEEDED** — 17/17 must-haves covered by static + unit-test evidence; 8 GUI/network end-to-end items deferred to manual smoke (autonomous mode policy: defer interactive items, let user prod release exe at any time).

**Autonomous progression rationale:** All backend code paths are unit-tested; all frontend code typechecks and builds; the 8 deferred items are integration-flow assertions that depend on a webview + live network — these can be run anytime by the user via `pnpm tauri dev` or the release exe.

Proceeding to Phase 3 (Launch & Playtime) per autonomous mode.
