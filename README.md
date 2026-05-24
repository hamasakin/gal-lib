# 箱庭 · Hakoniwa (gal-lib)

> **让本地一堆乱糟糟的 galgame 目录，变成可搜索、可启动、可统计的图书馆。**

面向 Windows 的 galgame 收藏与启动管理器。

[**下载最新版 →**](https://github.com/hamasakin/gal-lib/releases/latest) ・ [日本語](./README.ja.md) ・ [English](./README.en.md)

---

## 这是什么

**箱庭 (Hakoniwa)** 是一款面向 Windows 的 galgame 收藏与启动管理器。它会扫描你本地的游戏目录，自动从 **Bangumi / VNDB** 抓取封面、简介、制作团队、标签等元数据，用 **Locale Emulator** 一键转区启动游戏，并通过监控进程存活自动累计游玩时长。

整个应用打包成一个 ~10MB 的单 exe，所有数据都放在 exe 同目录的 `data/` 下——**解压即用、可放 U 盘、无任何残留**。

## 为什么做这个

中文圈 galgame 玩家通常会面临三个痛点：

1. **本地几十甚至几百款游戏散落在不同根目录，找不到、记不住。**
2. **日文 galgame 必须靠转区工具启动**——LE 虽然好用，但每款游戏配一遍配置很烦。
3. **打完想看自己玩了多久、最近在玩什么、某个画师都画过哪些作品**——本地没有图书馆视图，只有一堆文件夹。

市面上 LaunchBox / Playnite / Heroic 这类工具偏 PC 商业游戏，对 galgame 的元数据源（Bangumi）、转区刚需、人物聚合都覆盖不足。箱庭就是把"图书馆"这个隐喻彻底做出来：**藏书章、卡片网格、人物聚合页、时光轴**——看起来像图书馆，而不是一坨壁纸。

## 功能特性

### 📚 收藏与扫描
- **多根目录扫描**，每个根目录可独立配置深度
- 启发式 exe 打分自动识别可执行游戏；低置信度进入 **`/scan` 复核队列**，Bangumi/VNDB 候选并排对比一键采用
- 增量/全量扫描 + 实时进度反馈
- 自定义标签、收藏、1-10 评分、通关状态、备注笔记（800ms autosave）

### 🌐 元数据自动抓取
- **Bangumi 优先 + VNDB 兜底**双源匹配（带令牌桶限速）
- 自动拉取：封面、简介、品牌、发售年份、官方标签、**制作团队**（编剧 / 画师 / 声优 / 音乐 4 大职能）
- 匹配置信度低时支持手动绑定 Bangumi/VNDB ID
- **跨源人物去重**：同一作者在 Bangumi 和 VNDB 各占一行时，自动合并展示

### 🎮 一键转区启动
- 集成 **Locale Emulator** 自动检测路径
- 每款游戏可独立配置 LE Profile / 工作目录
- 内置截图自动收集（per-game 作用域 + 可调间隔）
- 存档目录一键备份 / 恢复

### ⏱ 游玩时长统计
- 进程存活计时，单次会话 + 累计总时长
- 系统托盘后台计时——关掉主窗口也继续记录
- Stats 仪表盘：KPI、6 月热力图、30 日柱图、按游戏 ringstack、Top 8、品牌 / 年份分布

### 👤 人物聚合（v1.2+）
- `/persons/:id` 人物聚合页：4 个职能分组网格 + 该人参与过的全部作品
- **时光轴**：横向年份气泡，把游玩时长映射到气泡高度
- **「常与 X 共同出现」** 横滑条：自动推荐协作过的其他人物
- 人物头像本地缓存（`data/portraits/`），离线也能看

### 🎨 5 轴设计令牌
通过 `<html data-*>` 实时切换，**全 CSS 变量驱动，无 JS 重渲染**：
- 3 主题（明 / 暗 / 系统）× 4 强调色 × 2 圆角 × 3 侧栏宽度 × 3 封面密度
- 浮动 Tweaks 面板随时调
- localStorage 持久化

### 📦 工程取向
- **Portable**：数据全部放 `data/`，U 盘携带 / 朋友间分发都直接
- **单 exe**：Tauri 打包 ~10MB（NSIS 安装器），目标 < 30MB
- **自动更新**：基于 GitHub Releases + minisign 签名（`tauri-plugin-updater`）

## 技术栈

| 层 | 技术 |
|---|---|
| Shell | Tauri 2 (Rust) |
| 前端 | React 19 + TypeScript + Vite + Tailwind v3 + shadcn/ui + Zustand |
| 数据库 | SQLite via `tauri-plugin-sql` + `sqlx` (schema v12) |
| HTTP | reqwest + governor（令牌桶限速） |
| 进程监控 | sysinfo + Windows API (OpenProcess / WaitForSingleObject) |
| 平台 | Windows 10/11 only |

## 安装

到 [Releases](https://github.com/hamasakin/gal-lib/releases/latest) 下载 `.exe` 安装器（NSIS），双击安装；首次启动会在 exe 同目录创建 `data/`。
需要预先安装 [Locale Emulator](https://github.com/xupefei/Locale-Emulator)（应用会自动检测路径）。

## 开发

```bash
# 前置：Node.js 20+、pnpm、Rust 工具链（stable）、Windows 10/11
pnpm install

# 开发模式（vite + tauri dev）
pnpm tauri dev

# 类型检查
pnpm typecheck

# 生产构建 → NSIS 安装器输出到 src-tauri/target/release/bundle/
pnpm tauri build

# 发版（自动 bump + commit + tag + push，触发 GitHub Actions release.yml）
pnpm release
```

Cargo 测试：`cd src-tauri && cargo test`。

### 项目结构

```
src/                 React 19 + TS 前端（routes/、components/、store/、hooks/）
src-tauri/src/       Rust 后端
  ├── scan/          多根目录 walker、exe 打分、removed-marker
  ├── metadata/      bangumi.rs、vndb.rs、限速器、匹配评分
  ├── launch/        LE 检测、orchestrator、进程跟踪、会话计时
  ├── ingest.rs      把扫描结果 + staff + tags 写入 SQLite
  ├── tray.rs        系统托盘 + 后台计时
  └── commands.rs    Tauri IPC 表面
src-tauri/migrations/  SQLite schema v1 → v12
```
