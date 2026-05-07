# Phase 2: Library Ingest - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning
**Mode:** Auto-generated via `/gsd-discuss-phase 2 --auto` (recommended-default selections; single pass)

<domain>
## Phase Boundary

用户能将本地杂乱 galgame 目录扫描进库，每款游戏自动匹配封面和元数据，以封面网格呈现。

**包含：**
- 设置页（Phase 1 占位）实装：管理扫描根目录列表（增/删/改深度）
- 文件系统扫描引擎：根目录 → "第 N 层子目录 = 一款游戏" 的边界识别（Rust 后端）
- 启动 exe 启发式识别（递归扫描 + 启发式打分排除 setup/uninst/launcher/patch 等）
- Bangumi 优先 + VNDB 兜底的元数据匹配适配层（含 API 限速器 + 失败重试）
- 目录名清洗（去版本号、汉化标记、商家名、括号噪声）
- 封面图本地缓存到 `data/covers/`（按 game_id 命名）
- 主区从 Phase 1 的「还没有游戏」空状态切换到封面网格视图（虚拟化滚动，支持 1000+ 卡片）
- 元数据低置信度时的候选挑选 UX（手动选）
- 错配修正（手动绑定 Bangumi/VNDB ID）+ 单游戏重新抓取
- 增量扫描（跳过已识别游戏目录）
- 扫描期间的实时进度反馈（当前目录 / 已完成 / 总数）

**不包含（在后续阶段）：**
- LE 启动 / 进程跟踪 / 时长记录（Phase 3）
- 标签 / 评分 / 笔记 / 详情页 / 搜索（Phase 4）
- 统计图表 / 截图 / 存档（Phase 5）
- 用户字典管理 UI（深度对应规则编辑器）—— Phase 4 设置页扩展
- 扫描日志可视化界面（写到 `data/logs/` 即可，Phase 4 才出 UI）

**REQ-IDs：** SCAN-01..08, META-01..07, LIB-02, LIB-06（共 17 项）

</domain>

<decisions>
## Implementation Decisions

### Filesystem Scan Engine
- **遍历策略：** Rust 端用 `walkdir` crate 异步迭代，配合 `tokio` 并发限制（4 工作线程，避免磁盘队列拥塞）
- **游戏边界识别（SCAN-04）：** "根目录的第 N 层子目录 = 1 款游戏"。N 由 SCAN-02 配置（默认 1，可选 1/2/3）。例：根 = `D:\Games`，深度 1 → `D:\Games\Fate` 是一款；深度 2 → `D:\Games\ABC社\Fate` 是一款
- **递归 exe 扫描（SCAN-05）：** 在每款游戏目录内**全递归**（不受深度限制）扫所有 `.exe`，按打分挑首发候选
- **打分启发式（SCAN-05）：** 对每个 .exe 计算分数：
  - **加分：** 文件名长度 5-30 字符 (+1)、与目录名前缀匹配 (+5)、文件大小 > 1 MB (+2)、不是任何子目录里的隔离工具 (+1)
  - **减分：** 名字含 `setup`/`uninst`/`patch`/`tool`/`config`/`launcher`/`crash`/`vcredist`/`dotnet` (-10)、文件大小 < 100KB (-3)、位于 `redist`/`tools`/`launcher`/`extras`/`crack` 等目录 (-3)
  - 最终选分数最高的 exe 作为 `executable_path`；并列时取 LastWriteTime 最新
  - 全部为负分时记录"无可识别 exe"，UI 上标灰但允许后续手动绑定（Phase 4 详情页才有 UI 修正入口；Phase 2 仅"无 exe"标记）
- **跳过/重试（SCAN-06）：** 扫描进度 UI 在每个目录条目上提供"跳过本目录"按钮（写入跳过状态 → 进度 +1，但不入库）；失败的目录支持"重试"
- **增量扫描（SCAN-08）：** 数据库 `games.path` 已存在 → 跳过；新目录 → 入库走完整 pipeline；删除的目录 → Phase 2 不自动从库删除（Phase 4 设置页才提供"清理已失踪游戏"工具）

### Title Cleaning (META-03)
- **规则集（顺序应用）：**
  1. 移除全角/半角括号及其内容：`（汉化）`/`(v1.5)` → 空
  2. 移除常见噪声词（大小写不敏感）：`v1`/`v2`/`v[0-9.]+`/`完整版`/`汉化版`/`繁体`/`简体`/`修正版`/`体験版`/`体验版`/`DL版`/`Steam版`/`Patch`/`Crack`/`(\d{4}年)?(\d{1,2}月)?发售`
  3. 移除商家/汉化组前缀：检测开头连续 1-3 个汉字/片假名后跟下划线或空格的串（如 `天使汉化_`、`雷竹工作室 -`）→ 空
  4. 移除最后一段年月日：`2023.05.26` / `20230526` / `230526` 类
  5. 全角转半角空格、连续空白合一、首尾 trim
- **实现：** Rust crate `regex` 写在后端 `src-tauri/src/title_clean.rs`，单元测试覆盖 10+ 真实样本
- **保留原始名：** `games.path` 永远是真实磁盘路径；清洗后仅作为搜索 query，不写入 `name` 字段（`name` 用 Bangumi/VNDB 返回的官方名）

### Metadata Match Pipeline
- **顺序：** Bangumi → fallback VNDB
- **Bangumi API：**
  - 搜索：`POST https://api.bgm.tv/v0/search/subjects` (新版 v0 API)，body `{"keyword": <cleaned_title>, "filter": {"type": [4]}}` (type=4 = Game)
  - 详情：`GET https://api.bgm.tv/v0/subjects/{id}`
  - 封面：`GET <subject.images.large>`
  - User-Agent：`gal-lib/0.1.0 (https://github.com/<placeholder>/gal-lib)` —— Bangumi 要求自定义 UA 否则 403
  - **无需 access token**（公共 read API 不强制；`Authorization: Bearer ...` 仅写入操作需要，本 phase 不写）
- **VNDB API：**
  - 端点：`POST https://api.vndb.org/kana/vn` (新版 Kana API)
  - 搜索：`{"filters": ["search", "=", <cleaned_title>], "fields": "id,title,titles{title,lang},image.url,description,released,length,languages,platforms,developers{name},rating,votecount", "results": 5}`
  - 封面：`<vn.image.url>` 直接用
  - **无需 token**（read-only 公共数据；100 req/min 默认配额；token 后续支持更多 voted-by-X 类查询）
- **置信度评分：**
  - 完全匹配（title 或 alias 一字不差）= 100
  - 模糊匹配（Levenshtein 距离归一化后 ≥ 0.8）= 70-99
  - 弱匹配（< 0.8）= < 70
  - **阈值：** ≥ 80 自动绑定；< 80 走 SCAN-07 候选列表挑选；候选列表显示前 5 名
- **手动绑定（META-05）：** Phase 2 在主区卡片右键菜单或卡片状态徽章上提供"重新匹配"入口；弹出搜索 modal（文本框 + 直接粘 ID）；搜索结果显示候选；选中后写入 `bangumi_id` 或 `vndb_id` 并刷新元数据
- **重新抓取（META-06）：** 同上 modal 路径；按"刷新"调 API 重拉
- **限速器（META-07）：**
  - Bangumi：1 req/sec（保守，Bangumi 官方未明说但社区共识）
  - VNDB：100 req/60sec（官方文档 100/min）
  - **实现：** Rust crate `governor` 提供 token-bucket，per-API singleton 限速器
- **重试：** 5xx / 网络错误 / 429 → 指数退避 (1s, 2s, 4s)，最多 3 次；4xx (除 429) 不重试

### Cover Cache (META-04)
- **路径：** `data/covers/{game_id}.{ext}`，扩展名按返回 Content-Type 选 `.jpg` / `.png` / `.webp`（不强制转换）
- **DB 字段：** `games.cover_path` 存相对路径 `covers/{game_id}.jpg`
- **去重：** game_id PK 即天然去重，已下载且文件存在 → 跳过；用户强制刷新（META-06）→ 删除旧文件再下载
- **缩略图：** Phase 2 不预生成缩略图；Phase 5 截图功能复用时再优化（用 `image` crate 缩放）
- **失败容错：** 下载失败保留 NULL，UI 卡片显示占位图（lucide `ImageOff` 或纯色块）

### Card Grid Virtualization (LIB-02, LIB-06)
- **库：** `@tanstack/react-virtual`（active 维护、TS 一类、网格示例完善；优于 react-virtuoso 因为我们要 grid 不是 list）
- **布局：**
  - 卡片宽度：动态 200-260px（响应式 minmax CSS grid）
  - 封面比例：3:4（竖版，匹配 galgame 标准盒图比例）
  - 卡片含：封面图 + 下方 H 14px 标题（双行截断 `line-clamp-2`）+ 状态徽章（unplayed=灰 / playing=蓝 / cleared=绿 / dropped=暗红，4×4px 圆点 + 文字）+ 时长（"12 时" / 在 Phase 2 因为还没有 session 都是 0）
- **空状态：** 复用 Phase 1 的「还没有游戏」+ "请到设置页添加扫描根目录"；扫描完成且仍 0 → 改为「未识别到游戏」+ "请检查根目录扫描深度配置"
- **加载/扫描中：** 顶部全宽进度条（shadcn `Progress` block，01b 未装 → Phase 2 加 5 件套）+ 文字 `扫描中: 当前目录 / 已完成 / 总数 [当前目录路径]`；可点 "暂停"/"取消"
- **错误状态：** 单卡片层级，没有元数据 → 卡片显示占位封面 + `metadata-pending` 标记 + 右下角 `重试` 按钮（手动触发 META-06）

### Settings Page (extending P1 placeholder)
- **设置页 Phase 2 实装项：**
  - "扫描根目录"列表（每行：路径 + 深度选择 1/2/3 + 移除按钮）
  - "添加根目录"按钮 → 调 Tauri dialog plugin (`@tauri-apps/plugin-dialog`) 选目录
  - "全量扫描"+"增量扫描" 两个按钮（触发后跳转主区显示进度）
  - **不包含**（留 Phase 4）：标签管理、Locale Emulator 路径配置、深色/浅色切换、关于页面

### Scan Progress Reporting (SCAN-03)
- **实现：** Rust 后端用 Tauri events emit 进度 (`scan-progress` event with payload `{current_dir, completed, total, status}`)；前端 Zustand store 订阅事件
- **取消：** Tauri command `cancel_scan` 写入 `AppPaths` 内的 `Arc<AtomicBool>` cancel flag；扫描循环每个目录起点检查
- **暂停 vs 取消：** Phase 2 仅取消，不实现暂停（暂停需要持久化中间状态，复杂度高于 P1 价值）

### Database Schema Extensions (Phase 2 → schema v2 migration `0002`)
- **新增表：**
  ```sql
  CREATE TABLE scan_roots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    depth INTEGER NOT NULL DEFAULT 1 CHECK(depth IN (1, 2, 3)),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ```
- **修改 `games`：**（通过 `ALTER TABLE`）
  - `cover_url TEXT` 新增（远端 URL，便于失败重试）
  - `metadata_source TEXT` 新增（`bangumi` / `vndb` / `manual` / `none`）
  - `match_confidence INTEGER` 新增（0-100；0 = 无匹配）
  - `last_scanned_at TEXT` 新增
- **schema_version**：UPDATE app_meta SET value='2' WHERE key='schema_version'；migration runner 应用 0002

### Claude's Discretion (delegate to planner / executor)
- 具体 Rust 模块拆分（`scan/`, `metadata/`, `cache/` 子模块）由 plan 阶段决定
- 前端 React 组件文件结构（GameCard, ScanProgressBar, MetadataPicker modal 等）由 plan 决定
- 进度事件 throttle / debounce 频率（默认建议 100ms throttle）
- 卡片 hover 微交互（卡片轻微抬起、边框 accent）按 UI-SPEC 风格自由发挥（暗色配色 + 不使用 accent 作为 hover 填充）
- Bangumi/VNDB API 客户端是用 `reqwest` (推荐) 还是 `ureq` 由 plan 决定
- 测试策略：Rust 单元测试 + 1-2 个集成测试（mock API 响应）；E2E 留给 phase verification

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1)
- `src-tauri/src/data_dir.rs` — exe-sibling `data/` resolver；Phase 2 复用 `data/covers/` 子目录
- `src-tauri/src/db.rs` — migration 注册机制；Phase 2 追加 `0002_add_scan_and_metadata.sql`
- `src-tauri/migrations/0001_init.sql` — 已含 `games` 5 表；Phase 2 用 `ALTER TABLE` 增字段，新增 `scan_roots` 表
- `src/lib/db.ts` — `getDb()` / `getDataDir()` helper；Phase 2 复用
- `src/store/app.ts` — Zustand store；Phase 2 扩展 `scanProgress` / `games` slices
- `src/components/ui/*` — shadcn block button/separator/scroll-area/tooltip 已就绪
- `src/components/layout/Sidebar.tsx` — 侧栏占位项 Phase 2 仍占位（Phase 4 才激活分类筛选）；侧栏底部 `设置` nav 在 Phase 2 后跳到实装设置页
- `src/routes/Library.tsx` — 主区路由；Phase 2 替换其内容（封面网格 vs 空状态）
- `src/routes/Settings.tsx` — 占位「设置 — 即将上线」；Phase 2 替换为实装

### Established Patterns
- **Rust modules：** 单文件模块（`data_dir.rs`、`db.rs`），Phase 2 沿用同风格（`scan.rs`、`metadata.rs`、`cover_cache.rs`）；如某模块超 300 行再拆子目录
- **错误处理：** Phase 1 有 `anyhow`/`thiserror`；Phase 2 后端用 `thiserror` 自定义 `ScanError` / `MetadataError` 类型
- **Tauri 命令风格：** `#[tauri::command] fn xxx(state: tauri::State<AppPaths>) -> Result<T, String>`（serializable error）；Phase 2 沿用
- **frontend invoke：** `invoke<T>("cmd_name", { arg })`；用 helper 包一层防 type 漂移
- **Migration runner：** `db::migrations()` 返回 `Vec<Migration>`，sqlx Migrator 串行应用；Phase 2 push 第二个 Migration
- **TS strict / no any：** Phase 1 已强制；Phase 2 必须遵循
- **UI-SPEC 调色板：** `bg-card` / `bg-accent` / `text-muted-foreground` / `ring-ring`；不引入新颜色 token；新组件继续用这套
- **HashRouter + react-router-dom v6：** Phase 2 不切换 router；新增子路由（如设置页内嵌路由）走 nested children
- **Locked copy 准则：** 所有用户可见文案两段式（state + next-step）；Phase 2 新增文案延续这个规则

### Integration Points
- **Tauri plugins to add：** `tauri-plugin-dialog`（选目录）、`tauri-plugin-http`（让 Rust 后端发请求；或用 `reqwest`）
- **Frontend npm to add：** `@tanstack/react-virtual`、`@tauri-apps/plugin-dialog`、可能 `framer-motion`（卡片 hover 微交互；如不必要不引入）
- **Existing UI tokens：** Phase 2 不动 `tailwind.config.ts` / `src/index.css`；如需新 token 必须先扩 `01-UI-SPEC.md`-style 锁定决策

</code_context>

<specifics>
## Specific Ideas

- Bangumi 搜索结果倾向于优先选 `type=4` (Game) 子类型，如果同名作品有动画/小说版本时不会误匹配；候选列表也只展示 game 类
- VNDB 的 `kana` 表示 Kana API（区别于旧版 V1 API）；JSON 响应直接可用，不需要 SQL-like syntax
- 封面文件命名按 `game_id`（INTEGER PK）；未来若要支持多封面（封面 / 横版 / 包装）按 `{game_id}-{slot}.ext` 命名
- 卡片网格响应式断点：`grid-cols-[repeat(auto-fill,minmax(200px,1fr))]`，Tailwind arbitrary value
- 进度条参考 Steam 库的扫描器视觉：顶部 4px sticky bar + 下方一行小文字
- 错配修正 modal 参考 Plex 的"修正影片信息"流程：左输入框/选 ID + 右候选列表 + 选中后预览
- LP 取舍：Phase 2 不做"重新扫描所有元数据"批量操作；只做单游戏；批量后续 phase
- 标题清洗规则集应作为 `data/title_clean_rules.json` 暴露给用户编辑（高级用户可加规则），但 Phase 2 仅写默认规则集到代码内常量；用户编辑入口 Phase 4

</specifics>

<deferred>
## Deferred Ideas

- 扫描日志 UI 可视化（Phase 4）
- 用户自定义标题清洗规则编辑器（Phase 4 设置页）
- 多封面 / 横版 / 包装图（Phase 5）
- 缩略图预生成（Phase 5）
- 暂停扫描（Phase 4）
- 扫描排除规则（用户黑名单某些目录）（Phase 4）
- 批量元数据重抓（Phase 4 设置页"修复"工具）
- 网格筛选 / 排序（Phase 4）
- 全文搜索（Phase 4）
- 卡片右下角的 hover 卡片信息浮层（"游玩 12 小时, 上次 2 周前, 评分 8/10"）（Phase 4 / Phase 5）
- "已删除游戏目录"清理工具（Phase 4 设置页）
- VNDB token 登录支持（按用户 voted/finished 列表导入）（Out of Scope for v1）

</deferred>
