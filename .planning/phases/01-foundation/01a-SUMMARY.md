---
phase: 01-foundation
plan: 01a
status: complete
completed: 2026-05-07
---

# Plan 01a — Tauri v2 + Vite + React + TS strict 脚手架 (Summary)

## 交付内容

可启动的 Tauri v2 项目骨架：pnpm + Vite 7 + React 19 + TypeScript strict + Rust crate + HashRouter 占位。`pnpm tauri dev` 能拉起空白窗口（视觉验证留给 01b/01d，01a 只验证启动不报错）。

## 文件清单

**前端：**
- `package.json` — gal-lib@0.1.0；React 19.2.6 / react-dom 19.2.6 / react-router-dom ^6.30.3 / @tauri-apps/api ^2.11.0；devDeps Vite ^7.0.4 / @vitejs/plugin-react ^5.0.13 / TypeScript ^5 / @tauri-apps/cli ^2.11.1
- `pnpm-lock.yaml` — pnpm 锁文件
- `tsconfig.json` / `tsconfig.node.json` — strict: true
- `vite.config.ts` — 端口 1420，HMR、Tauri devUrl 联通
- `index.html` — `<div id="root">` + Tauri 协议适配
- `src/main.tsx` — `createHashRouter` + `RouterProvider`，`createRoot` 挂载，注释明确「`./index.css` 留给 01b、`<RouterProvider>` 完整布线留给 01d」
- `src/App.tsx` — 极简「Hello gal-lib」占位（inline style，颜色用 UI-SPEC 锁定的 `#0F1115` / `#E5E7EB`），明确注释「01d 替换为 RootLayout」
- `src/vite-env.d.ts` — Vite 类型
- `src/App.css` / `src/assets/` — Vite 模板原样保留（01b 引入 Tailwind 后会被 `index.css` 取代或留作不导入的死文件）
- `public/` — Tauri 模板默认静态资源
- `.gitignore` — 含 `node_modules` / `dist` / `/src-tauri/target/` / `/data/` / `/data-dev/`（防御性，01c 的运行时数据目录）

**后端 (`src-tauri/`)：**
- `Cargo.toml` — tauri 2.x / serde / serde_json + `[profile.release]`（codegen-units=1 / lto=true / opt-level="s" / panic="abort" / strip=true）；**移除了** `create-tauri-app` 模板默认装入的 `tauri-plugin-opener`（出 Phase 1 范围）
- `Cargo.lock` — 已生成
- `build.rs` — `tauri_build::build()`
- `tauri.conf.json` — `productName: "gal-lib"`, `identifier: "com.gal-lib.app"`, `version: "0.1.0"`, `windows[0]: { width: 1280, height: 800, title: "gal-lib", resizable: true }`，**`decorations` 字段未设置**（默认 true，留给 01e 改 false）
- `src/main.rs` — `gal_lib_lib::run()`
- `src/lib.rs` — 极简 `Builder::default().run()`；明确注释「sql/log 插件 01c 加；窗口/标题定制 01e 加」
- `icons/icon.ico` / `32x32.png` / `128x128.png` / `128x128@2x.png` — Tauri 模板默认占位图标（01f 验证完整性，美术 logo 留 P4/P5）
- `capabilities/default.json` — 仅 `core:default`，未追加任何额外权限（01c 加 sql:*；01e 加 core:window:*）

## 与 PLAN 的偏离

| 项 | PLAN 期望 | 实际 | 原因 |
|---|---|---|---|
| Vite 主版本 | "Vite 5/6/7 — 看模板装什么" | Vite 7 | `pnpm create tauri-app` 当前模板装 v7；RESEARCH 也注明可接受范围 |
| `pnpm-workspace.yaml` | files_modified 列出但未实际创建 | 未创建 | 单包项目无需 workspace 文件；模板未生成；不影响功能 |
| `eslint.config.js` | files_modified 列出 | 未创建 | Tauri 模板无 ESLint；TS strict 已经覆盖类型问题；ESLint 留待 02+ |

无功能性偏离；所有锁定决策（pnpm / TS strict / HashRouter / v6 锁定 / `decorations` 未触碰 / icons 占位 / opener 已剔除）均符合契约。

## 验证结果

- `pnpm install` — 成功 ✅
- `pnpm typecheck` (`tsc --noEmit`) — 退出 0 ✅
- `cargo check --manifest-path src-tauri/Cargo.toml` — 退出 0 ✅（首次编译耗时一次，后续 cache）
- `pnpm tauri dev` — 启动后窗口可见，无 panic / 无 error ✅（启动期约 5-8s）
- `package.json` grep — `react-router-dom` 版本以 `^6.` 起始（v6 锁定生效）✅
- `src/main.tsx` grep — 含 `createHashRouter`，无 `BrowserRouter` / `MemoryRouter`（HashRouter 锁定生效）✅
- `src-tauri/tauri.conf.json` 不含 `"decorations": false`（01e 留座）✅
- `src-tauri/Cargo.toml` 不含 `tauri-plugin-sql` / `dunce` / `anyhow` / `thiserror`（01c 留座）✅

## 给下游 plan 的 Hand-off

| 下游 plan | 接 01a 后可立即做的事 |
|---|---|
| **01b** (Tailwind + shadcn) | 在 `src/main.tsx` 顶部追加 `import "./index.css";`，运行 `pnpm dlx shadcn@latest init`，扩展 `tailwind.config.ts` 时注意 `content: ["./index.html", "./src/**/*.{ts,tsx}"]` |
| **01c** (data dir + SQLite) | `src-tauri/Cargo.toml` 已就绪可追加 `tauri-plugin-sql`/`dunce`/`anyhow`/`thiserror`；`capabilities/default.json` 可追加 `sql:*` 权限；`lib.rs` 的极简 Builder 可在 setup hook 加 `data_dir::ensure()` 与 `tauri_plugin_sql` 注册 |
| **01d** (App Shell) | `src/App.tsx` 是 placeholder，可整体覆写为 `<RootLayout>`；`src/main.tsx` 的临时 `createHashRouter` 单路由可移到新的 `src/router.tsx`，main.tsx 改为 import router 后挂载 |
| **01e** (Custom titlebar) | `src-tauri/tauri.conf.json` 的 `windows[0]` 需要追加 `decorations: false`；`capabilities/default.json` 需要追加 `core:window:allow-{minimize,toggle-maximize,close,start-dragging}` |
| **01f** (单 exe 验证) | `[profile.release]` 已就位 5 项；只需追加 `incremental = false`；`tauri.conf.json` 需要追加 `bundle.targets: ["nsis"]` 与 `bundle.removeUnusedCommands: true`；图标资源 4 张已在，`Square*.png` / `StoreLogo.png` 留给 01f 用 Tauri CLI 生成或从模板补齐 |

## 未解决 / 风险

- 模板默认 `tauri-plugin-opener` 已从 Cargo.toml 移除，但 `package.json` devDeps **未发现**对应 npm 包（`@tauri-apps/plugin-opener` 也未装）—— 干净 ✅
- 一次完整 `cargo build --release` 未在 01a 跑（耗时长，留给 01f 配齐 release 配置后做）
- Windows VCRedist / WebView2 依赖未在 01a 验证（留给 01f portable smoke test 在干净机器上确认）

## Commits

- `5bcc11a feat(01-01a): scaffold tauri v2 + vite + react + ts strict project`
- `63a608f feat(01-01a): wire react-router-dom v6 hashrouter placeholder`

## Status

✅ Plan 01a 完成 — Wave 1 通过，Wave 2 可启动（01b Tailwind + shadcn）。

---

*Note: This SUMMARY was reconstructed by the orchestrator after the executor agent's network connection dropped post-commit but pre-SUMMARY-write. Both task commits landed cleanly; verification was re-run by the orchestrator. No re-execution needed.*
