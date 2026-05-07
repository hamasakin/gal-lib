# Phase 3: Launch & Playtime - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning
**Mode:** Auto-generated via `/gsd-discuss-phase 3 --auto` (recommended-default selections; single pass)

<domain>
## Phase Boundary

用户能通过 LE 一键转区启动游戏，关掉游戏后自动记录本次会话时长，关闭主窗口后计时仍在后台持续。

**包含：**
- Locale Emulator 路径自动检测（注册表 + 常见安装路径），手动指定
- LE profile 配置（每个 game 一个 profile：简中 / 繁中 / 日文 / 自定义）
- 启动按钮 + 启动参数 + 工作目录（cwd）覆盖
- 启动 exe 候选列表（重新扫描 + 手动选）
- 进程跟踪：LE 启动后识别实际游戏进程（不被 LE 自身退出干扰）
- 会话记录：start_at / end_at / duration_sec 写入 sessions 表
- 详情页（最小版）：总时长 + 会话历史列表
- 系统托盘：图标 + 关闭主窗口最小化到托盘 + 右键菜单（恢复 / 退出）
- 后台计时：主窗口关闭后计时继续

**不包含（在后续阶段）：**
- 完整详情页（封面 / 简介 / 截图 / 标签 / 评分）—— Phase 4
- 标签 / 评分 / 笔记 编辑 —— Phase 4
- 通关状态切换 —— Phase 4
- 时长统计图表（按月/年）—— Phase 5
- 截图捕获 —— Phase 5
- 存档备份 —— Phase 5
- 多游戏同时启动（仅支持一个 active session at a time）—— Out of Scope for v1
- 启动失败的智能恢复（如自动尝试不同 profile）—— Out of Scope

**REQ-IDs：** LAUNCH-01..05, TIME-01..05, TRAY-01..03（共 13 项）

</domain>

<decisions>
## Implementation Decisions

### Locale Emulator Detection (LAUNCH-01)
- **检测顺序：**
  1. 注册表读 `HKEY_CURRENT_USER\Software\LocaleEmulator` （安装时写入；可选）
  2. 常见路径检查：
     - `%LOCALAPPDATA%\LocaleEmulator\LEProc.exe`
     - `C:\Program Files\LocaleEmulator\LEProc.exe`
     - `C:\Program Files (x86)\LocaleEmulator\LEProc.exe`
     - `D:\Program Files\LocaleEmulator\LEProc.exe`（一些用户装非 C 盘）
  3. PATH 环境变量搜索 `LEProc.exe`
  4. 全部失败 → 设置页弹出"未检测到 Locale Emulator — 请手动指定路径或访问 [LE 项目页面](https://github.com/xupefei/Locale-Emulator/releases)"
- **存储：** 检测到的路径 → `data/config.json` 的 `le_path` 字段（首次检测后持久化）；用户手动改也写到这里
- **注册表读：** Rust crate `winreg`（Windows-only，符合 CLAUDE.md 锁定）
- **不强制 LE 装在 D:\：** 路径完全 portable 友好；`le_path` 是绝对路径

### LE Launch Pipeline (LAUNCH-02..04)
- **命令拼接：** `<le_path> -runas <profile_xml_or_alias> "<game_exe>"`，cwd 设为 `cwd` 字段或 game_exe 所在目录（默认）
- **LE profile 表示：** 不嵌入 LE 自身的 XML profile 文件（那是 LE 内部约定）；我们存 LE profile alias name（"Japanese" / "Simplified Chinese" / "Traditional Chinese" / 用户自定义文本）。LEProc 接受 `-runas <profile-name>` （查 LE 文档；社区共识）
- **启动参数：** `<args>` 拼到 game_exe 后面（例 `"<game_exe>" -windowed -nofs`）
- **工作目录：** cwd 默认 = `Path::new(executable_path).parent()`；用户可覆写
- **DB 字段（games 表 ALTER）：**
  - `le_profile TEXT` — LE profile alias，default "Japanese"
  - `launch_args TEXT` — 启动参数 string（空字符串 = 无参数）
  - `cwd TEXT` — 工作目录（NULL = 用 exe 同级目录）

### Process Tracking (TIME-01, TIME-02)
- **挑战：** LE 是 launcher（LEProc 启动后会 spawn 真实游戏进程然后自身退出），不能 wait LE 进程。需要识别 launch 后由 LE 拉起的真正子进程。
- **方案：**
  1. spawn LEProc（记录其 PID）；
  2. 等 ~3-5s 让游戏进程启动；
  3. 用 Windows API 列举所有进程 + 父子关系：找出 PID 链 root 是 LEProc 但 LEProc 已退出的孤儿进程；最匹配 game_exe basename 的就是真实游戏进程；
  4. 用 sysinfo crate (`sysinfo = "0.32"`) + Windows-specific 拓展（`windows = "0.58"` for `OpenProcess` / `WaitForSingleObject`）跟踪
  5. 退而求其次：如果识别失败，按 `executable_path` 文件名遍历当前进程列表，匹配第一个还活着的、cwd 在 game 目录下的；
- **进程退出 watch：** 拿到 PID 后 `OpenProcess(SYNCHRONIZE, ...)` 拿 handle，async loop `WaitForSingleObject(handle, 1000)` 直到 returns WAIT_OBJECT_0。
- **超时与降级：** 启动后 30s 内仍未识别到目标进程 → 标记 session 为 "launch_failed" status，记录但不计时
- **Rust 模块：** `src-tauri/src/launch/{mod.rs, le.rs, process_track.rs}`

### Session Lifecycle (TIME-03)
- **DB 写入：** session 在 LEProc spawn 时立即创建（status="starting"）；进程跟踪成功后 update status="running" + started_at；进程退出时 update status="completed" + ended_at + duration_sec
- **失败：** 进程跟踪失败 → status="launch_failed", duration_sec=0, ended_at=now
- **手动取消：** 详情页或 active session 按钮提供"强制结束"（kill process tree）
- **schema v3 ALTER sessions：**
  ```sql
  ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('starting','running','completed','launch_failed','cancelled'));
  ALTER TABLE sessions ADD COLUMN exit_code INTEGER;
  ```
  原来的 sessions 表 (Phase 1) 已含 game_id / started_at / ended_at / duration_sec；status + exit_code 是 P3 增量

### Session History UI (TIME-04, minimal Detail Page)
- **当前 Phase 3 范围：** 详情页只是最小版（封面 + 标题 + 状态 + 总时长 + 会话历史列表）；完整封面/简介/标签/评分/笔记 留 Phase 4
- **路由：** `/games/:id`（Phase 2 卡片 click 是 toast 占位 — Phase 3 替换为真实跳转）
- **会话历史显示：** 倒序，每行：日期 + 时长（"2 时 35 分"）+ 状态徽章；分页或虚拟化在 Phase 5 时长可能膨胀时再加（P3 简单 list）

### System Tray (TRAY-01..03)
- **Tauri plugin：** `tauri-plugin-positioner` 不需要；用 Tauri 2 内置的 `tauri::tray::TrayIconBuilder`
- **图标资源：** 复用 `src-tauri/icons/icon.ico`（Phase 1 模板默认；Phase 4/5 才换美术 logo）
- **关闭主窗口拦截：** Tauri `window.on_window_event` listen `WindowEvent::CloseRequested` → `event.prevent_default()` + `window.hide()`
- **托盘菜单（Tauri menu API）：**
  - "显示主窗口" → window.show() + window.set_focus()
  - "退出应用" → app.exit(0)
- **左键单击托盘图标：** 同 "显示主窗口"
- **配置开关（设置页 P4 加 toggle）：** 是否"关闭即真退出 vs 最小化到托盘" — Phase 3 hardcoded "最小化"，P4 暴露 toggle

### Background Timing (TIME-05)
- **机制：** 进程跟踪是 tokio task，与 webview 生命周期完全无关。窗口隐藏后 task 继续 await `WaitForSingleObject`。session 写库通过 commands 模块的 sqlx pool 完成。
- **应用退出 vs 主窗口隐藏：** 主窗口隐藏 ≠ 应用退出；Tauri 进程仍运行；session 跟踪正常
- **真退出（用户从托盘"退出应用"）：** 如果有 active session，先尝试 graceful flush（写当前 elapsed time 为 ended_at），然后 app.exit(0)

### Active Session UI Indicator
- **位置：** ScanProgressBar 同位置（顶部 sticky bar，但 ScanProgressBar 不在时显示）
- **样式：** 类似 ScanProgressBar 但内容不同：左侧 game cover thumbnail (24×24px) + 标题 + 当前 elapsed time（"已游玩 1 时 23 分"）；右侧"显示游戏窗口" + "强制结束"按钮
- **优先级：** 同时有 scan + active session 时，scan 更紧急（用户主动触发）；session 退到 main 区底部 mini bar
- **简化（Phase 3）：** 只在主区上方显示 active session bar；不引入 ScanProgressBar 共享/竞争（极小概率同时发生）

### Database Schema v3 Migration
- **新文件：** `src-tauri/migrations/0003_add_launch_and_session_status.sql`
- **内容：**
  ```sql
  ALTER TABLE games ADD COLUMN le_profile TEXT NOT NULL DEFAULT 'Japanese';
  ALTER TABLE games ADD COLUMN launch_args TEXT;
  ALTER TABLE games ADD COLUMN cwd TEXT;
  ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('starting','running','completed','launch_failed','cancelled'));
  ALTER TABLE sessions ADD COLUMN exit_code INTEGER;
  UPDATE app_meta SET value = '3' WHERE key = 'schema_version';
  ```

### Claude's Discretion
- 详情页具体 layout（顶部封面 + 元数据 + 时长卡片 + 会话历史）由 plan 决定；只锁"最小可用 + 复用 P2 GameCard 视觉风格"
- 进程跟踪轮询间隔（1s 默认；不需要 sub-second 精度）
- LE profile alias 列表的预设是否硬编码 4 个还是动态扫描 LE 安装目录的 profiles/ —— 选硬编码（更可靠，profile 列表稳定）
- 后台计时的视觉指示是否在托盘 tooltip 中（"游玩中: Game A — 1h23m"）—— 加，提升 awareness
- 详情页的"总时长"格式："{N}时{M}分" 或 "{H}h{M}m" —— 选中文格式与 P1/P2 的 copy 风格保持一致

</decisions>

<code_context>
## Existing Code Insights

### Reusable from Phase 1/2
- `src-tauri/src/data_dir.rs` — config.json 读写（le_path 持久化）
- `src-tauri/src/db.rs` — migrations 注册（追加 0003）
- `src-tauri/src/commands.rs` — 同模式追加 launch / session 相关 commands
- `src-tauri/src/lib.rs` — generate_handler! 列表追加；plugins 列表追加 tray-related
- `src/store/library.ts` — 追加 activeSession slice
- `src/lib/games.ts` — 追加 launchGame / endActiveSession 等 helpers
- `src/components/library/GameCard.tsx` — 卡片右下角追加 LaunchButton；右键菜单追加"启动"项
- `src/routes/Library.tsx` — 主区上方在 active session 时显示 ActiveSessionBar
- `src/routes/Settings.tsx` — 追加 LE 路径配置 section（自动检测显示 + 手动覆盖按钮）

### Established Patterns (from P1/P2)
- Rust modules：单文件或子目录；Phase 3 用子目录 `launch/` 装 le.rs + process_track.rs
- Tauri commands `Result<T, String>` 风格不变
- Frontend invoke wrappers 集中在 `src/lib/*.ts`
- Zustand store 单 create() pattern
- shadcn 复用：Button / Dialog / DropdownMenu / Badge / Sonner
- 锁定调色板继续，不引入新 token；状态徽章配色已在 02-UI-SPEC 锁定
- 中文 copy 两段式约束延续

### Integration Points
- **新 Tauri plugins：** None（系统托盘是 Tauri 2 core API；不需要额外 plugin）
- **新 Rust crates：** `winreg = "0.52"` (registry read), `sysinfo = "0.32"` (process listing), `windows = { version = "0.58", features = ["Win32_System_Threading", "Win32_Foundation"] }` (process wait + open)
- **新 npm：** None（继续用现有 shadcn blocks）
- **icons：** 复用 `src-tauri/icons/icon.ico` 给托盘；后续 Phase 4/5 加美术 logo 时同步替换

</code_context>

<specifics>
## Specific Ideas

- 启动按钮在 GameCard 卡片上的位置：cover 右下角悬浮，hover 时显现（lucide `Play` 图标 + "启动"）；右键菜单也加"启动"
- LE profile 在 GameCard 上不显示（在详情页配置）；通过 cardEditor 或详情页 menu 切换
- 详情页 hero 区：左上 cover (200×267px = aspect-cover * 200) + 右侧 H2 title + status badge + total playtime
- 详情页 sessions table：`日期 / 时长 / 状态 (徽章)`，最近 50 条；之后 "查看更多" 链接（Phase 5 才实装更多页）
- ActiveSessionBar 视觉：与 ScanProgressBar 风格一致（sticky / backdrop-blur / h-14），但内容是会话信息
- 托盘 tooltip：默认 "gal-lib"；active session 时改为 "gal-lib — 游玩中: {game_name} ({elapsed})"
- 关闭主窗口对话：默认隐藏 toast "已最小化到系统托盘"（首次显示，记 boolean 在 config.json 里 + "不再提示" 选项）
- 启动失败提示：toast.error("启动失败 — 请检查 LE 路径和游戏 exe 路径")；详情页 sessions 列表显示 "启动失败" 状态徽章

</specifics>

<deferred>
## Deferred Ideas

- 多游戏并发启动（Out of Scope v1）
- 启动器智能重试（不同 profile 自动尝试）（Out of Scope）
- 启动前的预启动钩子（运行某个脚本）（Out of Scope）
- 自动捕获游戏窗口截图（Phase 5）
- 详情页时长统计图表（Phase 5）
- 详情页编辑标签 / 评分 / 笔记（Phase 4）
- 全局快捷键（最小化所有 / 暂停所有计时）（Out of Scope v1）
- 第三方 locale switching 工具支持（NTLEA, Locale-Emulator-Helper 等）（Out of Scope — CLAUDE.md 明确 LE only）
- 详情页"封面手动上传"（Phase 4 设置页）
- 自动启动应用到托盘（Windows 启动项）（Out of Scope v1）

</deferred>
