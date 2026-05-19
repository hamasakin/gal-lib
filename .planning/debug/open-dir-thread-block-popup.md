---
slug: open-dir-thread-block-popup
status: resolved
trigger: "右键『打开本地文件目录』后，再对同一条目触发『重新匹配元数据』，元数据查询返回结果时仍会再次弹出一个文件管理器窗口。已尝试的修复(quick-260519-21s Task 2)无效。"
created: 2026-05-19
updated: 2026-05-19
---

# Debug Session: 打开目录后线程阻塞 + 元数据查询返回时多弹文件管理器窗口

## Symptoms

**Expected behavior:**
对游戏条目右键「打开本地文件目录」后，再做其它操作（重新匹配元数据 / 进入详情页），不应自动弹出多余的文件管理器窗口，也不应卡 loading。

**Actual behavior:**
手动「打开本地目录」后，**似乎有一个线程被阻塞**。此后：
- 进入详情页会一直显示「加载中」；
- 对同一条目「重新匹配元数据」，**在元数据查询返回结果的那一刻**会自动弹出一个多余的文件管理器窗口；
- 窗口弹出后 loading 才结束、内容才加载进来。
即「多弹的目录窗口」与「被阻塞的线程终于放行 / loading 完成」是同时发生的。

**Error messages:**
无报错信息（用户未报告控制台错误）。

**Timeline:**
长期存在的问题。quick-260519-21s Task 2 曾尝试修复但**无效** —— 见下方 Eliminated。

**Reproduction:**
1. 对某游戏条目右键 →「打开本地文件目录」（文件管理器打开游戏目录）。
2. 再对同一条目「重新匹配元数据」（或进入该条目详情页）。
3. 元数据查询返回结果时，自动弹出一个多余的文件管理器窗口；之后 loading 才结束。

**Reproduction facts (用户确认):**
- 复现入口：用户重新表述为 ——「手动打开目录后好像有线程被阻塞，进入详情页一直加载中，自动弹出一个新目录窗口后才加载进去」。
- 弹窗时机：**元数据查询返回结果时**（不是 picker 打开瞬间，也不是 picker 关闭后）。
- 前置依赖：**必须先「打开本地目录」**；不先打开目录、直接重新匹配元数据 → **不会弹**。
- 重复行为：多弹的目录窗**只弹一次**，连续重复操作不叠加。

## Eliminated

- hypothesis: 「Radix 菜单项 onClick 在 Dialog 关闭 onCloseAutoFocus 焦点恢复时被重放，导致『打开目录』onClick 二次触发」
  - 失败的修复 (quick-260519-21s Task 2)：把 GameCard `ContextMenuItem` / Detail `DropdownMenuItem` 的 `onClick` 改为 Radix `onSelect`，并给 MetadataPicker 的 `DialogContent` 加 `onCloseAutoFocus={(e)=>e.preventDefault()}`。
  - 结果：用户反馈「还是会重放打开目录」。前端菜单/Dialog 焦点链路修改**无效** → 根因不在前端 Radix 交互层。

- hypothesis（Cycle 2 排查后排除）：「『打开 Detail 详情页』或『触发匹配元数据』流程中存在第二处真实 invoke `open_in_explorer` / `open_path` 的代码路径」
  - 排查：grep 枚举全部前端调用点 —— `openGameDir` 仅 3 处（`GameCard.tsx:265`、`Detail.tsx:832`、`Screenshots.tsx:164`），全部位于显式 onClick 处理器内，无任何 `useEffect` / `listen(` / `addEventListener` 与「打开目录」相关。后端 grep `opener()` —— 仅 `open_path_impl`（目录/文件）与 `open_external_url`（仅 http url）两处，无重放机制。GameCard 右键菜单「重新匹配元数据」调 `onPickMetadata(game)`，不碰 `openGameDir`。
  - 结论：**不存在第二次 invoke**。「弹第二个窗口」并非二次调用，而是**单次 invoke 内部、被搁置的 shell 窗口创建消息延迟兑现**。

## Investigation Leads

调试代理应优先排查**后端线程模型**，而非前端。（已完成 —— 见 Evidence。）

## Evidence

- timestamp: 2026-05-19 — `open_in_explorer` 与 `open_path` 命令均定义为**同步 `pub fn`**（非 `async fn`），见 `src-tauri/src/commands.rs:3374` 和 `:3382`，两者都委托 `open_path_impl`（同步 `fn`，`commands.rs:3386`）。Tauri 2.x 中用 `fn`（非 `async fn`）声明的命令**在主线程上同步执行**（主线程承载 WebView 事件循环 / 窗口消息泵）。
- timestamp: 2026-05-19 — `open_path_impl` 调用 `app.opener().open_path(path, None)`。`tauri-plugin-opener` v2.5.4 的 `open_path(None)` → `open` crate 的 `that_detached`（见 `tauri-plugin-opener-2.5.4/src/open.rs:54-61`）。
- timestamp: 2026-05-19 — `tauri-plugin-opener` v2.5.4 的 `Cargo.toml:59-61` 为 `open` crate 开启了 `features = ["shellexecute-on-windows"]`。因此 `that_detached` 对**目录**走 `shell_open_folder` 分支（`open-5.3.4/src/windows.rs:40-78`），其内部执行 `CoInitialize(NULL)` 把当前线程 COM 初始化为 STA，再同步调用 `ILCreateFromPathW` + `SHOpenFolderAndSelectItems`。
- timestamp: 2026-05-19 — `shell_open_folder`（`open-5.3.4/src/windows.rs:69-80`）的 `CoInitialize` **没有配对的 `CoUninitialize`**（函数返回前只 `ILFree`），在调用线程留下未平衡的 STA apartment 初始化引用计数。
- timestamp: 2026-05-19 — 前端调用链确认无关：`openGameDir`（`src/lib/games.ts:172`）正常 `await invoke("open_in_explorer", { path })`，GameCard / Detail / Screenshots 调用方均正确 `await`，无未 resolve 的 promise。问题纯在后端命令的线程模型。
- timestamp: 2026-05-19 (Cycle 2) — grep 全量复核：前端 `openGameDir` 仅 3 处，全在 onClick 内；无 effect / `listen(` / `addEventListener` 触发它。后端仅 `open_path_impl` 一处经 opener 打开目录/文件。**确认不存在第二次 invoke** —— 弹窗不是「再次调用」，是「同一次调用里被延迟兑现的 shell 窗口消息」。
- timestamp: 2026-05-19 (Cycle 2) — 阅读 `open-5.3.4/src/windows.rs:40-66` `that_detached`：目录分支先 `shell_open_folder`，失败才落 fallback `ShellExecuteExW(EXPLORE)`。`SHOpenFolderAndSelectItems` 在 **STA apartment** 上是「投递窗口创建到该 STA 线程消息队列」的语义；真正的窗口要等该线程**抽取消息泵**才出现。
- timestamp: 2026-05-19 (Cycle 2) — Cycle 1（commit 775e4f0）把整个 opener 调用挪进 `tauri::async_runtime::spawn_blocking`。**这只是把 bug 从 Tauri 主线程平移到了 Tokio blocking 线程池线程**：① `CoInitialize` 仍在调用线程留下永久脏 STA，且 Tokio blocking 线程会被**复用**；② `spawn_blocking` 闭包返回后该线程回池待命、**不抽消息泵**，投递给 STA 的窗口创建消息被搁置。
- timestamp: 2026-05-19 (Cycle 2) — `refresh_metadata_smart`（`commands.rs:1428` 起）是 `async fn`，内部 `tokio::spawn` + `JoinSet` 并发跑 SQLx 查询 + Bangumi/VNDB HTTP。SQLx / 同步收尾工作会调度到**同一个 Tokio runtime 的 blocking 线程池**。当某个元数据子任务命中此前被「打开目录」污染过的那条 blocking 线程时，该线程被唤醒执行代码、间接驱动其 STA，**搁置已久的 Explorer 窗口创建消息此刻才兑现** —— 表现为「元数据查询返回的那一刻多弹一个目录窗」。
- timestamp: 2026-05-19 (Cycle 2) — 该机制精确吻合全部观察事实：①「必须先打开过目录」——只有真实「打开目录」会 `CoInitialize` 污染 blocking 线程并留下搁置消息；不打开目录则无脏 STA、无搁置消息。②「只弹一次」——搁置的窗口创建消息只有一条，被兑现一次即清空。③「与 loading 完成同时发生」——Cycle 1 已消除主线程阻塞，loading 不再卡；但弹窗时机仍绑定在「blocking 线程被元数据任务再次唤醒」这一刻。

## Cycle 1 复盘 —— 部分修复（commit 775e4f0：阻塞消除，弹窗未根除）

> 用户实测 commit `775e4f0`（open_in_explorer/open_path 改 async + spawn_blocking）后：
> 主线程阻塞确实消失了 —— 详情页**不再卡 loading**。
> 但**打开详情页 / 匹配元数据时仍会自动弹出一个新目录窗口**。
>
> → Cycle 2 结论：Cycle 1 没有真正消灭弹窗，只是把「脏 STA + 搁置 shell 消息」
> 从 Tauri 主线程平移到了 Tokio blocking 线程池线程。COM 套间和它的待处理
> 窗口创建消息只是换了个宿主线程，弹窗机制完全不变。

## Cycle 2 Resolution（已应用 —— 根除弹窗，commit 待提交）

**root_cause:**
弹「第二个目录窗口」不是任何一处的二次 invoke，而是**同一次「打开目录」调用内部、被搁置的 Windows shell 窗口创建消息延迟兑现**。链路：`open_path` → `tauri-plugin-opener` → `open` crate `that_detached` → 目录分支 `shell_open_folder`（`open-5.3.4/src/windows.rs:69-80`）。`shell_open_folder` 调用 `CoInitialize(NULL)` 把**调用线程**初始化为 STA apartment 却**永不 `CoUninitialize`**；`SHOpenFolderAndSelectItems` 在 STA 上的语义是把真正的窗口创建**投递到该线程的消息队列**，需该线程抽消息泵才兑现。Cycle 1 把调用挪进 `spawn_blocking` 只是把这条脏 STA 从 Tauri 主线程平移到了一条**会被复用**的 Tokio blocking 线程；`spawn_blocking` 闭包返回后该线程回池、不抽消息泵，投递的窗口创建消息被搁置。随后 `refresh_metadata_smart` 的 SQLx/HTTP 收尾工作调度回同一条 blocking 线程、唤醒它执行代码并间接驱动其 STA，搁置已久的窗口创建消息此刻兑现 —— 这就是「元数据查询返回时多弹一个目录窗、只弹一次、必须先打开过目录才复现」的完整成因。

**fix:**
（已应用，`src-tauri/src/commands.rs` `open_path_impl`）
- **目录**（Windows）：彻底绕开 `tauri-plugin-opener` / `open::that_detached` 那条有缺陷的 `shell_open_folder` 路径，改为直接 `std::process::Command::new("explorer.exe").arg(path)` 启动一个独立的 explorer 子进程，并加 `creation_flags(DETACHED_PROCESS = 0x8)` 让子进程与本进程不共享 console / 句柄。`explorer.exe` 自带独立进程与自己的消息泵 —— 窗口在 explorer 进程内创建，**不会 COM 初始化我们的任何线程**，`spawn()` 返回即完全 detach，不 `wait()` / 不检查退出码（explorer 正常退出码也常为非零）。
- **文件**及**非 Windows 平台**：保留原 `app.opener().open_path(path, None)` 路径 —— 该分支不进入 `shell_open_folder`、不碰 COM。
- `open_in_explorer` / `open_path` / `open_path_offthread` 仍为 `async fn` + `spawn_blocking`，保留 Cycle 1 「不占用主线程」的收益（`explorer.exe` 的 `spawn()` 虽快也仍是阻塞 syscall）。
- 命令注册（`lib.rs:250-252`）与前端 `openGameDir` / `openPath`（`src/lib/games.ts`）无需改动。
- 验证：`cargo check`（src-tauri）通过，0 错误（仅 5 个与本修复无关的既有 warning：metadata/mod.rs 未用 import、title_clean.rs 多余 mut、ingest.rs 未读字段、orchestrator/types.rs 未构造变体）。
- 说明：调试代理无法运行 GUI，无法实机验证多弹窗是否消除；需用户手动按 Reproduction 步骤回归确认 —— 先「打开本地目录」，再「重新匹配元数据」/ 进详情页，确认**不再弹出多余窗口**且 loading 正常结束。
