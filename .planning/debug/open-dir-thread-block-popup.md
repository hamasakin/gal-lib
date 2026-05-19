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

## Investigation Leads

调试代理应优先排查**后端线程模型**，而非前端：

- `open_in_explorer` Tauri 命令（`src-tauri/src/commands.rs:3374`）：是否为同步（非 async）命令？同步命令在 Tauri 中跑在主线程上。`app.opener().open_path()` 在 Windows 上是否阻塞？
- 「重新匹配元数据」对应的 Tauri 命令：是否 async？是否与 `open_in_explorer` 抢同一个 runtime / 线程池 / Mutex？
- 是否存在某个全局 `Mutex` / `RwLock` / 连接池被 `open_in_explorer` 持有未释放。
- 前端 `openGameDir` 调用链：invoke 是否被 await。
- Windows 特有：用 `Command`/`explorer.exe` 打开目录时进程退出码与是否 detach。

## Evidence

- timestamp: 2026-05-19 — `open_in_explorer` 与 `open_path` 命令均定义为**同步 `pub fn`**（非 `async fn`），见 `src-tauri/src/commands.rs:3374` 和 `:3382`，两者都委托 `open_path_impl`（同步 `fn`，`commands.rs:3386`）。Tauri 2.x 中用 `fn`（非 `async fn`）声明的命令**在主线程上同步执行**（主线程承载 WebView 事件循环 / 窗口消息泵）。
- timestamp: 2026-05-19 — `open_path_impl` 调用 `app.opener().open_path(path, None)`。`tauri-plugin-opener` v2.5.4 的 `open_path(None)` → `open` crate 的 `that_detached`（见 `tauri-plugin-opener-2.5.4/src/open.rs`）。
- timestamp: 2026-05-19 — `tauri-plugin-opener` v2.5.4 的 `Cargo.toml:59-61` 为 `open` crate 开启了 `features = ["shellexecute-on-windows"]`。因此 `that_detached` 对**目录**走 `shell_open_folder` 分支（`open-5.3.4/src/windows.rs:40-78`），其内部执行 `CoInitialize(NULL)` 把当前线程 COM 初始化为 STA，再同步调用 `ILCreateFromPathW` + `SHOpenFolderAndSelectItems`。
- timestamp: 2026-05-19 — `shell_open_folder` 的 `CoInitialize` **没有配对的 `CoUninitialize`**（函数返回前只 `ILFree`），在主线程留下未平衡的 COM apartment 初始化引用计数；`SHOpenFolderAndSelectItems` 是同步 shell 调用，在主线程上执行时会占用 / 驱动消息泵 —— 这就是用户感知的「线程被阻塞」。
- timestamp: 2026-05-19 — 「重新匹配元数据」命令 `refresh_metadata_smart`（`commands.rs:1428`）是 `async fn`，跑在 Tokio 线程池。它通过 `app.emit("scan-progress", ...)`（`commands.rs:1461`）发进度事件，事件派发回 WebView 必须经过**主线程事件循环**。主线程被打开目录的同步 shell 调用占用后，详情页 loading 一直挂起，直到元数据命令返回那一刻主线程被冲刷 —— 被搁置的 shell 窗口创建（多弹的 Explorer 窗口）与 loading 完成被同时处理。完全吻合用户观察：「弹窗与 loading 完成同时发生」「只弹一次」。
- timestamp: 2026-05-19 — 前置依赖解释：不先「打开本地目录」就没有 `CoInitialize` + 同步 shell 调用污染主线程 → 元数据查询正常返回、不弹窗、不卡 loading。与「必须先打开目录才复现」精确吻合。
- timestamp: 2026-05-19 — 前端调用链确认无关：`openGameDir`（`src/lib/games.ts:172`）正常 `await invoke("open_in_explorer", { path })`，GameCard / Detail 调用方均正确 `await`，无未 resolve 的 promise。问题纯在后端命令的线程模型。

## Current Focus

- hypothesis: 已确认 —— `open_in_explorer` / `open_path` 是同步命令，在 Tauri 主线程上执行 `tauri-plugin-opener` → `open` crate 的 `shellexecute-on-windows` 路径，其中 `CoInitialize`（无配对 `CoUninitialize`）+ 同步 `SHOpenFolderAndSelectItems` 阻塞/污染主线程消息泵。后续 `refresh_metadata_smart`（async）的事件派发被卡在主线程上，直到查询返回时主线程冲刷，搁置的 Explorer 窗口与 loading 同时被处理。
- next_action: 应用修复 —— 将 `open_in_explorer` / `open_path` 改为 `async fn`，把 shell 调用移出主线程。

## Resolution

**root_cause:**
`open_in_explorer` / `open_path` 定义为同步 Tauri 命令（`pub fn`），因此在主线程（WebView 事件循环 / 窗口消息泵所在线程）上执行；其底层经 `tauri-plugin-opener` → `open` crate 的 `shellexecute-on-windows` 路径，对目录调用 `CoInitialize` + 同步 `SHOpenFolderAndSelectItems`，阻塞并污染主线程。后续 `refresh_metadata_smart`（async）的 `app.emit` 事件派发需经主线程，被卡住直到元数据查询返回时才冲刷 —— 搁置的 Explorer 窗口创建与 loading 完成同时出现，表现为「查询返回时多弹一个目录窗 + 详情页一直加载中」。

**fix:**
（已应用，`src-tauri/src/commands.rs`）
- `open_in_explorer` / `open_path` 由同步 `pub fn` 改为 `pub async fn` —— async 命令跑在 Tokio 线程池，不再占用 Tauri 主线程。
- 新增私有 helper `open_path_offthread(app, path)`：用 `tauri::async_runtime::spawn_blocking` 把实际的 opener 调用（`open_path_impl`，含路径存在性校验 + COM/shell 同步调用）整体搬到专用 blocking 线程执行。即使 `SHOpenFolderAndSelectItems` 阻塞，也只阻塞该 blocking 线程，绝不触碰主线程消息泵。
- `open_path_impl` 函数体未变；命令注册（`lib.rs:250-252`）与前端 `openGameDir`/`openPath`（`src/lib/games.ts`）无需改动 —— `#[tauri::command]` 对 sync/async 生成兼容 handler，前端调用方已正确 `await`。
- 验证：`cargo check`（src-tauri）通过，0 错误（仅 5 个与本修复无关的既有 warning）。
- 说明：调试代理无法运行 GUI，无法实机验证多弹窗是否消除；需用户手动按 Reproduction 步骤回归确认。
