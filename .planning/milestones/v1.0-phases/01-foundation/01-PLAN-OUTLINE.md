# Phase 1 Plan Outline

**Phase:** 01-foundation
**Goal:** 可运行的 Tauri 应用骨架交付：Portable 数据目录自动初始化、SQLite schema 就位、双栏 App Shell 可见，单 exe 打包验证通过。
**Phase req IDs:** APP-01, APP-02, APP-03, LIB-01

每个 plan 范围按 ~50% 上下文预算 + 2-3 任务设计。Wave 数依据严格依赖（前置产物 + 文件占用不重叠）推算；Wave 2 中 01b/01c 完全独立可并行；Wave 3 中 01d/01e 文件无重叠（Layout vs Titlebar）也并行。

| Plan ID | Objective | Wave | Depends On | Requirements | Files (preview, top 5) |
|---------|-----------|------|------------|--------------|------------------------|
| 01a | Tauri v2 + Vite + React + TS strict 脚手架（pnpm 项目骨架，Rust 后端入口，前端入口，HashRouter 占位，单连通启动验证） | 1 | [] | [APP-03] | package.json, pnpm-lock.yaml, src-tauri/Cargo.toml, src-tauri/tauri.conf.json, src-tauri/src/main.rs |
| 01b | Tailwind v3 + shadcn/ui + 暗色主题 token（按 UI-SPEC 锁定调色板与字号、字体栈、初始化 button/separator/scroll-area/tooltip 四个 shadcn block） | 2 | [01a] | [LIB-01] | tailwind.config.ts, postcss.config.js, src/index.css, components.json, src/components/ui/button.tsx |
| 01c | Portable data dir 解析 + tauri-plugin-sql 接入 + 0001 init migration（games/sessions/tags/game_tags/app_meta 五张核心表，schema_version 写入 app_meta；data/config.json 默认值；首次启动静默创建子目录 covers/screenshots/saves/logs） | 3 | [01a, 01b] | [APP-01, APP-02] | src-tauri/Cargo.toml, src-tauri/src/data_dir.rs, src-tauri/src/db.rs, src-tauri/migrations/0001_init.sql, src-tauri/src/lib.rs, package.json, pnpm-lock.yaml |
| 01d | App Shell 双栏布局（HashRouter, Layout, Sidebar 含「分类/全部/收藏/标签/通关状态」占位 + 底部「设置」可点 nav, Main 空状态「还没有游戏」+「打开设置」CTA, /settings 路由占位「设置 — 即将上线」, ScrollArea + Tooltip「即将开放」, Zustand store 占位） | 4 | [01b, 01c] | [APP-02, LIB-01] | src/main.tsx, src/App.tsx, src/routes/Library.tsx, src/routes/Settings.tsx, src/components/layout/Sidebar.tsx |
| 01e | 自定义 titlebar + 窗口控制（decorations: false in tauri.conf.json，36px drag region，最小化/最大化/关闭按钮调用 appWindow API；focus ring 2px accent；window 默认 1280×800、min 960×600） | 5 | [01b, 01c, 01d] | [LIB-01] | src-tauri/tauri.conf.json, src-tauri/capabilities/default.json, src/components/layout/Titlebar.tsx, src/components/layout/WindowControls.tsx, src/styles/titlebar.css, src/components/layout/TitlebarSlot.tsx |
| 01f | 单 exe 打包验证（pnpm tauri build 产物体积 < 30MB，双击 .exe → data/ 自动创建 → schema 初始化 → 主窗口呈现，bundle 配置 NSIS/portable target，记录验证步骤到 SUMMARY，icons 就位） | 6 | [01a, 01b, 01c, 01d, 01e] | [APP-03] | src-tauri/tauri.conf.json, src-tauri/icons/icon.ico, src-tauri/icons/32x32.png, src-tauri/icons/128x128.png, .gitignore |

**Wave 调整说明 (post-checker fixes B-1 + 二轮 TitlebarSlot 修复):**
- 原 OUTLINE 让 01b 与 01c 同处 Wave 2，但两者都需要 `pnpm install`（写 `package.json` + `pnpm-lock.yaml`），并行会造成 lockfile 写冲突。**修复 1 (B-1):** 把 01c 升到 Wave 3、`depends_on=[01a, 01b]`，让 lockfile 写入串行；下游 01d 顺移至 Wave 4。原 01e `depends_on=[01b]` 也升级为 `[01b, 01c]` 以避免 capabilities/default.json 与 01c 并行写冲突。
- 二轮 plan-checker 又发现 01d 与 01e 共同写 `src/components/layout/TitlebarSlot.tsx`（01d 写 stub，01e 覆写为 re-export），不能并行。**修复 2:** 把 01e 升到 Wave 5、`depends_on=[01b, 01c, 01d]`；连带 01f 升到 Wave 6。最终 wave 序列为 1→2→3→4→5→6，每个 wave 内并行（Wave 1-5 各只有一个 plan）。Wave 1 / Wave 6 单 plan 是合法的；并行收益放弃，换取文件所有权零冲突。

## Coverage Map

每个 phase req ID 至少映射到 1 个 plan：

- **APP-01** (Portable: exe 同级 data/) → 01c（data_dir 解析 + 子目录创建 + config.json 默认值）
- **APP-02** (首次启动初始化 schema/config/目录) → 01c（migration 0001 + app_meta schema_version + 静默创建）, 01d（启动后空状态 UI 体现初始化完成）
- **APP-03** (单 exe < 30MB) → 01a（Tauri v2 单 exe 模板基线 + bundle target 配置）, 01f（打包验证 + 体积验收 + 双击启动 E2E）
- **LIB-01** (双栏布局：左 Sidebar + 右 Main) → 01b（Tailwind tokens 支撑布局尺寸 + shadcn ScrollArea/Separator/Tooltip 组件）, 01d（Layout 实装 220px Sidebar + 自适应 Main + 路由）, 01e（titlebar 36px 完成布局上沿）

完整覆盖：4/4 requirement IDs 已映射。

## Cross-cutting truths

观察可验：

- 双击 .exe 后窗口在 1280×800 显示；标题栏写「gal-lib」、自定义最小化/最大化/关闭可用；侧栏 220px 显示「分类」+「全部/收藏/标签/通关状态」+ 底部「设置」；主区显示「还没有游戏」+「请到设置页添加扫描根目录」+「打开设置」按钮（点击跳 /settings）。
- exe 同级出现 `data/` 目录，包含 `app.db`（SQLite，含 games/sessions/tags/game_tags/app_meta 五张表，且 app_meta.schema_version='1'）、`config.json`（JSON 默认值）、空子目录 `covers/screenshots/saves/logs/`。
- /settings 路由显示「设置 — 即将上线」占位；侧栏占位项 hover 出 Tooltip「即将开放」、`cursor-not-allowed`、`text-muted`。
- 焦点环 2px `#7C5CFF` accent；除选中标记 + focus ring 外无 accent 出现；窗口背景 `#0F1115`、侧栏 `#181B22`。
- bundle 产物单文件 < 30MB；Cargo release + Vite production build 无错误；TS strict 通过；ESLint/typecheck 通过。
- 所有用户数据（DB / config / cache 子目录）严格落在 exe 同级 `data/`，无任何写入 `%APPDATA%` 或注册表。

跨层不变量：

- 文件所有权零冲突：01b 只动 src/index.css + tailwind.config.ts + components.json + src/components/ui/*；01c 只动 src-tauri/{Cargo.toml,src/db.rs,src/data_dir.rs,migrations/*,src/lib.rs}；01d 只动 src/{main.tsx,App.tsx,routes/*,components/layout/Sidebar.tsx}；01e 只动 src/components/layout/{Titlebar,WindowControls}.tsx + src/styles/titlebar.css + tauri.conf.json 的 window/decorations 字段。
- tauri.conf.json 在 01a（初始）→ 01e（decorations/window 尺寸/drag region）→ 01f（bundle target/icons/产物名）三段串行写，靠 wave 顺序避免冲突。
- Cargo.toml 在 01a（基础依赖）→ 01c（追加 tauri-plugin-sql + 序列化/日志 crate）两段串行写，wave 1 → wave 2 顺序保证安全。
- 所有占位文案严格对齐 UI-SPEC「Copywriting Contract」表格，不允许 emoji/感叹号/单部分文案。

## OUTLINE COMPLETE
Plans: 01a, 01b, 01c, 01d, 01e, 01f
