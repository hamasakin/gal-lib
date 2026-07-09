---
phase: quick-260709-mnc
plan: 01
subsystem: launch / bundling / app-lifecycle
tags: [locale-emulator, bundling, tauri-resources, single-instance, bugfix]
requires: []
provides:
  - "resources/locale-emulator/LECommonLibrary.dll(官方原版 17920 字节)"
  - "bundle.resources 覆盖 locale-emulator 根文件 + Lang/ 子目录"
  - "tauri-plugin-single-instance 单实例守卫（首个 plugin）"
affects:
  - "转区启动链路（LEProc.exe 不再因缺 DLL 崩溃）"
  - "安装包资源清单（Lang/ 不再漏打）"
  - "应用生命周期（第二实例聚焦已有窗口后退出）"
tech-stack:
  added:
    - "tauri-plugin-single-instance = \"2\""
  patterns:
    - "从官方 LEInstaller.exe 内嵌资源(Properties.Resources.resources)提取原版托管 DLL"
key-files:
  created:
    - "src-tauri/resources/locale-emulator/LECommonLibrary.dll"
  modified:
    - "src-tauri/tauri.conf.json"
    - "src-tauri/resources/locale-emulator/NOTICE.md"
    - "src-tauri/Cargo.toml"
    - "src-tauri/Cargo.lock"
    - "src-tauri/src/lib.rs"
decisions:
  - "官方发布 ZIP 不含 LECommonLibrary.dll —— 改从官方 LEInstaller.exe 内嵌资源提取原版(仍是 v2.5.0.1 官方、17920 字节、PublicKeyToken a5ce8326c28d7c91)"
metrics:
  duration: "~15 min"
  completed: "2026-07-09"
  tasks: 2
  commits: 2
  files_changed: 6
---

# Quick 260709-mnc: 补齐 LECommonLibrary.dll + 单实例守卫 Summary

补齐 LEProc.exe 运行所需的官方原版 `LECommonLibrary.dll`(17920 字节)修复转区启动崩溃、修正 `bundle.resources` glob 漏打 `Lang/` 子目录，并接入 `tauri-plugin-single-instance` 单实例守卫。

## 完成的任务

| Task | 名称 | Commit | 关键文件 |
|------|------|--------|----------|
| 1 | 补齐 LECommonLibrary.dll + 修正 resources glob + 更新 NOTICE | `de80223` | LECommonLibrary.dll, tauri.conf.json, NOTICE.md |
| 2 | 接入 tauri-plugin-single-instance | `5686e9e` | Cargo.toml, Cargo.lock, src/lib.rs |

## Task 1 — DLL 补齐 + glob 修正

### DLL 来源与校验（关键发现 / 计划偏差）

**计划假设官方 ZIP 内含 `LECommonLibrary.dll`(17920 字节)——实测该 ZIP 根本没有这个文件。**

下载官方 `Locale.Emulator.2.5.0.1.zip`(154135 字节)后 `unzip -l` 列出全部 52 个文件：仅有
`LEGUI.exe / LEInstaller.exe / LEProc.exe / LEUpdater.exe / LEVersion.xml / LoaderDll.dll /
LocaleEmulator.dll` + `Lang/` 目录，**无 `LECommonLibrary.dll`**（大小写不敏感搜 "common" 也无命中）。

静态核实缺失确为 BUG（用反射-only 加载）：
- `LEProc.exe` 的 `GetReferencedAssemblies()` 明确引用 `LECommonLibrary` 程序集；
- `LEProc.exe` 的 `GetManifestResourceNames()` 只有 `LEProc.Properties.Resources.resources`，**没有**内嵌 LECommonLibrary（非 Costura 打包）。
  → 即 LEProc 运行期需要磁盘上的外置 `LECommonLibrary.dll`，而捆绑目录与官方 ZIP 都缺它。

**官方原版 DLL 的真实出处**：`LEInstaller.exe` 的内嵌资源
`LEInstaller.Properties.Resources.resources` 里以 byte[] 形式携带
`KEY=LECommonLibrary LEN=17920 SIG=MZ`（安装时由安装器写盘）。用 `System.Resources.ResourceReader`
提取该 blob 得到 **17920 字节** 的 PE，反射校验：
`FullName = LECommonLibrary, Version=0.0.0.0, PublicKeyToken=a5ce8326c28d7c91`，
类型含 `LEConfig / LEProfile / PEFileReader / GlobalHelper` 等，PDB 路径 `C:\Users\Paddy\...`
（Paddy = 上游作者 xupefei）——**确认为官方原版、字节数与计划要求一致**。

> 偏差记录：计划文件的"从 ZIP 直取"步骤不可行，改为"从官方 LEInstaller.exe 内嵌资源提取"。
> 未触碰本机被社区补丁改过的 `D:\Locale.Emulator.2.5.0.1\`（计划明令禁止）。产物仍是官方 v2.5.0.1 原版、大小 17920 逐字满足验收标准。

### LEProc argless 冒烟（before/after 对照）

以 PowerShell `Start-Process` 跑 argless `LEProc.exe`（无参仅弹用法 MessageBox，安全、不启动游戏、无 UAC），等 3 秒后检查是否生成 `LEConfig.xml`，随后 kill 进程并删除生成物：

- **BEFORE（去掉 DLL 的副本目录）**：`NO LEConfig.xml (crashed before config write)` —— 复现 FileNotFoundException 崩溃。
- **AFTER（补齐 DLL 的捆绑目录）**：`LEConfig.xml GENERATED (no FileNotFoundException crash)` —— 崩溃消失。

验证后已 kill LEProc 进程并删除生成的 `LEConfig.xml`；捆绑目录仅新增 `LECommonLibrary.dll`，无 LEConfig.xml 残留。

### resources glob 修改前后

- 修改前：`"resources": ["resources/locale-emulator/*"]`（单 `*` 不递归，漏 `Lang/`）
- 修改后：
  ```json
  "resources": [
    "resources/locale-emulator/*",
    "resources/locale-emulator/Lang/*"
  ],
  ```

### NOTICE.md

新增 `LECommonLibrary.dll` 条目，并如实标注其来源（官方 ZIP 不含、从 `LEInstaller.exe` 内嵌资源提取、17920 字节、PublicKeyToken）。同步把"unmodified copies from the upstream release ZIP"措辞改为"unmodified official binaries from the v2.5.0.1 distribution"以保持准确。

## Task 2 — tauri-plugin-single-instance 接入

- `Cargo.toml` `[dependencies]` 新增 `tauri-plugin-single-instance = "2"`（带中文注释，放在其它 tauri-plugin-* 附近）；`cargo check` 同步更新 `Cargo.lock`。
- `lib.rs` 在 `tauri::Builder::default()` 之后、原 `tauri_plugin_sql` 之前插入 single-instance 作为 **第一个** `.plugin(...)`（`grep .plugin( | head -1` 命中行号 103 即该 plugin，确认首位）。回调对 `"main"` 窗口 `show()` + `unminimize()` + `set_focus()` 三连（配合已有关闭到托盘的 hide 逻辑，show 不可省）。
- 复用 lib.rs:21 已有的 `use tauri::{Emitter, Manager};`，无需新增 import。
- `cargo check`：**0 error**，`Finished dev profile in 57.41s`；6 个 pre-existing 死代码 warning（MetadataError / ScanOutcome.removed_dirs 等）与本任务无关。

## Deviations from Plan

### [Rule 3 - Blocking] 官方 ZIP 不含 LECommonLibrary.dll，改从官方安装器内嵌资源提取

- **Found during:** Task 1（下载官方 ZIP 后解压）
- **Issue:** 计划假设 `Locale.Emulator.2.5.0.1.zip` 含 `LECommonLibrary.dll`，实测该 ZIP 无此文件，"从 ZIP 直取"步骤无法完成。
- **Fix:** 反射核实 LEProc 确需外置该 DLL 后，从官方 `LEInstaller.exe` 的 `Properties.Resources.resources` 提取内嵌的 17920 字节原版 DLL（PublicKeyToken=a5ce8326c28d7c91，上游作者构建），字节数与官方性均满足计划验收标准。未使用被禁的本机社区改版。
- **Files modified:** src-tauri/resources/locale-emulator/LECommonLibrary.dll（新增）、NOTICE.md（来源措辞如实修正）
- **Commit:** de80223

## 留给用户的真机验证项（子代理无法验证 GUI）

1. **LE 转区实际启动一个真实游戏**：在 build 出的应用里对某中文/日文 galgame 点「转区启动」，确认游戏进程正常出现、不再静默失败（本次仅静态核实 + argless 冒烟证明 FileNotFoundException 已消除）。
2. **安装包打包 Lang/**：出 NSIS 安装包后确认 `resources/locale-emulator/Lang/` 子目录随包安装到位。
3. **单实例聚焦**：连开两次应用，确认第二个实例立即退出、第一个窗口被 `show()+unminimize()+set_focus()` 聚焦回前台（含从托盘 hidden 态唤回）。

## Commits

- `de80223` fix(quick-260709-mnc): 补齐 LECommonLibrary.dll 修复 LE 转区启动崩溃 + resources glob 补 Lang 子目录
- `5686e9e` feat(quick-260709-mnc): 接入 tauri-plugin-single-instance 单实例守卫

## Self-Check: PASSED

- FOUND: src-tauri/resources/locale-emulator/LECommonLibrary.dll (17920 bytes)
- FOUND commit de80223
- FOUND commit 5686e9e
- cargo check: 0 error
- 无 stub / 无 threat flag 新增（仅补齐官方 DLL + 生命周期守卫）
