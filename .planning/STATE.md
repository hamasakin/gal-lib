---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Scan Pipeline & Person Polish
status: shipped
stopped_at: "v1.3 milestone shipped + archived (2026-05-12). 下一步: `/gsd-cleanup` 归档 phase 目录 → `/gsd-new-milestone` 定义 v1.4 (first task: 12-step walkthrough)。"
last_updated: "2026-05-26T16:30:00.000Z"
last_activity: "2026-05-26 — Quick 260526-0bi：移除本地用户评分字段 games.rating，只保留官方评分 external_rating。schema v14 DROP COLUMN + StarRating 组件整文件删（179 行）+ Detail 页本地评分行删 + update_game_rating IPC 删 + i18n 三语同步；db.rs 三处定向追加 + grep 三组自验 + cargo test --lib migrations_v14 三道防线延续 260525-tw2 模式预防 v13 翻版。执行序「先解前后端引用 → 再 DROP COLUMN」避免 SELECT 缺列触发列表全空。cargo check / cargo test --lib (87 passed + 1 pre-existing http_safe failure 与本任务无关) / pnpm tsc --noEmit / pnpm build 全绿。3 个 atomic commit：007daf4 (前端) · bd35859 (后端) · 2b4b8e2 (migration)。GUI 真机验证 4 项 (v13→v14 自动 migrate / Detail 页「评分」行消失 / StarRating 不再出现 / FilterPanel「评分范围」基于 external_rating) 待用户在 v0.3.3 build 出来后亲自确认；后续 npm run release patch → v0.3.3。"
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 16
  completed_plans: 16
  percent: 100
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-05-12 with Current Milestone v1.3)

**Core value:** 让本地一堆乱糟糟的 galgame 目录，变成可搜索、可启动、可统计的图书馆——并且每张卡片背后都有充实的元数据
**Current focus:** v1.3 Scan Pipeline & Person Polish — 清掉 v1.1/v1.2 累积 carry-over

## Current Position

Phase: 12 ✅ · 13 ✅ · 14 ✅ · 15 ✅ (verification-only)
Plan: 全部完成；下一步 /gsd-audit-milestone v1.3
Status: 4/4 phases shipped；自动化全绿；real-app walkthrough 清单交付待 audit
Last activity: 2026-05-19 — Quick 260519-pi1：新增 npm run release 发版脚本（scripts/release.mjs，一条命令完成 bump → commit → tag → push）

## Carried Tech Debt → v1.3 (folded into requirements)

Items deferred or carried at v1.2 close — 已映射到 v1.3 requirements，详见 `.planning/REQUIREMENTS.md`：

| Category | Item | Origin | Mapped REQ |
|----------|------|--------|------------|
| verification | UI-01 Detail summary/staff/外链 real-app smoke | Phase 11 deferred | VER-01 |
| verification | UI-02 人物 chip + 官方标签 region real-app smoke | Phase 11 deferred | VER-02 |
| verification | UI-03 FilterPanel 多维 facet real-app smoke | Phase 11 deferred | VER-03 |
| feature | 跨源人物去重 (Bangumi+VNDB) | Phase 11 carry | PER-01 |
| feature | 人物聚合页加强（时光轴 + 同台伙伴） | seeds/persons-page-enrichment.md | PER-02, PER-03 |
| feature | 人物头像本地缓存 | Phase 11 carry | PER-04 |
| feature | Backfill 进度 UI 完整化 | Phase 11 carry | POL-03 |

## Carried from v1.1 (folded into v1.3)

| Category | Item | Status | Mapped REQ |
|----------|------|--------|------------|
| requirement | LIB-02 杂志式不对称网格回归或废止 | Phase 7 reverted | POL-04 |
| requirement | PGE-01 standalone /scan + KPI strip | Phase 9 deferred | SCAN-01, SCAN-02 |
| requirement | PGE-02 Bangumi/VNDB review queue | Phase 9 deferred | SCAN-03 |
| feature | Detail 「打开目录」按钮 | Phase 8 carry | FS-01, FS-02 |
| feature | Screenshots 「打开截图目录」按钮 | Phase 10 carry | FS-01, FS-03 |
| feature | Detail `?tab=` deeplink 解析 | Phase 10 carry | POL-01 |
| metric | 真实会话总数 IPC | Phase 9 carry | POL-02 |
| copy | UIPreferences.tsx:135 stale "Phase 5" hint | Phase 4 carry | 可在任一执行 phase 顺手清除（非独立 req） |

## Carried from v1.0 (still open)

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| verification | Phase 01-05 GUI/integration items requiring real-machine QA | human_needed | v1.0 close |

**Resolution path:** Real-machine QA pass on clean Win10/Win11 environment with Locale Emulator + a real galgame library installed. 在 v1.3 VER-01/02/03 真机 smoke 期间可顺带覆盖 v1.0 GUI 项。

## Pending Todos

None.

## Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 20260510 | 修复 4 个 UI 问题（人物 chip 跳错 / FilterPanel UNDEFINED + 透明 / 侧边栏品牌限高 / Detail 更多菜单补全） | 2026-05-10 | 86a5f33 | [20260510-ui-fixes-detail-cards-filter-brands](./quick/20260510-ui-fixes-detail-cards-filter-brands/) |
| 20260510b | R18/全年龄 标识 + 自定义视图（schema v8、7 个新命令、网格批量选择模式） | 2026-05-10 | 68afa62 | [20260510b-r18-marker-and-custom-views](./quick/20260510b-r18-marker-and-custom-views/) |
| 20260512 | 封面 cache-buster — bind/refresh 后前端立即显示新封面（4 处 convertFileSrc 加 ?v=last_scanned_at） | 2026-05-12 | 2cd17b8 | [20260512-cover-cache-buster](./quick/20260512-cover-cache-buster/) |
| 20260512c | MetadataPicker 遮罩加深 + Bangumi infobox 发售日兜底 + reseed_review_queue IPC + Scan 页按钮 | 2026-05-12 | f38d4a6 | [20260512c-picker-overlay-year-fallback-reseed-review](./quick/20260512c-picker-overlay-year-fallback-reseed-review/) |
| 20260512d | alert-dialog overlay 同步加深 + match_score 前缀包含 baseline 80（修复 アマエミDL版 等短前缀场景不自动绑） | 2026-05-12 | 8b717e2 | [20260512d-overlay-followup-prefix-confidence](./quick/20260512d-overlay-followup-prefix-confidence/) |
| 20260512e | main overflow-hidden 修双滚动条 + Sidebar 去掉与 FilterPanel 重复的品牌/年份 + 次要导航底部固定 | 2026-05-12 | d8e7d7e | [20260512e-sidebar-redesign-outer-scrollbar](./quick/20260512e-sidebar-redesign-outer-scrollbar/) |
| 20260512f | Sidebar 视觉打磨（印章红短线 section / active 左缘 / hover ⋯）+ ViewNameDialog/DeleteViewDialog 替换 prompt/confirm | 2026-05-12 | 81189a5 | [20260512f-sidebar-polish-and-view-dialogs](./quick/20260512f-sidebar-polish-and-view-dialogs/) |
| 20260512g | 修复 isFilterEmpty 漏检 custom_view_id / age_ratings — 选自定义视图后列表回退全库的 bug | 2026-05-12 | 2fc5e6e | [20260512g-fix-isfilterempty-custom-view](./quick/20260512g-fix-isfilterempty-custom-view/) |
| 260513-2nx | 新增 backfill_release_year IPC + Settings「补全发行年份」按钮；移除旧 backfill_metadata_enrichment 整套代码 | 2026-05-12 | dd06714 | [260513-2nx-year-backfill-replace-enrich](./quick/260513-2nx-year-backfill-replace-enrich/) |
| 260513-3df | Settings「扫描操作」合并为 2 个按钮（全量扫描 + 刷新元数据）；新 IPC refresh_metadata_smart 替代 refresh_all_metadata + backfill_release_year | 2026-05-12 | d2b4c41 | [260513-3df-two-button-metadata-refresh](./quick/260513-3df-two-button-metadata-refresh/) |
| 260513-404 | 彻底删除 R18/age_rating 分类 — migration 0010 DROP COLUMN + 后端 IPC/自动判定 + 前端 badge/dropdown/FilterPanel facet 全部清除 | 2026-05-12 | 776412e | [260513-404-remove-r18-age-rating](./quick/260513-404-remove-r18-age-rating/) |
| 260513-r6t | 详情页启动按钮走 LE（修复硬编码 use_le=false）+ exe 评分对 _cn/_chs/_zh 后缀 +15 + Detail exe 路径加「浏览…」按钮 | 2026-05-13 | f9e98cc | [260513-r6t-exe-cn](./quick/260513-r6t-exe-cn/) |
| 260514-upd | Tauri 自动更新 — plugin-updater 接通 GH Releases、启动 5s silent check、Settings 关于区块、release.yml CI、docs/release.md；bump 0.2.0；v0.2.0 已发布到 hamasakin/gal-lib | 2026-05-14 | 7d57bff | [260514-upd-tauri-auto-update](./quick/260514-upd-tauri-auto-update/) |
| 260515-loading-phase | 刷新元数据 loading 视觉四轮迭代：r1 phase / r2 refresh 并发化 (JoinSet=4) + migration 0011 / r3 metaTouchedIds+metaRefreshActive 排队卡 pulse / r4 删除全部浮顶重排，loading 原地显示（卡片永不移动） | 2026-05-15 | d96045b · 444c2ad · 27f74fc · c24c79b | [260515-loading-phase-sort](./quick/260515-loading-phase-sort/) |
| 260516-q3y | 新增「整理子目录」能力 — 把误扫成游戏的品牌父目录拆分为多个独立游戏条目（后端 list_subdirs / split_game_into_subdirs 命令 + migration 0012 scan_skip_dirs 持久化跳过表；前端 SubdirSplitDialog 对话框 + GameCard 右键 / Detail「更多」两处入口；带用户数据的条目拆分前弹确认） | 2026-05-16 | 92d0a09 · 3ada5eb · 5006de9 | [260516-q3y-subdir-split](./quick/260516-q3y-subdir-split/) |
| 260516-tzu | useSmoothWheel hook 改 lerp-to-target（缓动到目标）平滑滚动 — 网格视图滚轮从「速度+摩擦衰减」惯性改为维护 targetScrollTop、每帧指数趋近（ease-in 起步 + ease-out 收尾），更接近键盘 scroll-behavior:smooth 的丝滑手感；仍写 native scrollTop，与 @tanstack/react-virtual 行虚拟化兼容；改动局限在 src/hooks/useSmoothWheel.ts | 2026-05-16 | 5e1305a | [260516-tzu-usesmoothwheel-lerp-to-target](./quick/260516-tzu-usesmoothwheel-lerp-to-target/) |
| 260516-uh6 | 中文版 EXE 详情页 LE 默认简体中文 — Detail.tsx 新增 isCnVersionExe 纯函数（复用 exe_score.rs 的 _cn/_chs/_zh/-cn/-chs/-zh 六后缀约定），refreshGame 未保存 le_profile 时按 exe 文件名后缀默认「简体中文」、否则「Japanese」；已显式保存 le_profile 的游戏行为不变 | 2026-05-16 | 593bf09 | [260516-uh6-cn-exe-exe-le](./quick/260516-uh6-cn-exe-exe-le/) |
| 260516-ulm | 修复 pick_best_exe EXE 匹配逻辑 — 从「全树递归平铺、纯按分数取最高」改为「按目录深度分层、浅层优先」：所有正分 exe 按 WalkDir entry.depth() 分桶进 BTreeMap，升序取首个非空层的最佳；游戏根目录有正分 exe 时深层子目录（redist/tools/汉化补丁等）的更高分 exe 不再压过正主，浅层无正分候选才下探兜底；SCAN-05 评分契约（score>0 门槛 / parent_dir=game_dir 根 / 全负返回 None / 同层并列 mtime 较新者胜）逐字不变；新增浅层优先 + 深层兜底 2 个单元测试 | 2026-05-16 | a779cbb · cc6a8cc · 2d426b1 | [260516-ulm-pick-best-exe-exe-exe](./quick/260516-ulm-pick-best-exe-exe-exe/) |
| 260516-v47 | 发布 v0.2.1 小版本 — package.json / tauri.conf.json / Cargo.toml / Cargo.lock(gal-lib 自身条目) 四处版本号 0.2.0 → 0.2.1 单原子提交；打 tag v0.2.1 并推送触发 release.yml 出包 | 2026-05-16 | 8edf43e | [260516-v47-release-v0-2-1](./quick/260516-v47-release-v0-2-1/) |
| 260517-qnn | 三项改进：① 修复 useSmoothWheel 网格滚动条拖动回弹——新鲜启动拖动滚动条被弹回拖动前位置，根因是 lerp target 只在空闲+下次 wheel 才重对齐，外部滚动期间过期 target 拽回视图；加 scroll 监听 + lastWritten 比对，外部滚动时重新同步 target 并停 rAF（非 vs4 回归）② 新增 delete_game 命令 + GameCard 右键「删除条目」+ Library 确认对话框（删 8 张 game_id 子表 + games 行，不碰磁盘文件）③ Detail 启动方式从 4 个 LE profile 收敛为日区 LE 启动 / 直接启动，删除 isCnVersionExe，旧值平滑回落 | 2026-05-17 | cc2244b · 86aa131 · c8cfa25 | [260517-qnn-scroll-delete-launch](./quick/260517-qnn-scroll-delete-launch/) |
| 260517-sm9 | 发布 v0.2.2 小版本 — package.json / tauri.conf.json / Cargo.toml / Cargo.lock(gal-lib 自身条目) 四处版本号 0.2.1 → 0.2.2 单原子提交；打 tag v0.2.2 并推送触发 release.yml 出包 | 2026-05-17 | 2c0a022 | [260517-sm9-v0-2-2](./quick/260517-sm9-v0-2-2/) |
| 260519-21s | 元数据匹配三项改进：① MetadataPicker 候选卡片标题/描述过长改 3 行 line-clamp（标题去 truncate、新增 summary 段仅非空渲染、confidence badge 行改 items-start）② 根治『右键打开目录后再匹配元数据会重复弹文件管理器』BUG——根因是 GameCard ContextMenuItem / Detail DropdownMenuItem 用 React onClick 而非 Radix onSelect，被点过的「打开目录」项激活态未被 Radix 清理，随后 MetadataPicker Dialog 关闭时默认 onCloseAutoFocus 把焦点甩回菜单 Trigger 重放该 onClick → open_in_explorer 二次 invoke；改 onClick→onSelect + DialogContent onCloseAutoFocus preventDefault ③ match_score.rs containment 分支 baseline 80/70 → 0（prefix 保留 +10 相对加成而非下限），最弱候选可手动选中，4 个单元测试改为相对关系断言；AUTO_BIND_THRESHOLD=80 未动 | 2026-05-19 | 8a70094 · 7059eee · c4ae04b | [260519-21s-metadata-match-fixes](./quick/260519-21s-metadata-match-fixes/) |
| 260519-fav | 详情页收藏按钮颜色与主页统一 —— Detail 收藏按钮 favorited 态从品牌色 text-brand 改为 text-rose-400，与 GameCard 主页卡片常驻爱心标记 (text-rose-400) 一致 | 2026-05-19 | 50d0816 | —（/gsd-fast 内联任务，无任务目录） |
| 260519-l9n | 两项库条目生命周期改进：① 有累计游玩时长的 unplayed 条目在 end_session/cancel_session 结束时自动升级为 playing（UPDATE 带 status='unplayed' 守卫，cleared/dropped 即使有时长也不被改写）+ backfill_playing_status 一次性历史补齐 IPC；② 删除游戏时在其磁盘目录写 .gal-lib-removed 隐藏标记（复用已有 windows crate v0.58 加 Win32_Storage_FileSystem feature 调 SetFileAttributesW，非新增依赖），扫描 Pass 2 跳过带标记目录不再重扫加回，run_scan 返回值 Vec<DiscoveredGame> → ScanOutcome{discovered,removed_dirs}，Scan 页两栏 feed 下方新增『已删除条目』区域 + list_removed_dirs / restore_removed_dir 两个 IPC，点「重新添加」删标记并经 ingest_one_dir 重新入库。自动化门全绿（cargo test --lib 83 passed / npm run build）；删除→重扫跳过→Scan 页恢复完整链路 + 隐藏属性效果待真机验证 | 2026-05-19 | cb80348 · 493bdc0 · cad57d5 | [260519-l9n-playing-status-delete-marker](./quick/260519-l9n-playing-status-delete-marker/) |
| 260519-lxm | 扫描按钮收敛（纯前端，运行时零变化）—— 后端 start_scan 自 20260516 起 full/incremental 两 mode 已统一为同一行为，前端「增量扫描」「全量重扫」两按钮本就完全等价。① /scan 页删除「增量扫描」按钮，「全量重扫」改名「扫描」，onScan 收敛为无参（内部固定 startScan("full")、toast 改「已开始扫描」），清理 RefreshCw import + 头注释；② /settings「扫描操作」区「全量扫描」按钮改名「扫描」、同步区块 lede 文案 + 头注释，onScan 收敛为无参。后端 src-tauri/ 与 src/lib/scan.ts 的 startScan(mode) 签名保留不动（前端固定传 "full"）；tsc 通过 | 2026-05-19 | 7564e18 · 6976ca5 | [260519-lxm-scan-button-converge](./quick/260519-lxm-scan-button-converge/) |
| 260519-oh9 | 扫描复核页两项 UI 改进（纯前端）：① ReviewQueue「待复核」列表根 div 加 max-h-[calc(100vh-280px)] —— 内部既有 overflow-y-auto 此前因无高度上限不生效、整页被撑长，加上限后列表超出在块内滚动；② Scan 页 KPI 条把「无匹配」卡合入「待复核」卡：删除独立「无匹配」KpiCard，unmatched 数并入「待复核」卡 delta 副行（>0 显示『其中 N 项无匹配 · 需人工确认』、=0 回退原文案），KpiCard gridColumn span-3 → span-4，4 卡变 3 卡铺满 12 列。KPI 数值口径与后端 get_scan_kpis / ScanKpis 均不变 | 2026-05-19 | 3fe09c6 · f5ee6ba | [260519-oh9-scan-page-ui](./quick/260519-oh9-scan-page-ui/) |
| 260519-p90 | 发布 v0.2.3 小版本 — package.json / tauri.conf.json / Cargo.toml / Cargo.lock(gal-lib 自身条目) 四处版本号 0.2.2 → 0.2.3 单原子提交；打 tag v0.2.3 并推送触发 release.yml 出包 | 2026-05-19 | c34bdef | [260519-p90-v0-2-3](./quick/260519-p90-v0-2-3/) |
| 260524-dlr | 搜索栏增强 + 详情页标签点击筛选 + MetadataPicker 溢出修复 —— ① advFilter 提升到 useLibraryStore（让非 Library 路由能直接设 facet 多选）② SearchBar 改造：左前缀类型下拉（游戏名/品牌/声优/标签）；非「游戏名」类型输入触发本地 fuzzy 候选下拉（数据走 getFilterOptions），点击/回车把项加入 advFilter 对应 Set；右尾部 X 一键清空（name 模式同时清 store.searchQuery）；Esc 收下拉/清 input ③ 详情页 OfficialTagChip span→button 点击 setAdvFilter(officialTags+=name)+navigate('/'); 用户「我的标签」chip span→button 点击 setFilter({tag_id})+navigate('/')；PersonChip 跳人物页语义不动 ④ MetadataPicker 候选行宽度链路 w-full·min-w-0·max-w-full·overflow-hidden 收敛，span→div+break-words 让 line-clamp 在 CJK 长串上稳定生效，溢出走 button title 属性聚合 hover tooltip 一次展示原标题+别名+完整简介；零后端改动；npm run build 全绿；交互真机验证待确认 | 2026-05-24 | 177959f · a44bfef · 08711d4 · 5355b89 | [260524-dlr-search-prefix-clear-tagjump](./quick/260524-dlr-search-prefix-clear-tagjump/) |
| 260524-qma | 补 i18n 筛选三件套 —— FilterPanel (popover header/footer / 10 section 标题 / 5 facet 搜索 placeholder / 3 chip tooltip / 重置+应用 / status+duration 选项 / MoreChip / 加载中+无匹配) + SearchBar (5 类型 KIND_OPTIONS+LABEL+PLACEHOLDER / kind 下拉 / 输入 aria / 清空+Ctrl+K 提示 / 候选下拉空态 / 候选行 X 部后缀 / 底部 已选+已应用+未应用+取消+确定) + FilterChip (STATUS_LABELS 复用 detail.status.* / 4 类 chip 模板 标签·状态·品牌·年代 / clear aria) 全部走 useTranslation()；module-level 常量改 i18nKey 配对避 i18n 未 ready；复用 chips.* + detail.status.* + common.*；新增 chips.dropped（弃坑/ドロップ/Dropped 与 sidebar 一致）；三语 +61 key → 522/522/522 对齐无空值；pnpm run build 通过；GUI 切换真机验证待人工确认 | 2026-05-24 | 70c75bb | [260524-qma-i18n-filter-ui](./quick/260524-qma-i18n-filter-ui/) |
| 260524-olt | i18n 中文 / 日本語 / English —— i18next@23 + react-i18next@15 接入，三套 translation.json 各 461 条 key 对齐；设置页加「界面语言」下拉 + localStorage 持久化；Sidebar / Settings / Library / Scan / Stats / Detail / Screenshots / Persons + 12 个组件 / 全局 toast helper 全部走 t()；专有名词 (galgame/Bangumi/VNDB/LE/Tauri/Hakoniwa/Shift-JIS) 三语保留原文；module-level 常量改 i18nKey 配对避 i18n 未 ready 初始化；`toLocaleString/Date` 改用 i18n.language；npm run build 通过 (bundle 增量 ~35-40KB gzip)；UIPreferences 顺手删除 Phase 5 stale 主题占位行；切换语言真机验证（Sidebar / Settings / Detail 全变 + 跨重启持久化）待人工确认 | 2026-05-24 | f1b6250 · 3f8db98 | [260524-olt-i18n-zh-ja-en](./quick/260524-olt-i18n-zh-ja-en/) |
| 260519-pi1 | 新增 `npm run release` 发版脚本 —— scripts/release.mjs（纯 Node 标准库 ESM）把手工发版收成一条命令：参数解析（无参 patch / patch / minor / major / 显式 X.Y.Z）+ 三项前置检查（工作区干净 / 分支 master / 目标 tag 本地+远端未占用，全在写文件前）+ 四处版本字段精确正则替换 bump（package.json / tauri.conf.json / Cargo.toml [package] 段 / Cargo.lock 严格锚定 name="gal-lib" 条目，其余依赖不动，每处命中数须为 1）+ git commit `chore: bump version to X.Y.Z` + tag 草稿（预填上个 tag 以来 git log，editor 兜底链 core.editor→GIT_EDITOR→EDITOR→VISUAL→notepad）让用户定稿、空消息中止 + push master 与 tag 触发 release.yml；commit 后任一步失败均打印中文手动收尾指引。package.json scripts 新增 `"release": "node scripts/release.mjs"` | 2026-05-19 | aca2470 | [260519-pi1-npm-run-release](./quick/260519-pi1-npm-run-release/) |
| 260525-g1m | 官方评分入库 + 排序升降序切换 —— schema v13 加 external_rating REAL / external_rating_count INTEGER / external_rating_source TEXT（无 backfill SQL，靠 refresh_metadata_smart 自然回填）；metadata 流：Bangumi 读 rating.score + rating.total、VNDB 读 rating + votecount 并 /10 归一化到 0..=10 同口径；4 处 UPDATE 路径（apply_ingest_result / bind_metadata / refresh_metadata / refresh_metadata_smart 已绑定+未绑定）+ 4 处 SELECT 列表（list_games / get_game / search_games / list_games_for_person）全部覆盖；search_games 新增 sort_dir asc/desc 入参，rating 排序键切到 external_rating（NULL 沉底语义不变）；前端 Game 类型 + searchGames 4 参 + store.sortDir（内存态）+ SortSelect 加 ↑/↓ 方向按钮 + i18n 三语 sort.direction.{asc,desc} + detail.info.external_rating；GameList 评分列 / Detail 顶部 Pill / 信息侧栏新「官方评分」行全部读 external_rating；cargo check + pnpm tsc --noEmit 全绿；http_safe::rejects_ip_literals 1 项 pre-existing 失败与本任务无关；老库升级需手动 Settings「刷新元数据」触发回填 — 这是预期；GUI 真机验证 6 项（新装命中 BGM/VNDB / 老库回填 / SortSelect 方向 / 三语切换 / NULL 沉底）待人工确认 | 2026-05-25 | a24ae21 · 9717c63 · 876ce49 · ae517d5 · c352591 · e3fb81d | [260525-g1m-external-rating-sort](./quick/260525-g1m-external-rating-sort/) |
| 260525-tw2 | 修复 v13 migration 漏注册导致 search_games 报错、游戏列表全空 —— 上一轮 quick 260525-g1m 生成了 `src-tauri/migrations/0013_add_external_rating.sql` 但漏在 `db.rs::migrations()` vec 注册 v13，tauri-plugin-sql 只跑登记过的 migration → 旧库 schema_version 卡在 12、games 表缺 external_rating 三列；`search_games` 的 SELECT 触到缺失列直接 Err，前端 `src/routes/Library.tsx:340-343` catch 块只 `console.error` 不清空 `store.games`，于是用户看到「侧边栏分类条目数正常（`get_sidebar_categories` 不读这三列）但游戏列表全空」。修复仅动 `src-tauri/src/db.rs` 一个文件 3 处定向追加：① module-doc 末段加 v13 描述 3 行 ② const 块末尾加 `V13_SQL = include_str!("../migrations/0013_add_external_rating.sql")` ③ `migrations()` vec 在 v12 entry 后追加 `Migration { version: 13, description: "add_external_rating", sql: V13_SQL, kind: MigrationKind::Up }`。SQL 文件 / commands.rs SELECT / 前端 catch 行为 / release 脚本均未触碰。Verify：`cargo check` 通过 + grep `version: 13` ×1 + `V13_SQL` ×2 + `0013_add_external_rating.sql` ×1 全中。GUI 真机验证（重启 v0.3.2 build → 旧库 v12→v13 自动 migrate → Library 列表恢复显示）由用户在新 build 出来后亲自确认；后续 `npm run release patch` → v0.3.2 由主对话执行 | 2026-05-25 | 3ec6fc5 | [260525-tw2-register-v13-migration](./quick/260525-tw2-register-v13-migration/) |
| 260526-2f9 | Cargo `[profile.dev-release]` 本地快编 profile —— 继承 release 但 `codegen-units=16` / `lto="thin"` / `incremental=true` / `opt-level=2`；本地 `pnpm tauri build --no-bundle -- --profile dev-release` 实测 108 秒（cargo 自报 1m39s），相比发版 release（用户感知 ~10 分钟）约 5x 提速；产出 `target/dev-release/gal-lib.exe` 15.2 MB（release 8.0 MB）；**未触碰 `[profile.release]`，`npm run release` 行为 100% 不变**；Tauri 2 CLI 不吃 `--profile`，须用 `--` 转给 cargo（首次尝试 `pnpm tauri build --profile dev-release --no-bundle` 报 `unexpected argument '--profile'`，已在 PLAN/SUMMARY 标注）；6 个 pre-existing 死代码 warning 与本任务无关 | 2026-05-26 | (pending) | [260526-2f9-cargo-dev-release-profile](./quick/260526-2f9-cargo-dev-release-profile/) |
| 260526-0bi | 移除本地用户评分字段 —— 只保留官方评分。`games.rating` (INTEGER 1..=10, 0001_init 起的本地用户打分) 与 `StarRating` 组件、`update_game_rating` IPC、Detail 页本地「评分」行、i18n `detail.info.rating` / `toast.rating_failed` 三语全部移除；保留 v13 引入的 `external_rating` (REAL 0..=10) 作为评分唯一字段。schema v14 `ALTER TABLE games DROP COLUMN rating`（参 v10 同款 SQLite ≥3.42 原生手法）；db.rs 三处定向追加（module-doc / `V14_SQL` const / migrations vec entry + tests::migrations_v14_drops_local_rating），延续 260525-tw2 v13 翻版预防模式 + grep 三组自验 `version: 14` ×1 / `V14_SQL` ×2 / `0014_drop_local_rating.sql` ×1 全中 + cargo test --lib 跑通 migrations_v14。执行序「先解前后端引用 → 再 DROP COLUMN」避免 SELECT 缺列触发列表全空。前端：StarRating.tsx 整文件删（179 行）、Detail.tsx 信息栏「评分」行 + 「常用操作」StarRating 用法删、advancedFilter ratingMin/ratingMax 字段名复用但读 `g.external_rating`（语义切到官方评分）、SubdirSplitDialog `g.rating != null` 守卫去掉、GameList 评分列 stale 注释顺手刷新；后端：Game struct 删 `pub rating: Option<i64>` + row_to_game 同步、4 处 SELECT 列 (list_games / get_game / search_games / list_games_for_person) 去 `rating,` 列名、lib.rs invoke handler 删 `commands::update_game_rating`；i18n 三语 (zh-CN / ja-JP / en-US) 同步删 2 个 key、保留 `settings.sort.rating` + `filter_panel.section.rating` (语义切到官方评分)。验证：cargo check / cargo test --lib 87 passed (含新增 v14 test) + 1 pre-existing http_safe failure 与本任务无关 / pnpm tsc --noEmit / pnpm build 全绿。grep false positive 1 个保留：`metadata/types.rs:103 pub rating: Option<f64>` 是 MetadataDetail DTO 承载 Bangumi/VNDB 源端 rating（归一化后写到 external_rating，与本地评分无关）。老库迁移：v13→v14 自动 DROP COLUMN，用户原本的 rating 数据丢弃（符合需求）；未刷新过的老条目 external_rating 仍 NULL 需用户在 Settings 点「刷新元数据」补回填（v13 既有行为，本任务不引入新需求）。GUI 真机验证 4 项（v13→v14 自动 migrate 无错误 / Detail 页「评分」行消失仅显示「官方评分」/ 「常用操作」无 StarRating / FilterPanel「评分范围」基于 external_rating 工作）待用户在 v0.3.3 build 出来后亲自确认；后续 `npm run release patch` → v0.3.3 由主对话执行 | 2026-05-26 | 007daf4 · bd35859 · 2b4b8e2 | [260526-0bi-drop-local-rating](./quick/260526-0bi-drop-local-rating/) |

## Session Continuity

Last session: 2026-05-12T08:30:00Z
Stopped at: Phase 15 完成（verification-only）。下一步: `/gsd-audit-milestone v1.3` 跑 12 条 walkthrough；通过后 `/gsd-complete-milestone` + `/gsd-cleanup`。
Resume file: `.planning/phases/15-v12-real-app-smoke/15-SUMMARY.md` (含完整 walkthrough)
