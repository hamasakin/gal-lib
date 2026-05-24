---
status: issues_found
scope: Rust 后端 (src-tauri/src)
files_reviewed: 28
depth: standard
findings:
  critical: 4
  warning: 14
  info: 8
  total: 26
---

# Rust 后端代码审查

## 关键问题（Critical）

### CR-01 强制结束后截屏任务永远不会停止
- 位置：`src-tauri/src/launch/orchestrator.rs:258-281`（wait task）配合 `283-321`（screenshot task）
- 问题：截图任务依赖 `cancel_for_wait` AtomicBool 来停止；该 flag 只在 wait task 的两个 `match pid_resolved` 分支里被 `store(true)`。**但 `end_active_session` 通过 `entry.task.abort()` 触发 abort 时，`tokio::spawn` 内的 future 直接被 drop —— `cancel_for_wait.store(true, Ordering::Relaxed)` 这一行永远不执行**。
- 影响：用户点「强制结束」后，screenshot 后台任务仍每隔 `interval_sec` 秒抓屏 + 写入 DB + 写盘，直到 OS 杀进程或 app 退出。这是隐私问题（用户以为已停 = 还在录）+ 磁盘占用问题。verify：abort 路径不走 `session::end_session`，而 `end_active_session` 调用 `cancel_session` 直接走 DB，但不接触 `cancel_flag`。
- 建议：把 `cancel_flag` 从 wait task 内部状态升级为 `LaunchHandle` 的第四个字段，让 `end_active_session` 在调 `entry.task.abort()` 之前先 `cancel_flag.store(true, Ordering::Relaxed)`；或者改成 `tokio::select!` 让 screenshot loop 同时 await `cancel_flag` 通知（用 `tokio::sync::Notify`）和 `iv.tick()`。

### CR-02 `launch_game` session-already-active 检查存在 TOCTOU 竞态
- 位置：`src-tauri/src/commands.rs:2061-2099`
- 问题：第一段 lock + `is_some()` 检查后立刻 drop guard（行 2069），然后调用 `orchestrator::launch_game(...).await`（耗时 ~1s — 含 LEProc spawn / find_game_pid），最后再次 lock 并 `*g = Some(...)`（行 2095）。两个并发 `launch_game` IPC 都能通过第一次 `is_some()` 检查，然后两个 LE 进程都被 spawn，第二个写入会覆盖第一个 `ActiveSessionEntry`，第一个 wait task 的 `JoinHandle` 与 `AbortHandle` 永远不会再被引用 —— 第一个进程在前端「强制结束」时无法被 cancel，必须等其自然退出才会 watcher fire 并 emit null（但状态已不一致）。
- 影响：用户连点两次「启动」会同时开两份游戏 + 第一份游戏的 active session 不可控（强制结束按钮只能终止第二份）。
- 建议：把检查 + spawn + 写入 state 合并到一段持续持锁 + `tokio::sync::Mutex` 的 critical section（不能用 `std::sync::Mutex` 因为含 `.await`）；或者用 `try_insert` 模式 —— 先 lock 写一个 placeholder（如 `Pending` 状态），如果已有就立刻返回 Err，否则 release lock 启动 orchestrator，成功后再 lock 升级为 `ActiveSessionEntry`。

### CR-03 `restore_removed_dir` 与 `add_game` 接受任意路径，可注册系统目录为游戏
- 位置：`src-tauri/src/commands.rs:1178-1210`（restore_removed_dir）、`906-934`（add_game）、`1003-1068`（split_game_into_subdirs）
- 问题：三个 IPC 都直接接受前端任意 `path: String`，仅校验 `dir.is_dir()` 就把目录写入 `games` 表 + 调用 `pick_best_exe`（递归走全树）。`restore_removed_dir` 额外会从该目录删除 `.gal-lib-removed` 标记文件。没有任何 scan_roots 边界校验 —— 任何 IPC 调用都能传 `"C:\\Windows\\System32"` 把整个系统目录注册为游戏 + 在该目录上跑遍全树 walk + 写入 DB 的 `executable_path`（之后可由 `launch_game` 启动）。
- 影响：受信边界是 Tauri webview，但 (a) 任何 XSS 漏洞会直接升级为系统目录扫描 + 任意 .exe 通过 LE 启动；(b) `restore_removed_dir` 在用户传错路径时静默删除 `.gal-lib-removed`（恶意页面可借此扰乱系统）。`launch_game` 后续的「转区运行」是用户可控的（需点击），但 spawn 路径已可控。
- 建议：在三个 IPC 入口加 scan_roots 包含校验 —— `path` 必须落在某个 `scan_roots.path` 之内（用 `dunce::canonicalize` 后比较 `path.starts_with(root)`），否则返回 Err。`add_game` 也要符合这一约束（用户加目录必须先把父目录加为 scan_root）。

### CR-04 metadata 客户端 `reqwest::Client::build().expect(...)` 会 panic 杀死整个 Tauri 后端
- 位置：`src-tauri/src/metadata/bangumi.rs:41-47`、`src-tauri/src/metadata/vndb.rs:43-48`
- 问题：两个客户端构造器都用 `.expect("reqwest client")` 处理 build 错误。reqwest::Client::Builder 的 build 会失败（系统根证书加载失败、tls 后端初始化失败、某些 Windows 环境下 schannel 不可用等），失败时整个搜索/详情调用 panic。由于这些 fn 是 async 且在 `#[tauri::command]` 调用栈上，panic 会传到 tokio worker thread —— Tauri 的 invoke handler **不捕获 panic**，会直接终止该 task；多次 panic 累积会拖死 runtime worker 池（默认 # cpu 个 worker）；至少表现是「点搜索元数据就掐」。
- 影响：用户系统证书异常 / 防火墙 TLS 拦截下，元数据相关命令全 panic，UI 一片错误且 app 越用越僵。同样 panic 还出现在 `cover_cache::cache_cover` 里 `reqwest::Client::builder()...build()?` —— 该处用 `?` 是正确的，比 metadata client 健康。
- 建议：把 `bangumi::client()` / `vndb::client()` 改成 `Result<reqwest::Client, MetadataError>`，build 失败时返回 `MetadataError::Http(...)` 或新增的 `MetadataError::ClientInit(String)`。更彻底的做法：把 client 提到 `OnceCell<reqwest::Client>` lazy singleton —— 一次构造，全程复用（兼修 IN-05）。

## 警告问题（Warning）

### WR-01 `cover_cache::cache_cover` / `portrait_cache::get_or_fetch` 未限制下载响应大小
- 位置：`src-tauri/src/cover_cache.rs:48-67`、`src-tauri/src/portrait_cache.rs:101-124`
- 问题：`client.get(url).send().await?.error_for_status()?` 之后直接 `resp.bytes().await?` 读完整个响应到内存再写盘。两个 client 都没有 `Content-Length` 上限，也没有流式校验。恶意远端（或 Bangumi/VNDB 主机被劫持）可推送任意大 body。
- 影响：图标/封面下载理论上有 10GB body 攻击窗口；攻陷一个 cover_url 可让 ingest 进程 OOM / 把磁盘灌满。
- 建议：读取前检查 `resp.content_length()`，超过 20 MB 直接 `Err(CacheError::UnsupportedType("oversized"))`；或者改成 `resp.bytes_stream()` 累计字节，超阈值时 `drop(stream)` 立即停止。

### WR-02 `portrait_cache::bangumi_portrait_url` 跟随 API 返回的远端 URL 时未做 scheme 校验
- 位置：`src-tauri/src/portrait_cache.rs:51-72` 配合 `96-126`
- 问题：从 Bangumi `/v0/persons/{id}` 取出 `images.medium` 后直接拼到 `client.get(&remote)` 下载。该 URL 由远端服务器决定 —— 没有 `https?://` 校验。若 Bangumi 被攻陷或返回畸形 JSON（极个别历史接口数据脏），portrait_cache 会发出任意协议请求（`file://`、`gopher://`、内网 `http://10.x.x.x` 等），构成 SSRF。
- 影响：低风险（reqwest 默认禁用大部分非 http/https scheme），但 `127.0.0.1:` / 内网 IP 的 http 请求仍可达。如果用户 LAN 有未鉴权的内网服务，攻陷 Bangumi 可让 portrait_cache 探测内网。
- 建议：在第 96 行 `let remote = ...` 之后加 `if !(remote.starts_with("http://") || remote.starts_with("https://")) { return Ok(None); }`，与 `cover_cache::cache_cover` 第 40 行的 gate 保持一致。

### WR-03 `process_track::find_game_pid` 的 `starts_with(stem)` 兜底匹配过宽
- 位置：`src-tauri/src/launch/process_track.rs:258-273`
- 问题：先做 `name == target_name` exact 匹配，未命中则 `name.starts_with(&target_stem)`。`target_stem` 来自 `game_exe.file_name()` 去掉 `.exe` 后缀；若游戏 stem 是 `g`、`a` 等短串，会匹配到 `gpu.exe`、`audiodg.exe` 等无关系统进程，错误把它们当成游戏进程并附加 `WaitForSingleObject`。`game.exe` 这种常见 stem 会匹配 `game1.exe`、`game-launcher.exe`、`game-editor.exe` 等同 stem 的辅助工具。
- 影响：跟踪到错的 PID → wait_for_exit 永远卡住（系统进程不退出）→ session 永不结束 → playtime 累加到错的进程结束（理论上无穷大）。
- 建议：把 `starts_with(stem)` 收紧到 `name.starts_with(&target_stem) && (name.len() == target_stem.len() || !name.as_bytes()[target_stem.len()].is_ascii_alphabetic())` —— 即要求 stem 后接非字母（数字、`_`、`-`），过滤掉系统进程。或者干脆移除 starts_with 分支，要求精确匹配，让无法识别的 LE 启动直接超时 fail 比错跟踪安全。

### WR-04 `process_track::wait_for_exit` 存在 PID 重用窗口
- 位置：`src-tauri/src/launch/process_track.rs:310-341`
- 问题：`find_game_pid` 返回 PID 后到 `wait_for_exit` 内 `OpenProcess` 之间存在时间窗口（含 `session::mark_running` 的 DB 写入 + tokio task 调度）。若游戏在这一窗口内崩溃 + Windows 重新分配该 PID 给完全无关的进程，`OpenProcess` 拿到的是新进程的 handle，`WaitForSingleObject` 等到那个新进程退出。
- 影响：极小概率但实际存在（特别是 spawn-immediately-crash 游戏 + 高 PID 重用频率系统）。后果是 session 卡在 running 直到误中的新进程退出。
- 建议：在 `find_game_pid` 内就调 `OpenProcess(PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, false, pid)` 拿到 handle 后通过 channel 传给 `wait_for_exit`（持有 handle 时 OS 不会重用 PID）。或者用 `OpenProcessToken` 拿一个 ETW unique process key 做后续核对。

### WR-05 `split_game_into_subdirs` 部分成功时不回滚
- 位置：`src-tauri/src/commands.rs:1003-1068`
- 问题：循环里逐个对 paths 做 `ingest_one_dir(...).await?` —— 任意一个失败就 `?` 早返，前面已成功 INSERT 的 game 行不会 rollback；调用方看到的是「整个分裂失败」，但 DB 里实际已经多了几个子目录条目，**parent games 行不会被删除**（删除发生在循环之后），所以同时存在 N 个孤儿子条目 + 原来 parent 条目。
- 影响：状态不一致；用户重新点「分裂」会因为已有 path 走 ON CONFLICT 分支，效果尚可，但留下了误导性 parent。
- 建议：把整个循环包到 `pool.begin()` 事务里，子目录 ingest 全部成功后再 commit + 删 parent + INSERT skip_dirs；或者先收集 N 个 DiscoveredGame 准备好，再一次性事务化写入。

### WR-06 `bind_metadata` cover_cache 失败时不写入 cover_path，但 SQL 用 COALESCE 保留旧值——首次 bind 也走这条路径
- 位置：`src-tauri/src/commands.rs:1298-1376`
- 问题：第 1353-1376 行 UPDATE 用 `cover_path = COALESCE(?, cover_path)`，绑定上的 `cover_path` 来自 `cache_cover` 调用：成功 → `Some(rel)`，失败 → `None`。注释说「保护已缓存的封面」。但**首次 bind 一个之前从未抓过封面的游戏**时，`cover_path` 列原本就是 NULL；这次 bind 又 cache_cover 失败 → 写入 NULL；之后 `cover_url` 列上有远端 url 但 `cover_path` 永远是 NULL，frontend fallback 到 url 是 OK 但用户每次重启都重新拉远端。
- 影响：UX 退化（无本地缓存），不算 bug 但 cover 缓存失败的根因被掩盖。
- 建议：cover_cache 失败时**也** eprintln 把 url + 错误打到日志（已经做了 in line 1302-1305 — 实际 OK），并在 `bind_metadata` 顶层把 cache_cover 的失败次数计入到一个临时 metric。或者改 UPDATE 为先读现存 cover_path，仅当现存为 NULL 时才用 COALESCE，否则**强制覆盖**（让 bind 行为强一些）。

### WR-07 `clear_all_data` 危险操作没有用户确认 / 鉴权
- 位置：`src-tauri/src/commands.rs:1217-1250`
- 问题：`#[tauri::command]` 任意前端调用就清空 games / sessions / screenshots / save_backups / scan_roots + 删除磁盘上 covers/screenshots/saves/portraits 子目录。命令完全没有「请输入确认串」「需要 admin 标记」之类的二次校验。
- 影响：UI 误点（或前端 BUG 调用错命令）→ 整个库一次性被擦掉，无 undo。
- 建议：要求 `confirm_token: String` 参数，必须是 `"yes-erase-everything"` 之类的固定字符串才执行；或者添加 `clear_all_data_dry_run` 先返回会清的统计，让前端二次确认。

### WR-08 SQL 中 `format!("g.status = '{}'", status)` 等字符串拼接虽 whitelist 但脆弱
- 位置：`src-tauri/src/commands.rs:2465`（status）、`2478-2481`（year_decade）、`2533-2538`（custom_view_id）、`2447-2452`（tag_id）
- 问题：注释说「i64 inline interpolation is injection-safe (numeric type)」是对的，但 status 是 `String`，虽然第 2456-2464 做了 whitelist `unplayed|playing|cleared|dropped` 才进 `format!`，问题在：(a) whitelist 与 SQL 拼接代码分离，未来增加新枚举值时若忘记 whitelist 就成注入；(b) `format!` 拼接整数也无技术理由不用 `bind` —— 现有代码混合 bind + 拼接，可读性差，维护时易踩雷。
- 影响：当前安全，将来易出注入。
- 建议：全部统一改成 `bind`（即便整数）；如果非要拼接，加 `debug_assert!` 校验 status 在 whitelist 内（同一个数组），或者用 sqlx 的 `query_as!` 在编译期生成 SQL。

### WR-09 `start_scan` 的 ScanState ctx 写入未在退出前清理
- 位置：`src-tauri/src/commands.rs:516-520`、`603` 起的 spawned task、`874-875` 结束
- 问题：`start_scan` 把 fresh `ScanContext` 写到 `scan_state.ctx`，但 spawned task 完成（或被 cancel）后**从未把 `ctx` set 回 None**。后续 `cancel_scan` 会对这个已经完成的 ctx 上 cancel flag store(true)，flag 永远没人读 —— 之后调用新的 `start_scan` 会覆盖 ctx，问题不大；但若用户从未再触发新 scan，`cancel_scan` 看上去「成功」实际上是 noop，**前端 UX 误判**。`refresh_metadata_smart` 同样有这个 issue（行 1532-1539）。
- 影响：cancel_scan 在「已无 scan running」时不报错，前端无从判断是真的没在跑还是 cancel 失败。
- 建议：spawned task 在末尾（终态发射 scan-progress 之后）写一句 `scan_state.ctx.lock().unwrap().take()` 把 ctx 清空。或者在 `cancel_scan` 内对比 ctx 的 lifetime token 与当前是否匹配。

### WR-10 `commands.rs::launch_game` watcher task 用 `try_state` 但状态可能已被换
- 位置：`src-tauri/src/commands.rs:2109-2119`
- 问题：watcher task awaits `join`，然后 `app_for_watch.try_state::<ActiveSessionState>()` 拿到 state 后无条件 `*g = None`。如果在 join 完成前用户已调 `end_active_session`（已 take 走 entry）并立刻 `launch_game` 启动了新一局，那么 watcher 会把新一局的 `ActiveSessionEntry` 清掉，并发出 `null` —— 但游戏其实还在跑。
- 影响：双 launch 边缘情况下（已被 CR-02 覆盖）+ 快速 end-then-launch 时序，UI 失去 active session 显示，但底层 session 仍在 DB 里运行；进程退出时第二个 watcher fire 又 set None。最终状态正确，但中间 UI 闪烁。
- 建议：watcher 把自己 spawn 时的 session_id 闭包捕获，set None 前对比 `g.as_ref().map(|e| e.session.session_id) == Some(my_session_id)` —— 仅当当前 entry 还是「我」时才清。

### WR-11 `start_scan` 内嵌的 INSERT placeholder + spawn loop 无回退机制
- 位置：`src-tauri/src/commands.rs:698-715`（placeholder 批 INSERT）
- 问题：在 spawned task 内对每个 discovered dir 调用 `insert_placeholder_dir`，失败「per-row swallowed」（注释 line 671-674），但**也不重试**。一旦某些 dir 因 disk full / DB lock 失败，之后的 ingest loop 调 `insert_placeholder_dir` 再 retry（idempotent ON CONFLICT），但若失败原因是持续性的（如 lock），整个 dir 直接被跳过 — 没有任何错误事件发到前端，用户看到完成进度但少几个游戏。
- 影响：用户找不到「为什么有几个游戏没出来」，且没有日志可查（仅一行 `.is_ok()` 静默吞掉）。
- 建议：把 `is_ok()` 改成 `match ... { Err(e) => eprintln!("[start_scan] placeholder INSERT failed for {}: {}", dg.path.display(), e), Ok(_) => ... }`；或者把失败 dir 收集成 vec，最终 scan-progress 发射时把 failed 数量一并带出。

### WR-12 `process_track::spawn_le` 在 ShellExecuteExW 失败时未释放进程 handle
- 位置：`src-tauri/src/launch/process_track.rs:161-201`
- 问题：第 173 行调 `ShellExecuteExW(&mut info)`，若返回 Err 但 `info.hProcess` 已被部分填充（依 MSDN，错误时 hProcess 通常无效或不应使用，但**存在驱动/shell 扩展行为差异**），我们的代码在错误分支早返（行 174-177），**未 `CloseHandle(info.hProcess)`**。同样第 192-198 行 `pid == 0` 分支也早返，**漏掉 CloseHandle**（注意此时第 190 行已经 CloseHandle 过 — 实际上行 190 永远会执行，因为它在 `if pid == 0` 之前。**重读**：行 190 `let _ = unsafe { CloseHandle(info.hProcess) };` 在 pid 检查**之前**，所以这里 OK。但行 174-177 的 `exec_result` Err 分支仍可能漏关 handle）。
- 影响：handle leak（每次 UAC 拒绝 / ShellExecute 失败 累积一个未关闭的进程 handle）；handle 表是有限的，长期运行可耗尽。
- 建议：在 `if let Err(e) = exec_result` 分支里也加 `if !info.hProcess.is_invalid() { let _ = unsafe { CloseHandle(info.hProcess) }; }`；或者用 RAII 包装 SHELLEXECUTEINFOW 让 Drop 自动关闭。

### WR-13 `save_backup::create_backup` strip_prefix.unwrap() 在 symlink 上可能 panic
- 位置：`src-tauri/src/save_backup.rs:87`、`128`
- 问题：`entry.path().strip_prefix(src).unwrap()` 假设 WalkDir yield 的路径必然以 src 为前缀。若 src 是 symlink 到别处，且 WalkDir 默认 `follow_links(false)` 看到 symlink 本身（其 path 仍以 src 为前缀），OK；但若中间某层是 symlink 解析（`canonicalize` 行为），unwrap 可能 panic。
- 影响：低概率 panic，整个 backup 命令崩溃；调用方看到的是 thread panicked / opaque error。
- 建议：换成 `.ok_or_else(|| SaveError::Io(io::Error::other("strip_prefix mismatch")))?`，让错误正常传播。

### WR-14 `launch::le::resolve_le_path` 持久化路径时 unwrap serde_json::to_string_pretty
- 位置：`src-tauri/src/launch/le.rs:136`、`158`
- 问题：`fs::write(&cfg_path, serde_json::to_string_pretty(&cfg).unwrap())?` — `to_string_pretty` 在 cfg 是普通 Value 时不会失败，但若未来 cfg 出现 Map 中含 NaN/Infinity 之类的 `f64` 即会失败，整个 `set_le_path` panic。
- 影响：低风险（当前只写 Object 含 String），但 unwrap 在文件写入路径上不应该出现。
- 建议：用 `serde_json::to_string_pretty(&cfg).map_err(|e| LeError::Io(io::Error::other(e)))?`。

## 提示问题（Info）

### IN-01 metadata 客户端每次调用都新建 reqwest::Client（无连接池复用）
- 位置：`src-tauri/src/metadata/bangumi.rs:41-47`、`src-tauri/src/metadata/vndb.rs:43-48`、`src-tauri/src/cover_cache.rs:44-47`、`src-tauri/src/portrait_cache.rs:54-58`、`101-105`
- 问题：5 个 client 工厂函数；每次 search / fetch_detail / cache_cover / portrait fetch 都重新走完整的 TLS 握手 + DNS 查询 + builder 构造。
- 影响：每个元数据查询多出 50-200 ms TLS 握手成本，加重对 Bangumi/VNDB 的连接建立频率（虽然 limiter 限了请求频率，但 TLS 资源照样消耗）。
- 建议：升级为 `once_cell::sync::Lazy<reqwest::Client>` 全局单例（每个 host 一个 Client 即可：bangumi/vndb 一个、image-cache 共用一个）。同时收益于 connection pooling。

### IN-02 `commands.rs` 单文件 4538 行
- 位置：`src-tauri/src/commands.rs`
- 问题：所有 70+ tauri::command 都堆在一个文件里，按主题混排（scan / metadata / launch / tags / screenshots / save_backups / custom_views / review_queue）。已经超过任何编辑器在屏幕上能舒服阅读的长度，新增功能时易在错误位置 append。
- 影响：可维护性持续退化，code review 困难。
- 建议：按模块拆分 —— `commands/scan.rs`、`commands/metadata.rs`、`commands/launch.rs`、`commands/library.rs`、`commands/screenshots.rs`、`commands/saves.rs`、`commands/views.rs`、`commands/review.rs`，每文件 < 600 行。helper（`err_str` / `row_to_game` / `apply_ingest_result`）拎到 `commands/util.rs`。

### IN-03 `insert_placeholder_dir` 覆盖已 manually-bound 行的 name
- 位置：`src-tauri/src/commands.rs:134-148`
- 问题：`ON CONFLICT(path) DO UPDATE SET name=excluded.name, executable_path=excluded.executable_path`。incremental 模式下 existing_paths 应已过滤了 bound 行，但 `add_game` 直接调 `ingest_one_dir` → `insert_placeholder_dir`，如果用户 add_game 一个已经在库且 metadata_source='manual' 的 path（罕见但可能 — 比如手动 remove 后重新加），manual 改名会被磁盘 raw_name 覆盖。
- 影响：用户改的名字（含 manual rename）丢失。
- 建议：DO UPDATE SET 加 `WHERE metadata_source IS NULL OR metadata_source = 'none'`，或者 add_game 路径用单独的 INSERT（无 ON CONFLICT）让重复 path 返回 Err。

### IN-04 `launch::session::elapsed_since_start` 在 started_at 解析失败时静默 fallback
- 位置：`src-tauri/src/launch/session.rs:194-203`
- 问题：`chrono::DateTime::parse_from_rfc3339(&row.0)` 失败时 `.unwrap_or_else(|_| chrono::Utc::now())` —— 把 started 视为「现在」，得到 0 秒 elapsed。注释说是「防御 future migration」，但实际任何已写入的 row 都应能解析；如果真的解析失败，说明 DB 已被外部修改 / 损坏，**应当报错而不是默默把 playtime 计为 0**。
- 影响：DB 损坏时静默丢失播放时长。
- 建议：fallback 改成 return `Err(SessionError::Db(sqlx::Error::Decode(...)))`，让上层显式知道时间无法计算。

### IN-05 `commands.rs::open_in_explorer` 与 `open_path` 完全同名功能两个 IPC
- 位置：`src-tauri/src/commands.rs:3510-3521`
- 问题：两个 #[tauri::command] 都调用 `open_path_offthread(...)`。注释说 `open_in_explorer` 保留是 backward compat。但 invoke_handler 同时注册两个名字，前端两条调用路径并存，长期会让 frontend 代码分叉。
- 建议：保留 `open_path` 为唯一权威；`open_in_explorer` 加 `#[deprecated]` 属性 + 注释指明 ETA 移除 phase。

### IN-06 `metadata::bangumi::with_retry` 与 `metadata::vndb::with_retry` 复制粘贴
- 位置：`src-tauri/src/metadata/bangumi.rs:368-395` 与 `src-tauri/src/metadata/vndb.rs:364-395`
- 问题：两个文件的 `with_retry` 实现几乎一致，只 delays 数组不同（bangumi `[1s,2s,4s]` vs vndb `[2s,5s,10s,20s]`）。代码、bound、retry 判定逻辑都重复。
- 建议：提到 `metadata/retry.rs` 模块，签名 `pub async fn with_retry<F, Fut, T>(delays: &[u64], f: F) -> Result<T, MetadataError>`，两个 client 各自传入自己的 delays 数组。

### IN-07 `data_dir::ensure_default_config` 写入的 JSON 在 le_path 是 null 时与后续 set_le_path 字符串写入混搭
- 位置：`src-tauri/src/data_dir.rs:20-26` 与 `src-tauri/src/launch/le.rs:149-160`
- 问题：默认 config.json 是手写字符串 `"le_path": null`；set_le_path 通过 serde_json 改写后，会丢掉默认模板的注释 / 字段顺序 / 缩进规则，并新增 `schema_version` 等字段被强制覆盖回原值（如果 cfg 没有 schema_version 字段会被 default 写）。
- 影响：维护性低。
- 建议：把默认 config 改成 `serde_json::json!({...})` 构造 + `to_string_pretty` 写盘，保持读写一致。

### IN-08 `process_track::spawn_le` 的 `_profile` 参数标记为 unused
- 位置：`src-tauri/src/launch/process_track.rs:133-140`
- 问题：函数签名收 `profile: &str` 但第 140 行 `let _ = profile;` 显式丢弃。注释说为 future API compat 保留。但 orchestrator 调用方一直在传 `le_profile` 列值（commands.rs 等 `update_game_launch_config` 路径写入的），这个值从 UI / DB 进来后被沉默忽略，给「设了 profile 但行为不变」的迷惑用户体验。
- 建议：要么真正实现 profile 路径（`-runas <guid>`），要么从 LaunchInputs 移除 le_profile 字段并在 update_game_launch_config 里禁用 UI 控件 + 标 deprecated。

## 整体观察

整体结构清晰，模块划分（`scan` / `metadata` / `launch` / `ingest`）边界合理，dropin 单元测试覆盖了关键的纯逻辑（exe_score、title_clean、match_score、removed_marker、save_backup 等）。SQL 全部走 `bind`（除了已 whitelist 过的少数 `format!`），错误类型用 `thiserror` 显式建模，限流器（`limiter::BANGUMI/VNDB`）选型和 burst=1 的论证有据可循。**做对的部分明显多过做错的部分**。

最严重的实际 bug 集中在 launch 子系统：CR-01（abort 后截屏不停）、CR-02（双 launch race）、WR-03（PID 匹配过宽）、WR-04（PID 重用）、WR-10（watcher 状态覆盖）—— 都源于「`tokio::spawn` + AtomicBool + std::sync::Mutex」这套配合在 abort 场景下的语义边角。建议把 launch 模块的状态机用 `tokio::sync::Notify` + `Arc<tokio::sync::Mutex>` 重写一遍，让 cancel / abort / watcher 三方通信走单一 channel 而非各持 `Arc<AtomicBool>` 推断。

其次是「接受前端任意路径」的几个 IPC（CR-03、WR-07）—— Tauri 的受信边界默认是 webview，但跨 IPC 边界对路径参数做白名单校验是低成本高收益的 defense-in-depth；webview 真出问题（XSS、第三方 webview 漏洞）时这层校验是唯一的护栏。

最后是 `commands.rs` 单文件 4538 行（IN-02）和 reqwest::Client 没复用（IN-01、CR-04 的 `.expect`）—— 都是「技术债积累」而非紧急 bug，但 CR-04 的 panic 路径在用户系统证书异常下会有显式症状，建议优先修。

---

_Reviewed: 2026-05-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
