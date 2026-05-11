# gal-lib

## Current State

**Last shipped:** v1.2 Metadata Enrichment & Filtering (2026-05-09)
**Status:** Functional MVP + 「图书馆」 visual identity + 元数据深度增强
**Stack:** Tauri 2 + Rust + React 19 + Vite + TypeScript + Tailwind v3 + shadcn + Zustand + SQLite (rusqlite); schema v7
**Bundle:** ~776 KB JS (gzip 238 KB) + 53 KB CSS (pre-v1.2 measurement; next pnpm build will refresh)
**Routes:** `/` (Library), `/games/:id` (Detail), `/persons/:id` (人物聚合), `/stats`, `/screenshots`, `/settings`

v1.2 closed with 16/18 audit-credit — 15 backend reqs (MET/API/ING) auto-verified via cargo test + pnpm tsc; UI-04 (`/persons/:id` route) verified at routing layer; UI-01/02/03 (Detail staff/summary/links + FilterPanel facets + person navigation) compiled + type-clean but real-app smoke deferred per autonomous-mode policy. Backend exposes `summary`, `persons`/`game_staff`/`game_official_tags` tables + 6 new IPCs (list_persons_for_game / list_games_for_person / list_official_tags_for_game / get_filter_options / backfill_metadata_enrichment / open_external_url). FilterPanel multi-dim facets (品牌 / 编剧 / 画师 / 声优 / 官方标签) layer on top of existing 4 axes.

## Current Milestone: v1.3 Scan Pipeline & Person Polish

**Goal:** 一次性清掉 v1.1/v1.2 累积的 carry-over —— 上线独立 `/scan` 复核流（PGE-01/02）、人物聚合页二阶加强（时光轴 + 同台伙伴 + 头像缓存 + 跨源去重）、文件系统/deeplink 打磨（`tauri-plugin-opener` + 「打开目录」 + `?tab=` deeplink + 真实会话数 KPI + Backfill 进度条 + LIB-02 回顾）、v1.2 UI-01/02/03 真机验证。

**Target features:**
- 独立 `/scan` 路由（无 Library 侧栏） + KPI 4 联 + 双栏 feed + Bangumi/VNDB 候选并排对比 + 待复核队列持久化
- 跨源人物去重 + 人物聚合页作品时光轴 + 同台伙伴推荐 + 人物头像本地缓存
- `tauri-plugin-opener` 接入 + Detail / Screenshots 「打开目录」按钮 + Detail `?tab=` deeplink
- Backfill 进度条（PageHeader 可见） + 真实会话数 KPI + LIB-02 杂志式不对称网格回归或正式废止
- v1.2 UI-01/02/03 真机 smoke（Detail summary/staff/外链 + 人物 chip 跳转 + FilterPanel 多维 facet）

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

**v1.2 Metadata Enrichment & Filtering (2026-05-09):**
- ✓ Schema v7：games.summary 列 + 3 张新表（persons / game_staff role enum scenario|artist|voice|music / game_official_tags） — v1.2
- ✓ Bangumi 客户端拉宽：fetch_detail infobox 解析品牌 + 官方 tags 数组；fetch_persons / fetch_characters 端点 — v1.2
- ✓ VNDB GraphQL 客户端拉宽：staff{} / va{} / developers{} / tags{}；art+chardesign 合并到 artist role — v1.2
- ✓ Ingest 写入 summary + brand (COALESCE) + persons + game_staff + game_official_tags（事务化 write_staff_and_tags helper） — v1.2
- ✓ 6 新 IPC 命令（list_persons_for_game / list_games_for_person / list_official_tags_for_game / get_filter_options / backfill_metadata_enrichment / open_external_url） — v1.2
- ✓ Detail 页面：简介区块 + 制作团队按 role 分组 + 官方标签 + 在 Bangumi/VNDB 看 ↗ 外部链接 — v1.2 (real-app smoke pending)
- ✓ Library FilterPanel 多维 facet：品牌 / 编剧 / 画师 / 声优 / 官方标签（chip 多选 + 局部搜索 + 60-cap 更多 expander） — v1.2 (real-app smoke pending)
- ✓ `/persons/:id` 人物聚合页（4 role-grouped grids + voice 角色 caption） — v1.2

### Active

<!-- Current scope. Building toward these. v1 hypotheses until shipped. -->

v1.3 Scan Pipeline & Person Polish (defined 2026-05-12，详情见 `.planning/REQUIREMENTS.md`)

**SCAN — 独立扫描复核流**
- [ ] **SCAN-01**: 新增 `/scan` 路由（无 Library 侧栏） + 顶部 KPI 4 联 + 触发增量/全量按钮
- [ ] **SCAN-02**: 双栏 feed — 左侧增量日志 / 右侧待复核卡片队列（重启后保留）
- [ ] **SCAN-03**: 待复核卡片展开 Bangumi vs VNDB 并排候选对比 + 一键采用

**PER — 人物聚合页加强**
- [ ] **PER-01**: 跨源人物去重（Bangumi+VNDB 同名同语 → 折叠为一行，保留 source attribution）
- [ ] **PER-02**: 作品时光轴（按 release_year 横向气泡，气泡尺寸 = 自己 playtime）
- [ ] **PER-03**: 「常与 X 共同出现」横滑条（co-staff 推荐，count ≥ 2）
- [ ] **PER-04**: 人物头像本地缓存（data/portraits/，聚合页 + Detail staff chip 显示）

**FS — 文件系统操作**
- [ ] **FS-01**: 引入 `tauri-plugin-opener` + 替换现有 cmd /C start fallback
- [ ] **FS-02**: Detail 「打开游戏目录」按钮
- [ ] **FS-03**: Screenshots 「打开截图目录」按钮

**POL — 打磨与 carry-over**
- [ ] **POL-01**: Detail 页解析 `?tab=screenshots|saves|notes|metadata` deeplink
- [ ] **POL-02**: Stats 真实会话总数 KPI（替换 games count 代理）
- [ ] **POL-03**: Backfill 进度 UI 完整化（PageHeader 进度条 + 取消按钮）
- [ ] **POL-04**: LIB-02 杂志式不对称网格 — 回归实现或正式从 spec 中删除

**VER — v1.2 真机 smoke**
- [ ] **VER-01**: UI-01 真机验证（Detail summary / staff / 外部链接）
- [ ] **VER-02**: UI-02 真机验证（人物 chip → /persons/:id + 官方标签 region）
- [ ] **VER-03**: UI-03 真机验证（FilterPanel 多维 facet + 更多 expander）

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

**v1.2 后状态**：
- 视觉系统 v1.1 完整保留，元数据层 v1.2 一次性补齐
- Rust IPC 表面扩展（v1.0/v1.1 全部保留 + 新增 6：list_persons_for_game / list_games_for_person / list_official_tags_for_game / get_filter_options / backfill_metadata_enrichment / open_external_url）
- Schema v7：games + sessions + tags + game_tags + scan_roots + screenshots + save_backups + persons + game_staff + game_official_tags
- 已知待办：v1.1 carry（standalone /scan + open-directory IPC + LIB-02 重审 + Detail ?tab= deeplink） + v1.2 carry（person dedup + portrait cache + backfill progress UI）

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
| LIB-02 杂志式 hero band 回退（v1.1 Phase 7） | Portrait cover 在 1.6fr hero 槽位裁切异常 + density 冲突 | ✗ 废止 — v1.3 Phase 14 (POL-04) 正式废止：a) auto-fill 网格在不同屏幕下视觉密度可控；b) 不对称布局对长名/短名游戏视觉权重不均衡；c) 实施成本相对收益过高。最终采用 `repeat(auto-fill, minmax(172px, 1fr))` 均匀网格。 |
| PGE-01/02 standalone /scan 延后（v1.1 Phase 9） | 需要新 router + 新 IPC payload + 新表 schema —— 不是纯视觉变更 | ⚠ Revisit — v1.3 实现 |
| Settings 外观 section 是指针（v1.1 Phase 10） | 避免与 Tweaks 面板双源 | ✓ Good |
| 独立 persons 表 + game_staff N:M（v1.2 Phase 11） | 反范式 JSON 不能"点 X 看 X 所有作品"+ 不能交集筛选 | ✓ Good — `/persons/:id` 聚合页落地 |
| 4-role enum 而非细分（v1.2 Phase 11） | scenario/artist/voice/music 覆盖 95% 价值，丢 director/translator | ✓ Good — VNDB chardesign 合并到 artist 解决一人多行 |
| Bangumi 拆 3 端点 vs VNDB 1 GraphQL（v1.2 Phase 11） | Bangumi 没有合并 endpoint，VNDB 一次拉光 | ✓ Good — limiter 1req/s × 3 = 3 倍延时但可接受 |
| 跨源人物不去重（v1.2 决策） | 同一作者 Bangumi+VNDB 各占一行 — 用户感知度低、去重复杂度高 | ⚠ Revisit — v1.3 seed |
| `tauri-plugin-opener` 不引入（v1.2 Phase 11） | Cargo.toml 没有该依赖；Windows-only 项目用 cmd /C start fallback 即可 | ⤴ Reversed — v1.3 Phase 14 (FS-01) 引入：统一权限模型 + 平台一致 API；open_in_explorer/open_external_url 内部改 delegate；新 open_path IPC 作为新 callsite 首选 |
| Brand filter 双重应用（v1.2 Phase 11） | server-side + client-side：保持 PageHeader 可见行计数跨轴一致 | ✓ Good — 零 SQL 成本 |

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
*Last updated: 2026-05-12 — milestone v1.3 (Scan Pipeline & Person Polish) initialized via /gsd-new-milestone*
