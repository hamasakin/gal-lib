# gal-lib

## What This Is

Galgame 收藏与启动管理器 —— 一个面向 Windows 用户的桌面应用，扫描本地游戏目录后自动从 Bangumi/VNDB 抓取元数据、用 Locale Emulator 一键转区启动游戏、自动累计游玩时长。面向中文圈 galgame 玩家本人收藏管理及向朋友/社区分发。

## Core Value

**让本地一堆乱糟糟的 galgame 目录，变成可搜索、可启动、可统计的图书馆**：扫一眼就能找到游戏、点一下就能转区启动、关掉游戏就能看到这把玩了多久。

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. v1 hypotheses until shipped. -->

**核心三件套：**
- [ ] 扫描多个根目录、按可配深度识别游戏边界
- [ ] 调用 Bangumi 优先 + VNDB 兜底自动匹配元数据（封面、简介、CV、品牌、发行日、标签）
- [ ] 用 Locale Emulator 一键转区启动游戏，自动检测启动 exe（启发式打分 + 用户手动覆盖）
- [ ] 进程存活计时，自动累计每款游戏的总时长 / 单次会话

**库管理：**
- [ ] 双栏 UI（侧边栏分类导航 + 主区封面网格）
- [ ] 自定义标签 / 分类
- [ ] 收藏夹、评分、通关状态标记（未开始/游玩中/已通关/弃坑）
- [ ] 每款游戏的笔记/备注
- [ ] 元数据自动匹配错时手动搜索/绑定 ID 修正

**启动器与运行时：**
- [ ] 每款游戏独立启动配置（LE profile、自定义启动参数、cwd）
- [ ] 系统托盘 + 后台计时（关闭主窗口仍跟踪进程）
- [ ] 扫描进度 UI：实时反馈、跳过/重试单个目录、低置信度时手动从候选列表挑选

**辅助功能：**
- [ ] 游玩统计图表（每日/每周时长分布、按游戏分布）
- [ ] 截图管理（自动收集运行期间的截图到 game-scoped 目录）
- [ ] 存档管理（备份/恢复指定存档目录）

**分发与运行：**
- [ ] Portable 模式：所有数据放 `data/` 子目录，解压即用、可放 U 盘

### Out of Scope

<!-- Explicit boundaries. -->

- **跨平台（macOS / Linux）** — Locale Emulator 是 Windows-only 技术，转区是核心功能，跨平台没有等价方案
- **多用户切换** — 一台机器一个用户使用，多用户需求会大幅复杂化数据模型，v1 不做
- **NTLEAS / 其他第三方转区工具** — 用户明确选择只支持 LE，避免启动器抽象过早膨胀
- **窗口焦点检测计时 / 闲置阈值暂停** — 用户选择仅用进程存活计时，简化实现，挂机时间作为已知误差接受
- **自动更新机制** — Portable 模式优先，更新方式留给用户手动替换 exe
- **云同步 / 多设备同步** — v1 是单机应用，不引入云后端
- **Patreon / 商店 / 在线购买集成** — 这是收藏管理器，不是商店
- **完整中文社区元数据源（DLsite/Getchu/EGS）** — Bangumi+VNDB 双源已能覆盖中文圈主流需求，更多源延后

## Context

**用户画像**：作者本人是中文圈 galgame 玩家，本地积累了多个根目录、几十至几百款游戏，目录命名混乱（日文罗马音 / 中文译名 / 含汉化版/RAW 等噪声后缀）。希望既能自用，也能打包给朋友和小社区使用。

**生态参考**：
- LaunchBox / Heroic / Steam / Playnite —— 通用 PC 游戏库管理器，UI 范式参考
- Galgame Manager / GameTracker / SAManager —— 中文圈同类工具，但多数是 Python+PyQt 或老 .NET，分发体验和 UI 现代化程度不够
- LE（Locale Emulator）—— 国内最常用的转区工具，命令行参数 + 多 profile 支持
- Bangumi（bgm.tv）—— 中日双语条目库，REST API 可用、有评分和标签
- VNDB（vndb.org）—— 全球最大视觉小说库，HTTPS API + GraphQL，元数据最完整

**关键技术挑战**：
1. **目录名 → 元数据匹配**：目录名通常含噪声（版本号、汉化标记、商家名），需要清洗 + 模糊搜索 + 多源结果合并
2. **启动 exe 识别**：游戏目录常含多个 exe（安装/卸载/启动器/补丁/主程序），需启发式打分排除非主程序
3. **LE 转区调用**：LE 启动游戏后自身退出，主进程是游戏 exe；计时需跟踪正确的目标进程
4. **分发友好**：Portable + 单 exe，避免 Electron 类大体积带来的负担

## Constraints

- **Tech stack — Tauri + React + Tailwind**：包小（~10MB）、Rust 后端做进程/文件 I/O 方便，Web 前端做卡片网格 UI 最快
- **Platform — Windows-only**：LE 是 Windows 独占，无跨平台等价方案
- **Storage — Portable**：所有用户数据放 exe 同目录 `data/`，便于分发、U 盘携带、无残留
- **Database — SQLite**：单文件、无外部依赖、Rust 生态成熟（rusqlite/sqlx）
- **Metadata sources — Bangumi 优先 + VNDB 兜底**：主源命中走 Bangumi，未命中再 fallback 到 VNDB；需要 API 适配层 + 限速器（避免被两边限流）
- **Locale switching — Locale Emulator only**：内置 LE 路径自动检测，仅支持 LE，不做通用启动器抽象
- **Distribution — 单 exe**：Tauri 打包后单 exe + 同目录 data/，目标 < 30MB

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tauri 而非 Electron | 包大小一个数量级差距（10MB vs 80MB+），Rust 后端做进程监控/文件 I/O 更合适 | — Pending |
| Bangumi 优先 + VNDB 兜底 | 用户群是中文圈，Bangumi 中文标签/评分更贴近；VNDB 兜底覆盖 Bangumi 没收录的小众作品 | — Pending |
| Portable 模式（数据放 exe 同目录） | 用户场景是分发给社区，解压即用、无残留体验最好 | — Pending |
| 仅支持 Locale Emulator | 用户明确只用 LE，避免启动器抽象过早膨胀；将来加新工具再重构 | — Pending |
| 仅进程存活计时（不做焦点/闲置检测） | 实现成本低、稳定可靠；挂机误差接受作为已知 trade-off | — Pending |
| 双栏 UI（侧边栏 + 主区网格） | 标签/分类/品牌多维度过滤需要导航空间；galgame 管理器主流形态 | — Pending |
| 多根目录 + 每根独立深度 | 用户实际场景：有人按品牌嵌套（深度 2），有人扁平（深度 1），灵活配置 | — Pending |
| Exe 识别用启发式打分 + 手动覆盖 | 全自动易错（多 exe 场景），全手动太累；启发式 80% + 边缘 case 人工兜底 | — Pending |

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
*Last updated: 2026-05-06 after initialization*
