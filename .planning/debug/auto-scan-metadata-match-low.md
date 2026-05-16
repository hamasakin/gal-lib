---
slug: auto-scan-metadata-match-low
status: resolved
trigger: |
  自动扫描时元数据匹配成功率很低，只有前几个游戏匹配到数据，但手动扫描时
  VNDB 能匹配到（甚至有 100 置信度）。
created: 2026-05-15
updated: 2026-05-16
---

## Symptoms

DATA_START
- expected: 自动扫描（full/incremental）时每个发现的游戏都应尽量匹配到元数据，命中率应与手动扫描/手动匹配一致。
- actual: 自动扫描后只有前几个游戏拿到了元数据（封面/简介/标签等），靠后的游戏大量无数据；但对同一批无数据游戏单独走手动扫描/手动匹配时，VNDB 能匹配到，甚至给出 100 置信度。
- actual_2 [2026-05-16 重测新证据]: 限速/并发/重试 fix 应用后重测，症状不变——仍只有前几个游戏拿到元数据和封面。且 loading-phase 的逐卡 "loading" 态也只有前几个游戏出现，靠后的游戏从不进入 loading 态。
- actual_3 [2026-05-16 round-5 用户精确描述]: (a) 网格中**同一时刻恰好只有 2 个卡片**显示 loading 态——与 `INGEST_CONCURRENCY = 2` 数值吻合，强烈暗示 loading UI 绑定的是「正在跑的 ingest 任务」而非 placeholder 的 `last_scanned_at IS NULL`。(b) 大约 4 个卡片拿到封面后，**网格里再无任何卡片 loading**，但顶部扫描进度条仍正常推进直到完成。(c) 扫描完成后只有前 4 个游戏有数据/封面，其余全空；对同批空白游戏走手动匹配能匹配到。(d) 用户期望：所有正在抓取元数据/封面的卡片都显示 loading 样式。
- error_messages: 未知（用户未提供控制台输出）。`pick_best_across_sources` 已加 `[ingest-diag]` 日志可区分"搜索失败"与"低分未命中"。
- timeline: 用户措辞"现在...这么低了"暗示是回归；近期有 `quick-260515-loading-phase`（round 1-4）改动过网格 loading 态逻辑。
- reproduction: 触发一次自动扫描 → 前 ~4 个有元数据+封面+loading 态，约 4 个拿到封面后全网格 loading 消失，靠后游戏大量空白且从不进入 loading，而进度条照常跑完。
DATA_END

## Current Focus

```yaml
hypothesis: |
  [2026-05-16 round-5 走查后收敛] 穷尽静态走查（含本轮精读 quick-260515-
  loading-phase diff、apply_ingest_result、单任务体、QueryCache 毒化语义）
  确认 ingest 路径**不存在任何结构性早退**——与 round-3 结论一致。

  两个新的明确事实改写了诊断地图：
  1. 自动扫描期间 `metaRefreshActive` 恒为 false（只有 Settings 手动刷新
     才置位）→ 靠后排队的 placeholder 卡的 loading 完全靠
     `metaState === "pending"`（`last_scanned_at IS NULL`）。理论上每个
     未 ingest 的 placeholder 都该 pulse。
  2. 终态 Completed 事件**无条件** emit `completed: total`——进度条跑满
     **不能**证明每个游戏都被真正 ingest 过。round-3 据「进度条到 total」
     排除「线 B panic」的前提因此失效，「线 B」重新存疑。

  当前最可能的两条路线（互斥，需运行时证据二选一）：
  - 线 B'（panic）: 头几个游戏之后的 ingest 任务在 process_game_cached
    内 panic → 不发 finished、不增 completed，但 join_next() 吞掉 JoinError
    循环继续。注意：panic 的卡会**卡在 in_flight loading**，与「loading
    消失」症状相反——除非 panic 发生在 `started` emit 之前（如 placeholder
    重新 INSERT 阶段），那样卡片从不进入 loading 也从不被 ingest。
  - 线 C（事件丢失/竞态）: ingest 任务确实全部跑完，但 `meta-fetch-progress`
    的 `started` 事件在前几个之后丢失/未送达前端，或 `games-changed`
    throttle 把靠后的刷新吞掉 → 前端看不到 loading 也看不到新数据，
    DB 里其实有数据。需对照「手动匹配能匹配到」判断 DB 是否真的为空。
test: |
  必须由用户跑一次新的 `npm run tauri dev` 扫描并提供：
  1. 完整控制台输出——特别是 `[ingest-diag]` 行（统计有几条 = 实际跑了
     几个 query）、`[ingest] ... failed` 行、以及任何 panic backtrace。
     `[ingest-diag]` 行数 ≈ 4 ⇒ 线 B'（循环/任务体提前停）；
     `[ingest-diag]` 行数 ≈ total ⇒ 线 C（任务跑完但前端没反映）。
  2. 扫描结束后两条 SQL：
     `SELECT COUNT(*) FROM games;`
     `SELECT COUNT(*) FROM games WHERE last_scanned_at IS NULL;`
     第二个数 ≈ 0 ⇒ 任务全跑完（线 C）；≈ total-4 ⇒ 任务没跑（线 B'）。
expecting: |
  `[ingest-diag]` 行数 + `last_scanned_at IS NULL` 计数二者合起来能直接
  区分线 B' 与线 C，把根因从两条候选收敛到一条。静态走查已穷尽，无法
  在没有这份运行时证据的情况下继续。
next_action: |
  [RESOLVED round-6] 根因不是线 B'/线 C，而是 `insert_placeholder_dir` 的
  `last_insert_rowid()` id 解析 bug——已用 `sqlite3` CLI 直接实证并改为
  `RETURNING id` 修复（见 Resolution）。剩余动作：用户跑一次
  `npm run tauri dev` 全量扫描做端到端确认。
reasoning_checkpoint: ""
tdd_checkpoint: ""
```

## Evidence

- timestamp: 2026-05-15T00:00 — `src-tauri/src/commands.rs:42` `INGEST_CONCURRENCY = 2`（首轮 fix 已 4→2）；`commands.rs:707-814` start_scan 的 ingest JoinSet refill 模式。
- timestamp: 2026-05-15T00:00 — `src-tauri/src/ingest.rs:107-127` `pick_best_across_sources` 用 `tokio::join!` 同时打 Bangumi + VNDB；首轮 fix 已把 `if let Ok` 改为 `match` + `eprintln!`（不再静默吞错）。
- timestamp: 2026-05-15T00:00 — `src-tauri/src/ingest.rs:188-250` `fetch_enrichment` 命中后对源再发 3 个请求，单游戏源用量最多 4 次。
- timestamp: 2026-05-15T00:00 — `src-tauri/src/metadata/limiter.rs` VNDB 限速器首轮 fix 已改为 `with_period(2s)`（突发容量 1）。
- timestamp: 2026-05-16T00:00 — [关键新证据] 限速/并发/重试 fix 应用后重测：症状不变，且 loading-phase 逐卡 loading 态也只有前几个游戏出现。
- timestamp: 2026-05-16T01:00 — [静态走查] `scan/walker.rs:35-66` `collect_game_dirs`：用 `WalkDir min_depth==max_depth==depth` 枚举全部目标层目录，**无 .take / 无 cap / 无早退**（仅 cancel）。discovery 不是早退点。
- timestamp: 2026-05-16T01:00 — [静态走查] `scan/mod.rs:77-160` `run_scan` Pass 2：`for (i, dir) in game_dirs.into_iter().enumerate()` 迭代全部，全部 push 进 `discovered`（仅 cancel/skip/incremental-existing 会 continue，不会 break）。
- timestamp: 2026-05-16T01:00 — [静态走查] `commands.rs:668-685` placeholder 循环：`for dg in &discovered` 对全部 discovered 调 `insert_placeholder_dir` + emit `games-changed`；单行 insert 失败只跳过 emit、循环继续。无 cap。
- timestamp: 2026-05-16T01:00 — [静态走查] `commands.rs:707-814` start_scan JoinSet refill 循环：`while set.len() < INGEST_CONCURRENCY { iter.next() }` + `set.join_next().await`。refill 正确——每完成一个补一个，直到 `iter` 耗尽且 set 空时 `join_next()` 返回 None 才 break。**无 take/break/cap**。task panic 时 `join_next()` 返回 `Some(Err(JoinError))`，`is_none()` 为 false，循环继续，panic 不导致早退。
- timestamp: 2026-05-16T01:00 — [静态走查] `commands.rs:1284-1500+` `refresh_metadata_smart` JoinSet 同款 refill 模式，同样迭代 `SELECT ... FROM games ORDER BY id ASC` 的全集。无早退。
- timestamp: 2026-05-16T01:00 — [静态走查] `commands.rs:2090-2277` `search_games`：主查询 **无 LIMIT、无分页**，返回全部 games 行（含 placeholder）。前端 grid 拿到全集。
- timestamp: 2026-05-16T01:00 — [静态走查] `migrations/0002` `games.metadata_source` / `last_scanned_at` 均为 `TEXT` **无 DEFAULT** → placeholder 行这两列为 NULL。
- timestamp: 2026-05-16T01:00 — [静态走查] `commands.rs:112-145` `insert_placeholder_dir` 只写 path/name/executable_path/screenshot_interval_sec，**不写 metadata_source / last_scanned_at** → placeholder 行 `last_scanned_at == NULL`。
- timestamp: 2026-05-16T01:00 — [静态走查] `GameCard.tsx:84-93` `getMetadataState`：`last_scanned_at == null` → `"pending"`；`GameCard.tsx:180-191` `bottomBadge`：`metaState === "pending"` → `"pending"` 徽章 + `pulse-ring`。**结论：fresh full scan 下每个 placeholder 卡片都应立即显示「获取中」loading 态**——这与"loading 只有前几个"的症状**直接矛盾**。
- timestamp: 2026-05-16T01:00 — [静态走查] `Library.tsx:267-302` `games-changed` 订阅 600ms throttle + trailing 调用 `refetchGrid`；placeholder 循环每插一行 emit 一次 → grid 会刷出全部 placeholder 卡。
- timestamp: 2026-05-16T01:00 — [关键推论] 既然 fresh full scan 下全部 placeholder 都应 loading，而症状是"只有前几个"，则要么 (A) 用户跑的是 incremental（discovered 只含新增几个，placeholder 只插几个），要么 (B) 运行时有 panic/hang 导致 spawned task 早退。两者都需运行时证据区分——静态走查无法再推进。
- timestamp: 2026-05-16T02:00 — [用户答疑] 「自动扫描」= start_scan 扫目录自动匹配；「手动扫描」= MetadataPicker 卡片手动选条目。扫描进度条**正常加载并完成**（不卡死、total 不是个位数）。测试跑的是 `npm run tauri dev`（重新编译，首轮 fix 生效）。
- timestamp: 2026-05-16T02:00 — [静态走查] `commands.rs:949-958` `search_metadata` 命令直接调 `metadata::vndb::search(&query)` / `bangumi::search`——与自动扫描 `pick_best_across_sources` 用的是**同一个搜索函数**。自动 vs 手动差异只在查询串、≥80 阈值、并发上下文。
- timestamp: 2026-05-16T02:00 — [关键推论] 手动匹配同批游戏能拿 100 置信度 => VNDB 服务端没在限流该 IP => 首轮"服务端 429"根因**确定错误**，首轮 limiter/并发/重试 fix 修的是不存在的问题。
- timestamp: 2026-05-16T02:00 — [诊断] `ingest.rs` `pick_best_across_sources` 加 `[ingest-diag]` 日志：每查询打印 query / bangumi_hits / vndb_hits / best_confidence（hits=-1 表示该源报错）。`cargo build --lib` 编译通过。等用户跑一次扫描贴控制台。
- timestamp: 2026-05-16T03:00 — [round-5 用户精确描述] 同一时刻**恰好 2 个**卡片 loading（= `INGEST_CONCURRENCY`）；约 4 个游戏拿到封面后全网格 loading 消失；进度条仍跑完；扫描完成后只有前 4 个游戏有数据/封面。=> loading UI 绑定 in-flight ingest 任务而非 placeholder DB 列；round-3 静态走查"refill 正确无 break"的结论与此症状冲突，需结合 `quick-260515-loading-phase` 改动重审。
- timestamp: 2026-05-16T03:00 — [待查] 近期 `quick-260515-loading-phase`（commits 552ad6b / 27f74fc / c15f8d7 / c24c79b / 7dc23bd，round 1-4）改动了网格 loading 态逻辑——是 round-5 重定向的关键嫌疑改动，gsd-debugger 须精读其 diff。
- timestamp: 2026-05-16T04:00 — [round-5 走查] 精读 `quick-260515-loading-phase` diff（27f74fc / c24c79b）。GameCard 的 loading 态由三条独立来源决定，按 badge 优先级：(1) `isFetchingMeta` = `fetchingMetaIds[id] != null`（由 `meta-fetch-progress` `started`/`finished` 维护）→ spinner；(2) `isPendingRefresh` = `metaRefreshActive && !isFetchingMeta && !metaTouched`；(3) `metaState === "pending"`（= placeholder：非 bangumi/vndb/manual 且 `last_scanned_at == null`）→ 静态 pulse。**关键：`metaRefreshActive` 只由 `Settings.onRefreshMetadata` 置 true，`start_scan`（自动扫描）从不置位** → 自动扫描期间 `isPendingRefresh` 恒为 false，靠后排队的 placeholder 卡只能靠 (3) `metaState==="pending"` 显示 loading。c24c79b 还移除了 `visibleGames` 的所有重排（round-4 决策），grid 顺序纯 server sort。
- timestamp: 2026-05-16T04:00 — [round-5 走查] `commands.rs:168-227` `apply_ingest_result`：UPDATE **无条件**写 `last_scanned_at = datetime('now')` + `metadata_fetched_at = datetime('now')`，即使 no-match（`metadata_source = "none"`）。=> ingest 一旦真正跑过某个游戏，其行立即从 placeholder（`last_scanned_at NULL` → `metaState "pending"`）变成「失败终态」（`metadata_source "none"` + `last_scanned_at` 非空 → `getMetadataState` 返回 `"failed"` → 「待复核」徽章）。命中则 `metadata_source` = bangumi/vndb → `"ok"` → 普通卡。**没有任何代码路径会让一张卡变成「完全空白、无徽章、无 loading」** —— 用户口中「空白」只能是 `"failed"`/「待复核」态被误述，或那些行**根本没被 ingest 过**（仍是 placeholder，理应 pulse）。
- timestamp: 2026-05-16T04:00 — [round-5 走查] `commands.rs:737-805` 单个 ingest 任务体：`started` emit 在 placeholder 重新 INSERT 之后（L774）；随后 `process_game_cached`（网络）；成功才 emit `finished`（L791）+ `completed.fetch_add`（L794）。若任务在 `process_game_cached` 内 panic：unwind → 不发 `finished`、不增 `completed`，但 `set.join_next()` 返回 `Some(Err(JoinError))`，循环继续。=> panic 的卡会**卡在 `in_flight` loading 直到扫描完成**才被 `clearFetchingMetaIds` 清。这与 round-5「loading 反而消失」**症状相反** —— 若靠后游戏在 panic，应看到越来越多卡卡在 loading，不是没有 loading。例外：若 panic 发生在 L774 的 `started` emit 之前（placeholder 重新 INSERT 阶段），卡片从不进入 loading 也从不被 ingest。
- timestamp: 2026-05-16T04:00 — [round-5 走查 / round-3 结论修正] `commands.rs:830-840` 终态 Completed 事件**无条件** emit `completed: total`（不是 `completed.load()`）。=> **进度条跑到 total 完成并不能证明每个游戏都被真正 ingest 过**。round-3 据此排除「线 B panic」的前提是错的——进度条到 total 与「ingest 任务体真正执行」已解耦。「线 B」应视为**重新存疑**，但需运行时证据（panic backtrace / `[ingest-diag]` 行数）才能确认或排除。
- timestamp: 2026-05-16T04:00 — [round-5 走查] `pick_best_with_cache`（`ingest.rs:177-193`）：`std::sync::Mutex` 只在 panic-free 的 HashMap insert 期间持有，await 前已 drop → 网络代码 panic 不会毒化该 Mutex。`tokio::sync::OnceCell::get_or_init` 的 init future 若 panic，OnceCell 保持未初始化、panic 向上传播给当前 caller、后续 caller 可重试 → 不会卡死后续任务。**结论：QueryCache 不构成「循环静默停止」的结构性早退点。** 与 round-3「JoinSet refill 正确、无 take/break/cap」的结论一致——穷尽静态走查未发现任何结构性早退。
- timestamp: 2026-05-16T04:00 — [round-5 阻塞点] `tauri-dev.log`（最近一份，5月9日）早于 round-4 的 `[ingest-diag]` 日志与 round-5 重测，**无 `[ingest-diag]` / `[ingest]` / panic 行**。区分「循环真停了（只有 ~4 条 query 日志）」vs「循环跑全但靠后任务 panic（有 panic backtrace）」vs「任务全跑完但前端没反映（事件丢失/竞态）」**必须**靠用户跑一次新的 `npm run tauri dev` 扫描并贴控制台输出——静态走查已穷尽，无法再推进。
- timestamp: 2026-05-16T05:00 — [round-6 实测 DB 状态] 直接查 `src-tauri/target/debug/data/app.db`（dev 库，`gal-lib.exe` 运行中、WAL 2.5MB/12:03 修改）：`games` 表 **0 行**，`scan_roots` 1 行。与用户「扫描完成后只有前 4 个游戏有数据」矛盾——若扫过，至少应剩若干行。指向 `lib.rs:183-193` 启动清理 `DELETE FROM games WHERE metadata_source IS NULL AND last_scanned_at IS NULL` 把上一轮没被正确 ingest 的 placeholder 全删了。
- timestamp: 2026-05-16T05:00 — [round-6 走查 / 关键] `commands.rs:112-145` `insert_placeholder_dir` 用 `INSERT ... ON CONFLICT(path) DO UPDATE` 后靠 `last_insert_rowid() != 0` 判断「新插入」、否则走 `SELECT id` fallback。该判断**根本错误**：SQLite 的 `last_insert_rowid()` 在 upsert 走 DO UPDATE 分支（没有真正 INSERT）时**不归零、不更新**，保持该连接上一次真正 INSERT 的 rowid。
- timestamp: 2026-05-16T05:00 — [round-6 直接实证] `sqlite3` CLI 复现：连续 INSERT aaa/bbb/ccc（rowid 1/2/3）后，对**已存在**行 `/g/aaa`（真实 id=1）做 `INSERT ... ON CONFLICT(path) DO UPDATE` → `last_insert_rowid()` 返回 **3**（不是 0、也不是 1）。证实 `insert_placeholder_dir` 对已存在行会返回**陈旧的错误 id**。
- timestamp: 2026-05-16T05:00 — [round-6 根因链] `start_scan`：placeholder 预循环（`commands.rs:668-685`）先把全部 N 行 INSERT 进 `games`；随后 ingest 循环每个任务在 `commands.rs:749` **再次**调 `insert_placeholder_dir`——此时行**必然已存在** → 走 DO UPDATE → `last_insert_rowid()` 返回该 pooled 连接上一次真正 INSERT 的 rowid（预循环灌进去的某行 id，非 0）→ `insert_placeholder_dir` 返回**错误 id**。`max_connections(5)`：跑过预循环的连接被「污染」，ingest 期间新建的干净连接 `last_insert_rowid()==0` → 走 fallback 拿对 → 故只有部分游戏（落在干净连接上的）数据正确，其余 `started`/`finished`/`apply_ingest_result` 全部作用在错误行上。
- timestamp: 2026-05-16T05:00 — [round-6 修复+验证] `insert_placeholder_dir` 改用 `INSERT ... ON CONFLICT(path) DO UPDATE ... RETURNING id` + `fetch_one`——insert 与 update 两条路径都直接返回受影响行的真实 id，不再依赖 pooled 连接的 `last_insert_rowid()` 历史。`sqlite3` CLI 验证 `RETURNING id` 对冲突 upsert 返回正确 id（1）。`cargo build --lib` 通过；`cargo test --lib` 全绿（80 passed）。

## Eliminated

- hypothesis: 自动匹配走的源 / 置信度阈值与手动匹配不同 → 排除：`ingest.rs:99-127` 自动 `AUTO_BIND_THRESHOLD = 80`，且同时查 Bangumi + VNDB；手动匹配同样能拿 ≥80。
- hypothesis: title_clean 把靠后游戏的 clean_name 清空导致跳过搜索 → 部分排除：clean_name 为空确实会 skip（`ingest.rs:295`），但清名结果与目录在列表中的位置无关。
- hypothesis: [2026-05-16 二次排除] ingest 路径有结构性早退 / JoinSet refill 不补充后续游戏（`.take(N)` / 错误循环条件 / 过早 break / 计数器 cap 在 INGEST_CONCURRENCY） → **排除**：穷尽走查 walker / run_scan / placeholder 循环 / start_scan JoinSet / refresh_metadata_smart JoinSet / search_games / QueryCache 毒化语义，**全部正确迭代全集，不存在任何 take/break/cap/死锁早退**。round-5 走查再次确认。
- hypothesis: [2026-05-16] search_games 有默认 LIMIT/分页只返回前 N 行 → 排除：`commands.rs:2240-2249` 主查询 `SELECT ... FROM games {} ORDER BY {}` 无 LIMIT。
- hypothesis: [2026-05-16] placeholder 行因 schema DEFAULT 导致 last_scanned_at 非 NULL → 不被渲染成 loading → 排除：`metadata_source` / `last_scanned_at` 均无 DEFAULT，placeholder 行为 NULL，`getMetadataState` 正确返回 "pending"。
- hypothesis: [2026-05-16 round-3] 线 A——用户跑的是 incremental，discovered 只含新增几个 → **排除**：用户确认进度条正常加载并完成、total 不是个位数。
- hypothesis: [2026-05-16 round-3] 首轮"VNDB 服务端 429 限流"根因 → **确定排除**：用户手动匹配同批游戏能拿 100 置信度，证明 VNDB 服务端未限流该 IP。首轮 limiter/并发/重试 fix 是在修不存在的问题。

## Re-opened Hypotheses (status after re-investigation)

- [2026-05-16] ingest 循环 early-exit / refill 不补充后续游戏 → 重新激活后 **再次排除**（见 Eliminated）。round-3 + round-5 两轮穷尽走查均未发现任何结构性早退。
- [2026-05-16 round-5] 此前"限速突发 → 429 → 静默吞 Err"根因 → 存疑且首轮 fix 已不能解决。limiter/并发/重试 fix 作为防御性改进保留。
- [2026-05-16 round-5] 「线 B —— spawned task panic/hang 导致 JoinSet 提前 drain」 → **重新打开**（round-3 曾据「进度条到 total」排除，但终态 Completed 无条件 emit `completed: total`，该前提失效）。需 panic backtrace 才能确认/排除。注意 panic 后症状本应是「卡片卡在 loading」而非「loading 消失」，除非 panic 发生在 `started` emit 之前。

## Open Questions (need runtime evidence)

1. **[最高优先级]** 一次新 `npm run tauri dev` 扫描的完整控制台输出：`[ingest-diag]` 行数（≈4 还是 ≈total）、`[ingest] ... failed` 行、任何 panic backtrace。
2. 扫描结束后两条 SQL 的结果：
   `SELECT COUNT(*) FROM games;`
   `SELECT COUNT(*) FROM games WHERE last_scanned_at IS NULL;`
   —— 第二个数 ≈ 0 ⇒ ingest 任务全跑完（指向前端事件丢失/竞态）；≈ total-4 ⇒ 任务没跑（指向循环/任务体提前停或 panic）。
3. 扫描进度条 total 数字 = ? 是否等于库里游戏总数？

## Resolution

[RESOLVED — round-6，根因经 `sqlite3` CLI 直接实证后确认并修复]

- root_cause: |
    `insert_placeholder_dir`（`commands.rs:112-145`）用 `last_insert_rowid() != 0`
    判断「这次是新插入还是命中已存在行」，假设 upsert 走 DO UPDATE 分支时该值为 0。
    **这个假设是错的**：SQLite 的 `last_insert_rowid()` 是 per-connection 粘滞值，
    upsert 走 DO UPDATE（没有真正 INSERT）时它**不变**，保持该连接上一次真正
    INSERT 的 rowid。

    `start_scan` 的 placeholder 预循环先把全部 N 行 INSERT 进 `games`；ingest
    循环每个任务在 `commands.rs:749` 第二次调 `insert_placeholder_dir` 时行
    **必然已存在** → 走 DO UPDATE → `last_insert_rowid()` 返回该 pooled 连接
    历史上某次真正 INSERT 的 rowid（非 0、非当前行）→ 函数返回**错误的 game id**。

    后果：`meta-fetch-progress started/finished`、`process_game_cached`（封面
    按 game_id 命名）、`apply_ingest_result`（按 game_id UPDATE）全部作用在
    **错误的 `games` 行**上。多数游戏真实的 placeholder 行从未被正确 enrich →
    无数据、无封面；扫描下次启动时 `lib.rs:187` 清理把这些「永远是 placeholder」
    的行整批删掉（解释了实测 `games` 表为 0 行）。手动匹配不受影响，因为
    `bind_metadata`/`search_metadata` 用前端传入的真实 id，不经
    `insert_placeholder_dir` 的 id 解析。

    这同时解释三个症状：(1)(3) loading 视觉绑定的 `started` 事件 id 错乱 →
    loading 落在错卡、真实卡从不 loading；(2) 多数游戏数据空白；以及实测
    `games` 表为空。是 `20260509f` 两阶段 ingest 引入「双调 + last_insert_rowid
    捷径」时带入的回归。
- fix: |
    `insert_placeholder_dir` 改用
    `INSERT ... ON CONFLICT(path) DO UPDATE SET ... RETURNING id` + `fetch_one`。
    `RETURNING id` 对 insert 与 update 两条路径都直接返回受影响行的真实 id，
    彻底不依赖 pooled 连接的 `last_insert_rowid()` 历史。
- verification: |
    `sqlite3` CLI 实证：(a) 旧路径——对已存在行做 ON CONFLICT DO UPDATE 后
    `last_insert_rowid()` 返回陈旧的 3（错）；(b) 新路径——同样 upsert 加
    `RETURNING id` 返回正确的 1。`cargo build --lib` 通过；`cargo test --lib`
    80 passed / 0 failed。待用户跑一次 `npm run tauri dev` 全量扫描做端到端确认：
    期望每个游戏数据落在自己的行、loading 视觉跟随正确的卡。
- files_changed:
    - src-tauri/src/commands.rs  (insert_placeholder_dir — RETURNING id)

首轮（已推翻）结论保留为历史记录：

- [已推翻] root_cause：并发 ingest 打爆 VNDB（限速突发 → 429 → 静默吞 Err）。
  推翻原因：重测后 loading 态也只有前几个游戏，限速根因无法解释。
- [已应用、与本根因无关] limiter.rs with_period(2s)；INGEST_CONCURRENCY 4→2；
  vndb with_retry 退避加长；`pick_best_across_sources` Err 改 `eprintln!`；
  `[ingest-diag]` 诊断日志。作为防御性改进 / 诊断设施保留（未提交，见
  `git status`）。这些改动不修本 bug，但也无害——可独立决定是否保留/提交。
