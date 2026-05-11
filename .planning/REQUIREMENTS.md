# Requirements: gal-lib

**Milestone:** v1.3 — Scan Pipeline & Person Polish
**Defined:** 2026-05-12
**Core Value:** 让本地一堆乱糟糟的 galgame 目录，变成可搜索、可启动、可统计的图书馆——并且每张卡片背后都有充实的元数据。v1.3 把 v1.1/v1.2 累积的 carry-over 一次性清掉，让用户首次"扫描-复核-绑定-跳转"的体验跑通端到端。

## v1.3 Requirements

v1.3 总计 17 个 requirement，分布在 5 个类别 / 4 个执行 phase。来源全部为 v1.1 + v1.2 carry-over 与 seed —— 无新领域研究需求。

### SCAN (Scan Pipeline & Review Queue)

- [ ] **SCAN-01**: 新增独立 `/scan` 路由（无 Library 侧栏，顶部窄 nav 返回 Library），页面顶部 KPI 4 联：已扫游戏 / 已绑定 / 待复核 / 不匹配；增量扫描 / 全量重扫 / 取消 三按钮
- [ ] **SCAN-02**: 中央双栏 feed —— 左栏实时增量扫描日志（最新 200 条 + 自动滚动），右栏「待复核」卡片队列（缩略 + 路径 + 当前 match_confidence + 建议源）；队列写入新表 `scan_review_queue` 持久化（重启后保留）
- [ ] **SCAN-03**: 待复核卡片展开 → Bangumi vs VNDB 并排候选对比（封面 / 标题 / 品牌 / 简介首 200 字 / 评分 / source id），用户点「采用 Bangumi」/「采用 VNDB」一键切换数据源并触发 ingest 重抓 + 从队列移除

### PER (Person Page Enrichment)

- [ ] **PER-01**: 跨源人物去重 —— 在 `/persons/:id` 聚合页与 Detail staff chip 上，同 name + 同 name_cn（任一非空匹配即视为同人）的 Bangumi/VNDB persons 折叠为一行，UI 头部展示「Bangumi + VNDB」双源 chip；DB 层 persons 表保留双源行，仅在查询时归并（不破坏 source attribution）
- [ ] **PER-02**: `/persons/:id` 顶部加入「作品时光轴」—— 按 release_year 横向排布（年份 → 气泡），每个气泡尺寸映射用户对该作品的 playtime（log scale），hover 显示标题 + 通关状态；空年份用 dashed 占位线串起
- [ ] **PER-03**: `/persons/:id` 底部加入「常与 X 共同出现」横滑条 —— SQL `JOIN game_staff a JOIN game_staff b ON a.game_id=b.game_id WHERE a.person_id=:id AND b.person_id != :id GROUP BY b.person_id HAVING COUNT >= 2 ORDER BY COUNT DESC LIMIT 12`，渲染为 PersonCard 横滑条，点击跳对方聚合页
- [ ] **PER-04**: 人物头像本地缓存 —— 新增 `data/portraits/{source}-{source_id}.jpg`，抓取时机：用户首次进入 `/persons/:id` 时按需下载（Bangumi `/v0/persons/{id}` images.medium；VNDB GraphQL person query 的 image.url）；新增 IPC `get_or_fetch_portrait(source, source_id)` 返回本地路径；缓存命中直接读盘；Detail staff chip + 聚合页头部 + 同台伙伴 PersonCard 全部接入，缺失 fallback 文字徽标

### FS (Filesystem Actions via tauri-plugin-opener)

- [ ] **FS-01**: 引入 `tauri-plugin-opener` 依赖（Cargo.toml + capabilities + JS 包），新增 `open_path(path)` IPC（包装 plugin opener，统一错误处理）；替换 v1.2 `open_external_url` 的 `cmd /C start` fallback 实现，保持 IPC 名兼容
- [ ] **FS-02**: Detail 页右上「更多」菜单或 launcher 卡片新增「打开游戏目录」按钮，点击调 `open_path(install_path)`；install_path 缺失或不存在时按钮 disabled 并提示
- [ ] **FS-03**: Screenshots 页顶部 toolbar 新增「打开截图目录」按钮（per-game 范围 = `data/screenshots/{game_id}/`，全局 = `data/screenshots/`），右键 GameCard 也加入「打开截图目录」快捷项

### POL (Polish & Cross-cutting Carry-over)

- [ ] **POL-01**: Detail 页解析 query string `?tab=screenshots|saves|notes|metadata|sessions|config` —— 进入页面时若 tab 参数有效则切到对应 tab，否则默认 overview；Library/Screenshots 等跨页跳转使用此 deeplink 落点
- [ ] **POL-02**: Stats 顶部 KPI「会话总数」接入新 IPC `count_sessions()` (`SELECT COUNT(*) FROM sessions WHERE end_at IS NOT NULL`)，替换当前用 games count 代理的占位值；StatsPage 同步更新
- [ ] **POL-03**: Backfill 进度 UI 完整化 —— 在 Library PageHeader 当 `meta-fetch-progress` 事件流活跃时显示进度条（current/total + 当前游戏名 + 取消按钮），结束后自动隐藏；接管 v1.2 已 emit 的事件通道，无需新加后端事件
- [ ] **POL-04**: LIB-02 杂志式不对称网格 —— 在 v1.3 内做最终决定：要么修复 portrait-cover 在 1.6fr hero 槽位的裁切问题并重新接入，要么正式从 UI-SPEC 中删除 LIB-02 spec 并在 ROADMAP/PROJECT 记录废止决策；产出二选一的决策记录 + 落地代码或 spec 清理

### VER (v1.2 Real-app Smoke Verification)

- [ ] **VER-01**: UI-01 真机验证 —— Detail 页对一款绑定 Bangumi 的游戏展示完整 summary 段落 + 制作团队按 role 分组（scenario/artist/voice/music 各显图标 + 人名）+ 在 Bangumi 看 ↗ / 在 VNDB 看 ↗ 外链跳浏览器；任一项失败需在本 phase 内修复
- [ ] **VER-02**: UI-02 真机验证 —— Detail staff 行点击人物名跳 `/persons/:id` 路由切换正常；同游戏官方标签 region 与用户 tag 区域并存且视觉区分；交互失败需修复
- [ ] **VER-03**: UI-03 真机验证 —— Library FilterPanel 多维 facet（品牌 / 编剧 / 画师 / 声优 / 官方标签）勾选后 grid 实际收窄；多 facet 跨维度 AND、同维度 OR 行为正确；60-chip cap 「更多」expander 展开/收起 OK；任一项失败需修复

## Future Requirements

<!-- Deferred to v1.4+. Not in v1.3 scope. -->

- Detail 简介区块的 markdown 完整渲染（含图片 / 链接 / 表格）——目前只做段落分割
- Persons 聚合页加「完成度 chip」（该作家在你库中：5 部 / 已通关 3 / 总游玩 47h） —— v1.2 seed 第 3 条，留待 v1.4 数据驱动时再做
- 扫描复核队列的 AI 辅助判别（用模糊匹配 + 评分二选一推荐） —— SCAN-03 上线后视用户反馈决定
- Bangumi/VNDB 配额监控面板（剩余 quota / 上次刷新 / 限速排队） —— 高级用户需求
- 多机器同步用户标签/笔记 —— PROJECT.md 已列 out of scope，但可在 v1.4+ 重审
- 自动定时 backfill（每周抓一次新增的官方 tags / staff 更新） —— 等 backfill UI 稳定后再说

## Out of Scope

<!-- Explicit boundaries for v1.3. -->

- **重写整个扫描引擎** —— v1.3 只加 review queue + UI，不动 walkdir 边界识别逻辑
- **跨源人物物理去重（合并 persons 表行）** —— PER-01 只做查询层归并，DB 仍保留双源行；物理合并涉及 game_staff 外键迁移，太重，留待用户实际感知度提高后再做
- **Bangumi/VNDB 第三源** —— PROJECT.md 已列 out of scope，v1.3 保持
- **/scan 路由的虚拟化滚动** —— 待复核队列预计 < 50 项典型场景，CSS 滚动够用
- **人物头像的远程 CDN 代理** —— 直接拉源站 image url 即可，不引入额外代理层
- **LIB-02 重构成全新视觉风格** —— POL-04 只在「修旧 vs 删 spec」二选一，不引入新设计语言
- **schema v9 schema-only migration（无数据变更）** —— SCAN-02 的 `scan_review_queue` 表会触发 schema v9，但仅此一表；不顺带做其他 schema 调整

## Traceability

<!-- Filled by /gsd-roadmapper after roadmap is created. -->

| REQ-ID | Phase | Plan(s) | Status |
|--------|-------|---------|--------|
| SCAN-01 | Phase 12 | TBD | Active |
| SCAN-02 | Phase 12 | TBD | Active |
| SCAN-03 | Phase 12 | TBD | Active |
| PER-01 | Phase 13 | TBD | Active |
| PER-02 | Phase 13 | TBD | Active |
| PER-03 | Phase 13 | TBD | Active |
| PER-04 | Phase 13 | TBD | Active |
| FS-01 | Phase 14 | TBD | Active |
| FS-02 | Phase 14 | TBD | Active |
| FS-03 | Phase 14 | TBD | Active |
| POL-01 | Phase 14 | TBD | Active |
| POL-02 | Phase 14 | TBD | Active |
| POL-03 | Phase 13 | TBD | Active |
| POL-04 | Phase 14 | TBD | Active |
| VER-01 | Phase 15 | TBD | Active |
| VER-02 | Phase 15 | TBD | Active |
| VER-03 | Phase 15 | TBD | Active |

## Constraints / Notes

- **Schema v9 单一变更**：SCAN-02 引入 `scan_review_queue` 表（game_path / suggested_source / suggested_id / confidence / created_at），schema_version 升到 9，migration `0009_add_scan_review_queue.sql` 独立提交
- **PER-01 不动 DB**：跨源去重只在 IPC 查询层做（`list_persons_for_game` / `list_games_for_person` / `/persons/:id` identity 查询），SQL 改 + 前端 reducer 处理 source attribution
- **PER-04 缓存策略**：portraits 目录在 `data/` 下（portable 不破坏），文件名 `{source}-{source_id}.{jpg|webp}`；首次访问 lazy fetch；命中直接读盘 base64 / convertFileSrc 都行（参考 v1.0 截图 lightbox）
- **FS-01 替换原 fallback**：v1.2 的 `open_external_url` 走 `cmd /C start` Windows-only fallback，可保留同名 IPC 但内部改走 plugin opener；新 `open_path` 是独立命令（path 不是 url）
- **VER-* 真机要求**：必须在装有 Locale Emulator + 至少 5 款已绑定 Bangumi+VNDB 的游戏的 Win10/11 实机运行；非 Headless；本 phase SUMMARY 必须附截图或文字 walkthrough
- **POL-04 决策记录**：无论选哪条路径都要在 PROJECT.md Key Decisions 表新增一行记录原因
