---
slug: scan-completed-before-ingest
status: resolved
trigger: |
  扫描完成事件早于入库完成，导致前端 searchGames 拿到空列表显示"未识别到游戏"。
  修复方向：方案 B — 两阶段进度（扫描→入库），run_scan 末尾不再 emit Completed，
  改由 commands.rs 的 spawn task 在 ingest 循环每条结束时 emit
  Running { completed: i+1, total: discovered.len() }，全部入库结束后 emit Completed。
  涉及 src-tauri/src/commands.rs 的 start_scan、src-tauri/src/scan/mod.rs 的 run_scan
  终态事件、对应单元测试。
created: 2026-05-08
updated: 2026-05-08
---

## Symptoms

DATA_START
- expected: 扫描结束后游戏卡片列表显示扫描到的 200+ 款游戏。
- actual: 进度条显示"扫描完成 200+/200+"后，列表立刻进入"未识别到游戏"空态；之后即使 ingest 在后台陆续完成，列表也不会更新。
- error_messages: 无。前端无报错，仅是 UI 错误地命中 `scanFinishedZeroResults` 分支。
- timeline: 始终如此（事件时序设计自带缺陷，非回归）。
- reproduction: 在 /settings 添加包含 200+ 款游戏的扫描根目录 → 触发 full 扫描 → 切回 / (Library) → 进度条很快变 completed → 列表显示"未识别到游戏"。手动刷新或更换排序后，已入库的游戏才会出现。
DATA_END

## Initial Investigation Notes (from main context)

主流程已经定位（已在主对话中完成 Phase 1 根因调查）：

1. `src-tauri/src/commands.rs` 中 `start_scan` 的 spawn task：
   - 调用 `scan::run_scan(...)` 完成发现阶段
   - `run_scan` 末尾立刻 `on_progress(ScanProgress { status: Completed, completed: total, total, ... })`
   - 此 callback (`commands.rs:200-202`) 直接转发为 `app.emit("scan-progress", p)`
   - 然后**接着**进入 ingest 循环（commands.rs:235-288）：每条 INSERT 一行 + `ingest::process_game()`（Bangumi 1 req/s 限速）+ UPDATE
   - 200 个游戏 ≈ 3+ 分钟才能跑完

2. `src/routes/Library.tsx:132-137` 在 `scanProgress?.status === "completed"` 时调用 `refetchGrid()`，这是唯一的扫描完成 → refetch 触发点。
   - 此时 DB 几乎是空的 → `searchGames` 返回 [] → `setGames([])` → 命中 `scanFinishedZeroResults` 空态分支
   - 之后 ingest 默默继续，但**没有任何后续事件**触发再次 refetch

3. `src/store/library.ts` 与 `src/main.tsx` 的事件订阅链路验证无误：`ScanStatus::Completed` serde `rename_all = "lowercase"` → 前端收到 `"completed"`，匹配正确。

## Root Cause (already identified)

`run_scan` 把"发现完成"语义错误地等同于"扫描完成"，提前 emit 终态 `Completed`。spawn task 的实际终止时机是 ingest 循环结束，但中间没有任何进度事件，前端只能依赖那一个错位的 `Completed` 事件，因此一定在数据未就绪时 refetch。

## Proposed Fix (Plan B — two-phase progress)

1. **`src-tauri/src/scan/mod.rs::run_scan`**：
   - 删除末尾的 `Completed` emit（第 152-158 行）。
   - `run_scan` 不再发任何终态事件；只发 Running 进度。它仅负责"发现阶段"。

2. **`src-tauri/src/commands.rs::start_scan` 的 spawn task**：
   - `run_scan` 返回 `discovered: Vec<DiscoveredGame>` 后，进入 ingest 循环之前 emit 一个过渡事件（`Running` 状态，completed=0, total=discovered.len(), current_dir=""）以重置进度条到入库阶段。
   - ingest 循环里每完成一条（无论成功失败）emit `Running { completed: i+1, total: discovered.len(), current_dir: <游戏名/路径>, status: Running }`。
   - 整个 ingest 循环结束后 emit 一次 `Completed { completed: discovered.len(), total: discovered.len(), ... }`。
   - 错误路径（`scan::ScanError::Cancelled` / `Failed`）仍然 emit 对应终态事件（保持原行为）。
   - 边缘情况：`discovered` 为空时（增量模式或全部 skip）也要 emit 一个 `Completed { 0, 0 }`，否则前端进度条永远卡在 Running。

3. **`src-tauri/src/scan/mod.rs` 单测**：
   - `run_scan_emits_running_then_completed` 当前断言 events.len()==3 + 末尾 Completed，需更新为：仅断言所有事件都是 Running，长度==发现数（Pass 2 每个 dir 一条）。
   - 其它两个测试（cancel/skip-set）不受影响（它们关心的是发现路径，不是终态事件）。

4. **前端**：
   - `src/routes/Library.tsx` 的 `scanProgress?.status === "completed"` 触发 refetch 的逻辑无需改变 —— 现在 `Completed` 事件在 ingest 之后到达，refetch 时 DB 数据已就绪。
   - `ScanProgressBar` 组件需简单核查：现在用户会看到两段进度（发现 0/N→N/N → 入库 0/M→M/M），文案最好能区分阶段。这是 UX 优化项，不阻塞修复。

## Current Focus

```yaml
hypothesis: |
  start_scan 的 spawn task 在 ingest 循环之前转发了 run_scan 末尾的
  Completed 事件，前端因此在 DB 尚空时 refetch 拿到 [] —— 把 Completed
  的发送时机推迟到 ingest 循环结束即可修复。
test: |
  改造后端事件发送时序，运行扫描，验证：
  (1) Running 事件在发现+入库期间持续到来；
  (2) Completed 事件仅在 ingest 全部结束后到达；
  (3) 前端在收到 Completed 时调用 searchGames 能拿到完整列表；
  (4) ScanProgressBar 的进度数字平滑过渡两个阶段。
expecting: |
  cargo test scan::tests 全绿（更新后的断言）；手动 E2E 扫描时列表
  在扫描结束后立即填满，无 "未识别到游戏" 误显示。
next_action: |
  Phase 4 实施：(a) 改 scan/mod.rs 删末尾 Completed；(b) 改 commands.rs
  start_scan 在 ingest 循环里发 Running、循环后发 Completed、空 discovered
  也发一次 Completed；(c) 更新 scan/mod.rs::tests::run_scan_emits_running_then_completed；
  (d) cargo test 验证；(e) 手动跑一次扫描确认体感修复。
reasoning_checkpoint: ""
tdd_checkpoint: ""
```

## Evidence

- timestamp: 2026-05-08T00:00 — `src-tauri/src/scan/mod.rs:152-158` 末尾 emit Completed，run_scan 在该 emit 之后立即返回 discovered。
- timestamp: 2026-05-08T00:00 — `src-tauri/src/commands.rs:200-202` callback 把 ScanProgress 原样转发为 `app.emit("scan-progress", p)`。
- timestamp: 2026-05-08T00:00 — `src-tauri/src/commands.rs:235-288` ingest 循环在 run_scan 返回之后才开始；每个游戏需 INSERT + ingest::process_game(含 Bangumi 限速) + UPDATE，串行执行。
- timestamp: 2026-05-08T00:00 — `src/routes/Library.tsx:132-137` 唯一的 `status === "completed"` → refetch 触发点；不会因为 DB 后续变化重试。
- timestamp: 2026-05-08T00:00 — `src-tauri/src/scan/types.rs:26-33` ScanStatus 用 `serde(rename_all = "lowercase")`，前端 `"completed"` 字符串匹配正确（排除大小写错配假设）。

## Eliminated

- hypothesis: 前端事件订阅未挂载或大小写不匹配 → 排除：`src/main.tsx:38-49` 在模块作用域订阅；types.rs 序列化为小写。
- hypothesis: `searchGames` 默认 sort/filter 把游戏过滤掉了 → 排除：默认 `searchQuery=""`、`filter={}`、`sortBy="last_played"`，后端 `search_games` 在三者均为空/默认时不加 WHERE 子句，等同 listGames。
- hypothesis: 数据库写入失败（rowid 取不到等） → 排除：commands.rs:252-265 已有 last_insert_rowid==0 时回退 SELECT id 的 fallback；即便 ingest 元数据失败也会先 INSERT 行，后续 refetch 应能看到。

## Resolution

- root_cause: |
    run_scan 末尾错把"发现阶段完成"当作"扫描完成"，提前 emit 终态 Completed。
    实际终止时机是 spawn task 中的 ingest 循环结束，但 ingest 期间没有再发任何
    事件，前端只能依赖那个错位的 Completed → 在 DB 尚空时 refetch 命中空态。
- fix: |
    采用方案 B 两阶段进度：
    (1) scan/mod.rs::run_scan 删去末尾 Completed emit，仅发 Running；
    (2) commands.rs::start_scan 的 spawn task 在 ingest 循环前发一个过渡
        Running { completed: 0, total }，循环里每条结束（含 fallback 失败路径）
        发 Running { completed: i+1, total }，循环后发 Completed { total, total }；
    (3) discovered 为空时（增量全 skip 等）兜底 emit Completed { 0, 0 }；
    (4) 错误路径（Cancelled/Failed）保持原有终态事件不变。
- verification: |
    cargo test --manifest-path src-tauri/Cargo.toml 全绿（41 passed; 0 failed）。
    其中 scan::tests::run_scan_emits_running_then_completed 已更新断言为
    "全部事件均为 Running，长度==发现数"，仍然通过。
- files_changed:
    - src-tauri/src/scan/mod.rs
    - src-tauri/src/commands.rs
