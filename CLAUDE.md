<!-- GSD:project-start source:PROJECT.md -->
## Project

**gal-lib**

Galgame 收藏与启动管理器 —— 一个面向 Windows 用户的桌面应用，扫描本地游戏目录后自动从 Bangumi/VNDB 抓取元数据、用 Locale Emulator 一键转区启动游戏、自动累计游玩时长。面向中文圈 galgame 玩家本人收藏管理及向朋友/社区分发。

**Core Value:** **让本地一堆乱糟糟的 galgame 目录，变成可搜索、可启动、可统计的图书馆**：扫一眼就能找到游戏、点一下就能转区启动、关掉游戏就能看到这把玩了多久。

### Constraints

- **Tech stack — Tauri + React + Tailwind**：包小（~10MB）、Rust 后端做进程/文件 I/O 方便，Web 前端做卡片网格 UI 最快
- **Platform — Windows-only**：LE 是 Windows 独占，无跨平台等价方案
- **Storage — Portable**：所有用户数据放 exe 同目录 `data/`，便于分发、U 盘携带、无残留
- **Database — SQLite**：单文件、无外部依赖、Rust 生态成熟（rusqlite/sqlx）
- **Metadata sources — Bangumi 优先 + VNDB 兜底**：主源命中走 Bangumi，未命中再 fallback 到 VNDB；需要 API 适配层 + 限速器（避免被两边限流）
- **Locale switching — Locale Emulator only**：内置 LE 路径自动检测，仅支持 LE，不做通用启动器抽象
- **Distribution — 单 exe**：Tauri 打包后单 exe + 同目录 data/，目标 < 30MB
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
