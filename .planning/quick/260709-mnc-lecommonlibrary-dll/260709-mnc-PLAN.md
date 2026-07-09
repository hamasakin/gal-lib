---
phase: quick-260709-mnc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src-tauri/resources/locale-emulator/LECommonLibrary.dll
  - src-tauri/tauri.conf.json
  - src-tauri/resources/locale-emulator/NOTICE.md
  - src-tauri/Cargo.toml
  - src-tauri/Cargo.lock
  - src-tauri/src/lib.rs
autonomous: true
requirements: [LE-FIX-01, SINGLE-INSTANCE-01]

must_haves:
  truths:
    - "捆绑的 Locale Emulator 目录包含 LECommonLibrary.dll，LEProc.exe 不再因 FileNotFoundException 崩溃"
    - "安装包资源清单同时打包 locale-emulator 根文件与 Lang/ 子目录"
    - "同一时刻只能运行一个应用实例，第二次启动会聚焦已有主窗口后退出"
  artifacts:
    - path: "src-tauri/resources/locale-emulator/LECommonLibrary.dll"
      provides: "LEProc.exe 运行所需的托管程序集（官方原版 17920 字节）"
    - path: "src-tauri/tauri.conf.json"
      provides: "resources glob 覆盖 locale-emulator/* 与 locale-emulator/Lang/*"
    - path: "src-tauri/src/lib.rs"
      provides: "tauri-plugin-single-instance 注册为第一个 plugin + 聚焦回调"
  key_links:
    - from: "src-tauri/src/lib.rs"
      to: "tauri_plugin_single_instance"
      via: "Builder::default().plugin(...) 作为首个 plugin"
      pattern: "tauri_plugin_single_instance::init"
    - from: "tauri.conf.json bundle.resources"
      to: "src-tauri/resources/locale-emulator/Lang/"
      via: "显式 glob 条目 resources/locale-emulator/Lang/*"
      pattern: "locale-emulator/Lang"
---

<objective>
修复两个已确诊问题：
1. **转区启动失败** —— 捆绑的 Locale Emulator 漏打包 `LECommonLibrary.dll`，导致 `LEProc.exe` 每次转区启动在 Main 入口抛 `System.IO.FileNotFoundException` 崩溃、游戏进程永不出现。补齐官方原版 DLL，并修复 `bundle.resources` glob 漏打 `Lang/` 子目录的附带问题。
2. **应用可多实例运行** —— 接入 `tauri-plugin-single-instance`，第二次启动聚焦已有窗口后退出。

Purpose: 转区启动是应用核心能力，缺 DLL 直接让「一键转区启动」全线失效；单实例避免用户重复开进程导致 session/DB 竞争。
Output: locale-emulator 目录补齐 DLL、tauri.conf.json 资源 glob 修正、NOTICE.md 清单更新、single-instance 插件接入 lib.rs。

**两个修复各自原子提交：**
- Commit 1（Task 1）: LE DLL 补齐 + resources glob 修正 + NOTICE.md 更新
- Commit 2（Task 2）: single-instance 插件接入
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<constraints>
- 项目用 **pnpm**，不要 `npm install`；Rust 依赖用 `cargo add` 或直接编辑 Cargo.toml。
- **不要改动 `src-tauri/src/launch/` 模块逻辑** —— spawn 链路本身没 bug。
- LECommonLibrary.dll **必须**取自官方 zip（下方 URL），**不要**使用本机 `D:\Locale.Emulator.2.5.0.1\` 里的 DLL（那份被 2025-06 社区补丁改过，非官方原版）。官方原版大小应为 **17920 字节**。
- single-instance 插件 **必须**注册为 `Builder::default()` 的第一个 `.plugin(...)`（官方硬性要求，否则回调不触发）。
- 关闭到托盘逻辑存在（lib.rs:159-167 hide()），聚焦回调里 `show()` 不可省，需 show() + unminimize() + set_focus() 三连。
</constraints>

<interfaces>
<!-- lib.rs 当前 Builder 结构（执行器直接照此改，无需再探索）-->
- 主窗口 label = "main"（tauri.conf.json:16）
- 当前第一个 plugin 是 tauri_plugin_sql（lib.rs:100-104）—— single-instance 必须插到它前面
- 已 `use tauri::{Emitter, Manager};`（lib.rs:21）—— Manager trait 提供 get_webview_window，无需新增 import
- 已有 close-to-tray：main_window.hide() on CloseRequested（lib.rs:159-167）—— 所以第二实例聚焦回调必须先 show() 再 set_focus()

<!-- tauri.conf.json 当前 bundle.resources（tauri.conf.json:45）-->
- 现值: "resources": ["resources/locale-emulator/*"]  —— glob 不递归，漏 Lang/ 子目录
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: 补齐 LECommonLibrary.dll + 修正 resources glob + 更新 NOTICE</name>
  <files>src-tauri/resources/locale-emulator/LECommonLibrary.dll, src-tauri/tauri.conf.json, src-tauri/resources/locale-emulator/NOTICE.md</files>
  <action>
**1a. 下载官方 zip 并提取 LECommonLibrary.dll（仅此一个文件）：**

用 bash 下载官方发行包到 scratchpad，解压出 `LECommonLibrary.dll` 放进 `src-tauri/resources/locale-emulator/`：
```bash
SCRATCH="C:/Users/ADMINI~1/AppData/Local/Temp/claude/D--project-gal-lib/325785ed-bdd0-4149-b85e-58c185da8cf8/scratchpad"
curl -L -o "$SCRATCH/le.zip" \
  "https://github.com/xupefei/Locale-Emulator/releases/download/v2.5.0.1/Locale.Emulator.2.5.0.1.zip"
# 只解出 LECommonLibrary.dll（zip 内路径可能带顶层目录，用 -j 展平后按名取）
unzip -o -j "$SCRATCH/le.zip" "*LECommonLibrary.dll" -d "$SCRATCH/le-extract"
cp "$SCRATCH/le-extract/LECommonLibrary.dll" \
  "D:/project/gal-lib/src-tauri/resources/locale-emulator/LECommonLibrary.dll"
```
**校验字节数必须 = 17920**（官方原版）：
```bash
stat -c %s "D:/project/gal-lib/src-tauri/resources/locale-emulator/LECommonLibrary.dll"
```
若大小不是 17920，停止并报告（可能取到了社区改版或下载损坏）。若网络下载失败，报告阻塞而非从本机 `D:\Locale.Emulator.2.5.0.1\` 拷贝。

**1b. 修正 tauri.conf.json 的 resources glob（tauri.conf.json:45）：**

把 `"resources": ["resources/locale-emulator/*"]` 改为同时显式列出根文件与 Lang 子目录：
```json
"resources": [
  "resources/locale-emulator/*",
  "resources/locale-emulator/Lang/*"
],
```
（Tauri 2 资源 glob 单个 `*` 不递归，故需显式补 Lang/*。用 Edit 定向替换该行，勿动 bundle 其它字段。）

**1c. 更新 NOTICE.md 文件清单：**

在 `src-tauri/resources/locale-emulator/NOTICE.md` 的文件清单里（`LocaleEmulator.dll` 行附近）新增一行说明 LECommonLibrary.dll：
```
- `LECommonLibrary.dll` — LEProc 运行所需的公共托管程序集
```
保持与现有列表风格一致。
  </action>
  <verify>
<automated>
# DLL 存在且为官方原版大小
test "$(stat -c %s 'D:/project/gal-lib/src-tauri/resources/locale-emulator/LECommonLibrary.dll')" = "17920" && echo "DLL_OK"
# glob 已含 Lang 子目录
grep -q "locale-emulator/Lang" D:/project/gal-lib/src-tauri/tauri.conf.json && echo "GLOB_OK"
# NOTICE 已列 LECommonLibrary
grep -q "LECommonLibrary.dll" D:/project/gal-lib/src-tauri/resources/locale-emulator/NOTICE.md && echo "NOTICE_OK"
# LEProc argless 冒烟：补齐 DLL 后 Main 不再抛 FileNotFoundException，会生成 LEConfig.xml
cd "D:/project/gal-lib/src-tauri/resources/locale-emulator" \
  && (./LEProc.exe >/dev/null 2>&1 &) ; sleep 3 \
  && (ls LEConfig.xml >/dev/null 2>&1 && echo "LEPROC_OK: config generated, no crash" || echo "LEPROC_CHECK: 无 LEConfig.xml，需人工确认是否弹出用法 MessageBox") \
  ; taskkill //IM LEProc.exe //F >/dev/null 2>&1 ; rm -f LEConfig.xml
</automated>
  </verify>
  <done>
LECommonLibrary.dll（17920 字节官方原版）落入 resources/locale-emulator/；tauri.conf.json resources 含 Lang/* 条目；NOTICE.md 列出该 DLL；argless 运行 LEProc.exe 后目录生成 LEConfig.xml 且无 .NET Runtime 1026 崩溃（证明 FileNotFoundException 已消失），验证后已 kill 进程并删除生成的 LEConfig.xml。

**提交 Commit 1**（原子）：
`git add src-tauri/resources/locale-emulator/LECommonLibrary.dll src-tauri/tauri.conf.json src-tauri/resources/locale-emulator/NOTICE.md && git commit -m "fix(quick-260709-mnc): 补齐 LECommonLibrary.dll 修复 LE 转区启动崩溃 + resources glob 补 Lang 子目录"`
  </done>
</task>

<task type="auto">
  <name>Task 2: 接入 tauri-plugin-single-instance</name>
  <files>src-tauri/Cargo.toml, src-tauri/Cargo.lock, src-tauri/src/lib.rs</files>
  <action>
**2a. 添加依赖（Cargo.toml）：**

在 `[dependencies]` 里加入（放在其它 tauri-plugin-* 附近，风格一致，带简短中文注释）：
```toml
# Quick 260709-mnc — 单实例守卫：第二次启动聚焦已有窗口后退出。
# 必须注册为 Builder 的第一个 plugin（官方要求）。
tauri-plugin-single-instance = "2"
```
优先用 `cargo add tauri-plugin-single-instance@2 --manifest-path src-tauri/Cargo.toml`（会同步 Cargo.lock）；若 cargo add 不可用则手动编辑 Cargo.toml 后靠 cargo check 更新 lock。

**2b. 注册为第一个 plugin（lib.rs）：**

在 `tauri::Builder::default()` 之后、**现有 `.plugin(tauri_plugin_sql::...)` 之前**插入 single-instance 作为首个 plugin。回调聚焦已有主窗口（复用已 import 的 Manager trait）：
```rust
tauri::Builder::default()
    // Quick 260709-mnc — 单实例守卫必须是第一个 plugin。第二次启动时
    // 本回调在已运行的首实例进程内触发：show()（本应用有关闭到托盘逻辑，
    // 窗口可能是 hidden，不可省）+ unminimize() + set_focus() 聚焦回来。
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    }))
    .plugin(
        tauri_plugin_sql::Builder::default()
            .add_migrations(&db_url, migrations)
            .build(),
    )
    // ...余下 plugin 链不变
```
注意闭包签名为 `|app, argv, cwd|`（app: &AppHandle），窗口 label "main" 与 tauri.conf.json 一致。不要改动其它任何 plugin/setup/invoke_handler。
  </action>
  <verify>
<automated>
# single-instance 已作为首个 plugin 注册
grep -q "tauri_plugin_single_instance::init" D:/project/gal-lib/src-tauri/src/lib.rs && echo "PLUGIN_REGISTERED"
# 依赖已声明
grep -q "tauri-plugin-single-instance" D:/project/gal-lib/src-tauri/Cargo.toml && echo "DEP_OK"
# 编译通过（子代理无法验证 GUI 聚焦，做到编译绿 + 代码审读即可）
cd "D:/project/gal-lib/src-tauri" && cargo check 2>&1 | tail -5
</automated>
  </verify>
  <done>
Cargo.toml 声明 tauri-plugin-single-instance = "2"；lib.rs 中该 plugin 是 Builder 的第一个 `.plugin(...)`，回调对 "main" 窗口 show()+unminimize()+set_focus()；`cargo check` 通过（0 error）。GUI 真机验证（连开两次、第二个立即退出且第一个窗口被聚焦）留给用户——子代理无法验证 GUI 聚焦。

**提交 Commit 2**（原子）：
`git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs && git commit -m "feat(quick-260709-mnc): 接入 tauri-plugin-single-instance 单实例守卫"`
  </done>
</task>

</tasks>

<verification>
- LECommonLibrary.dll 存在于 resources/locale-emulator/ 且为 17920 字节官方原版。
- argless 运行 LEProc.exe 生成 LEConfig.xml、无 .NET Runtime 1026 崩溃事件（FileNotFoundException 已消失），验证后清理生成物。
- tauri.conf.json bundle.resources 同时打包根文件与 Lang/ 子目录。
- NOTICE.md 清单含 LECommonLibrary.dll。
- cargo check 通过；single-instance 注册为第一个 plugin。
- 两个修复各自一个原子 commit。
</verification>

<success_criteria>
- 转区启动崩溃根因（缺 DLL）已消除，且安装包不再漏打 Lang/ 子目录。
- 应用具备单实例守卫（编译层面 + 代码审读确认；真机聚焦待用户验证）。
- 未触碰 launch/ 模块逻辑。
- 两个原子提交分别对应两个修复。
</success_criteria>

<output>
完成后创建 `.planning/quick/260709-mnc-lecommonlibrary-dll/260709-mnc-SUMMARY.md`，记录：
- DLL 下载/校验结果（含实际字节数）与 LEProc argless 冒烟结果
- resources glob 修改前后
- single-instance 接入位置与 cargo check 结果
- 留给用户的真机验证项（LE 转区实际启动一个游戏、连开两次实例聚焦）
- 两个 commit 的 hash
</output>
