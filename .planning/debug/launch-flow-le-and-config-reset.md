---
slug: launch-flow-le-and-config-reset
status: fix-applied
trigger: 启动流程双 BUG — 1) 日区 LE 启动无反应（点击后游戏进程未拉起） 2) 启动配置保存后被重置回旧值
created: 2026-05-26
updated: 2026-05-26
---

# Debug Session: 启动流程双 BUG（LE 不启动 + 启动配置不持久化）

## Symptoms

### Bug A — 日区 LE 启动无反应
- **Expected**: 详情页点击"日区 LE 启动"按钮后，Locale Emulator 应以日区 locale 拉起游戏可执行文件，游戏窗口出现。
- **Actual**: 点击按钮无反应，没有窗口弹出，没有 LE 弹窗，没有可见错误提示。
- **Status**: 代码级根因证据不足；本次提交补 console 日志为下一次真机验证做铺垫。

### Bug B — 启动配置保存后被重置
- **Expected**: 详情页"启动配置"标签更改启动方式 / 参数 / cwd / exe 路径，保存后再次进入应保持。
- **Actual**: 保存后再次进入，启动方式回到默认日区 LE，args / cwd 都被清空。
- **Status**: ROOT CAUSE FIXED — 已 apply 代码修复，待用户真机验证。

## Root Cause — Bug B

**保存路径完全正确，问题是读路径漏字段**。

`update_game_launch_config`（`src-tauri/src/commands.rs:2451-2478`）的 `UPDATE games SET le_profile = COALESCE(?, le_profile), launch_args = COALESCE(?, launch_args), cwd = COALESCE(?, cwd), executable_path = COALESCE(?, executable_path) WHERE id = ?` 是对的，DB 里确实写进去了。

但下游读链路一整套都漏了 `le_profile / launch_args / cwd` 三列：

| 位置 | 文件:行 | 漏了什么 |
|---|---|---|
| Rust `Game` struct | `src-tauri/src/commands.rs:2054-2093` | 三个字段没声明，序列化到前端的 JSON 自然没这三个 key |
| `list_games` SELECT | `src-tauri/src/commands.rs:2108-2115` | 列没选 |
| `get_game` SELECT | `src-tauri/src/commands.rs:2139-2146`（Detail 页 refreshGame 路径） | 列没选 |
| `search_games` SELECT | `src-tauri/src/commands.rs:2773-2781` | 列没选 |
| `row_to_game` | `src-tauri/src/commands.rs:2160-2192` | 没映射三列 |
| 前端 `Game` interface | `src/lib/games.ts:24-101` | 字段没声明 |
| 前端读路径 | `src/routes/Detail.tsx:507-517` | 用 `as Game & LaunchExtras` cast 蒙混过去，但实际 JSON 永远没这几个字段 |

每次进 Detail 页 → `refreshGame` → `getGame` → 返回的 JSON 没有 `le_profile/launch_args/cwd` → `x.le_profile` = `undefined` → `leProfileToMethod(undefined)` 回落到默认 `"le-jp"`，`args/cwd` 也都回落到 `""`。这正是用户看到的"保存后被重置"。

schema v3（`src-tauri/migrations/0003_add_launch_and_session_status.sql:9-11`）很久前就加了这三列，所以是一处长期欠账，不是新引入的回归。

## Root Cause — Bug A

**代码证据不足，无法定到一处具体根因。** 已排除的几种可能：
- ❌ 同根于 Bug B：`executable_path` 列 `get_game` 是读了的，不会丢；走 LE 启动需要的是 DB 里的 `executable_path`，不是 UI 状态。
- ❌ 后端吞了错误：`launch_game` 命令是 `Result<_, String>`，所有 LE / spawn / IO 错误都 `map_err(err_str)?` 上抛到前端，前端 catch → `toast.error`。
- ❌ IPC 命名不匹配：Tauri 2.x camelCase ↔ snake_case 默认转换正常。

剩余可能（按概率排）：
1. **`game.executable_path == null` → LaunchButton disabled → 主按钮点击 onClick 根本不触发**（最常见的"无反应"）。判定：disabled 按钮视觉上半透明 + 有 `disabledTitle` tooltip，用户可能没注意。
2. **用户点的是 popover 内"日区 LE 启动"菜单项**（只切 launchMethod state，不启动），而不是 hover 展开的圆形主按钮。判定：UX 上确实有歧义。
3. **LE 路径解析或 spawn 失败但 toast 错过**。判定：后端 `[launch]` 前缀日志已存在，真机看 stderr 即可。

本次提交：在 `onLaunchClick` 入口/成功/失败三处补 `console.info / console.error`，让用户真机验证时能在 DevTools 拿到第一手证据决定走哪条排查路径。

## Hypothesis — 双 BUG 同根？

**否**。两 bug 独立：Bug B 是 read 漏列，Bug A 在 Bug B 修复后仍然可能出现（disabled button / UX 误操作 / spawn 失败），需要真机日志。

## Evidence

- timestamp: 2026-05-26 — user report: 点击日区 LE 启动后无任何反应
- timestamp: 2026-05-26 — user report: 启动配置保存后再次进入被还原
- timestamp: 2026-05-26 — code: `src-tauri/src/commands.rs` `pub struct Game` 缺三字段，三处 SELECT 漏列，`row_to_game` 漏映射 → Bug B 决定性证据
- timestamp: 2026-05-26 — code: `update_game_launch_config` UPDATE + COALESCE 正常 → 保存写入是对的，"被重置"是读不出
- timestamp: 2026-05-26 — code: schema v3 migration 早已加列，是 read 路径长期欠账
- timestamp: 2026-05-26 — verify: cargo check 通过（无新增 warning）；tsc --noEmit 通过；cargo test 失败 1 项 `http_safe::tests::rejects_ip_literals` 与本次改动无关（baseline 也失败）

## Eliminated

- update 路径错误 — `update_game_launch_config` 的 UPDATE + COALESCE 是对的
- IPC 字段命名不匹配 — Tauri 2.x camelCase ↔ snake_case 转换正常
- 表单 controlled/uncontrolled — useState + onChange 正常
- Bug A 同根于 Bug B — `executable_path` 字段 `get_game` 是有读的，Bug B 不影响它
- 后端吞错误 — `Result<_, String>` + `map_err(err_str)?` 全链路向前端 propagate

## Resolution

### Fix Applied

修复 commit 包含三个文件的改动（保持向后兼容；不动 schema）：

1. **`src-tauri/src/commands.rs`** — `pub struct Game` 加三字段（`le_profile: String`，`launch_args: Option<String>`，`cwd: Option<String>`），三个 SELECT (`list_games` / `get_game` / `search_games`) 加列，`row_to_game` 加映射。
2. **`src/lib/games.ts`** — `Game` interface 加三字段（`le_profile: string`，`launch_args: string | null`，`cwd: string | null`）。
3. **`src/routes/Detail.tsx`** — 删掉 `type LaunchExtras = {...}` 这层断言 hack，`refreshGame` 直接读 `g.le_profile / g.launch_args / g.cwd`。同时在 `onLaunchClick` 入口/成功/失败补 `console.info/error` 日志，便于 Bug A 真机验证。

### 真机验证步骤（用户必做）

**Bug B 验证：**
1. `pnpm tauri dev` 起服务。
2. 任一游戏 → 详情页 → "启动配置" 标签。
3. 切换"启动方式"成"直接启动"，填一段 args（如 `-foo bar`），填 cwd，点保存。
4. 切到别的 tab 再切回"启动配置" → 配置应保持。
5. 重启应用 → 同游戏详情页"启动配置"标签 → 配置仍应保持。
6. （可选）DB 验证：`sqlite3 data/galib.db "SELECT id, le_profile, launch_args, cwd FROM games WHERE id = <id>;"` 应能看到刚保存的值。

**Bug A 验证：**
1. 开 DevTools Console（在 Tauri 窗口右键 → Inspect 或 `Ctrl+Shift+I`，取决于 dev 是否启用 webview inspector）。
2. 点击"日区 LE 启动"圆形主按钮（注意是 **44px 圆形主按钮**，不是 popover 里的菜单项 —— popover 里只是切启动方式）。
3. Console 期望看到 `[Detail] onLaunchClick start { ... useLe: true, exePath: ..., ... }`。
4. 成功路径：`[Detail] onLaunchClick spawn ok`，游戏窗口出现，toast 提示。
5. 失败路径：`[Detail] onLaunchClick failed: <error>`，错误内容描述（NotFound / spawn / UAC 等）+ 后端 stderr 里的 `[launch]` 前缀日志，把这两份日志和该游戏的 `SELECT executable_path FROM games WHERE id = <id>` 结果一起反馈。
6. 如主按钮**根本无视觉响应**（cursor 没变手指 / 按钮半透明）：那是 `launchDisabled === true`，原因是 `executable_path` 为 null 或有其他正在运行的会话。请检查 DB 该列。

### 被吞错误补 logging

`onLaunchClick` 已有 `try/catch + toast.error`，本来没吞错误，只是 toast 可能被用户错过。本次新增 console.error 让错误一定留痕。后端链路 (`orchestrator::launch_game` / `process_track::spawn_le` / `le::resolve_le_path`) 本来就有 `eprintln!("[launch] ...")` 日志覆盖，没需要再补。
