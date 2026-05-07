# Phase 4: Library Polish - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning
**Mode:** Auto-generated via `/gsd-discuss-phase 4 --auto`

<domain>
## Phase Boundary

用户能快速找到任意游戏，给游戏打标签/状态/评分/笔记，通过详情页查看完整信息，通过设置页管理库配置。

**包含：**
- 全文搜索（标题 / 罗马音 / 别名 / 品牌 / 标签）— 在主区顶部搜索框
- 排序（最近游玩 / 添加日期 / 字母 / 时长 / 评分）— 在主区顶部排序下拉
- 自定义标签 CRUD（创建、编辑、删除、给游戏打标签 0~N）
- 侧栏激活：标签列表 + 自动派生分类（品牌、年代、通关状态、收藏）
- 完整详情页（继承 P3 minimal Detail）：封面、name/name_cn、简介、CV、标签 chip、笔记编辑、评分（1-10 或 5 星）、收藏 toggle、通关状态 toggle
- 设置页扩展：根目录管理（已有 P2）+ LE 路径（已有 P3）+ UI 偏好（深浅色切换占位 / 默认排序）
- 通关状态切换（unplayed / playing / cleared / dropped）
- 收藏开关
- 评分（5 星组件）
- 笔记多行 textarea
- 卡片右键菜单扩展：标记收藏 / 切换通关状态

**不包含（在后续阶段）：**
- 时长统计图表（Phase 5）
- 截图功能（Phase 5）
- 存档备份（Phase 5）
- 全文搜索 SQL FTS5 优化（v2 — Phase 4 用 SQL LIKE % 即可，games 数 < 数千时性能可接受）
- 标签合并 / 批量打标签 / 标签组（Out of Scope v1）
- 高级筛选（多标签 AND/OR）（Out of Scope — 单标签 click 即筛选足够）

**REQ-IDs：** LIB-03, LIB-04, LIB-05, LIB-07, TAG-01..04, STAT-01..04（共 12 项）

</domain>

<decisions>
## Implementation Decisions

### Search & Filter (LIB-03, LIB-04)
- **搜索范围：** name + name_cn + path (basename) + tags.name + （未来扩展）alias
- **后端：** 用 SQL `WHERE name LIKE %?% OR name_cn LIKE %?% OR id IN (SELECT game_id FROM game_tags JOIN tags ON ... WHERE tags.name LIKE %?%)`；< 1000 games 性能足够，FTS5 留 v2
- **前端：** Search Input debounce 200ms → 调 `search_games(query)` cmd → 替换 store games
- **排序选项：** 最近游玩 (last_played_at DESC NULLS LAST) / 添加日期 (created_at DESC) / 字母 (name COLLATE NOCASE ASC) / 时长 (total_playtime_sec DESC) / 评分 (rating DESC NULLS LAST)
- **筛选 vs 搜索分离：** 搜索是文本匹配；侧栏 click 是分类筛选。两者可叠加（query AND filter）
- **UI 顶部 bar：** 搜索 Input (左) + 排序 Select (右) + 筛选 chip (在搜索框旁，显示当前 active filter，× 清除)

### Tag CRUD (TAG-01..03)
- **DB：** 复用 Phase 1 已有的 `tags` + `game_tags` 表
- **Tauri commands：** `create_tag(name, color?) -> i64`、`update_tag(id, name, color?)`、`delete_tag(id)`、`list_tags() -> Vec<Tag>`、`set_game_tags(game_id, tag_ids: Vec<i64>)`
- **UX：** 标签管理在设置页（"标签管理" section），不进侧栏（侧栏只显示+点击）
- **颜色：** 标签可选 8 个预设颜色（slate / blue / emerald / amber / rose / violet / orange / pink）；存 hex 字符串
- **删除 cascade：** ON DELETE CASCADE 已在 Phase 1 schema；删除标签自动解除关联

### Sidebar Auto-Categories (TAG-04)
- **来源：** SQL 聚合查询：
  - 品牌：`SELECT bangumi_id [as brand_id], COUNT(*) FROM games GROUP BY bangumi_id WHERE bangumi_id IS NOT NULL` （注：Phase 1/2 schema 不存 brand_name；Phase 4 需要在 metadata fetch 时补存 brand 字段；schema v4 ALTER games ADD COLUMN brand TEXT）
  - 年代：从 release_date 提取年份分桶（2020s / 2010s / 2000s / 1990s / 未知）
  - 通关状态：4 个固定值 (unplayed/playing/cleared/dropped) + count
  - 收藏：单个 "收藏" 节点（is_favorite TRUE）
- **schema v4 ALTER：**
  ```sql
  ALTER TABLE games ADD COLUMN brand TEXT;
  ALTER TABLE games ADD COLUMN release_year INTEGER;
  ALTER TABLE games ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
  -- rating 已存在 (Phase 1)；只补充提取 release_year 的迁移逻辑
  ```
  迁移时不回填 brand / release_year（NULL 即可；Phase 4 重新匹配元数据时自动填）
  
### Detail Page (Full version, LIB-05, STAT-01..04)
- **覆写 P3 minimal Detail：** 顶部 hero 不变（cover + name + status badge + 总时长 + 启动按钮）
- **下方 Tabs（shadcn `tabs` block — 新装）：**
  - **简介** Tab：name_cn + name + summary (markdown render via react-markdown — 新装 npm) + CV/staff list (未来 fetch 时填) + release date / brand
  - **标签** Tab：当前 chips + "添加标签" combobox（搜索现有 + 创建新）
  - **笔记** Tab：multi-line Textarea (shadcn `textarea` block — 新装) + 自动保存（debounce 800ms）
  - **会话历史** Tab：复用 P3 sessions list；扩展为虚拟化（如果 > 50 条）
  - **设置** Tab：复用 P3 启动配置（LE profile / args / cwd / executable_path 候选列表挑选）
- **Hero 区操作按钮：**
  - Star / 收藏 toggle（is_favorite）
  - Rating (5 星组件，hover 显示半星)
  - Status dropdown (4 选项 + 状态徽章颜色)
  - Edit cover (上传文件 — Phase 5)；P4 占位

### Settings Page Polish (LIB-07)
- 已有：扫描根目录 / LE 路径
- 新增：
  - **标签管理** section：list 现有标签 + 编辑名 + 颜色 + 删除；"添加标签" 按钮
  - **UI 偏好** section：默认排序方式（保存到 config.json） / 深浅色切换占位（disabled，提示 Phase 5）

### shadcn 新装
- `textarea` (笔记)
- `tabs` (Detail 页)
- `combobox` 实际是用 popover + command + input 拼装（shadcn 没有独立 combobox block；用 `popover` + `command` blocks 装 — 都新装）
- `star-rating` 不是 shadcn 块；用 lucide `Star` + `StarHalf` 自己拼

### Database Schema v4 Migration
```sql
-- migration 0004_add_brand_year_favorite.sql
ALTER TABLE games ADD COLUMN brand TEXT;
ALTER TABLE games ADD COLUMN release_year INTEGER;
ALTER TABLE games ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;
UPDATE app_meta SET value = '4' WHERE key = 'schema_version';
```

### Claude's Discretion
- 笔记自动保存的 debounce 频率（800ms 默认）
- 标签 chip 视觉样式（pill 圆角 + 颜色 dot）由 plan 决定
- 评分组件：5 星 + 半星，但 DB 存 1-10（每星 = 2 分）
- 排序状态持久化在 Zustand store，不写入 DB（每次启动默认"最近游玩"）

</decisions>

<code_context>
## Existing Code Insights

### Reusable from P1/P2/P3
- 完整 backend: data_dir, db, scan, metadata, ingest, launch (le/process_track/session/orchestrator), commands, tray
- 完整 frontend: lib/{db,scan,metadata,games,launch}.ts, store/{app,library}.ts, components/library/{GameCard,GameGrid,ScanProgressBar,MetadataPicker,ActiveSessionBar}.tsx, routes/{Library,Settings,Detail}.tsx, components/ui/* (13 shadcn blocks: 4 P1 + 9 P2 = 13)
- DB schema v3：games 含 19 列；sessions 含 7 列；scan_roots / tags / game_tags / app_meta

### Established Patterns
- Tauri commands `Result<T, String>`
- frontend invoke wrappers in `src/lib/*.ts`
- Zustand single create() store
- shadcn blocks new-york style + slate base
- 中文 copy 两段式
- HSL palette via `hsl(var(--*))` Tailwind tokens

### Integration Points
- 新 Tauri commands: search_games, list_tags, create_tag, update_tag, delete_tag, set_game_tags, list_tag_games, get_sidebar_categories, update_game_status, update_game_favorite, update_game_rating, update_game_notes, update_game_cover (留 P5)
- 新 npm: react-markdown + remark-gfm
- 新 shadcn blocks: textarea / tabs / popover / command

</code_context>

<specifics>
## Specific Ideas

- 主区顶部 SearchBar 60px 高（与 ScanProgressBar 同位置层叠：scan 时 scan 优先；闲时 search 显示）
- 笔记自动保存提示：右下角小灰文 "已保存 2 秒前" / "保存中..."
- 标签 chip 配色：根据 tags.color 字段渲染 4×4 dot + 中性 muted 文字
- Detail tab 顺序：简介 / 标签 / 笔记 / 会话历史 / 设置（操作按钮在 hero 区，不进 tab）
- 侧栏的 "全部" / "收藏" / "标签" / "通关状态" 四个 P1 占位项：现在全部激活；点击切换主区筛选；当前选中项用 accent indicator + bg-accent

</specifics>

<deferred>
## Deferred Ideas

- 全文搜索 FTS5 优化（v2）
- 多标签 AND/OR 筛选（Out of Scope v1）
- 标签批量编辑（Out of Scope）
- 标签合并 / 标签组（Out of Scope）
- 截图捕获 / 上传封面（Phase 5）
- 时长统计图表（Phase 5）
- 存档备份（Phase 5）
- CV / staff 列表（依赖 metadata 重新拉；预留 schema 字段在 P5）
- 笔记 markdown 实时预览（P5）
- 高级排序（自定义字段）（Out of Scope）

</deferred>
