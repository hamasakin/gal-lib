---
phase: 01-foundation
plan: 01a
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - pnpm-lock.yaml
  - pnpm-workspace.yaml
  - tsconfig.json
  - tsconfig.app.json
  - tsconfig.node.json
  - vite.config.ts
  - eslint.config.js
  - index.html
  - .gitignore
  - src/main.tsx
  - src/App.tsx
  - src/vite-env.d.ts
  - src-tauri/Cargo.toml
  - src-tauri/build.rs
  - src-tauri/tauri.conf.json
  - src-tauri/src/main.rs
  - src-tauri/src/lib.rs
  - src-tauri/icons/icon.ico
  - src-tauri/icons/32x32.png
  - src-tauri/icons/128x128.png
  - src-tauri/icons/128x128@2x.png
  - src-tauri/capabilities/default.json
autonomous: true
requirements: [APP-03]
must_haves:
  truths:
    - "用户在仓库根目录运行 `pnpm install` 一次性完成所有依赖安装（含 Rust crate 通过 cargo build 触发）"
    - "用户运行 `pnpm tauri dev` 后 Tauri 主窗口在 1280×800 自动打开"
    - "前端通过 HashRouter 渲染 `Hello gal-lib` 占位页面（位于路径 `#/`）"
    - "TypeScript 严格模式 (`strict: true`) 通过 `pnpm tsc --noEmit` 类型检查"
    - "Tauri Rust 后端通过 `cargo check` 编译无错误"
  artifacts:
    - path: "package.json"
      provides: "pnpm 项目元数据 + scripts (dev/build/tauri/typecheck)"
      contains: "@tauri-apps/cli"
    - path: "pnpm-lock.yaml"
      provides: "pnpm 锁定文件（证明用 pnpm 安装而非 npm/yarn）"
    - path: "tsconfig.json"
      provides: "TypeScript 严格模式根配置"
      contains: "\"strict\": true"
    - path: "vite.config.ts"
      provides: "Vite 配置 + React 插件 + dev server 端口 1420"
      contains: "@vitejs/plugin-react"
    - path: "src/main.tsx"
      provides: "前端入口，挂载 HashRouter 到 #root"
      contains: "createHashRouter"
    - path: "src/App.tsx"
      provides: "占位根组件 (将被 01d 替换)"
      contains: "Hello gal-lib"
    - path: "src-tauri/Cargo.toml"
      provides: "Rust crate 元数据 + tauri/tauri-build 基础依赖 + release profile 优化"
      contains: "lto = true"
    - path: "src-tauri/tauri.conf.json"
      provides: "Tauri 配置：productName=gal-lib, identifier=com.gal-lib.app, window 1280×800, devUrl/frontendDist"
      contains: "com.gal-lib.app"
    - path: "src-tauri/src/main.rs"
      provides: "Rust 主进程入口 (调用 lib::run)"
    - path: "src-tauri/src/lib.rs"
      provides: "Tauri Builder 骨架 (此 plan 仅最小骨架，01c/01e 会扩展)"
    - path: ".gitignore"
      provides: "忽略 node_modules / dist / target / data/"
      contains: "target"
  key_links:
    - from: "package.json (scripts.tauri)"
      to: "@tauri-apps/cli"
      via: "pnpm tauri 命令"
      pattern: "\"tauri\":\\s*\"tauri\""
    - from: "src-tauri/tauri.conf.json (build.devUrl)"
      to: "vite dev server"
      via: "http://localhost:1420"
      pattern: "localhost:1420"
    - from: "src-tauri/tauri.conf.json (build.frontendDist)"
      to: "Vite production output"
      via: "../dist 相对路径"
      pattern: "\\.\\./dist"
    - from: "src/main.tsx"
      to: "src/App.tsx"
      via: "import App; HashRouter mount"
      pattern: "import.*App"
---

<objective>
搭建 gal-lib 项目最小可启动骨架：pnpm 项目元数据 + TS strict 配置 + Vite + React 19 入口 + Tauri v2 Rust crate + HashRouter 占位页 + 单一可连通的 `pnpm tauri dev` 启动验证。

Purpose: 为后续 5 个 plan（01b-01f）提供共同的脚手架基底；本 plan 不处理样式（Tailwind/shadcn 在 01b）、不处理 portable 数据目录与数据库（01c）、不处理 Layout 与路由分支（01d）、不处理自定义 titlebar（01e）、不处理打包验证（01f）。

Output:
- 一个可通过 `pnpm tauri dev` 启动的最小 Tauri v2 应用
- 主窗口 1280×800（暂时保留默认系统装饰栏，01e 会改为 decorations:false）
- WebView 中显示一个最简的 "Hello gal-lib" 占位页面，路径为 `#/`
- TS strict 与 cargo check 双重通过
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

<interfaces>
<!--
本 plan 是从零创建项目，无既有代码可读取，但 RESEARCH.md 中已经定义了关键的版本、配置片段与文件结构。
执行者必须严格遵守以下版本契约（直接照抄，不要"取最新"），出现任何 latest/* 都视为缺陷。
-->

**Locked package versions (RESEARCH.md § Standard Stack, VERIFIED 2026-05-07):**

dependencies (前端运行时):
- `react@19.2.6`
- `react-dom@19.2.6`
- `react-router-dom@^6.30.3`  ← 必须用 caret `^6` 范围，禁止 v7
- `@tauri-apps/api@^2.11.0`

devDependencies (前端构建):
- `@tauri-apps/cli@^2.11.1`
- `@vitejs/plugin-react@^5.0.13`
- `vite@^6` 或 `^7`（接受 `pnpm create tauri-app` 模板默认提供的版本，禁止手动指定 v8 — 模板未必兼容）
- `typescript@^5`
- `@types/react@^19`
- `@types/react-dom@^19`
- `@types/node@^20`

**Locked Cargo deps (本 plan 仅基础三件，sql/log/dunce 等留给 01c):**
- `tauri = { version = "2", features = [] }`
- `tauri-build = { version = "2", features = [] }`  (build-dep)
- `serde = { version = "1", features = ["derive"] }`
- `serde_json = "1"`

**Tauri config keys this plan owns (RESEARCH.md § tauri.conf.json):**
```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "gal-lib",
  "version": "0.1.0",
  "identifier": "com.gal-lib.app",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "beforeBuildCommand": "pnpm build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{
      "label": "main",
      "title": "gal-lib",
      "width": 1280,
      "height": 800,
      "minWidth": 960,
      "minHeight": 600,
      "resizable": true,
      "center": true
    }],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.ico"]
  }
}
```

**注意：本 plan 暂不写 `decorations: false`、`removeUnusedCommands`、`bundle.targets: ["nsis"]`、`webviewInstallMode` —— 这些字段属于 01e（titlebar）和 01f（打包验证），按 PLAN-OUTLINE 「跨层不变量」串行写入。**

**Capabilities (本 plan 仅最小集，01c 与 01e 会追加 sql/window 权限):**
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: 用 create-tauri-app 生成 pnpm + React + TS 模板，并强制锁定依赖版本</name>
  <files>
    package.json,
    pnpm-lock.yaml,
    tsconfig.json,
    tsconfig.app.json,
    tsconfig.node.json,
    vite.config.ts,
    index.html,
    src/main.tsx,
    src/App.tsx,
    src/vite-env.d.ts,
    src-tauri/Cargo.toml,
    src-tauri/build.rs,
    src-tauri/tauri.conf.json,
    src-tauri/src/main.rs,
    src-tauri/src/lib.rs,
    src-tauri/icons/icon.ico,
    src-tauri/icons/32x32.png,
    src-tauri/icons/128x128.png,
    src-tauri/icons/128x128@2x.png,
    src-tauri/capabilities/default.json,
    .gitignore
  </files>
  <read_first>
    D:\project\gal-lib\.planning\phases\01-foundation\01-RESEARCH.md (§ Standard Stack, § Installation 命令, § Recommended Project Structure, § tauri.conf.json),
    D:\project\gal-lib\.planning\phases\01-foundation\01-CONTEXT.md (§ Build Tooling & Stack Versions),
    D:\project\gal-lib\.planning\phases\01-foundation\01-PLAN-OUTLINE.md (Cross-cutting truths)
  </read_first>
  <action>
    用脚手架创建项目骨架。**关键：项目根目录就是 `D:\project\gal-lib\`，已包含 `.planning/`、`docs/`、`CLAUDE.md`，create-tauri-app 不能在含文件的目录下生成，所以采用「先在临时空目录生成，再把内容搬过来」的方式。** 步骤如下：

    1. 在 `D:\project\` 下创建临时空目录 `D:\project\__gal_lib_scaffold__`，然后执行：
       ```powershell
       cd D:\project\__gal_lib_scaffold__
       pnpm create tauri-app@4.6.2 gal-lib --template react-ts --manager pnpm --identifier com.gal-lib.app
       ```
       如果该 `--manager`/`--template`/`--identifier` 非交互参数在你的 create-tauri-app 版本不支持，回退到交互式：手动选择 `pnpm` / `TypeScript` / `React` / `TypeScript`，应用名 `gal-lib`，identifier `com.gal-lib.app`。

    2. 把生成的 `D:\project\__gal_lib_scaffold__\gal-lib\` 下的所有文件（包括 `src/`、`src-tauri/`、`package.json`、`tsconfig*.json`、`vite.config.ts`、`index.html`、`.gitignore` 等）**复制**（不是移动）到 `D:\project\gal-lib\`。如果 `D:\project\gal-lib\.gitignore` 已存在则合并，新增 `node_modules/`、`dist/`、`src-tauri/target/`、`/data/` 行。

    3. 复制完成后删除临时目录 `D:\project\__gal_lib_scaffold__`。

    4. 编辑 `D:\project\gal-lib\package.json`，确保字段：
       - `"name": "gal-lib"`
       - `"private": true`
       - `"version": "0.1.0"`
       - `"type": "module"`
       - `"scripts"` 至少包含：`"dev": "vite"`, `"build": "tsc -b && vite build"`, `"preview": "vite preview"`, `"tauri": "tauri"`, `"typecheck": "tsc --noEmit"`
       - `"dependencies"` 强制为：
         ```json
         "react": "19.2.6",
         "react-dom": "19.2.6",
         "react-router-dom": "^6.30.3",
         "@tauri-apps/api": "^2.11.0"
         ```
       - `"devDependencies"` 强制包含：
         ```json
         "@tauri-apps/cli": "^2.11.1",
         "@vitejs/plugin-react": "^5.0.13",
         "typescript": "^5",
         "@types/react": "^19",
         "@types/react-dom": "^19",
         "@types/node": "^20"
         ```
         其它由模板带入的 `vite`、`@types/*` 等保持不变（模板默认是 vite 6 或 7，都接受）。

    5. **关键校验：禁止 react-router-dom v7。** 如果模板生成的 lockfile 出现 `react-router-dom@7`，删除 `pnpm-lock.yaml` 后重装。

    6. 编辑 `D:\project\gal-lib\tsconfig.json`，**确保 `compilerOptions.strict: true`**（脚手架默认通常已是 true，但显式校验）。同时设 `"target": "ES2022"`、`"module": "ESNext"`、`"moduleResolution": "bundler"`、`"jsx": "react-jsx"`、`"isolatedModules": true`、`"noEmit": true`。增加 `"baseUrl": "."` 与 `"paths": { "@/*": ["src/*"] }`（为 01b 的 shadcn 准备好 alias）。

    7. 编辑 `D:\project\gal-lib\vite.config.ts`：保留模板生成的 `@vitejs/plugin-react`，server 端口固定为 `1420`，确认包含路径 alias `@` -> `./src`。最小内容：
       ```ts
       import { defineConfig } from "vite";
       import react from "@vitejs/plugin-react";
       import path from "node:path";

       export default defineConfig({
         plugins: [react()],
         clearScreen: false,
         server: {
           port: 1420,
           strictPort: true,
         },
         resolve: {
           alias: { "@": path.resolve(__dirname, "src") },
         },
       });
       ```

    8. 编辑 `D:\project\gal-lib\src-tauri\tauri.conf.json` 让其严格匹配 `<interfaces>` 中给出的 JSON（productName, identifier, devUrl, frontendDist, window 1280×800, minWidth 960, minHeight 600, resizable, center, security.csp=null）。**本任务不要写入 `decorations: false`、`removeUnusedCommands`、`webviewInstallMode`、`bundle.targets: ["nsis"]`** —— 这些归 01e/01f。

    9. 编辑 `D:\project\gal-lib\src-tauri\Cargo.toml` 仅保留本 plan 范围的依赖（`tauri`、`tauri-build`、`serde`、`serde_json`），**移除模板可能默认带入的 `tauri-plugin-opener` 等本期不需要的插件**。同时追加 `[profile.release]`：
       ```toml
       [profile.release]
       codegen-units = 1
       lto = true
       opt-level = "s"
       panic = "abort"
       strip = true
       ```
       （这是 RESEARCH.md § Code Examples 锁定的体积优化 profile，提前写入避免 01f 再回头改 wave 1 的文件。）

    10. 编辑 `D:\project\gal-lib\src-tauri\src\lib.rs`：保持模板提供的最小 `pub fn run()` 入口，但 **移除模板带入的 `tauri_plugin_opener`** 等本期不需要的 `.plugin(...)` 调用。最终骨架：
        ```rust
        #[cfg_attr(mobile, tauri::mobile_entry_point)]
        pub fn run() {
            tauri::Builder::default()
                .run(tauri::generate_context!())
                .expect("error while running tauri application");
        }
        ```

    11. 编辑 `D:\project\gal-lib\src-tauri\src\main.rs`：
        ```rust
        #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

        fn main() {
            gal_lib_lib::run()
        }
        ```
        其中 `gal_lib_lib` 名称必须与 `Cargo.toml` `[lib].name` 一致；按 RESEARCH.md `[lib] name = "gal_lib_lib"`。如果模板生成的 lib 名是 `gal_lib_lib`、`gal_lib`、`app_lib` 等，统一改成 `gal_lib_lib`。

    12. 编辑 `D:\project\gal-lib\src-tauri\capabilities\default.json` 让其严格匹配 `<interfaces>` 中给出的最小集（`core:default` 单条权限），**移除模板带入的 `core:window:default`、`opener:*` 等** —— window 权限归 01e，sql 权限归 01c。

    13. 在仓库根目录运行 `pnpm install`（这会同时拉取 Rust crate registry 索引）。

    14. **至此本任务完成。** 不要运行 `pnpm tauri dev` —— 那是 Task 2 的事。
  </action>
  <verify>
    <automated>
      cd D:\project\gal-lib; ^
      test -f package.json -a -f pnpm-lock.yaml -a -f tsconfig.json -a -f vite.config.ts -a -f index.html -a -f src/main.tsx -a -f src/App.tsx -a -f src-tauri/Cargo.toml -a -f src-tauri/tauri.conf.json -a -f src-tauri/src/main.rs -a -f src-tauri/src/lib.rs -a -f src-tauri/capabilities/default.json -a -f .gitignore && ^
      grep -q '"strict": true' tsconfig.json && ^
      grep -q '"react-router-dom": "\^6' package.json && ^
      ! grep -E '"react-router-dom":\s*"\^?7' package.json && ^
      grep -q '"@tauri-apps/cli"' package.json && ^
      grep -q '"name": "gal-lib"' package.json && ^
      grep -q 'com.gal-lib.app' src-tauri/tauri.conf.json && ^
      grep -q '"productName": "gal-lib"' src-tauri/tauri.conf.json && ^
      grep -q '"width": 1280' src-tauri/tauri.conf.json && ^
      grep -q '"height": 800' src-tauri/tauri.conf.json && ^
      grep -q '"devUrl": "http://localhost:1420"' src-tauri/tauri.conf.json && ^
      grep -q 'lto = true' src-tauri/Cargo.toml && ^
      grep -q 'opt-level = "s"' src-tauri/Cargo.toml && ^
      ! grep -q 'tauri-plugin-opener' src-tauri/Cargo.toml && ^
      grep -q 'target' .gitignore && grep -q 'node_modules' .gitignore && grep -q '/data/' .gitignore
    </automated>
  </verify>
  <acceptance_criteria>
    - `D:\project\gal-lib\package.json` 存在且字段满足：name=gal-lib、scripts.tauri=tauri、`react-router-dom` 在 `^6` 范围（绝不能是 `^7`/`*`/`latest`）、`@tauri-apps/cli` 在 `^2.11`
    - `D:\project\gal-lib\pnpm-lock.yaml` 存在（证明用 pnpm 而非 npm/yarn）
    - `D:\project\gal-lib\tsconfig.json` 中 `"strict": true` 显式存在（grep 命中）
    - `D:\project\gal-lib\src-tauri\tauri.conf.json` 中 productName=gal-lib、identifier=com.gal-lib.app、window width=1280 height=800 minWidth=960 minHeight=600、devUrl=http://localhost:1420、frontendDist=../dist 全部命中 grep
    - `D:\project\gal-lib\src-tauri\tauri.conf.json` **不** 含 `decorations: false`、`removeUnusedCommands`、`webviewInstallMode`（留给 01e/01f）
    - `D:\project\gal-lib\src-tauri\Cargo.toml` 含 `[profile.release]` 中 `lto = true` 与 `opt-level = "s"`
    - `D:\project\gal-lib\src-tauri\Cargo.toml` 不含 `tauri-plugin-opener`（不在本期范围）
    - `D:\project\gal-lib\src-tauri\capabilities\default.json` 仅 `core:default` 一条权限
    - `D:\project\gal-lib\.gitignore` 含 `node_modules`、`/data/`、`target` 三行
    - 临时目录 `D:\project\__gal_lib_scaffold__` 已删除（该路径不存在）
  </acceptance_criteria>
  <done>
    项目目录中具备完整的 Tauri v2 + Vite + React 19 + TS strict 模板文件，依赖锁定到 RESEARCH.md 列出的 VERIFIED 版本，react-router-dom 严格 v6，所有关键 grep 校验通过。
  </done>
</task>

<task type="auto">
  <name>Task 2: 接入 react-router-dom v6 HashRouter，写入最小 "Hello gal-lib" 占位入口</name>
  <files>
    src/main.tsx,
    src/App.tsx,
    index.html
  </files>
  <read_first>
    D:\project\gal-lib\src\main.tsx (Task 1 生成),
    D:\project\gal-lib\src\App.tsx (Task 1 生成),
    D:\project\gal-lib\index.html (Task 1 生成),
    D:\project\gal-lib\.planning\phases\01-foundation\01-RESEARCH.md (§ Pattern 6: HashRouter + RootLayout, § Pitfall 4: HashRouter v6 vs v7),
    D:\project\gal-lib\.planning\phases\01-foundation\01-PLAN-OUTLINE.md (01a 与 01d 的边界 — 占位文案不要逐字写出 UI-SPEC 的 Copywriting Contract，那是 01d 的工作)
  </read_first>
  <action>
    把 Task 1 生成的默认 React Vite 入口替换为 react-router-dom v6 HashRouter 的最小可运行结构。本 plan **不实现 RootLayout、Sidebar、Titlebar、空状态、/settings 路由**（这些是 01d/01e 的工作），只保证 HashRouter 框架就位、`#/` 渲染 `<App />`、`<App />` 显示一行文本占位。

    1. 完整覆写 `D:\project\gal-lib\src\main.tsx`：
       ```tsx
       import { createRoot } from "react-dom/client";
       import { createHashRouter, RouterProvider } from "react-router-dom";
       import App from "./App";

       const router = createHashRouter([
         {
           path: "/",
           element: <App />,
         },
       ]);

       const rootEl = document.getElementById("root");
       if (!rootEl) {
         throw new Error("#root element not found in index.html");
       }
       createRoot(rootEl).render(<RouterProvider router={router} />);
       ```
       注意：**不引入 `index.css` import**（Tailwind/shadcn 在 01b 处理）。如果 Task 1 生成的 main.tsx 已经 `import "./App.css"`/`import "./index.css"`，本任务先**注释掉这行 import**（用 `// import "./index.css"; // wired in 01b`）以保证当下能跑且不留下空文件冲突。如果模板生成了 `src/index.css`/`src/App.css`，**保留文件不要删**（01b 会重写 index.css），仅断开 import 链。

    2. 完整覆写 `D:\project\gal-lib\src\App.tsx`（默认导出函数组件，名字 `App`）：
       ```tsx
       export default function App() {
         return (
           <div
             style={{
               display: "flex",
               alignItems: "center",
               justifyContent: "center",
               height: "100vh",
               fontFamily:
                 'ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif',
               fontSize: 14,
               background: "#0F1115",
               color: "#E5E7EB",
             }}
           >
             Hello gal-lib
           </div>
         );
       }
       ```
       这里用 inline style 而非 Tailwind 类，因为 Tailwind 还没接入（在 01b）；颜色直接用 UI-SPEC 的 `#0F1115` 与 `#E5E7EB` 让视觉先和最终方向一致。**字符串「Hello gal-lib」** 是临时占位，01d 会替换为 RootLayout + 空状态。

    3. 编辑 `D:\project\gal-lib\index.html`：
       - 确保 `<html lang="zh-CN" class="dark">` （`class="dark"` 提前写好为 01b 准备；本期此 class 没有效果）
       - 确保 `<title>gal-lib</title>`
       - 确保 `<body>` 内含 `<div id="root"></div>` 与 `<script type="module" src="/src/main.tsx"></script>`
       - **暂不**引入任何 stylesheet link，inline style 已自给自足

    4. 运行 `pnpm tsc --noEmit` 必须通过（验证 TS strict + 类型完整）。

    5. 运行 `pnpm tauri dev` 启动开发模式（这是连通性烟测；Tauri 会在端口 1420 起 vite，然后启动 Rust crate 的 cargo build —— 首次会下载并编译 tauri/tauri-build 等 crate，可能耗时 3–10 分钟）。**期望：** 一段 cargo build 输出后弹出主窗口，标题 `gal-lib`，尺寸约 1280×800，画面上居中显示 `Hello gal-lib`。看到窗口出现后立即手动 Ctrl+C 中断 dev 进程（dev server 不需要持续运行，这一步只为证明可启动）。

    6. 运行 `cargo check --manifest-path src-tauri/Cargo.toml` 验证 Rust 编译干净（`pnpm tauri dev` 已经隐式做过一次 build，但 cargo check 是更轻量的复验）。
  </action>
  <verify>
    <automated>
      cd D:\project\gal-lib && ^
      grep -q 'createHashRouter' src/main.tsx && ^
      grep -q 'RouterProvider' src/main.tsx && ^
      grep -q 'import App from' src/main.tsx && ^
      grep -q 'export default function App' src/App.tsx && ^
      grep -q 'Hello gal-lib' src/App.tsx && ^
      grep -q 'lang="zh-CN"' index.html && ^
      grep -q 'class="dark"' index.html && ^
      grep -q '<title>gal-lib</title>' index.html && ^
      grep -q 'id="root"' index.html && ^
      pnpm tsc --noEmit && ^
      cargo check --manifest-path src-tauri/Cargo.toml
    </automated>
  </verify>
  <acceptance_criteria>
    - `src/main.tsx` 使用 `createHashRouter` + `RouterProvider`，import `App` 来自 `./App`，**不**包含 `BrowserRouter` 或 `MemoryRouter`
    - `src/App.tsx` 默认导出名为 `App` 的函数组件，组件渲染包含字符串 `Hello gal-lib`
    - `index.html` 含 `<html lang="zh-CN" class="dark">`、`<title>gal-lib</title>`、`<div id="root">`、`<script type="module" src="/src/main.tsx">`
    - `pnpm tsc --noEmit` 退出码 0（TS strict 通过）
    - `cargo check --manifest-path src-tauri/Cargo.toml` 退出码 0（Rust 编译通过）
    - 执行者已亲眼确认 `pnpm tauri dev` 能弹出主窗口并显示 `Hello gal-lib`（在 SUMMARY.md 中记录该 smoke test 时间戳与 Tauri/Rust 构建耗时，作为 01f 打包基线对照）
    - 没有任何文件 import 不存在的 CSS（`pnpm tsc --noEmit` 不会捕捉运行时缺失，但 `pnpm tauri dev` 启动失败会暴露）
  </acceptance_criteria>
  <done>
    `pnpm tauri dev` 能从空白仓库一键启动，主窗口显示 `Hello gal-lib`；TS strict + cargo check 双绿；后续 plan 01b/01c/01d/01e 可在此骨架上继续。
  </done>
</task>

</tasks>

<verification>
**Plan-level checks (执行完所有 task 后整体复验):**

1. **依赖锁定校验:**
   ```powershell
   cd D:\project\gal-lib
   findstr /C:"react-router-dom" package.json    # 必须 ^6.x，禁止 ^7
   findstr /C:"@tauri-apps/cli" package.json     # 必须 ^2.11
   ```

2. **TS strict + Rust check:**
   ```powershell
   pnpm tsc --noEmit
   cargo check --manifest-path src-tauri/Cargo.toml
   ```

3. **HashRouter 锁定（防止误用 BrowserRouter）:**
   ```powershell
   findstr /C:"BrowserRouter" src\main.tsx       # 必须无命中
   findstr /C:"createHashRouter" src\main.tsx    # 必须命中
   ```

4. **本 plan 不应写入未来 plan 的字段:**
   ```powershell
   findstr /C:"decorations" src-tauri\tauri.conf.json   # 必须无命中（01e 才写）
   findstr /C:"tauri-plugin-sql" src-tauri\Cargo.toml   # 必须无命中（01c 才加）
   findstr /C:"tailwindcss" package.json                # 必须无命中（01b 才加）
   findstr /C:"shadcn" package.json                     # 必须无命中（01b 才加）
   ```

5. **数据目录隔离（防止 01a 越权预创建）:**
   ```powershell
   if (Test-Path D:\project\gal-lib\data) { exit 1 } else { exit 0 }
   # data/ 目录必须由运行时（01c 实现）首次启动时创建，不应在仓库内预先 commit
   ```
</verification>

<success_criteria>
1. 仓库根目录 `D:\project\gal-lib\` 拥有完整的 pnpm + Vite + React 19 + Tauri v2 项目骨架（按 RESEARCH.md § Recommended Project Structure 的子集，不含 01b/01c/01d/01e/01f 的产物）
2. 依赖严格锁定：react-router-dom 在 `^6.30.x`、@tauri-apps/cli 在 `^2.11.x`、react 在 `19.2.6`
3. TypeScript `"strict": true` 写入 tsconfig.json 且 `pnpm tsc --noEmit` 通过
4. `pnpm tauri dev` 能从零启动到主窗口显示 `Hello gal-lib`（首次编译完成后窗口在 1280×800 出现）
5. `cargo check --manifest-path src-tauri/Cargo.toml` 退出码 0
6. `src-tauri/tauri.conf.json` 仅含本 plan 范围字段（productName/identifier/window 1280×800/devUrl/frontendDist），未越界写 decorations/removeUnusedCommands/bundle.targets nsis 等下游 plan 的字段
7. `src-tauri/Cargo.toml` 已写入 `[profile.release]` 体积优化 profile（lto/opt-level=s/strip）作为 01f 体积达标的前置铺垫
8. `.gitignore` 已包含 `node_modules`、`/data/`、`src-tauri/target/`（dev 模式 `current_exe()` 会写到 `target/debug/data/`，必须忽略）
9. 仓库内不存在预创建的 `data/` 目录（运行时由 01c 创建）
</success_criteria>

<output>
After completion, create `D:\project\gal-lib\.planning\phases\01-foundation\01a-SUMMARY.md` 含：

- 已锁定的关键版本（react/react-router-dom/@tauri-apps/cli/tauri/vite，以及 vite 模板实际带入的版本号）
- `pnpm tauri dev` 首次启动的实测耗时（cargo build 阶段 + 窗口出现时间）—— 用于 01f 估算 release build 时长
- 模板带入但被本任务**移除**的依赖列表（如 `tauri-plugin-opener`），便于后续 plan 决策时回溯
- TS strict + cargo check 双通过的时间戳
- 任何偏离 RESEARCH.md 推荐的事项（例如模板默认 vite 版本与 RESEARCH.md 标注的 8.0.10 不一致 → 记录实际版本与原因）
</output>
