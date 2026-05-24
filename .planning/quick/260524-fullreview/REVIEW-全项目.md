---
date: 2026-05-24
scope: 全项目代码审查（gal-lib）
files_reviewed: 97
total_loc: ~30000
depth: standard
findings:
  critical: 15
  warning: 52
  info: 35
  total: 102
reports:
  - REVIEW-rust.md
  - REVIEW-frontend-lib.md
  - REVIEW-components.md
  - REVIEW-routes.md
---

# gal-lib 全项目代码审查汇总

并行派发 4 个 gsd-code-reviewer 子代理，按模块覆盖 src-tauri/src（Rust 后端）、src/lib + src/store + src/hooks（前端业务逻辑层）、src/components/{library,layout,settings,tweaks}（业务 React 组件）、src/App.tsx + src/main.tsx + src/router.tsx + src/routes（路由与入口）。共审查 97 个源文件、约 3 万行。

## 总览

| 模块 | 文件数 | Critical | Warning | Info | 报告 |
| --- | --- | --- | --- | --- | --- |
| Rust 后端 (src-tauri/src) | 28 | 4 | 14 | 8 | [REVIEW-rust.md](REVIEW-rust.md) |
| 前端 lib/store/hooks | 23 | 0 | 6 | 7 | [REVIEW-frontend-lib.md](REVIEW-frontend-lib.md) |
| 业务 React 组件 | 36 | 7 | 18 | 12 | [REVIEW-components.md](REVIEW-components.md) |
| 路由与入口 | 10 | 4 | 14 | 8 | [REVIEW-routes.md](REVIEW-routes.md) |
| **合计** | **97** | **15** | **52** | **35** | — |

## 必修 Critical（15 项）

### Rust 后端（4 项）

1. **CR-01 强制结束游戏 → 截图任务无法取消，持续抓屏写盘**
   - `src-tauri/src/launch/orchestrator.rs:258-321`
   - `entry.task.abort()` 把整个 wait task drop，`cancel_for_wait.store(true)` 永远不执行。隐私 + 资源泄漏。

2. **CR-02 `launch_game` TOCTOU race，第二次启动覆盖 session entry**
   - `src-tauri/src/commands.rs:2061-2099`
   - session-active 检查到 spawn 之间有 `await` 窗口，第一个游戏被覆盖后不可控。

3. **CR-03 `restore_removed_dir` / `add_game` / `split_game_into_subdirs` 允许注册任意系统目录**
   - `src-tauri/src/commands.rs:1178-1210, 906-934, 1003-1068`
   - 前端任意路径仅校验 `is_dir()`，可注册 `C:\Windows\System32` 等。缺 scan_roots 白名单。

4. **CR-04 reqwest Client builder `.expect()` panic 杀进程**
   - `src-tauri/src/metadata/bangumi.rs:41-47`、`src-tauri/src/metadata/vndb.rs:43-48`
   - TLS 后端初始化失败时整个 Tauri 后端被杀。

### 业务组件（7 项）

5. **CR-01 4 个组件的 `listen(...).then(unlisten => ...)` StrictMode 下泄漏订阅**
   - `ScanFeed.tsx` / `ReviewQueue.tsx` / `Sidebar.tsx` / `BackfillProgressBar.tsx`
   - cleanup 跑在 then 之前 → 订阅泄漏。**建议抽 `useTauriListen` hook 一次性修掉**。

6. **CR-02 `TagPicker.createAndSelect` stale closure 丢标签**
   - 同事件循环内多次 toggle 会丢失之前的选择。

7. **CR-03 `ScreenshotsTab` HTML 嵌套 interactive element 非法**
   - 外层 `<button>` 包内层 `role="button"`，且 KeyboardEvent 强转 MouseEvent。

8. **CR-04 `ReviewQueue.CandidateCard` 父 div 缺 `position: relative`**
   - 无封面时 ImageOff 图标飞到屏幕其它位置。

9. **CR-05 `ScanProgressBar.summary` TDZ ReferenceError 风险**
   - `let` + switch 无 default，后端扩展 status 必炸。

10. **CR-06 `SubdirSplitDialog` setSelected 不检查 cancelled**
    - 快速切目录时旧 exe 路径被并到新目录的 selected 集合。

11. **CR-07 `CoStaffStrip` 抓 portrait 的 effect deps 漏 `portraits`**
    - 循环内 `if (key in portraits) continue` 始终读初始空对象，N 次 re-render。

### 路由与入口（4 项）

12. **BL-01 `src/main.tsx:43-44, 93-94, 137-138, 175-176` 4 处模块级守卫逻辑失效**
    - `let __xxxUnsub; if (!__xxxUnsub)` 每次模块求值都是 undefined → guard 永远进真分支。Vite HMR 命中 main.tsx 后旧 listener 不解绑，事件被重复消费。

13. **BL-02 `src/routes/Detail.tsx:492-508` `refreshGame` 全表拉取**
    - 7 处 mutation 各拉一次全库 `listGames()` 再 `.find()`。且只 `setGame(local)` 不回 store。

14. **BL-03 `src/routes/Persons.tsx:166-196` 声优页 N+1 IPC**
    - 一个声优 50 部作品 = 50 次 `listPersonsForGame` 全人物 JOIN，只为提 50 个 character_name。需后端补 `listCharactersForPerson(personId)`。

15. **BL-04 `src/routes/Detail.tsx:600-608` Esc keydown 全局监听冲突**
    - Dialog 关闭后焦点回 body 时按 Esc 会被意外踢回 Library。

## 高优先级 Warning 摘选

围绕安全、健壮性、性能各挑出影响面最大的：

- **WR Rust** — `portrait_cache` 下载未校验 URL scheme（SSRF）、cover/portrait 下载无大小限制（OOM）、`find_game_pid` `starts_with(stem)` 错跟踪进程、`split_game_into_subdirs` 部分成功不回滚、PID 重用窗口、placeholder INSERT 静默失败、`save_backup` strip_prefix unwrap、SQL `format!` 拼接（虽 whitelist 但脆弱）
- **WR 前端 lib** — `Library.refetchGrid` 无 stale-guard 导致搜索结果错位、`db.ts:22` dbPromise 缓存 rejected promise 永久不可恢复、`useSmoothWheel` 未 normalize `deltaMode`、`preferences` 静默吞 parse/quota 错误、`createView` + `addGames` 失败不回滚
- **WR 组件** — `GameList` 订阅整张 `fetchingMetaIds` 表全表 re-render、5+ 处 `img.onError` 反模式（src 重置不可恢复）、`SearchBar` 全局 Ctrl+K 不查 `target.tagName` 抢 textarea、多处 setState 缺 functional updater、SavesTab 删除/恢复连点无 in-flight 守卫
- **WR 路由** — Scan 与 main.tsx 重复订阅 `scan-progress`、Settings 修 scan-root 用 remove+add 无回滚、Library scan-completed 边沿检测顺序错严格模式失效、Screenshots 全游戏并行 IPC 无 abort、Stats `computeStreak` UTC/本地时区混用 DST 断点、`void getDb().catch` 致命错误无 UI、Detail `notesHydratedRef` 跳转期写入旧游戏笔记、router 无 lazy 全 bundle 进首屏

## 跨模块系统性问题（架构层）

跨 4 份报告共同出现的、应在一个工作流里集中处理而非散点修复：

1. **没有统一的 Tauri event 订阅 hook** —— 4 个 Critical + N 个 Warning 都来自手写 `listen().then(unlisten => ...)`。建议 `src/hooks/useTauriListen.ts` 一处搞定 race-safe + StrictMode + HMR cleanup。
2. **没有图像 fallback 组件** —— `<img onError={e => e.target.style.display='none'}>` 散落 5+ 处。建议 `<SafeImage src fallback />`。
3. **store ↔ route 数据流向不明** —— `useLibraryStore.games` 被 5 个路由共用但 Detail mutation 不回写、Library 看 stale。需要明确 owner 或下沉到 selector hook。
4. **invoke 错误传播策略不统一** —— 有的 try/catch toast、有的 silent flag、有的彻底吞。建议封装 `safeInvoke` + toast 策略约定。
5. **没有 router loader/action / lazy import** —— 7 个路由全 bundle 进首屏，每页都重复实现 mount-fetch / hydrate / loading 三态。建议迁移到 react-router 6.4 data API。
6. **缺 ErrorBoundary** —— 单点抛错白屏，无降级。
7. **缺自动化测试** —— 完全无前端测试、Rust 测试也仅限 scan/metadata/limiter 子系统。
8. **commands.rs 单文件 4538 行** —— 强烈建议按子系统拆分（library_cmds、scan_cmds、launch_cmds、metadata_cmds、settings_cmds）。
9. **Tauri command 路径白名单缺位** —— 多个 IPC 接受任意 PathBuf 仅 `is_dir()`。应在 `commands` 层加 `scan_roots_contains_or_subpath()` 守卫。
10. **HTTP / DB / Cache 客户端复用** —— bangumi/vndb 每次 build 新 reqwest::Client；前端 dbPromise 一旦失败不恢复。

## 整体评价

- **代码风格与命名一致性**：好。snake_case wire / camelCase invoke 约定 23 个前端 lib 文件无例外；Rust 模块划分清晰，scan/metadata/ingest/limiter/launch 子模块各司其职。
- **类型纪律**：前端 TS 整体良好，业务组件层有少量 any/as 滥用。
- **SQL 安全**：rusqlite 全部走 bind，未见拼接漏洞（一处 whitelist + format! 写法虽安全但脆弱）。
- **最严重的真实 bug 集中在 launch 子系统的 abort 路径** —— `tokio::spawn + AtomicBool + std::sync::Mutex` 在 cancel 路径上语义易错，建议改用 `tokio::sync::Notify` + 显式 cancel token，并补集成测试。
- **第二大风险面是 React StrictMode + Tauri listen** —— 4 个 Critical 全是同一 pattern，单点抽 hook 即批量修复。
- **第三大风险面是 IPC 入参缺路径白名单** —— defense-in-depth 缺位，攻击门槛低但影响范围大。

## 修复建议优先级

**P0（本周内）**
- Rust CR-01/CR-02（launch 子系统并发与 abort 路径）
- 组件 CR-01（抽 `useTauriListen`，一次性修 4 处订阅泄漏）
- 路由 BL-01（main.tsx 模块级守卫修正）

**P1（两周内）**
- Rust CR-03/CR-04（路径白名单 + reqwest panic）
- 路由 BL-02/BL-03/BL-04（Detail/Persons 数据流重构）
- 组件 CR-02..CR-07
- Warning 中影响安全的几条（portrait_cache SSRF、cover 大小限制、SearchBar Ctrl+K 隔离）

**P2（迭代清理）**
- commands.rs 拆分
- router lazy import
- 抽 SafeImage、safeInvoke、ErrorBoundary
- 加最小可行测试基线（先覆盖 launch / metadata / advancedFilter）

## 参考报告

完整发现请见对应子报告：

- [REVIEW-rust.md](REVIEW-rust.md) —— Rust 后端 28 文件
- [REVIEW-frontend-lib.md](REVIEW-frontend-lib.md) —— 前端 lib/store/hooks 23 文件
- [REVIEW-components.md](REVIEW-components.md) —— 业务 React 组件 36 文件
- [REVIEW-routes.md](REVIEW-routes.md) —— 路由与入口 10 文件
