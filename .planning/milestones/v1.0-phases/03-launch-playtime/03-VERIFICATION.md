---
phase: 03-launch-playtime
status: human_needed
date: 2026-05-07
score: 13/13 must-haves automated coverage; manual GUI/LE smoke deferred
---

# Phase 3 Verification Report

## Goal Achievement Summary

Phase 3 交付完整 LE 启动 + 游玩时长跟踪 + 系统托盘子系统：用户可在 Settings 配置 LE 路径 → 在 GameCard 或 Detail 页一键启动 → 后端 spawn LEProc → 识别 LE-spawned 真实游戏进程（通过 sysinfo 轮询 + Win32 OpenProcess(SYNCHRONIZE) 异步等待）→ 游戏退出时自动写 sessions 行（duration / status / exit_code）+ 累计 games.total_playtime_sec → ActiveSessionBar 实时显示 elapsed → 关闭主窗口 → 隐藏到系统托盘（首次提示 toast）+ 计时继续 → 托盘菜单恢复/退出。Schema 升到 v3；36/36 Rust 单元测试通过；前端 typecheck + vite build 全绿。

## Must-Have Coverage

| # | Requirement | Evidence | Status |
|---|---|---|---|
| 1 | **LAUNCH-01** LE 路径自动检测 + 手动指定 | `launch::le::detect_le_path` 注册表 + 4 常见路径 + PATH 搜索；`resolve_le_path` 优先 config.json；`set_le_path` 持久化；前端 Settings.tsx 含 `Locale Emulator` section + `选择 LEProc.exe` 文件选择按钮 | ✅ |
| 2 | **LAUNCH-02** 一键 LE 转区启动 | `commands::launch_game` → `orchestrator::launch_game` → `process_track::spawn_le` 拼 `LEProc -runas <profile> "<exe>"`；前端 GameCard hover-button + Detail 启动按钮 | ✅ |
| 3 | **LAUNCH-03** 每游戏 LE profile（简中/繁中/日文/自定义） | `games.le_profile TEXT NOT NULL DEFAULT 'Japanese'` 列；`update_game_launch_config` cmd；前端 Detail 页 Select 含 4 个 profile 选项 | ✅ |
| 4 | **LAUNCH-04** 自定义启动参数 + 工作目录 | `games.launch_args TEXT` + `games.cwd TEXT` 列；`update_game_launch_config`；前端 Detail 页 2 个 Input 字段 | ✅ |
| 5 | **LAUNCH-05** 手动覆盖启动 exe | `update_game_launch_config(executable_path)` 接受 override（COALESCE 风格 UPDATE）；前端 Phase 3 范围内仅展示 `未识别可执行文件 — 请手动指定` 提示，完整 exe 候选列表 UI 留 P4 | 🟡 (后端 ✅, 前端 minimal — 推迟到 P4) |
| 6 | **TIME-01** 自动跟踪游戏 exe 进程 | `process_track::find_game_pid` 用 sysinfo 轮询 + basename 匹配；`wait_for_exit` 用 Win32 OpenProcess + WaitForSingleObject async-wrapped via spawn_blocking | ✅ |
| 7 | **TIME-02** 正确识别 LE-spawned 进程 | `find_game_pid` 在 LE_GRACE_MS=1500ms 后开始轮询，最多 30s 超时；优先匹配 file_name == game_exe basename；LEProc 自身退出后我们追踪的是 game.exe 不是 LEProc | ✅ |
| 8 | **TIME-03** 进程退出自动写会话记录 | `session::end_session(pool, session_id, exit_code)` UPDATE status='completed' + duration_sec + ended_at + 累加 games.total_playtime_sec；`session::mark_failed` 处理超时 | ✅ |
| 9 | **TIME-04** 总时长 + 会话历史列表 | `commands::list_sessions(game_id)` 倒序 100 条；前端 Detail 页 `会话历史` section 渲染（日期 + 时长 + 状态 Badge） | ✅ |
| 10 | **TIME-05** 主窗口关闭后计时继续 | `WindowEvent::CloseRequested` interceptor `prevent_close + window.hide()`；orchestrator 的 tokio task 完全独立于 webview 生命周期 | ✅ |
| 11 | **TRAY-01** 系统托盘图标 | `tray::setup_tray` 用 Tauri 2 `TrayIconBuilder` + `default_window_icon` (复用 Phase 1 icon.ico) + tooltip `gal-lib` | ✅ |
| 12 | **TRAY-02** 关闭主窗口最小化到托盘 | `prevent_close + window.hide() + emit("close-to-tray")`；前端 main.tsx 订阅事件显示 toast `已最小化到系统托盘`（首次） | ✅ |
| 13 | **TRAY-03** 托盘菜单（恢复 + 退出） | `Menu::with_items(&[show_item, quit_item])` + `on_menu_event` dispatch；左键单击 → 显示主窗口；退出前 best-effort cancel_session | ✅ |

**Score: 13/13 covered ✅** (LAUNCH-05 frontend minimal — full exe-candidate-list UX deferred to P4 per CONTEXT)

## Cross-cutting Assertions

| Check | Result |
|---|---|
| `pnpm tsc --noEmit` | ✅ exit 0 |
| `pnpm vite build` | ✅ exit 0 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | ✅ exit 0 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | ✅ 36/36 passed |
| `cargo build --release --bin gal-lib` | ✅ exit 0 (during 03e verification, ~2 min) |
| Schema v3 migration | ✅ schema_version 2 → 3 verified during 03a smoke; 5 new columns confirmed via PRAGMA table_info |
| 19 Tauri commands registered (12 P1+P2 + 7 P3) | ✅ via grep on lib.rs `generate_handler!` |
| 1 new Tauri plugin feature (tray-icon) | ✅ Cargo.toml `tauri = { version = "2", features = ["tray-icon"] }` |
| 3 new Rust crates (winreg, sysinfo, windows) + chrono | ✅ via grep |
| Locked Chinese copy strings (Detail / ActiveSessionBar / Settings LE / tray toast) | ✅ all verbatim per UI-SPEC and CONTEXT |

## Human Verification Items (deferred per autonomous policy)

These need a real Locale Emulator install + actual galgame to validate end-to-end. None block phase progression.

| # | Item | Notes |
|---|---|---|
| 1 | Real LE detection on a system with LE installed | Auto-detect must find LEProc.exe via registry or one of the 4 common paths |
| 2 | Successful launch of an actual galgame via LEProc | Profile correctly applied; game window appears in correct locale |
| 3 | LE-spawned game PID identification | After LEProc exits, our find_game_pid + wait_for_exit successfully tracks the real game |
| 4 | Session duration accuracy | Session duration_sec roughly matches wall-clock playtime |
| 5 | Close main window → tray hide + first-time toast | UI behavior; toast appears once, dismissable |
| 6 | Tray menu interactions | "显示主窗口" + "退出应用"; left-click on tray icon |
| 7 | Background timing during minimized state | Active session continues counting after window hidden |
| 8 | "强制结束" path | AlertDialog confirm → kill_pid → session.status='cancelled' |
| 9 | Active session boot-time hydration | Restart app while game running → ActiveSessionBar should show on boot (best-effort; LE+orchestrator state is in-memory only, will not survive app restart in P3 — that's a P5 enhancement) |

## Decision

🟡 **HUMAN-NEEDED** — 13/13 must-haves covered by static + unit-test evidence; 9 GUI/LE/integration items deferred to manual smoke (autonomous mode policy).

Proceeding to Phase 4 (Library Polish — search, tags, ratings, notes, full Detail page) per autonomous mode.
