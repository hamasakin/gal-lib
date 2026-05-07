---
phase: 01-foundation
plan: 01f
type: execute
wave: 6
depends_on: [01a, 01b, 01c, 01d, 01e]
files_modified:
  - src-tauri/Cargo.toml
  - src-tauri/tauri.conf.json
  - src-tauri/icons/icon.ico
  - src-tauri/icons/32x32.png
  - src-tauri/icons/128x128.png
  - src-tauri/icons/128x128@2x.png
  - src-tauri/icons/Square30x30Logo.png
  - src-tauri/icons/Square44x44Logo.png
  - src-tauri/icons/Square71x71Logo.png
  - src-tauri/icons/Square89x89Logo.png
  - src-tauri/icons/Square107x107Logo.png
  - src-tauri/icons/Square142x142Logo.png
  - src-tauri/icons/Square150x150Logo.png
  - src-tauri/icons/Square284x284Logo.png
  - src-tauri/icons/Square310x310Logo.png
  - src-tauri/icons/StoreLogo.png
  - .gitignore
  - package.json
  - docs/PHASE-01-VERIFICATION.md
autonomous: false
requirements: [APP-03]
must_haves:
  truths:
    - "执行 `pnpm tauri build --no-bundle` 后产出单文件 `src-tauri/target/release/gal-lib.exe`，无 NSIS/MSI installer 副产物（也即 bundler 步骤被 --no-bundle 跳过）"
    - "上述 gal-lib.exe 单文件大小 < 30 * 1024 * 1024 字节（即 < 30 MB），由 `Get-Item ... | Select-Object Length` 实测验证（APP-03 强约束）"
    - "把 gal-lib.exe 单独复制到一个全新的、不含 data/ 子目录的临时目录后双击启动，应用主窗口在 1280×800 出现，标题为 `gal-lib`，画面呈现自定义 titlebar + 220px Sidebar + 「还没有游戏」空状态（即 01d/01e 的 UI 在 release build 中正确渲染）"
    - "上述启动后，与 gal-lib.exe 同级目录自动出现 `data/` 子目录，且 `data/app.db` 存在并可被 sqlite3 查询；`SELECT value FROM app_meta WHERE key='schema_version'` 返回 `1`（APP-02 在 release 构建下仍成立）"
    - "上述启动后，`data/config.json`、`data/covers/`、`data/screenshots/`、`data/saves/`、`data/logs/` 全部存在（01c 的子目录初始化在 release 下未回归）"
    - "上述启动后，`%APPDATA%\\com.gal-lib.app\\` 路径**不存在**（path_mapper 绝对路径绕过在 release 下仍生效，APP-01 portable 不变量）"
    - "把上述 portable 目录（仅含 gal-lib.exe，不含 data/）打成 zip → 解压到另一个全新位置 → 双击启动，应用同样能正常运行并在新位置创建独立的 data/（验证可分发性，单 exe 不依赖原始位置的副产物）"
    - "`docs/PHASE-01-VERIFICATION.md` 文件存在且记录了：实测 exe 字节大小 + 大小 / (1024*1024) 的 MB 值 + 双击启动后窗口出现耗时 + 6 项视觉验证 checklist 的逐条勾选状态 + zip 重定位测试结果 + WebView2 / VCRedist 依赖说明（RESEARCH §Open Q1）"
  artifacts:
    - path: "src-tauri/Cargo.toml"
      provides: "verify/extend `[profile.release]` 块包含 RESEARCH §Pitfall 6 锁定的 6 个体积优化字段（codegen-units=1, lto=true, opt-level=\"s\", panic=\"abort\", strip=true, incremental=false）；01a 已写入前 5 项，本 plan 仅追加缺失的 incremental=false 并校验其余存在"
      contains: "incremental = false"
    - path: "src-tauri/tauri.conf.json"
      provides: "在 01a/01e 已建立的基础上追加两项打包相关字段：`build.removeUnusedCommands: true`（Tauri 2.4+ IPC 命令裁剪）+ `bundle.targets: [\"nsis\"]`（仅声明 NSIS 为唯一 bundle target；本 plan 实际产物走 --no-bundle，但保留 nsis 配置以便 Phase 5+ 切换发布安装包时无需再改）"
      contains: "removeUnusedCommands"
    - path: "src-tauri/icons/icon.ico"
      provides: "Tauri Windows 构建必需的 .ico 图标（02b/01a 模板默认占位即可，Phase 1 不要求自定义视觉）"
    - path: "src-tauri/icons/32x32.png"
      provides: "Tauri 模板必需 PNG（占位即可）"
    - path: "src-tauri/icons/128x128.png"
      provides: "Tauri 模板必需 PNG（占位即可）"
    - path: "src-tauri/icons/128x128@2x.png"
      provides: "Tauri 模板必需 PNG（占位即可）"
    - path: ".gitignore"
      provides: "校验已忽略 target/、dist/、/data/、src-tauri/target/、docs/PHASE-01-VERIFICATION.local.md 不被忽略（验证报告需 commit）"
      contains: "src-tauri/target"
    - path: "package.json"
      provides: "新增 npm script `build:exe`，记录 `pnpm tauri build --no-bundle` 是 Phase 1 验收用的「单 exe」命令（让命令在 SUMMARY 中可被引用，不依赖执行者记忆）"
      contains: "build:exe"
    - path: "docs/PHASE-01-VERIFICATION.md"
      provides: "验证报告：实测 exe 字节数 + MB 值 + 启动耗时 + 6 项视觉 checklist + zip 重定位结果 + WebView2/VCRedist 依赖结论"
      contains: "Phase 1 Verification"
  key_links:
    - from: "src-tauri/Cargo.toml [profile.release]"
      to: "rustc / cargo build --release"
      via: "Cargo 在 release build 时读 [profile.release]，启用 LTO + opt-level=s + strip 把单 exe 体积压到 < 30MB"
      pattern: "lto\\s*=\\s*true"
    - from: "src-tauri/tauri.conf.json build.removeUnusedCommands"
      to: "tauri::generate_context!"
      via: "Tauri 2.4+ 在编译期裁剪未被前端 invoke 的 Rust command，进一步减小 exe（RESEARCH §Pitfall 6）"
      pattern: "removeUnusedCommands"
    - from: "package.json scripts.build:exe"
      to: "@tauri-apps/cli build --no-bundle"
      via: "pnpm 触发 tauri CLI 走 --no-bundle 路径，产物为 src-tauri/target/release/gal-lib.exe"
      pattern: "tauri build --no-bundle"
    - from: "docs/PHASE-01-VERIFICATION.md"
      to: "01-SUMMARY.md (orchestrator 汇总阶段)"
      via: "Phase 1 verification 报告作为阶段验收证据被 SUMMARY.md 引用"
      pattern: "PHASE-01-VERIFICATION"
---

<objective>
完成 Phase 1 的 release 单 exe 打包验证：调齐 Cargo release profile（追加 incremental=false）+ tauri.conf.json 的 `removeUnusedCommands: true` 与 `bundle.targets: ["nsis"]` 配置 + 校验 Windows 图标资源齐全 → 跑 `pnpm tauri build --no-bundle` 拿单文件 `target/release/gal-lib.exe` → 实测体积 < 30MB → portable 双击启动 E2E（包括 data/ 自动创建、schema_version=1 验证、%APPDATA% 不被污染）→ zip 重定位 portable 验证 → 把全部测试结果落到 `docs/PHASE-01-VERIFICATION.md`。

Purpose: 落地 APP-03（单 .exe 分发，< 30MB）的硬约束并对 APP-01/APP-02 在 release 构建下做回归校验。本 plan 是 Phase 1 的最后一道闸门：除非 exe < 30MB 且 portable 启动 E2E 通过，否则 Phase 1 不算交付。

Output:
- 调过 release profile 的 `src-tauri/Cargo.toml`
- 写入 `removeUnusedCommands` + `bundle.targets: ["nsis"]` 的 `src-tauri/tauri.conf.json`
- 校验齐全的 `src-tauri/icons/` 资源
- `package.json` 中的 `build:exe` 脚本
- `target/release/gal-lib.exe` 单文件 < 30MB（**构建产物，不进 git**）
- `docs/PHASE-01-VERIFICATION.md`：含字节实测、MB 折算、启动耗时、视觉 checklist、zip 重定位结果、WebView2/VCRedist 依赖说明

Out of scope:
- NSIS / MSI 安装器实际构建（声明 target 但本期跑 --no-bundle）
- WebView2 fixedRuntime 模式（RESEARCH §Pitfall 3 已锁定不做）
- 跨 Windows 旧版本兼容（Win10 1803+ 接受作为系统要求）
- 自动更新 / 签名（已在 ROADMAP Out of Scope）
- 任何 Cargo 进一步压榨（如 nightly trim-paths）— 本 plan 不主动启用，仅在 < 30MB 失败时按 Failure Mode 文档化升级路径
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@D:\project\gal-lib\CLAUDE.md
@D:\project\gal-lib\.planning\STATE.md
@D:\project\gal-lib\.planning\ROADMAP.md
@D:\project\gal-lib\.planning\REQUIREMENTS.md
@D:\project\gal-lib\.planning\phases\01-foundation\01-CONTEXT.md
@D:\project\gal-lib\.planning\phases\01-foundation\01-RESEARCH.md
@D:\project\gal-lib\.planning\phases\01-foundation\01-PLAN-OUTLINE.md
@D:\project\gal-lib\.planning\phases\01-foundation\01a-PLAN.md
@D:\project\gal-lib\.planning\phases\01-foundation\01c-PLAN.md
@D:\project\gal-lib\.planning\phases\01-foundation\01d-PLAN.md
@D:\project\gal-lib\.planning\phases\01-foundation\01e-PLAN.md

<interfaces>
<!--
本 plan 不引入新代码模块，所有"接口"是命令、配置字段、文件路径与体积阈值。
执行者必须严格按此契约操作，不要"取最新"或自创变体。
-->

**Build command contract (RESEARCH §Architecture + §Pitfall 6, VERIFIED 2026-05-07):**

```powershell
# 单 exe 验收命令（Phase 1 唯一受认可的"单 exe"产物来源）
pnpm tauri build --no-bundle
# 产物：src-tauri/target/release/gal-lib.exe
```

**严禁** 执行 `pnpm tauri build`（不带 --no-bundle）作为体积验收依据 —— 那会产 NSIS setup.exe，体积语义不同，违反 RESEARCH §Anti-patterns。

**Cargo release profile 锁定字段（src-tauri/Cargo.toml）：**

```toml
[profile.release]
codegen-units = 1
lto = true
opt-level = "s"        # "z" 可能更小但风险更高，本期固定 "s"
panic = "abort"
strip = true
incremental = false    # 01a 可能未写，本 plan 校验并补齐
```

**tauri.conf.json 本 plan 写入字段（与 01a/01e 已有字段合并，不覆盖）：**

```json
{
  "build": {
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist",
    "removeUnusedCommands": true
  },
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.ico"
    ]
  }
}
```

注意：
- `removeUnusedCommands` 是 Tauri 2.4+ 的 build 字段（不是 bundle 字段）。
- `bundle.targets` 从 01a 的 `"all"` 收紧为 `["nsis"]`（声明性）。本 plan 实际不跑 bundler（用 --no-bundle），此字段是为 Phase 5+ 切发布做铺垫。
- 不要把 01a 已写入的 `productName`、`identifier`、`app.windows[*]`、01e 已写入的 `decorations: false` 等字段擦掉。

**体积阈值（APP-03 硬约束）：**

```
exe_bytes / (1024 * 1024) < 30
```

实测命令（PowerShell）：

```powershell
$exe = "src-tauri/target/release/gal-lib.exe"
$bytes = (Get-Item $exe).Length
$mb = [math]::Round($bytes / 1MB, 2)
Write-Host "gal-lib.exe = $bytes bytes ($mb MB)"
if ($mb -ge 30) { Write-Host "FAIL: exceeds 30MB"; exit 1 }
```

**Portable 验证目录（绝对路径，避免 cwd 漂移）：**

- 主验证目录：`D:\tmp\gal-lib-portable\`
- 重定位目录：`D:\tmp\gal-lib-relocated\`
- zip 暂存：`D:\tmp\gal-lib-portable.zip`

如 `D:\tmp\` 不存在则先 `New-Item -ItemType Directory -Force D:\tmp`。每次重跑前 `Remove-Item -Recurse -Force` 清理上次残留。

**SQLite 查询命令（验证 schema_version=1）：**

```powershell
# 优先使用系统 sqlite3.exe（如 PATH 中有）
sqlite3 D:\tmp\gal-lib-portable\data\app.db "SELECT value FROM app_meta WHERE key='schema_version';"
# 如系统无 sqlite3.exe，回退到 Tauri app 自带的 sqlx 不可达 → 改用 Python 兜底：
python -c "import sqlite3,sys; c=sqlite3.connect(r'D:\tmp\gal-lib-portable\data\app.db'); print(c.execute(\"SELECT value FROM app_meta WHERE key='schema_version'\").fetchone()[0])"
```

执行者两种方式选其一即可，但**必须**记录哪种成功用于在验证报告中。期望输出：单行 `1`。

**Windows 图标文件清单（Tauri Windows build 必需）：**

`src-tauri/icons/` 目录下至少必须存在：
- `icon.ico`（Windows 应用图标 — Cargo build 会嵌入到 PE 资源）
- `32x32.png`、`128x128.png`、`128x128@2x.png`（Tauri 模板默认引用，缺失会导致 `tauri build` 报错）

01a 模板已生成上述 4 项。本 plan 仅校验存在（不重新生成）；如缺失视为 01a 回归 → 在 PHASE-01-VERIFICATION.md 中记录并阻断。

**WebView2 / VCRedist 依赖（RESEARCH §Open Q1）：**

- WebView2 Runtime：Win10 1803+ / Win11 内置；测试机若是这两者之一，无需手装。
- VCRedist：Tauri prerequisites 通常已带；本期不主动绑定，文档化为「现代 Win10/11 默认包含」。

**Failure modes（按优先级）：**

1. **exe > 30MB**：用 `cargo bloat --release --crates --manifest-path src-tauri/Cargo.toml | head -n 30` 排查最大依赖；按行写进 PHASE-01-VERIFICATION.md 的 Failure Mode 节，**不要静默接受失败** —— 必须显式标记 plan 阻塞 + 提出后续路径（如降级 sqlx 特性、改 opt-level=z、上 nightly）。
2. **WebView2 缺失**：测试机环境异常，文档化系统要求 + 给用户提供 Edge WebView2 Runtime 下载链接（`https://developer.microsoft.com/microsoft-edge/webview2/`），不视为 plan 失败但记入 RISK。
3. **`data/` 不创建**：01c 在 release build 下回归 → 阻断 plan，向用户报告 01c 需要重做 portable smoke test（dev vs release 行为分裂）。
4. **`%APPDATA%\com.gal-lib.app\` 出现**：path_mapper 绝对路径绕过失效 → 阻断 plan，向用户报告 01c 的 `add_migrations` 调用未传绝对路径或 `replace('\\\\', "/")` 漏写。
5. **icon 缺失导致 `tauri build` 失败**：01a 回归 → 文档化缺失文件 + 提供 Tauri CLI `tauri icon <source.png>` 的回填命令，但本 plan 不替 01a 决定视觉；如必要用占位图，在 PHASE-01-VERIFICATION.md 注明。
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: 配置 release 单 exe 打包参数（Cargo profile 校验补齐 + tauri.conf.json removeUnusedCommands + bundle.targets nsis + package.json build:exe 脚本 + icons 完整性校验）</name>
  <files>
    src-tauri/Cargo.toml,
    src-tauri/tauri.conf.json,
    package.json,
    .gitignore,
    src-tauri/icons/icon.ico,
    src-tauri/icons/32x32.png,
    src-tauri/icons/128x128.png,
    src-tauri/icons/128x128@2x.png
  </files>
  <read_first>
    D:\project\gal-lib\src-tauri\Cargo.toml (01a/01c 写入的当前状态),
    D:\project\gal-lib\src-tauri\tauri.conf.json (01a 与 01e 写入的当前状态),
    D:\project\gal-lib\package.json (01a/01b/01d 写入的当前状态),
    D:\project\gal-lib\.gitignore (01a/01c 写入的当前状态),
    D:\project\gal-lib\.planning\phases\01-foundation\01-RESEARCH.md (§Pitfall 6 体积优化, §Code Examples tauri.conf.json 模板, §Architecture --no-bundle),
    D:\project\gal-lib\.planning\phases\01-foundation\01a-PLAN.md (确认 01a 已写入的 [profile.release] 字段),
    D:\project\gal-lib\.planning\phases\01-foundation\01e-PLAN.md (确认 01e 已写入的 decorations:false 与 window 字段)
  </read_first>
  <action>
    本任务**不做实际打包**，只调齐配置 + 校验前置依赖文件齐全，为 Task 2 的 release build 做铺垫。所有改动遵循「合并不覆盖」原则 —— 仅追加缺失字段，不擦除 01a/01c/01e 已写入字段。

    1. **校验 + 补齐 `src-tauri/Cargo.toml` 的 `[profile.release]`：**
       - 用 Read 工具读 `src-tauri/Cargo.toml`，定位 `[profile.release]` 块
       - 期望已存在的字段（01a 写入）：`codegen-units = 1`、`lto = true`、`opt-level = "s"`、`panic = "abort"`、`strip = true`
       - 缺失字段（本 plan 补齐）：`incremental = false`
       - 用 Edit 工具在 `[profile.release]` 块内追加 `incremental = false`（如已存在则跳过）
       - **严禁** 改动 `[dependencies]`、`[build-dependencies]`、`[lib]` 等其他块（那是 01a/01c 的范围）

    2. **更新 `src-tauri/tauri.conf.json`：**
       - 用 Read 工具读当前内容
       - 在 `build` 对象内追加 `"removeUnusedCommands": true`（Tauri 2.4+ 字段，与 `beforeDevCommand` / `beforeBuildCommand` / `devUrl` / `frontendDist` 同级）
       - 把 `bundle.targets` 从 01a 的 `"all"` 改为 `["nsis"]`（数组形式）；如已是数组则确保仅含 `"nsis"` 一项
       - 保留 01a 已写入的 `productName`、`version`、`identifier`、`app.windows[*]` 全部字段
       - 保留 01e 已写入的 `app.windows[0].decorations: false` 与 1280×800/960×600 尺寸约束
       - 保留 01a 已写入的 `bundle.icon` 数组（4 项）与 `bundle.active: true`
       - **严禁** 删除任何已存在字段；仅追加 `removeUnusedCommands` + 收紧 `bundle.targets`

    3. **更新 `package.json`：**
       - 用 Read 工具读当前 `scripts` 对象
       - 在 `scripts` 内追加 `"build:exe": "tauri build --no-bundle"`（与 `dev` / `build` / `tauri` / `typecheck` 同级）
       - 不动 `dependencies` / `devDependencies` / `name` / `version` 等其他字段

    4. **校验 `.gitignore` 已忽略构建产物：**
       - 用 Read 工具读当前 `.gitignore`
       - 必须存在的行（01a/01c 已写入）：`node_modules`、`/data/`、`src-tauri/target`、`/dist/`（或 `dist/`）
       - 如缺失任意一行 → 用 Edit 工具补齐
       - **额外追加一行** `/target/`（Cargo workspace 根 target 兜底，仓库实际只在 src-tauri 下生成 target，但保险起见加上）

    5. **校验 Windows 图标资源齐全：**
       - 用 PowerShell 检查以下文件存在：
         - `D:\project\gal-lib\src-tauri\icons\icon.ico`
         - `D:\project\gal-lib\src-tauri\icons\32x32.png`
         - `D:\project\gal-lib\src-tauri\icons\128x128.png`
         - `D:\project\gal-lib\src-tauri\icons\128x128@2x.png`
       - 如全部存在：通过
       - 如任一缺失：**视为 01a 回归** —— 在终端打印明确错误信息，列出缺失文件，并在 SUMMARY.md 中记录；如执行者判断必须用占位图回填，可执行 `pnpm tauri icon src-tauri/icons/icon.ico`（如有源图）或从 `pnpm create tauri-app` 生成的临时模板拷贝默认占位 PNG，但**必须**在 SUMMARY 中说明这是占位资源、Phase 1 接受、Phase 2+ 替换为真实视觉

    6. **运行 TS 类型检查 + Cargo check（前置闸门，不做实际 build）：**
       - `pnpm tsc --noEmit` 必须退出码 0
       - `cargo check --manifest-path src-tauri/Cargo.toml --release` 必须退出码 0（注意带 `--release` 让 Cargo 解析 release profile，提前暴露 [profile.release] 字段语法错误）

    本任务结束时，所有打包配置都已就位，但还没有产物 —— 那是 Task 2 的事。
  </action>
  <verify>
    <automated>
      cd D:/project/gal-lib && \
      grep -E '^\s*incremental\s*=\s*false' src-tauri/Cargo.toml && \
      grep -E '^\s*lto\s*=\s*true' src-tauri/Cargo.toml && \
      grep -E '^\s*opt-level\s*=\s*"s"' src-tauri/Cargo.toml && \
      grep -E '^\s*strip\s*=\s*true' src-tauri/Cargo.toml && \
      grep -E '^\s*panic\s*=\s*"abort"' src-tauri/Cargo.toml && \
      grep -E '^\s*codegen-units\s*=\s*1' src-tauri/Cargo.toml && \
      grep -q '"removeUnusedCommands"\s*:\s*true' src-tauri/tauri.conf.json && \
      grep -q '"targets"\s*:\s*\[\s*"nsis"\s*\]' src-tauri/tauri.conf.json && \
      grep -q '"productName"\s*:\s*"gal-lib"' src-tauri/tauri.conf.json && \
      grep -q '"identifier"\s*:\s*"com.gal-lib.app"' src-tauri/tauri.conf.json && \
      grep -q '"decorations"\s*:\s*false' src-tauri/tauri.conf.json && \
      grep -q '"build:exe"\s*:\s*"tauri build --no-bundle"' package.json && \
      grep -qE '^/?data/?$' .gitignore && \
      grep -qE 'src-tauri/target' .gitignore && \
      test -f src-tauri/icons/icon.ico && \
      test -f src-tauri/icons/32x32.png && \
      test -f src-tauri/icons/128x128.png && \
      test -f src-tauri/icons/128x128@2x.png && \
      pnpm tsc --noEmit && \
      cargo check --manifest-path src-tauri/Cargo.toml --release
    </automated>
  </verify>
  <acceptance_criteria>
    - `src-tauri/Cargo.toml` 的 `[profile.release]` 块同时含 6 行：`codegen-units = 1`、`lto = true`、`opt-level = "s"`、`panic = "abort"`、`strip = true`、`incremental = false`（grep 全部命中）
    - `src-tauri/tauri.conf.json` 的 `build` 对象含 `"removeUnusedCommands": true`
    - `src-tauri/tauri.conf.json` 的 `bundle.targets` 严格等于 `["nsis"]`（数组单元素，**不再是** `"all"`）
    - `src-tauri/tauri.conf.json` 的 `productName: "gal-lib"`、`identifier: "com.gal-lib.app"`、`app.windows[0].decorations: false` 三项保留未被擦除
    - `package.json` 的 `scripts.build:exe` 严格等于 `"tauri build --no-bundle"`
    - `.gitignore` 含 `node_modules`、`/data/`（或 `data/`）、`src-tauri/target`、`/dist/`（或 `dist/`）
    - `src-tauri/icons/` 下 4 个必需图标文件全部存在；如有占位回填行为，在 SUMMARY 中明确标注
    - `pnpm tsc --noEmit` 退出码 0
    - `cargo check --manifest-path src-tauri/Cargo.toml --release` 退出码 0（证明 [profile.release] 字段语法正确）
    - 本任务**未触发** `cargo build --release`（不做实际 build），未生成 `target/release/gal-lib.exe`
  </acceptance_criteria>
  <done>
    所有打包前置配置已就位；Cargo release profile 6 项体积优化字段齐全；tauri.conf.json 的 removeUnusedCommands + bundle.targets nsis 已写入；package.json 的 build:exe 脚本就位；图标资源完整；TS + Cargo check 双绿。Task 2 可以直接跑 `pnpm tauri build --no-bundle`。
  </done>
</task>

<task type="auto">
  <name>Task 2: 跑 release single-exe build（pnpm tauri build --no-bundle）+ 测体积 + portable 双击启动 E2E + zip 重定位 + 写 PHASE-01-VERIFICATION.md（除「视觉确认」「窗口控制」「拖动」「Tooltip」「focus ring」「resize 下限」6 项需 Task 3 人工确认外，其余全部自动化）</name>
  <files>
    docs/PHASE-01-VERIFICATION.md
  </files>
  <read_first>
    D:\project\gal-lib\src-tauri\tauri.conf.json (Task 1 调齐后的状态),
    D:\project\gal-lib\src-tauri\Cargo.toml (Task 1 调齐后的状态),
    D:\project\gal-lib\.planning\phases\01-foundation\01-RESEARCH.md (§Pitfall 1 path_mapper 绝对路径绕过 + §Pitfall 6 体积优化 + §Open Q1 WebView2/VCRedist),
    D:\project\gal-lib\.planning\phases\01-foundation\01-CONTEXT.md (§Portable Data Layout & Init data 子目录清单),
    D:\project\gal-lib\.planning\phases\01-foundation\01c-PLAN.md (must_haves: data/ 子目录清单 + schema_version 验证)
  </read_first>
  <action>
    本任务执行实际 release build + 全自动化的 portable 验证 + 报告生成。任何步骤失败 → 立即停下、把失败现场写进 `docs/PHASE-01-VERIFICATION.md` 的 Failure Mode 节、再终止任务（不要尝试自动绕过 path_mapper 失效或 < 30MB 失败）。

    所有命令在仓库根 `D:\project\gal-lib\` 运行（PowerShell）。

    1. **预清理：**
       ```powershell
       cd D:\project\gal-lib
       # 清掉上次 release 产物（如有），确保从干净状态开始
       if (Test-Path src-tauri\target\release\gal-lib.exe) { Remove-Item src-tauri\target\release\gal-lib.exe -Force }
       # 清掉测试目录残留
       if (Test-Path D:\tmp\gal-lib-portable) { Remove-Item D:\tmp\gal-lib-portable -Recurse -Force }
       if (Test-Path D:\tmp\gal-lib-relocated) { Remove-Item D:\tmp\gal-lib-relocated -Recurse -Force }
       if (Test-Path D:\tmp\gal-lib-portable.zip) { Remove-Item D:\tmp\gal-lib-portable.zip -Force }
       New-Item -ItemType Directory -Force D:\tmp | Out-Null
       New-Item -ItemType Directory -Force D:\tmp\gal-lib-portable | Out-Null
       ```

    2. **跑 release build：**
       ```powershell
       $buildStart = Get-Date
       pnpm tauri build --no-bundle
       $buildEnd = Get-Date
       $buildSeconds = ($buildEnd - $buildStart).TotalSeconds
       Write-Host "build took $buildSeconds seconds"
       ```
       期望：退出码 0，产生 `src-tauri/target/release/gal-lib.exe`。如失败 → 把 `tauri build` 完整输出最后 30 行写进 PHASE-01-VERIFICATION.md 的 Failure Mode 节并终止。

    3. **测体积（APP-03 硬约束）：**
       ```powershell
       $exe = "src-tauri\target\release\gal-lib.exe"
       if (-not (Test-Path $exe)) { Write-Error "exe not produced"; exit 1 }
       $bytes = (Get-Item $exe).Length
       $mb = [math]::Round($bytes / 1MB, 2)
       Write-Host "gal-lib.exe = $bytes bytes ($mb MB)"
       ```
       记录 `$bytes` 与 `$mb` 备用。
       - 如 `$mb < 30`：通过，继续
       - 如 `$mb >= 30`：**不要继续**。运行 `cargo bloat --release --crates --manifest-path src-tauri/Cargo.toml | Select-Object -First 30` 把 top crate 列表也保存。把全部数据写进 PHASE-01-VERIFICATION.md 的 Failure Mode 节，标记 plan 阻塞，终止任务，向 orchestrator 报告。

    4. **复制 exe 到 portable 测试目录：**
       ```powershell
       Copy-Item src-tauri\target\release\gal-lib.exe D:\tmp\gal-lib-portable\gal-lib.exe
       # 验证目标目录此刻只有这一个文件（没有预存 data/ 子目录）
       Get-ChildItem D:\tmp\gal-lib-portable
       ```
       期望输出：仅 `gal-lib.exe` 一行；如有 `data/` 表示前置清理失败，回到 step 1 重做。

    5. **启动 portable exe（无界面交互，自动化拉起 + 等待 + 自动关闭）：**
       ```powershell
       $startTime = Get-Date
       $proc = Start-Process -FilePath D:\tmp\gal-lib-portable\gal-lib.exe -PassThru
       # 给应用 30s 完成启动 + DB 迁移 + 首次窗口呈现 + 写入 data/
       Start-Sleep -Seconds 30
       $startElapsed = ((Get-Date) - $startTime).TotalSeconds
       Write-Host "portable launch waited $startElapsed seconds (proc id $($proc.Id))"
       ```

    6. **校验 data/ 自动创建（APP-01 + APP-02 在 release 下回归校验）：**
       ```powershell
       $dataDir = "D:\tmp\gal-lib-portable\data"
       if (-not (Test-Path $dataDir)) { Write-Error "data/ not created"; Stop-Process -Id $proc.Id -Force; exit 1 }
       # 必需子项
       $required = @("app.db", "config.json", "covers", "screenshots", "saves", "logs")
       foreach ($name in $required) {
           $p = Join-Path $dataDir $name
           if (-not (Test-Path $p)) { Write-Error "data/$name missing"; Stop-Process -Id $proc.Id -Force; exit 1 }
       }
       Write-Host "data/ subdirs OK: $($required -join ', ')"
       ```

    7. **校验 schema_version=1：**
       ```powershell
       # 优先 sqlite3.exe（如不在 PATH，直接用 python 兜底）
       $sqliteExe = Get-Command sqlite3 -ErrorAction SilentlyContinue
       if ($sqliteExe) {
           $version = & sqlite3 D:\tmp\gal-lib-portable\data\app.db "SELECT value FROM app_meta WHERE key='schema_version';"
       } else {
           $version = python -c "import sqlite3; c=sqlite3.connect(r'D:\tmp\gal-lib-portable\data\app.db'); print(c.execute(\"SELECT value FROM app_meta WHERE key='schema_version'\").fetchone()[0])"
       }
       if ($version.Trim() -ne "1") { Write-Error "schema_version expected 1, got $version"; Stop-Process -Id $proc.Id -Force; exit 1 }
       Write-Host "schema_version = $version OK"
       ```

    8. **校验 %APPDATA% 未被污染（APP-01 portable 不变量）：**
       ```powershell
       $polluted = "$env:APPDATA\com.gal-lib.app"
       if (Test-Path $polluted) {
           Write-Error "FAIL: %APPDATA% pollution detected at $polluted (path_mapper bypass broken)"
           Stop-Process -Id $proc.Id -Force
           exit 1
       }
       Write-Host "no APPDATA pollution OK"
       ```

    9. **优雅关闭应用：**
       ```powershell
       # 先尝试发关闭信号（CloseMainWindow），超时则强杀
       $closed = $proc.CloseMainWindow()
       Start-Sleep -Seconds 3
       if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
       Write-Host "portable proc terminated"
       ```

    10. **zip 重定位测试：**
        ```powershell
        # 把 portable 目录（含 data/）打包，模拟用户拷贝/分发
        Compress-Archive -Path D:\tmp\gal-lib-portable\* -DestinationPath D:\tmp\gal-lib-portable.zip -Force
        # 解压到一个全新位置
        New-Item -ItemType Directory -Force D:\tmp\gal-lib-relocated | Out-Null
        Expand-Archive -Path D:\tmp\gal-lib-portable.zip -DestinationPath D:\tmp\gal-lib-relocated -Force
        # 在重定位位置启动
        $proc2 = Start-Process -FilePath D:\tmp\gal-lib-relocated\gal-lib.exe -PassThru
        Start-Sleep -Seconds 20
        # 重定位位置的 data/ 应已存在（zip 已带过来；启动后非首次，不会重建）
        if (-not (Test-Path D:\tmp\gal-lib-relocated\data\app.db)) { Write-Error "relocated data/app.db missing"; Stop-Process -Id $proc2.Id -Force; exit 1 }
        # 关闭
        $proc2.CloseMainWindow() | Out-Null
        Start-Sleep -Seconds 3
        if (-not $proc2.HasExited) { Stop-Process -Id $proc2.Id -Force }
        Write-Host "relocated launch OK"
        ```

    11. **生成 `docs/PHASE-01-VERIFICATION.md` 报告：**
        用 Write 工具创建文件，内容模板如下（变量按上文实测值替换，**不要保留占位符**）：

        ```markdown
        # Phase 1 Verification

        **Date:** 2026-05-07
        **Build command:** `pnpm tauri build --no-bundle`
        **Build host:** Windows 11 (record OS build via `[System.Environment]::OSVersion`)
        **Rust toolchain:** record `rustc --version` 输出
        **Node / pnpm:** record `node -v` 与 `pnpm -v` 输出

        ## APP-03: Single .exe < 30MB

        | Metric | Value |
        |--------|-------|
        | exe path | `src-tauri/target/release/gal-lib.exe` |
        | bytes | `<actual bytes>` |
        | MB (bytes / 1MB) | `<actual MB rounded 2 decimals>` |
        | threshold | `< 30 MB` |
        | result | PASS / FAIL |
        | build duration (s) | `<buildSeconds>` |

        ## APP-01: Portable data/ next to .exe

        测试目录：`D:\tmp\gal-lib-portable\`
        启动后 data/ 自动创建：YES / NO
        子项检查：
        - data/app.db: YES / NO
        - data/config.json: YES / NO
        - data/covers/: YES / NO
        - data/screenshots/: YES / NO
        - data/saves/: YES / NO
        - data/logs/: YES / NO
        %APPDATA%\com.gal-lib.app\ 是否存在（必须 NO）：YES / NO

        ## APP-02: First-launch schema init

        Query: `SELECT value FROM app_meta WHERE key='schema_version'`
        Result: `1` / `<actual>`
        Tool used: sqlite3.exe / python sqlite3

        ## Portable zip + relocate

        zip path: `D:\tmp\gal-lib-portable.zip`
        relocate path: `D:\tmp\gal-lib-relocated\`
        relocate launch OK: YES / NO
        relocate data/app.db present: YES / NO

        ## Visual checklist (filled by Task 3 — human verification)

        - [ ] Window 1280×800 default size, custom dark titlebar with `gal-lib` text + 3 control buttons
        - [ ] Sidebar 220px wide showing `分类` heading + 4 placeholder items + `设置`
        - [ ] Main pane shows empty state: H2 `还没有游戏` + body `请到设置页添加扫描根目录` + ghost button `打开设置`
        - [ ] Click `打开设置` → navigates to `/settings`, shows `设置 — 即将上线`
        - [ ] Hover sidebar placeholder items → tooltip `即将开放` appears
        - [ ] Window controls (minimize / maximize / close) work; titlebar drag works; window cannot resize below 960×600

        ## WebView2 / VCRedist dependency notes

        - WebView2 Runtime: assumed present (Win10 1803+ / Win11 内置)
        - VCRedist: assumed present (Tauri prerequisites)
        - 如测试机弹缺 DLL/runtime → 在此节追加描述与下载链接 `https://developer.microsoft.com/microsoft-edge/webview2/`

        ## Failure mode (only if any check failed)

        （只在有 FAIL 时填；正常通过留空或写 N/A）
        - 失败检查：xxx
        - 现场输出最后 30 行：```
          <paste>
          ```
        - cargo bloat top 30（如 < 30MB 失败）：```
          <paste>
          ```
        - 处置建议：xxx
        ```

    12. **本任务最终输出：**
        - `docs/PHASE-01-VERIFICATION.md` 中：APP-03 / APP-01 / APP-02 / zip 重定位四节全部填好实测值（PASS/FAIL 二选一，不是占位）
        - 「Visual checklist」节保留 6 个未勾选 checkbox（留给 Task 3 人工填）
        - 终端最终打印 `Phase 1 build verification automated checks: ALL PASS` 或 `FAIL: <reason>`
  </action>
  <verify>
    <automated>
      cd D:/project/gal-lib && \
      test -f src-tauri/target/release/gal-lib.exe && \
      powershell -NoProfile -Command "$bytes = (Get-Item 'src-tauri/target/release/gal-lib.exe').Length; if ($bytes -ge 30 * 1024 * 1024) { Write-Error \"exe is $bytes bytes, exceeds 30MB\"; exit 1 }; exit 0" && \
      test -f D:/tmp/gal-lib-portable/data/app.db && \
      test -f D:/tmp/gal-lib-portable/data/config.json && \
      test -d D:/tmp/gal-lib-portable/data/covers && \
      test -d D:/tmp/gal-lib-portable/data/screenshots && \
      test -d D:/tmp/gal-lib-portable/data/saves && \
      test -d D:/tmp/gal-lib-portable/data/logs && \
      powershell -NoProfile -Command "if (Test-Path \"$env:APPDATA\\com.gal-lib.app\") { Write-Error 'APPDATA pollution'; exit 1 }; exit 0" && \
      test -f D:/tmp/gal-lib-relocated/gal-lib.exe && \
      test -f D:/tmp/gal-lib-relocated/data/app.db && \
      test -f docs/PHASE-01-VERIFICATION.md && \
      grep -q 'Phase 1 Verification' docs/PHASE-01-VERIFICATION.md && \
      grep -q 'APP-03: Single .exe' docs/PHASE-01-VERIFICATION.md && \
      grep -q 'APP-01: Portable data/' docs/PHASE-01-VERIFICATION.md && \
      grep -q 'APP-02: First-launch schema init' docs/PHASE-01-VERIFICATION.md && \
      grep -q 'Portable zip + relocate' docs/PHASE-01-VERIFICATION.md && \
      grep -q 'Visual checklist' docs/PHASE-01-VERIFICATION.md && \
      grep -qE 'PASS|FAIL' docs/PHASE-01-VERIFICATION.md
    </automated>
  </verify>
  <acceptance_criteria>
    - `src-tauri/target/release/gal-lib.exe` 存在
    - 上述 exe 字节数 < 30 * 1024 * 1024（即 < 30MB）；如 ≥ 30MB 则任务失败 + Failure Mode 节填好
    - `D:\tmp\gal-lib-portable\data\` 含 app.db、config.json 与 4 个空子目录 covers/screenshots/saves/logs/
    - `sqlite3` 或 `python` 查询 `SELECT value FROM app_meta WHERE key='schema_version'` 返回 `1`
    - `%APPDATA%\com.gal-lib.app\` **不存在**
    - `D:\tmp\gal-lib-portable.zip` 已生成；`D:\tmp\gal-lib-relocated\gal-lib.exe` 启动成功；relocated data/app.db 存在
    - `docs/PHASE-01-VERIFICATION.md` 含 6 节标题（含 Visual checklist + Failure mode）；APP-03 / APP-01 / APP-02 / zip 重定位四节实测值已填（不是占位）；Visual checklist 6 项保留为未勾选 checkbox（待 Task 3）
    - 任务结束时 portable / relocated 两个测试进程均已关闭（无僵尸进程占用 exe 文件锁）
  </acceptance_criteria>
  <done>
    Release single-exe 构建产物已生成且 < 30MB；portable 启动 E2E 全部自动化 check 通过；zip 重定位验证通过；`docs/PHASE-01-VERIFICATION.md` 报告已写入实测数据，仅余 Task 3 的 6 项视觉 checklist 待人工勾选。
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Task 2 已完成 release 构建 + 全自动化的 portable 启动 + zip 重定位 + 报告文件 `docs/PHASE-01-VERIFICATION.md`，但 6 项必须用人眼/键盘/鼠标确认的视觉与交互行为不能被 PowerShell 自动校验，需用户手动完成。

    现场：
    - 单 exe 路径：`D:\tmp\gal-lib-portable\gal-lib.exe`（如已被 Task 2 关闭，需重新双击启动）
    - 报告草稿：`D:\project\gal-lib\docs\PHASE-01-VERIFICATION.md`，「Visual checklist」节有 6 个未勾选 checkbox
  </what-built>
  <how-to-verify>
    打开文件管理器，进入 `D:\tmp\gal-lib-portable\`，**双击 gal-lib.exe** 启动应用，然后逐条确认（每条对应 PHASE-01-VERIFICATION.md 的 Visual checklist）。

    1. **窗口默认尺寸 + 自定义 titlebar：**
       - 应用窗口出现时大小约 1280×800（不是更小）
       - 窗口顶部是自定义 36px 高的 titlebar（深色 `#181B22` 背景），含 `gal-lib` 文字（左侧）+ 3 个控制按钮（右侧）
       - 看不到 Windows 系统默认的标题栏装饰（`decorations: false` 生效）
       - **如果对：** 在 `docs/PHASE-01-VERIFICATION.md` 把第 1 项 checkbox 改成 `[x]`

    2. **Sidebar 220px + 占位项 + 「设置」：**
       - 左侧栏宽约 220px，深色 `#181B22` 背景
       - 顶部 muted 文字 `分类`
       - 下面 4 个占位项依次为 `全部` / `收藏` / `标签` / `通关状态`，光标移到上面是 `cursor-not-allowed`，文字偏暗 muted
       - Separator 之下有 `设置`（带齿轮图标）
       - **如果对：** 把第 2 项 checkbox 改成 `[x]`

    3. **空状态 + 「打开设置」CTA：**
       - 主区垂直水平居中显示三段：`还没有游戏`（H2 大字）/ `请到设置页添加扫描根目录` / 一个 ghost 风格的按钮 `打开设置`
       - 点击 `打开设置` 按钮 → 窗口主区切换显示 `设置 — 即将上线`（H2）
       - **如果对：** 把第 3 项与第 4 项 checkbox 改成 `[x]`

    4. **Sidebar 占位项 Tooltip：**
       - 把光标停在 `全部` / `收藏` / `标签` / `通关状态` 任一项上不动 1 秒
       - 弹出 Tooltip 文本 `即将开放`（不是 `Coming soon`，不是空白）
       - **如果对：** 把第 5 项 checkbox 改成 `[x]`

    5. **窗口控制 + 拖动 + resize 下限：**
       - 点击 titlebar 右上的 `−`（最小化）→ 窗口最小化到任务栏；从任务栏点回 → 还原
       - 点击 `□`（最大化）→ 窗口铺满屏幕；再点 → 还原
       - 点击 `×`（关闭）→ 应用退出（注意：如果点了 ×，本步骤其余项需要重新启动应用再做）
       - 重新启动后，按住 titlebar 左半（`gal-lib` 文字所在区域）拖动 → 窗口跟随移动
       - 鼠标拖动窗口右下角缩小窗口 → 缩到 960×600 时无法继续缩小（minWidth/minHeight 生效）
       - **如果对：** 把第 6 项 checkbox 改成 `[x]`

    6. **打开 PHASE-01-VERIFICATION.md 文件，确认所有 6 个 checkbox 都已 `[x]`，保存文件。**

    7. **如发现任一项不对：**
       - **不要勾选**对应项
       - 在 PHASE-01-VERIFICATION.md 的 Failure Mode 节追加详细描述（哪一步、看到什么、期望什么）
       - 在响应中 type `failed: <reason>`，本 plan 标记为阻塞，需要回到 01a/01d/01e 之一修复后再回到 01f
  </how-to-verify>
  <resume-signal>
    确认 6 项视觉 checklist 全部勾选 + PHASE-01-VERIFICATION.md 已保存后，输入 `approved`。
    如任一项失败，输入 `failed: <具体失败描述>` 并附上失败截图（如有）。
  </resume-signal>
</task>

</tasks>

<verification>
**Plan-level checks (执行完所有 task 后整体复验):**

1. **配置就位（Task 1 闸门）：**
   ```powershell
   cd D:\project\gal-lib
   findstr /C:"incremental = false" src-tauri\Cargo.toml
   findstr /C:"removeUnusedCommands" src-tauri\tauri.conf.json
   findstr /C:"\"nsis\"" src-tauri\tauri.conf.json
   findstr /C:"build:exe" package.json
   ```
   全部命中 → Task 1 通过。

2. **build 产物就位（Task 2 闸门）：**
   ```powershell
   if (-not (Test-Path src-tauri\target\release\gal-lib.exe)) { exit 1 }
   $bytes = (Get-Item src-tauri\target\release\gal-lib.exe).Length
   if ($bytes -ge 30MB) { exit 1 }
   if (-not (Test-Path D:\tmp\gal-lib-portable\data\app.db)) { exit 1 }
   if (Test-Path "$env:APPDATA\com.gal-lib.app") { exit 1 }
   ```

3. **报告就位 + 6 项视觉 checklist 全勾（Task 3 闸门）：**
   ```powershell
   $report = Get-Content docs\PHASE-01-VERIFICATION.md -Raw
   # 6 项视觉 checklist 必须全是 [x]，不能有 [ ]
   $unchecked = ([regex]::Matches($report, '- \[ \] ')).Count
   if ($unchecked -gt 0) { Write-Error "$unchecked unchecked visual items"; exit 1 }
   ```

4. **本 plan 不应越权动 01a/01b/01c/01d/01e 的文件：**
   ```powershell
   # 比如本 plan 不应改 src/ 任何 .tsx，不应改 src-tauri/src/*.rs，不应改 migrations/*.sql
   git diff --name-only HEAD~1 HEAD | findstr /R "src/.*\.tsx src-tauri\\src\\.*\.rs migrations" 
   # 期望：无命中
   ```

5. **portable 不变量（最关键）：**
   - `data/` 在 exe 同级出现（不是 %APPDATA%）
   - app.db 存在 + schema_version=1
   - 5 个子目录 covers/screenshots/saves/logs（+ data/ 本身 = 5）齐全
   - zip → relocate → 启动 → data 仍在 exe 同级
</verification>

<success_criteria>
1. `pnpm tauri build --no-bundle` 在干净仓库（npm 已 install + Rust 缓存就绪）下退出码 0，产出 `src-tauri/target/release/gal-lib.exe` 单文件
2. 上述 exe 字节数 / (1024*1024) < 30（APP-03 硬约束）
3. 把上述 exe 单独拷到 `D:\tmp\gal-lib-portable\` 后双击启动，主窗口在 1280×800 出现，标题 `gal-lib`，自定义 titlebar 与双栏布局正确渲染
4. 启动后 exe 同级 `data/` 目录自动出现，含 app.db、config.json、covers/、screenshots/、saves/、logs/（APP-01 + APP-02）
5. SQLite 查询 `app_meta.schema_version` 返回 `1`（APP-02）
6. `%APPDATA%\com.gal-lib.app\` 不存在（path_mapper 绝对路径绕过在 release 下生效）
7. 把 portable 目录 zip → 解压到另一位置 → 双击启动 → 应用正常运行（验证可分发性）
8. `docs/PHASE-01-VERIFICATION.md` 含实测字节、MB、启动耗时、6 项视觉 checklist（全 `[x]`）、zip 重定位结果、WebView2/VCRedist 依赖说明
9. `src-tauri/Cargo.toml` 的 `[profile.release]` 含 6 项体积优化字段（codegen-units=1, lto=true, opt-level="s", panic="abort", strip=true, incremental=false）
10. `src-tauri/tauri.conf.json` 含 `build.removeUnusedCommands: true` 与 `bundle.targets: ["nsis"]`
11. 本 plan 未越权动 01a/01b/01c/01d/01e 的产物文件（src/*.tsx、src-tauri/src/*.rs、migrations/*.sql 无修改）
</success_criteria>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| 用户文件系统 → exe | 用户从可能的不可信位置（U 盘、网盘、临时目录）双击 exe；exe 必须只在自己同级 data/ 写文件，不污染系统其他目录 |
| build host → release exe | 构建产物嵌入了 [profile.release] 设置；上传/分发时不应携带 debug 符号、`incremental` 缓存、源路径 |
| zip 解压 → 二次启动 | 用户拷贝 portable 目录到新位置；新位置必须能独立运行而不依赖原始位置（无绝对路径硬编码） |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01f-01 | I (Information Disclosure) | release exe binary | mitigate | `[profile.release] strip = true` 去除 debug 符号；`trim-paths` 不主动启用（nightly only），但已通过 strip 满足 ASVS L1 V14 |
| T-01f-02 | T (Tampering) | portable data/ next to exe | accept | exe 同级写入是 portable 设计意图；用户对 exe 所在目录有完全控制权（v1 不做 DB 加密，CONTEXT 锁定） |
| T-01f-03 | I (Information Disclosure) | %APPDATA% pollution | mitigate | path_mapper 绝对路径绕过（01c 实装），本 plan 在 release 下做回归校验：`%APPDATA%\com.gal-lib.app\` 路径不存在断言 |
| T-01f-04 | D (Denial of Service) | exe size > 30MB | mitigate | `[profile.release]` 6 项 + `removeUnusedCommands: true` 双重压缩；如失败有 cargo bloat 排查路径，不静默接受 |
| T-01f-05 | E (Elevation) | WebView2 runtime | accept | 系统级组件，由 OS / Edge updater 维护；Win10 1803+ / Win11 内置，符合 ASVS L1 范围 |
| T-01f-06 | R (Repudiation) | build provenance | accept | Phase 1 不签名 / 不出 SBOM（ROADMAP Out of Scope）；distribution 通过 trusted channel（GitHub Release）解决 |
| T-01f-07 | T (Tampering) | zip relocate 后路径漂移 | mitigate | exe 同级路径解析在每次启动时重算（01c 用 `current_exe()` 派生），不存绝对路径于 config.json，本 plan zip+relocate 测试做回归校验 |
</threat_model>

<output>
After completion, create `D:\project\gal-lib\.planning\phases\01-foundation\01f-SUMMARY.md` 含：

- 实测 release build 耗时（秒）+ exe 字节数 + MB 折算
- 双击启动到主窗口出现的耗时（秒）
- 6 项视觉 checklist 是否全勾（粘贴 PHASE-01-VERIFICATION.md 中 Visual checklist 节）
- zip 重定位测试结果（PASS/FAIL）
- 是否触发任一 Failure Mode；如有，简述并链接到 PHASE-01-VERIFICATION.md 的 Failure Mode 节
- 与 RESEARCH §Pitfall 6 预期对比：实测体积是否在 8–25MB 区间（预测）；如低于 10MB 或高于 25MB，分析原因
- WebView2 / VCRedist 依赖在测试机上的实际状态（是否需要预装提示）
- 对 Phase 2+ 的回填建议（如 cargo bloat 显示某个 crate 偏大，建议 Phase 2 评估替代）

并更新 `D:\project\gal-lib\.planning\STATE.md`：
- 把 phase 01-foundation 状态从 in-progress 推进到 verified
- 在 decisions 节追加：`Phase 1 single-exe size: <bytes> bytes / <MB> MB (verified 2026-05-07)`
- 在 patterns 节追加：`Single-exe build command: pnpm tauri build --no-bundle → src-tauri/target/release/gal-lib.exe（不是 NSIS setup.exe）`
</output>
</content>
</invoke>