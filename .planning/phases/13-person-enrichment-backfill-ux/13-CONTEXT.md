# Phase 13: Person Enrichment & Backfill UX — Context

**Gathered:** 2026-05-12
**Status:** Ready for planning
**Mode:** Auto-generated for /gsd-autonomous (REQUIREMENTS 已锁定细节)

<domain>
## Phase Boundary

把 `/persons/:id` 从单 grid 升级为完整人物聚合页：
1. 跨源人物去重（PER-01）—— 同名同语 Bangumi+VNDB 行在查询层折叠
2. 作品时光轴（PER-02）—— 顶部横向年份气泡，气泡尺寸映射 playtime
3. 同台伙伴推荐（PER-03）—— 共现 ≥ 2 次的 person 横滑条
4. 头像本地缓存（PER-04）—— 首次访问按需下载到 `data/portraits/`
5. Backfill 进度条（POL-03）—— Library PageHeader 接入 meta-fetch-progress

**Out of scope:**
- 跨源 persons 物理合并（PER-01 只在 IPC 查询层做归并）
- 完成度 chip / 头像 CDN 代理 / 自动定时 backfill —— 推迟到 v1.4
- 同台 person 算法升级（先做 count ≥ 2 朴素阈值）

</domain>

<decisions>
## Implementation Decisions

### PER-01 — Cross-source dedup (query-layer only, no DB change)
- 触发位置：`list_persons_for_game` IPC 返回前，在 Rust 层 reduce
- 归并规则：相同 `(LOWER(TRIM(name)), LOWER(TRIM(name_cn)))` 视为同人；其中一侧 name_cn 为空时只比 name 即可
- 返回时新增字段 `sources: Vec<{source, source_id}>`（包含每个底层 row 的 source attribution）；保持 `id` 为 representative（按 source 'bangumi' 优先，否则 'vndb'）
- `/persons/:id` identity 派生：之前只展示第一条 source；改为读取 merged row 的 sources 数组，显示 "Bangumi + VNDB" 双源 chip
- DB persons 表保持不变；不引入新表

### PER-02 — Timeline component (新组件 PersonTimeline.tsx)
- 输入：merged games（包含 release_year + total_playtime_sec）
- 横向 strip：年份从最早到最新平铺；每年份槽位是一个 cluster（同年作品垂直堆叠）
- 气泡：直径根据 sqrt(playtime_hours + 1) 映射到 8..28 px（log-style 防止特长一作占满）
- Hover 显示 game.name + playtime + 通关状态
- 缺失年份用 dashed 线串起；底栏用 mono 标年份范围
- 不点击跳转（GameCard 网格已经有点击跳转语义；timeline 是俯瞰视图）

### PER-03 — Co-staff IPC (`list_co_staff_for_person`)
- SQL：
  ```sql
  SELECT b.id, b.name, b.name_cn, b.source, COUNT(DISTINCT gs_b.game_id) AS coshare
  FROM game_staff gs_a
  JOIN game_staff gs_b ON gs_a.game_id = gs_b.game_id AND gs_b.person_id != gs_a.person_id
  JOIN persons b ON b.id = gs_b.person_id
  WHERE gs_a.person_id = ?
  GROUP BY b.id, b.name, b.name_cn, b.source
  HAVING coshare >= 2
  ORDER BY coshare DESC, COALESCE(b.name_cn, b.name) ASC
  LIMIT 12
  ```
- 返回结构：`CoStaffRow { person_id, name, name_cn, source, source_id, coshare, role_hint: Option<String> }`
- `role_hint` 在 SQL 二次查询里 pick：在与 :id 共同的 game 中，b 最常担任的 role
- 前端组件 `CoStaffStrip.tsx`：横滑条 5 列 + lucide ChevronRight 滚动 + 每张 PersonCard (40px portrait + name + count chip + role hint)
- 点击跳转 `/persons/:id`（对方）

### PER-04 — Portrait cache
- 新增 IPC `get_or_fetch_portrait(person_id) -> Option<String>` 返回相对路径 `portraits/{source}-{source_id}.{jpg|webp}`
- 缓存命中 → 直接返回路径
- 缓存 miss → 抓 `https://bgm.tv/v0/persons/:source_id` images.medium（Bangumi）或 VNDB GraphQL person query 的 image.url；写到 `data/portraits/{source}-{source_id}.jpg`；带 Bangumi 限速器
- 不存在或抓取失败 → 返回 None，前端 fallback 文字徽标
- 调用时机：用户进入 `/persons/:id` 时 batch 拉自己 + 同台伙伴 portrait；Detail staff chip 在 hover 时按需 lazy fetch
- 仅 v1.3 引入新文件夹 `data/portraits/`；clear_all_data 增 `data/portraits/` 删除

### POL-03 — Backfill progress UI
- 既有 `meta-fetch-progress` event payload: `{ game_id, phase }` — 不足以画进度条（缺 total）
- 增强：在 `backfill_metadata_enrichment` 启动时 emit 一个 `meta-fetch-progress-meta` 包含 `{ total: i64 }`，每 finished phase 让前端累加 current
- 前端组件 `BackfillProgressBar.tsx` 监听 `meta-fetch-progress-meta` + `meta-fetch-progress`，绘制 PageHeader 下沿一条 progress bar + current/total + 当前 game name + 「取消」按钮（新增 `cancel_backfill` IPC）
- 现有 `meta-fetch-progress` 单游戏 ingest 也会被监听，但仅在 `meta-fetch-progress-meta` 收到 total > 0 时才显示进度条
- 取消机制：新增 `BACKFILL_CANCEL` AtomicBool 类似 ScanContext，cancel IPC 翻位；backfill loop top of iteration 检查

### What NOT to change
- 不动 persons 表 schema
- 不动 game_staff CHECK constraint
- 不重构 `list_persons_for_game` / `list_games_for_person` 主体；只在末尾或包裹处做 dedup
- Backfill 主循环骨架不变；只增 total emit + cancel check

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `commands.rs::list_persons_for_game` / `list_games_for_person` / `backfill_metadata_enrichment`
- `Persons.tsx` 已有 4 role section + GameCard grid 主体
- `convertFileSrc` 已被 v1.2 portrait 调用复用
- `metadata::limiter::wait_bangumi` 1 req/s 共享配额；新 portrait 抓取走同一限速
- `Bangumi /v0/persons/:id` endpoint 已知（Phase 11 fetch_persons 已用其变种）
- `meta-fetch-progress` event 通道已存在；扩展即可

### Established Patterns
- IPC error: stringified via err_str
- 缓存写盘走 `data_dir.join("…")`；类似 `cover_cache::cache_cover`
- 事件 emit：`app.emit("name", json!({...}))`
- 前端组件文件名 PascalCase；导出 named export 除路由
- 横滑条 → 使用 CSS overflow-x-auto + scroll-snap

### Integration Points
- `commands.rs` 增 3-4 个新 IPC（co_staff / portrait / cancel_backfill / progress meta emit）
- `lib.rs` 注册新命令
- `Persons.tsx` 上沿插 PersonTimeline + CoStaffStrip
- `Library.tsx` PageHeader 下沿插 BackfillProgressBar
- `src/lib/persons.ts` 增 `listCoStaffForPerson` / `getOrFetchPortrait` 包装

</code_context>

<specifics>
## Specific Ideas

- PER-01 dedup 在 `/persons/:id` identity 也生效：之前用 first source 派生 identity；改为传入 merged person 的所有 sources。这意味着 URL `/persons/:id` 中的 :id 应该接受任一底层 person_id —— 当查询命中 merged 对象时返回完整 sources 数组
- PER-02 横向滚动条隐藏滚动 thumbs（`scrollbar-width: none`），但保留鼠标 wheel / 触控滑动；底栏年份用 sticky 起头
- PER-03 PersonCard 视觉与 GameCard 一致但更紧凑：圆形 40px portrait + 12px 文字 + 灰底 chip
- PER-04 portrait 文件名约定：`portraits/{source}-{source_id}.jpg`；jpg 兼容性好；后续可改 webp
- POL-03 progress bar 在已无 active backfill 时不渲染；终态后 2s 自动隐藏（mirror ScanProgressBar 行为）

</specifics>

<deferred>
## Deferred Ideas

- 完成度 chip（"该作家在你库中 5 部 / 已通关 3 / 47 h"）—— v1.4
- portrait CDN 代理 —— 直接抓源站即可
- 自动定时 backfill —— 用户实际需要再决定
- co-staff 复杂权重（按 voice ↔ scenario 的 affinity）—— 现阶段 count 朴素阈值
- 跨源人物物理合并（迁移 game_staff FK）—— PER-01 查询层归并已足够

</deferred>
