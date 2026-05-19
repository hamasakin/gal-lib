---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Scan Pipeline & Person Polish
status: shipped
stopped_at: "v1.3 milestone shipped + archived (2026-05-12). 下一步: `/gsd-cleanup` 归档 phase 目录 → `/gsd-new-milestone` 定义 v1.4 (first task: 12-step walkthrough)。"
last_updated: "2026-05-19T08:15:33.280Z"
last_activity: "2026-05-19 — Quick 260519-l9n：两项库条目生命周期改进。① 有累计游玩时长的 unplayed 条目在 end_session/cancel_session 结束时自动升级为 playing（带 status='unplayed' 守卫，cleared/dropped 不被改写）+ backfill_playing_status 历史补齐 IPC。② 删除游戏时在磁盘目录写 .gal-lib-removed 隐藏标记（复用已有 windows crate 的 SetFileAttributesW），扫描跳过带标记目录不再重扫加回，run_scan 返回值改为 ScanOutcome{discovered,removed_dirs}，Scan 页新增『已删除条目』区域 + list_removed_dirs/restore_removed_dir 两个 IPC 支持点「重新添加」恢复。自动化门全绿（cargo test --lib 83 passed / npm run build）；删除→重扫跳过→Scan 页恢复完整链路待真机验证。"
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
Last activity: 2026-05-19 — Quick 260519-lxm：扫描按钮收敛（纯前端，行为不变）——后端 full/incremental 两 mode 早已统一，/scan 页删「增量扫描」按钮、「全量重扫」改名「扫描」，/settings「全量扫描」改名「扫描」，onScan 收敛为无参

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

## Session Continuity

Last session: 2026-05-12T08:30:00Z
Stopped at: Phase 15 完成（verification-only）。下一步: `/gsd-audit-milestone v1.3` 跑 12 条 walkthrough；通过后 `/gsd-complete-milestone` + `/gsd-cleanup`。
Resume file: `.planning/phases/15-v12-real-app-smoke/15-SUMMARY.md` (含完整 walkthrough)
