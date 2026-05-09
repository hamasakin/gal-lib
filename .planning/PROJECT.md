# gal-lib

## Current State

**Last shipped:** v1.1 UI Redesign (2026-05-09)
**Status:** Functional MVP + bespoke 「图书馆」 visual identity
**Stack:** Tauri 2 + Rust + React 19 + Vite + TypeScript + Tailwind v3 + shadcn + Zustand + SQLite (rusqlite)
**Bundle:** ~776 KB JS (gzip 238 KB) + 53 KB CSS — recharts removed in Phase 9
**Routes:** `/` (Library), `/games/:id` (Detail), `/stats`, `/screenshots`, `/settings`

v1.1 closed with 27/30 requirements satisfied — LIB-02 (magazine asymmetric grid) reverted as impractical, PGE-01/02 (standalone `/scan` route + Bangumi/VNDB review queue) deferred to v1.2 pending backend IPC + schema work. Cross-phase integration audit confirmed all v1.0 functional flows (scan/launch/playtime/screenshots/saves/sessions) survived the visual redesign intact.

## Next Milestone Goals (v1.2 — TBD)

Run `/gsd-new-milestone` to formalise. Likely scope (from v1.1 carry-over):

- Standalone `/scan` page with KPI strip + per-directory feed + Bangumi/VNDB review queue
- `tauri-plugin-opener` integration → open-directory and open-screenshots-dir actions
- Detail `?tab=` deeplink parsing
- Either reinstate LIB-02 hero band (with cropping fix) or amend spec
- Real session count IPC (currently proxied by games count)

## What This Is

Galgame 收藏与启动管理器 —— 一个面向 Windows 用户的桌面应用，扫描本地游戏目录后自动从 Bangumi/VNDB 抓取元数据、用 Locale Emulator 一键转区启动游戏、自动累计游玩时长。v1.1 落地了 Claude Design 交付的「图书馆」视觉系统：3 主题 × 4 强调色 × 2 圆角 × 3 侧栏宽度 × 3 封面密度，全部通过 `<html data-*>` 实时切换，无刷新。面向中文圈 galgame 玩家本人收藏管理及向朋友/社区分发。

## Core Value

**让本地一堆乱糟糟的 galgame 目录，变成可搜索、可启动、可统计的图书馆**：扫一眼就能找到游戏、点一下就能转区启动、关掉游戏就能看到这把玩了多久——并且看起来像一座图书馆而不是一坨壁纸。

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

**v1.0 MVP (2026-05-08):**
- ✓ 多根目录扫描 + 可配深度识别游戏边界 — v1.0
- ✓ Bangumi 优先 + VNDB 兜底自动匹配元数据 — v1.0
- ✓ Locale Emulator 一键转区启动 + 启发式 exe 打分 — v1.0
- ✓ 进程存活计时 + 单次会话/累计总时长 — v1.0
- ✓ 双栏 UI（侧边栏 + 封面网格）+ 自定义标签 + 收藏 + 评分 + 通关状态 — v1.0
- ✓ 笔记/备注 + 800ms autosave — v1.0
- ✓ 元数据低置信度手动绑定 ID（MetadataPicker） — v1.0
- ✓ 每款游戏独立启动配置（LE profile / cwd） — v1.0
- ✓ 系统托盘 + 后台计时（关闭主窗口仍跟踪） — v1.0
- ✓ 扫描进度 UI（实时反馈 + 增量/全量） — v1.0
- ✓ 截图自动收集（per-game scoped + 间隔 select） — v1.0 (Phase 5/05e)
- ✓ 存档备份/恢复 — v1.0 (Phase 5)
- ✓ 游玩统计图表（每日/每周时长 + 按游戏分布） — v1.0 (Phase 5)
- ✓ Portable 模式（exe 同目录 data/） — v1.0

**v1.1 UI Redesign (2026-05-09):**
- ✓ 设计令牌系统（5 轴 × `<html data-*>` 切换 + localStorage 持久化） — v1.1
- ✓ Tweaks 面板（右下浮动 + 5 组开关 + 5 跳转） — v1.1
- ✓ Library 页面重塑（藏书章戳 + 3:4 卡片 hover 浮起 + sidebar status dot + page-hd + toolbar + 现在游玩浮条） — v1.1
- ✓ Detail 页面重塑（380px 模糊 hero + 220×293 cover overflow + 44→240px 启动按钮 + LE Profile popover + 1fr+320px 双栏 + accent-underline tabs） — v1.1
- ✓ Stats 12 列仪表盘（KPI + 6 月热力图 + 30 日柱图 + ringstack + Top 8 + 品牌/年份） — v1.1
- ✓ Settings 200px 左导航 + 8 分区 + scroll-spy + path-row — v1.1
- ✓ Screenshots 按游戏 masonry + lightbox — v1.1

### Active

<!-- Current scope. Building toward these. v1 hypotheses until shipped. -->

(v1.2 backlog — to be formalised via `/gsd-new-milestone`)

- [ ] 标准 `/scan` 路由 + 顶部 KPI 4 联 + 双栏 feed + 待复核卡片队列（PGE-01 carry-over）
- [ ] Bangumi/VNDB 候选并排对比 + 一键切换数据源（PGE-02 carry-over）
- [ ] 重新评估 LIB-02 杂志式不对称网格 — 修复 portrait-cover 裁切 / density 冲突，或将规格回退
- [ ] `tauri-plugin-opener` 集成 → Detail / Settings 「打开目录」按钮
- [ ] Screenshots 「打开截图目录」按钮（需要 `open_path` IPC）
- [ ] Detail 页解析 `?tab=screenshots` deeplink
- [ ] 真实会话总数 IPC（目前用 games 数代理）

### Out of Scope

<!-- Explicit boundaries. -->

- **跨平台（macOS / Linux）** — Locale Emulator 是 Windows-only 技术，转区是核心功能，跨平台没有等价方案
- **多用户切换** — 一台机器一个用户使用，多用户需求会大幅复杂化数据模型
- **NTLEAS / 其他第三方转区工具** — 用户明确选择只支持 LE，避免启动器抽象过早膨胀
- **窗口焦点检测计时 / 闲置阈值暂停** — 用户选择仅用进程存活计时，挂机时间作为已知误差接受
- **自动更新机制** — Portable 模式优先，更新方式留给用户手动替换 exe
- **云同步 / 多设备同步** — 单机应用，不引入云后端
- **Patreon / 商店 / 在线购买集成** — 这是收藏管理器，不是商店
- **完整中文社区元数据源（DLsite/Getchu/EGS）** — Bangumi+VNDB 双源已能覆盖中文圈主流需求
- **虚拟化网格** — react-virtual 在 v1.1 移除（典型 50-300 game library 用 CSS Grid auto-fill 完全足够）；如果将来用户报告 >1000 games 卡顿再加回来
- **Recharts 等重图表库** — Phase 9 移除，~380 KB JS 节省；CSS Grid + flex 渲染热力图/柱图/ring 完全可控

## Context

**用户画像**：作者本人是中文圈 galgame 玩家，本地积累了多个根目录、几十至几百款游戏。希望既能自用，也能打包给朋友和小社区使用。

**生态参考**：
- LaunchBox / Heroic / Steam / Playnite —— 通用 PC 游戏库管理器
- Galgame Manager / GameTracker / SAManager —— 中文圈同类工具
- LE（Locale Emulator） / Bangumi / VNDB —— 转区 + 元数据双源

**v1.1 后状态**：
- 视觉系统已完整落地，3 主题 × 4 强调色无缝切换，符合「图书馆」品牌语调
- v1.0 功能层全部保留，Rust IPC 表面未变（`launchGame` / `endActiveSession` / `active-session-changed` / `scan-progress` / `getScreenshots` / `setScreenshotInterval` / `updateGameLaunchConfig` / `addScanRoot` / `clearAllData`）
- Bundle 体积 776 KB（recharts 移除后）—— Tauri 单 exe < 10MB 目标内
- 已知待办：standalone /scan 页 + open-directory IPC + LIB-02 hero band 重审

## Constraints

- **Tech stack — Tauri + React + Tailwind**：包小（~10MB）、Rust 后端做进程/文件 I/O 方便
- **Platform — Windows-only**：LE 是 Windows 独占，无跨平台等价方案
- **Storage — Portable**：所有用户数据放 exe 同目录 `data/`
- **Database — SQLite**：单文件、无外部依赖（rusqlite）
- **Metadata sources — Bangumi 优先 + VNDB 兜底**：API 适配层 + 限速器
- **Locale switching — Locale Emulator only**：内置 LE 路径自动检测
- **Distribution — 单 exe**：Tauri 打包后单 exe + 同目录 data/，目标 < 30MB
- **Design system — `<html data-*>` 5 axes**：theme/accent/radius/sidebar/density 全部 CSS 变量驱动，无 JS 重渲染（v1.1 引入）
- **No virtualization in grid**：直到用户报告 >1000 games 卡顿（v1.1 决策）
- **No heavy chart library**：Stats 用 CSS Grid + flex 自渲染（v1.1 决策）

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tauri 而非 Electron | 包大小一个数量级差距 | ✓ Good — Bundle 776 KB JS + Rust 后端，远低于 Electron |
| Bangumi 优先 + VNDB 兜底 | 中文圈用户更熟悉 Bangumi 标签/评分 | ✓ Good — 双源覆盖率高 |
| Portable 模式（数据放 exe 同目录） | 解压即用、无残留体验 | ✓ Good — 可放 U 盘携带 |
| 仅支持 Locale Emulator | 用户明确只用 LE | ✓ Good — 避免抽象膨胀 |
| 仅进程存活计时 | 实现成本低、稳定可靠 | ✓ Good — 挂机误差作为已知 trade-off 接受 |
| 双栏 UI（侧边栏 + 主区网格） | galgame 管理器主流形态 | ✓ Good — v1.1 重塑后藏书章美学落地 |
| 多根目录 + 每根独立深度 | 用户实际场景灵活 | ✓ Good |
| Exe 识别用启发式打分 + 手动覆盖 | 80% 自动 + 边缘 case 人工兜底 | ✓ Good |
| `<html data-*>` 5 轴 token 系统（v1.1） | 切换无刷新、CSS 变量驱动、无 JS 重渲染 | ✓ Good — Phase 6 落地，3 主题 × 4 强调色组合全部可读 |
| 移除虚拟化（v1.1 Phase 7） | 50-300 games 用 CSS Grid auto-fill 完全够 | ✓ Good — Bundle 缩小、density toggle 直接驱动 |
| 移除 recharts（v1.1 Phase 9） | CSS Grid + flex 自渲染图表足够 | ✓ Good — JS bundle 1145→776 KB |
| LIB-02 杂志式 hero band 回退（v1.1 Phase 7） | Portrait cover 在 1.6fr hero 槽位裁切异常 + density 冲突 | ⚠ Revisit — v1.2 重新评估或删除 spec |
| PGE-01/02 standalone /scan 延后（v1.1 Phase 9） | 需要新 router + 新 IPC payload + 新表 schema —— 不是纯视觉变更 | ⚠ Revisit — v1.2 实现 |
| Settings 外观 section 是指针（v1.1 Phase 10） | 避免与 Tweaks 面板双源 | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-09 after v1.1 milestone (UI Redesign) shipped*
