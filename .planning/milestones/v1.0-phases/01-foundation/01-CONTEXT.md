# Phase 1: Foundation - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

可运行的 Tauri 应用骨架交付：portable 数据目录自动初始化、SQLite schema 就位、双栏 App Shell 可见、单 exe 打包验证通过。

**包含：**
- Tauri v2 项目脚手架（Rust 后端 + React + Vite 前端）
- exe 同级 `data/` 目录的自动初始化（首次启动）
- SQLite 数据库 schema 初版（games / sessions / tags / app_meta 等核心表）
- 双栏 App Shell 布局（左侧 Sidebar 占位 + 右侧 Main 占位）
- Tauri 配置：单 exe 打包、图标、产物体积控制 < 30MB
- 启动验证：双击 .exe → 启动 → data/ 创建 → schema 初始化 → 主窗口呈现

**不包含（在后续阶段）：**
- 实际扫描功能（Phase 2）
- 元数据匹配/封面拉取（Phase 2）
- LE 启动 / 进程跟踪（Phase 3）
- 标签 / 评分 / 笔记交互（Phase 4）
- 搜索 / 详情页 / 设置页（Phase 4，Phase 1 仅占位路由）
- 统计图表 / 截图 / 存档（Phase 5）

</domain>

<decisions>
## Implementation Decisions

### Build Tooling & Stack Versions
- 包管理器：**pnpm**（安装快、磁盘节省、monorepo 友好）
- Tauri 主版本：**Tauri v2**（当前主线、插件体系完善、长期支持）
- 前端构建工具：**Vite**（Tauri v2 官方模板默认）
- TypeScript 严格模式：**strict: true**

### Backend & Database
- SQLite 库：**tauri-plugin-sql (sqlx 后端)** — 官方插件、异步、迁移内建
- 迁移策略：**嵌入 SQL 文件**，放置于 `src-tauri/migrations/`，按时间戳命名
- 连接策略：**单连接**（单用户 portable 场景，避免 SQLite 多写并发问题）
- Schema 版本控制：**`app_meta(key TEXT PRIMARY KEY, value TEXT)` 表，存 `schema_version` 等元数据**

### Frontend App Shell
- 状态管理：**Zustand**（轻量、零样板）
- 路由：**react-router-dom v6**（HashRouter，避免 Tauri 协议路径问题）
- UI 组件库底座：**shadcn/ui**（radix-ui + tailwind，复制源码进项目，可定制）
- 字体/i18n 默认：**中文默认 + 系统字体栈**（不引入 i18n 框架）
- Tailwind 版本：v3.x（shadcn/ui 当前模板兼容版本）

### Portable Data Layout & Init
- 数据目录解析：**exe 同级 `data/`**（通过 Tauri Rust API 取 exe parent dir）
- 首次初始化策略：**静默自动创建**所需目录与默认 config
- 配置文件格式：**JSON**（`data/config.json`）
- 数据子目录布局：
  ```
  data/
    app.db                # SQLite 主库
    config.json           # 应用配置
    covers/               # 封面图缓存
    screenshots/          # 游戏截图（按 game_id 子目录）
    saves/                # 存档备份（按 game_id 子目录）
    logs/                 # 应用日志
  ```

### Claude's Discretion
- 具体目录结构：`src/` (前端) 与 `src-tauri/` (Rust 后端) 内部子模块分组由 Claude 决定
- App Shell 占位文案、边距、配色由 Claude 决定（保持简洁、占位明确）
- 数据库初版 schema 列细节（除上述确定的核心表外）由 Claude 在 Plan 阶段设计
- 前端样式约定（CSS 变量、深浅色支持等）由 Claude 决定（默认深色优先，galgame 用户夜间使用偏好）
- Rust crate 选择（除 tauri-plugin-sql 外，如日志库、错误处理库）由 Claude 决定

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- 无 — 全新项目（仅 `.planning/`、`docs/`、`CLAUDE.md` 已存在，无源代码）

### Established Patterns
- 无 — 无前置代码

### Integration Points
- 无 — 全新项目入口

</code_context>

<specifics>
## Specific Ideas

- App Shell 双栏布局：固定左侧栏 ~220px 宽，右侧主区自适应；类似 LaunchBox / Playnite 的经典布局
- 主区在 Phase 1 显示空状态："还没有游戏 — 请到设置页添加扫描根目录"（设置页占位）
- 侧栏在 Phase 1 显示静态分类占位项（"全部"、"收藏"、"标签"、"通关状态" — 但都不可点击或仅占位）
- 标题栏：自定义 Tauri 装饰栏（去除系统默认装饰），保持现代桌面应用观感
- 窗口默认尺寸：1280×800，最小 960×600

</specifics>

<deferred>
## Deferred Ideas

- 系统托盘（移到 Phase 3 — 需配合后台计时）
- 实际可点击的导航与分类筛选（Phase 4）
- 游戏卡片网格虚拟化（Phase 2 — 配合实际数据）
- 设置页交互（Phase 4 — 此阶段只放占位路由）
- 错误边界与全局错误提示组件（在出现实际数据流后再加）
- 自动更新（已明确 Out of Scope）

</deferred>
