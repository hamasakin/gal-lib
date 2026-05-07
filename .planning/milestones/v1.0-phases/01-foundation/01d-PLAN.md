---
phase: 01-foundation
plan: 01d
type: execute
wave: 4
depends_on: [01b, 01c]
files_modified:
  - src/main.tsx
  - src/App.tsx
  - src/router.tsx
  - src/routes/Library.tsx
  - src/routes/Settings.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/TitlebarSlot.tsx
  - src/store/app.ts
  - package.json
  - pnpm-lock.yaml
autonomous: true
requirements: [APP-02, LIB-01]
must_haves:
  truths:
    - "用户运行 `pnpm tauri dev` 后主窗口左侧呈现 220px 固定宽度 Sidebar，画面上沿是 36px 的 TitlebarSlot 占位条（与 sidebar/main 相邻、`bg-card`、`border-b`），下方分为左 Sidebar + 右 Main 双栏布局（LIB-01）"
    - "Sidebar 第一段显示 section heading `分类`（13px label，muted 前景色）；下方 4 个静态占位项 `全部` / `收藏` / `标签` / `通关状态`，每项呈 `cursor-not-allowed` + `text-muted-foreground` + 不可选中（`select-none`），鼠标悬停约 300ms 后弹出 Tooltip 文本 `即将开放`"
    - "Sidebar 底部用 `<Separator>` 隔开，再放一个 `设置` 导航项（lucide `Settings` icon + 文字），点击后路由切到 `#/settings`；当 URL 在 `/settings` 时该项左侧出现 2px `#7C5CFF` 竖条 + `bg-accent` 高亮"
    - "Main 区在 `/` 路由下显示空状态：标题 `还没有游戏`（H2 18px/600/1.4）+ 副文 `请到设置页添加扫描根目录`（Body 14px）+ ghost 按钮 `打开设置`（点击 `useNavigate('/settings')`），三者垂直水平居中并包在 `<ScrollArea>` 内（APP-02 启动后空状态可见）"
    - "Main 区在 `/settings` 路由下显示占位文本 `设置 — 即将上线`（H2 18px/600/1.4）"
    - "前端用 `createHashRouter`（**不是** `BrowserRouter`/`MemoryRouter`），路由表恰好两条：`/` → `<Library/>`、`/settings` → `<Settings/>`"
    - "App 启动后 Zustand store `useAppStore` 在 `<App/>` mount 的 `useEffect` 中调一次 01c 暴露的 `getDataDir()`，并把结果写入 `state.dataDir`（首次 render 期间 `dataDir` 为 `null`，async 完成后非 null）"
    - "`pnpm tsc --noEmit` 退出码 0；`pnpm tauri dev` 启动后无运行时报错（背景仍为 #0F1115，shell 渲染完整）"
  artifacts:
    - path: "src/main.tsx"
      provides: "前端入口：保留 01b `import \"./index.css\"`，从 `./router` 导入 `router` 并 mount `<RouterProvider>`"
      contains: "RouterProvider"
    - path: "src/App.tsx"
      provides: "Layout 根：`<div class=\"flex flex-col h-screen\">` 包 `<TitlebarSlot/>` + `<div class=\"flex flex-1 min-h-0\">` 内含 `<Sidebar/>` + `<main class=\"flex-1 min-w-0\"><Outlet/></main>`；并在 mount 时一次性 fetch dataDir 写入 store"
      contains: "TitlebarSlot"
    - path: "src/router.tsx"
      provides: "`createHashRouter` 路由表：`/` → `<App/>` (含 Outlet) → 子路由 index `<Library/>` + `settings` `<Settings/>`"
      contains: "createHashRouter"
    - path: "src/routes/Library.tsx"
      provides: "空状态页：H2 `还没有游戏` + Body `请到设置页添加扫描根目录` + ghost Button `打开设置`，垂直水平居中，外包 ScrollArea"
      contains: "还没有游戏"
    - path: "src/routes/Settings.tsx"
      provides: "Settings 占位页：H2 `设置 — 即将上线`"
      contains: "设置 — 即将上线"
    - path: "src/components/layout/Sidebar.tsx"
      provides: "220px 固定宽度的左侧栏：分类 heading + 4 个 disabled 占位项（带 Tooltip `即将开放`）+ Separator + 底部 `设置` nav（active 状态左侧 2px accent 竖条）"
      contains: "w-[220px]"
    - path: "src/components/layout/TitlebarSlot.tsx"
      provides: "TitlebarSlot stub：渲染 `<div class=\"h-9 bg-card border-b border-border\" data-testid=\"titlebar-slot\" />`；01e 会**完整覆写本文件**为真实 `<Titlebar/>` 组件，import 路径稳定"
      contains: "data-testid=\"titlebar-slot\""
    - path: "src/store/app.ts"
      provides: "Zustand store 骨架：`{ dataDir: string | null; setDataDir(d): void }`；导出 `useAppStore` hook"
      contains: "create"
    - path: "package.json"
      provides: "新增 `zustand` 运行时依赖（^5）"
      contains: "zustand"
  key_links:
    - from: "src/main.tsx"
      to: "src/router.tsx"
      via: "import { router } from \"./router\"; <RouterProvider router={router}/>"
      pattern: "import\\s+\\{\\s*router\\s*\\}\\s+from\\s+[\"']\\./router[\"']"
    - from: "src/router.tsx"
      to: "src/App.tsx"
      via: "{ path: '/', element: <App/>, children: [...] }"
      pattern: "createHashRouter"
    - from: "src/App.tsx"
      to: "src/components/layout/TitlebarSlot.tsx + src/components/layout/Sidebar.tsx + react-router-dom Outlet"
      via: "JSX 组合"
      pattern: "Outlet"
    - from: "src/App.tsx"
      to: "src/store/app.ts + src/lib/db.ts (01c)"
      via: "useEffect 调 getDataDir() 后 useAppStore.setState({ dataDir })"
      pattern: "getDataDir|setDataDir"
    - from: "src/components/layout/Sidebar.tsx"
      to: "src/components/ui/{button,separator,scroll-area,tooltip}.tsx (01b) + lucide-react Settings icon"
      via: "shadcn imports + useNavigate / useLocation 决策 active 状态"
      pattern: "useNavigate|useLocation"
    - from: "src/routes/Library.tsx"
      to: "react-router-dom useNavigate"
      via: "ghost Button onClick → navigate('/settings')"
      pattern: "navigate\\([\"']/settings[\"']\\)"
---

<objective>
为 gal-lib 落地 Phase 1 的 App Shell 双栏布局：HashRouter 路由根 + 双栏 Layout（左 220px Sidebar / 右 Main + 上方 TitlebarSlot 占位条）+ Sidebar 静态分类占位 4 项（带 Tooltip）+ 底部「设置」可点 nav + Main 在 `/` 显示「还没有游戏」空状态 + 「打开设置」CTA + `/settings` 显示「设置 — 即将上线」占位 + Zustand store 骨架（`dataDir` 字段在 mount 时通过 01c 的 `getDataDir()` 填充）。

Purpose: 落地 LIB-01（双栏布局：左 Sidebar + 右 Main）与 APP-02（首次启动后 UI 可见 — 配合 01c 的 portable data 初始化，让用户在画面上看到「初始化已完成、库为空」的明确反馈）。本 plan 不实现真实 Titlebar/窗口控制（那是 01e）、不动 Tailwind tokens（已由 01b 锁定）、不动 SQLite/数据目录初始化（已由 01c 实现，本 plan 仅消费其暴露的 `getDataDir()` helper）、不动 tauri.conf.json 的 decorations/window 字段（01e 写）、不打包验证（01f）。

Output:
- `pnpm tauri dev` 启动后主窗口呈现完整 App Shell：上沿 36px TitlebarSlot 灰条 → 下方双栏（左 220px Sidebar，右 Main）
- Sidebar 含「分类」标签 + 4 个不可点击占位项（hover 出 Tooltip「即将开放」）+ Separator + 底部「设置」可点 nav
- `/` 路由 Main 显示居中空状态（H2「还没有游戏」+ 副文「请到设置页添加扫描根目录」+ ghost CTA「打开设置」）
- `/settings` 路由 Main 显示「设置 — 即将上线」占位
- Zustand store `useAppStore` 暴露 `dataDir` 字段，App mount 时通过 01c 的 Tauri command `get_data_dir` 异步填充
- `pnpm tsc --noEmit` + 视觉烟测双绿

Out of scope:
- 真实自定义 Titlebar / WindowControls / data-tauri-drag-region（01e）
- tauri.conf.json `decorations: false`（01e）
- SQLite schema / 数据目录创建逻辑（01c 已落地，本 plan 仅 import）
- Tailwind / shadcn 接入（01b 已落地）
- 单 exe 打包验证（01f）
- 任何真实业务（扫描、元数据、启动、计时 — Phase 2/3/4/5）
- 主题切换（CONTEXT 锁定 dark-only）
- skeleton loaders / toasts / 动画（CONTEXT/UI-SPEC 锁定 P1 不做）
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
@D:\project\gal-lib\.planning\phases\01-foundation\01-UI-SPEC.md
@D:\project\gal-lib\.planning\phases\01-foundation\01-RESEARCH.md
@D:\project\gal-lib\.planning\phases\01-foundation\01-PLAN-OUTLINE.md
@D:\project\gal-lib\.planning\phases\01-foundation\01a-PLAN.md
@D:\project\gal-lib\.planning\phases\01-foundation\01b-PLAN.md
@D:\project\gal-lib\.planning\phases\01-foundation\01c-PLAN.md

<wave_safety>
<!--
本 plan 与 01e 同处 Wave 3。两者都对 `src/App.tsx` 有写入：01d 写整个 Layout 结构（含 `<TitlebarSlot/>` 占位），01e 仅替换 import + JSX 标签
（`<TitlebarSlot/>` → `<Titlebar/>`）。

为避免乱序执行：
- **01d 必须先执行**（写完整 Layout + TitlebarSlot stub 文件）。
- **01e 后执行**：01e 直接把 `src/components/layout/TitlebarSlot.tsx` 文件**整体覆写**为真实 Titlebar 组件，并把 App.tsx 的 import
  `import { TitlebarSlot } from "@/components/layout/TitlebarSlot"` 改为 `import { Titlebar } from "@/components/layout/Titlebar"`，
  JSX `<TitlebarSlot/>` 改为 `<Titlebar/>`（或者 01e 也可以直接保留 TitlebarSlot 这个文件名/import 不动，仅替换内部实现 — 两条路都可，
  由 01e 的 plan 决定）。

本 plan 不预设 01e 的具体改法，只保证：01d ship TitlebarSlot.tsx + App.tsx 后，画面上 36px 的 `bg-card` 灰条已正常呈现，
满足 LIB-01 双栏布局的"上沿"约束 — 即便 01e 还没跑、Tauri 默认装饰栏仍在，01d 自身也是视觉自洽的。

执行序：执行者必须确认 01b 与 01c 都已被 SUMMARY 标记为 done 后再开始本 plan；执行 01e 时必须再次确认 01d 的 SUMMARY 已 done。
-->
</wave_safety>

<interfaces>
<!--
本 plan 在 01a/01b/01c 已就位的脚手架上工作。下面是「现成可消费」契约清单，执行者直接按此 import / 调用，不要重新探索。
-->

**01b 已就位（直接 import 使用）：**

```tsx
// shadcn UI 组件源文件 — 已经在 src/components/ui/ 下
import { Button } from "@/components/ui/button";        // variants: default | destructive | outline | secondary | ghost | link
import { Separator } from "@/components/ui/separator";  // orientation: horizontal | vertical
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// shadcn cn helper
import { cn } from "@/lib/utils";
```

**01b 已配置的 Tailwind 颜色 token（直接用 utility class）：**
- `bg-background` → `#0F1115`（main pane）
- `bg-card` → `#181B22`（sidebar / titlebar slot）
- `bg-secondary` / `bg-accent` → `#21252E`（surface elevated, sidebar item hover/active）
- `text-foreground` → `#E5E7EB`（body text）
- `text-muted-foreground` → `#9CA3AF`（section heading + 占位项 disabled）
- `border-border` → `#2A2F3A`（separator / divider）
- `ring-ring` → `#7C5CFF`（focus ring，brand accent，**也用作选中竖条颜色**）

**01b 已配置的 Tailwind fontSize alias（直接 `text-h2` / `text-body` / `text-label`）：**
- `text-body` → 14px / 400 / line-height 1.5
- `text-label` → 13px / 500 / line-height 1.4
- `text-h2` → 18px / 600 / line-height 1.4

**01c 已暴露（直接 import 调用）：**

```ts
// src/lib/db.ts (01c 已写)
export async function getDataDir(): Promise<string>;   // → 调 invoke<string>("get_data_dir")
export function getDb(): Promise<Database>;             // 本 plan 不调用，留给 Phase 2
```

Tauri command `get_data_dir` 已在 01c 的 `src-tauri/src/lib.rs` 中通过 `tauri::generate_handler![get_data_dir]` 注册并由 capability `default.json` 默认放行（01c capabilities 含 `core:default` + sql 相关；`get_data_dir` 是应用自定义 command，默认不需要额外权限项，01a 的 `core:default` 已涵盖）。

**zustand 包**：CONTEXT.md 锁定 `zustand` 作为状态管理库；RESEARCH.md § Standard Stack 锁定 `^5.0.x`。本 plan 用 `pnpm add zustand@^5` 一次性引入；不引入 `zustand/middleware`、`immer`、`persist` 等 — 01d 的 store 仅有一个 `dataDir` 字段，不需要中间件。

**react-router-dom v6 已安装**（01a 锁定 `^6.30.3`），用 `createHashRouter` + `RouterProvider` + `Outlet` + `useNavigate` + `useLocation`。**禁止用 `BrowserRouter`/`MemoryRouter`**。

---

**Locked copy strings（UI-SPEC §Copywriting Contract — verbatim，禁止任何替换/简化/英化）：**

| 元素 | 逐字内容 |
|---|---|
| Sidebar section heading | `分类` |
| Sidebar 4 个占位项（顺序固定） | `全部` / `收藏` / `标签` / `通关状态` |
| Sidebar 占位项 Tooltip | `即将开放` |
| Sidebar 底部 nav | `设置` |
| Main 空状态 H2 | `还没有游戏` |
| Main 空状态 Body | `请到设置页添加扫描根目录` |
| Main 空状态 CTA Button | `打开设置` |
| Settings 路由占位 | `设置 — 即将上线`（注意是中文长破折号 `—`，不是 `-` 也不是 `--`） |

**Locked layout 数值（UI-SPEC §Layout Contract）：**
- Sidebar 宽度：`w-[220px]`（**不允许** `w-56` / `w-[14rem]` / 其它别名 — 220px 是锁定值）
- TitlebarSlot 高度：`h-9`（36px = 9 × 4 = Tailwind h-9，锁定值）
- Sidebar `bg-card` + 右边 `border-r border-border`
- TitlebarSlot `bg-card` + 下边 `border-b border-border`
- Main `bg-background`（即 root 默认背景，省略 class 也可，但 explicit 更清晰）
- 文字默认 `text-foreground`
- Sidebar item padding：`px-4 py-2`（md=16px x，sm=8px y，符合 UI-SPEC §Spacing Scale）
- Sidebar 段间垂直间距：`py-2`（8px）

**Locked HashRouter 结构：**

```tsx
// src/router.tsx
import { createHashRouter } from "react-router-dom";
import App from "./App";
import { Library } from "./routes/Library";
import { Settings } from "./routes/Settings";

export const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Library /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);
```

注意：使用嵌套路由（`<App>` 作为 layout 路由，`<Outlet/>` 在 main 区域），让 `useLocation()` 在 Sidebar 内能精准判断 active；这是 RESEARCH.md § Pattern 6 锁定的 layout-route 模式。

**Locked Sidebar active 判定逻辑：**

```tsx
const location = useLocation();
const isSettingsActive = location.pathname === "/settings";
// active 时左侧加 2px 竖条 + bg-accent
```

竖条用 absolute positioning 或 `border-l-2 border-ring`；本 plan 推荐 `relative` 容器内放 `<span class="absolute left-0 top-0 h-full w-[2px] bg-ring" />`，避免 `border-l-2` 把字推位（保持 sidebar item padding 一致）。

**禁止/必须列表：**
- ❌ 禁止用 `BrowserRouter`、`MemoryRouter`
- ❌ 禁止改 Tailwind config / index.css（01b 锁定，本 plan 不动）
- ❌ 禁止改 tauri.conf.json / Cargo.toml / src-tauri 任何文件（01c/01e 范围）
- ❌ 禁止用 emoji / 感叹号
- ❌ 禁止「v1」「占位」「即将上线」之外的英文 placeholder copy
- ❌ 禁止动 `src/lib/db.ts`、`src/lib/utils.ts`、`src/components/ui/*`（前者 01c 已交付，后两者 01b 已交付）
- ✅ 必须用 `w-[220px]`（不要别名）
- ✅ 必须用 `createHashRouter`（grep 命中）
- ✅ 必须 8 条 locked copy 全部 grep 命中
- ✅ 必须 `<Tooltip>` 包 4 个占位项（每项独立 Tooltip 实例，或共享 1 个 `<TooltipProvider>` 在 Sidebar 顶层）
- ✅ Library 空状态外包 `<ScrollArea>`（UI-SPEC §Layout 要求 main 用 ScrollArea — 即使内容很短也要包，为后续 Phase 2 网格做准备）
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: 安装 zustand + 写入 store/router/路由组件三件套（Library、Settings、TitlebarSlot stub、useAppStore）</name>
  <files>
    package.json,
    pnpm-lock.yaml,
    src/store/app.ts,
    src/router.tsx,
    src/routes/Library.tsx,
    src/routes/Settings.tsx,
    src/components/layout/TitlebarSlot.tsx
  </files>
  <read_first>
    D:\project\gal-lib\package.json (确认 01a/01b/01c 已锁定 dependencies — 不重复添加 react/react-router/shadcn deps),
    D:\project\gal-lib\src\App.tsx (01a 写入的 inline-style "Hello gal-lib" — Task 2 才覆写，本任务不改 App.tsx),
    D:\project\gal-lib\src\main.tsx (01a 写的 createHashRouter inline 路由表 — Task 2 才改，本任务不改 main.tsx),
    D:\project\gal-lib\src\lib\db.ts (01c 已交付的 getDataDir / getDb helper，确认 export 签名),
    D:\project\gal-lib\src\components\ui\button.tsx (01b 已交付，确认 ghost variant 名为 "ghost"),
    D:\project\gal-lib\src\components\ui\tooltip.tsx (01b 已交付，确认 Tooltip/TooltipProvider/TooltipTrigger/TooltipContent 四个 export),
    D:\project\gal-lib\src\components\ui\scroll-area.tsx (01b 已交付),
    D:\project\gal-lib\src\components\ui\separator.tsx (01b 已交付),
    D:\project\gal-lib\src\lib\utils.ts (01b 已交付的 cn helper),
    D:\project\gal-lib\.planning\phases\01-foundation\01-UI-SPEC.md (§Copywriting Contract / §Layout Contract / §Interaction Contract 锁定 copy 与尺寸)
  </read_first>
  <action>
    本任务只新建/补全文件，不动 App.tsx / main.tsx（那是 Task 2）。

    **1. 安装 zustand**：
    ```powershell
    cd D:\project\gal-lib
    pnpm add zustand@^5
    ```
    安装后 `package.json` `dependencies` 应出现 `"zustand": "^5"` 或 `"^5.0.x"` 形式。如果 pnpm 解析为 v6+（极不可能），删 lockfile 用精确 `zustand@5.0.0` 重装。

    **2. 创建 `src/store/app.ts`**：
    ```ts
    import { create } from "zustand";

    /**
     * Application-wide ambient state.
     *
     * Phase 1 scope: only the resolved portable data directory absolute path
     * (filled at app boot via 01c's `getDataDir()` Tauri command). Future phases
     * will add scan progress, current selection, etc. — keep this surface minimal.
     */
    interface AppState {
      /** Absolute path to portable `data/` dir; null until first resolved. */
      dataDir: string | null;
      setDataDir: (dir: string) => void;
    }

    export const useAppStore = create<AppState>((set) => ({
      dataDir: null,
      setDataDir: (dir) => set({ dataDir: dir }),
    }));
    ```

    **3. 创建 `src/components/layout/TitlebarSlot.tsx`**（stub — 01e 会覆写本文件）：
    ```tsx
    /**
     * Titlebar slot for Phase 1.
     *
     * 01d (this plan) ships an empty 36px-tall placeholder bar so the App Shell's
     * top edge is visually self-consistent. 01e overwrites THIS FILE with the
     * real custom Titlebar (drag region + window controls). Keeping the import
     * path stable means 01d's <App> JSX does not need to change in 01e.
     */
    export function TitlebarSlot() {
      return (
        <div
          className="h-9 bg-card border-b border-border"
          data-testid="titlebar-slot"
        />
      );
    }
    ```

    **4. 创建 `src/routes/Library.tsx`**（按 UI-SPEC §Copywriting Contract / §Layout Contract）：
    ```tsx
    import { useNavigate } from "react-router-dom";
    import { ScrollArea } from "@/components/ui/scroll-area";
    import { Button } from "@/components/ui/button";

    export function Library() {
      const navigate = useNavigate();
      return (
        <ScrollArea className="h-full w-full">
          <div className="flex h-full min-h-full w-full items-center justify-center px-8">
            <div className="flex flex-col items-center gap-6 text-center">
              <h2 className="text-h2 text-foreground">还没有游戏</h2>
              <p className="text-body text-muted-foreground">
                请到设置页添加扫描根目录
              </p>
              <Button variant="ghost" onClick={() => navigate("/settings")}>
                打开设置
              </Button>
            </div>
          </div>
        </ScrollArea>
      );
    }
    ```
    注意：
    - `<ScrollArea>` 必须包整个内容（UI-SPEC §Layout 要求 main 用 ScrollArea）
    - 内层 `flex h-full min-h-full items-center justify-center` 实现垂直水平居中（ScrollArea 的 viewport 默认 `h-full`，需要 `min-h-full` 让短内容也能撑满）
    - H2 用 `text-h2`（01b 注册的 fontSize alias），Body 用 `text-body`
    - Button `variant="ghost"`（shadcn 内置 variant；UI-SPEC §Interaction Contract 指定 ghost）
    - Copy 严格逐字：`还没有游戏` / `请到设置页添加扫描根目录` / `打开设置`

    **5. 创建 `src/routes/Settings.tsx`**：
    ```tsx
    export function Settings() {
      return (
        <div className="flex h-full w-full items-center justify-center px-8">
          <h2 className="text-h2 text-foreground">设置 — 即将上线</h2>
        </div>
      );
    }
    ```
    注意：
    - 中文长破折号 `—`（U+2014），不是 `-` / `--` / `―`
    - H2 用 `text-h2`
    - 不包 `<ScrollArea>`（仅一行文字，包不包都可以；UI-SPEC §Layout 严格要求是 main 区域整体，但本 placeholder 极简一行不会 overflow，包 ScrollArea 反而引入空 viewport — 此处 deliberately 不包，与 Library 的差异由 verbose 注释记录）。**修订**：为保持 main pane 行为一致，仍然包 `<ScrollArea className="h-full w-full">`，里面再放 flex 居中容器。修订后内容：
    ```tsx
    import { ScrollArea } from "@/components/ui/scroll-area";

    export function Settings() {
      return (
        <ScrollArea className="h-full w-full">
          <div className="flex h-full min-h-full w-full items-center justify-center px-8">
            <h2 className="text-h2 text-foreground">设置 — 即将上线</h2>
          </div>
        </ScrollArea>
      );
    }
    ```

    **6. 创建 `src/router.tsx`**：
    ```tsx
    import { createHashRouter } from "react-router-dom";
    import App from "./App";
    import { Library } from "./routes/Library";
    import { Settings } from "./routes/Settings";

    export const router = createHashRouter([
      {
        path: "/",
        element: <App />,
        children: [
          { index: true, element: <Library /> },
          { path: "settings", element: <Settings /> },
        ],
      },
    ]);
    ```
    注意：
    - 用 layout-route 模式（`<App />` 是父，`<Library/>` `<Settings/>` 通过 `<Outlet/>` 渲染到 App 的 main 区）
    - `<App />` 默认导出 — Task 2 会把 App.tsx 改为 default-export 的 layout 组件

    **7. 不要在本任务运行 `pnpm tauri dev`**（main.tsx 还在 Task 2 才改，跑了也是 01a 的旧画面）。运行 `pnpm tsc --noEmit` 也不要 — 此时 router.tsx import 的 `App` 还是 01a 留下的「Hello gal-lib」inline 版（不接受 children），会报类型错。Task 2 会一并解决。

    **8. 文件清单复查**：本任务结束时新文件应有 5 个：
    - `src/store/app.ts`
    - `src/router.tsx`
    - `src/routes/Library.tsx`
    - `src/routes/Settings.tsx`
    - `src/components/layout/TitlebarSlot.tsx`
    + `package.json` 与 `pnpm-lock.yaml` 因新增 zustand 而被修改。
  </action>
  <verify>
    <automated>
      cd D:\project\gal-lib && \
      grep -q '"zustand"' package.json && \
      test -f src/store/app.ts && \
      test -f src/router.tsx && \
      test -f src/routes/Library.tsx && \
      test -f src/routes/Settings.tsx && \
      test -f src/components/layout/TitlebarSlot.tsx && \
      grep -q 'import { create } from "zustand"' src/store/app.ts && \
      grep -q 'export const useAppStore' src/store/app.ts && \
      grep -q 'dataDir: string | null' src/store/app.ts && \
      grep -q 'setDataDir' src/store/app.ts && \
      grep -q 'createHashRouter' src/router.tsx && \
      ! grep -q 'BrowserRouter' src/router.tsx && \
      ! grep -q 'MemoryRouter' src/router.tsx && \
      grep -q 'children: \[' src/router.tsx && \
      grep -q "path: \"settings\"" src/router.tsx && \
      grep -q 'index: true' src/router.tsx && \
      grep -q 'export function Library' src/routes/Library.tsx && \
      grep -q '还没有游戏' src/routes/Library.tsx && \
      grep -q '请到设置页添加扫描根目录' src/routes/Library.tsx && \
      grep -q '打开设置' src/routes/Library.tsx && \
      grep -q 'variant="ghost"' src/routes/Library.tsx && \
      grep -q 'useNavigate' src/routes/Library.tsx && \
      grep -q 'navigate("/settings")' src/routes/Library.tsx && \
      grep -q 'ScrollArea' src/routes/Library.tsx && \
      grep -q 'text-h2' src/routes/Library.tsx && \
      grep -q 'text-body' src/routes/Library.tsx && \
      grep -q 'export function Settings' src/routes/Settings.tsx && \
      grep -q '设置 — 即将上线' src/routes/Settings.tsx && \
      grep -q 'text-h2' src/routes/Settings.tsx && \
      grep -q 'export function TitlebarSlot' src/components/layout/TitlebarSlot.tsx && \
      grep -q 'h-9' src/components/layout/TitlebarSlot.tsx && \
      grep -q 'bg-card' src/components/layout/TitlebarSlot.tsx && \
      grep -q 'border-b' src/components/layout/TitlebarSlot.tsx && \
      grep -q 'data-testid="titlebar-slot"' src/components/layout/TitlebarSlot.tsx
    </automated>
  </verify>
  <acceptance_criteria>
    - `package.json` `dependencies` 含 `"zustand"` 在 `^5` 范围；`pnpm-lock.yaml` 已被本任务修改（mtime 更新）
    - `src/store/app.ts` 存在，含 `import { create } from "zustand"`、`useAppStore` export、`dataDir: string | null` 类型字段、`setDataDir` action
    - `src/router.tsx` 存在，含 `createHashRouter`，**不**含 `BrowserRouter` / `MemoryRouter`，含 `children` 数组、`{ index: true, element: <Library /> }`、`{ path: "settings", element: <Settings /> }`
    - `src/routes/Library.tsx` 存在，含 8 个 grep 锚点：`还没有游戏` / `请到设置页添加扫描根目录` / `打开设置` / `variant="ghost"` / `useNavigate` / `navigate("/settings")` / `ScrollArea` / `text-h2`
    - `src/routes/Settings.tsx` 存在，含 `设置 — 即将上线`（中文长破折号）
    - `src/components/layout/TitlebarSlot.tsx` 存在，含 `h-9` / `bg-card` / `border-b` / `data-testid="titlebar-slot"`
    - **不**修改 `src/App.tsx` / `src/main.tsx`（Task 2 才改）
    - **不**修改 `src/lib/db.ts` / `src/lib/utils.ts` / `src/components/ui/*` / `src/index.css` / `tailwind.config.ts` / `tauri.conf.json` / `Cargo.toml`（越界）
    - 不预创建 `src/components/layout/Sidebar.tsx`（那是 Task 2 的工作）
  </acceptance_criteria>
  <done>
    Zustand 安装就位；store skeleton + router 表 + Library/Settings 路由组件 + TitlebarSlot stub 五个新文件按 UI-SPEC 锁定 copy 与 layout 数值落地，所有 grep 校验通过。Task 2 可在此基础上接通 main.tsx + App.tsx + Sidebar 让画面可见。
  </done>
</task>

<task type="auto">
  <name>Task 2: 写入 Sidebar.tsx（220px / 4 占位项 + Tooltip / 设置 nav active 状态）+ 覆写 App.tsx 为 Layout + 改 main.tsx 用 router.tsx</name>
  <files>
    src/components/layout/Sidebar.tsx,
    src/App.tsx,
    src/main.tsx
  </files>
  <read_first>
    D:\project\gal-lib\src\store\app.ts (Task 1 写入 — 确认 useAppStore + setDataDir 签名),
    D:\project\gal-lib\src\router.tsx (Task 1 写入 — 确认 router export 名),
    D:\project\gal-lib\src\routes\Library.tsx (Task 1 写入),
    D:\project\gal-lib\src\routes\Settings.tsx (Task 1 写入),
    D:\project\gal-lib\src\components\layout\TitlebarSlot.tsx (Task 1 写入),
    D:\project\gal-lib\src\components\ui\button.tsx (01b — 确认 props),
    D:\project\gal-lib\src\components\ui\tooltip.tsx (01b — 确认 4 个 export 与用法签名),
    D:\project\gal-lib\src\components\ui\separator.tsx (01b — 确认 props),
    D:\project\gal-lib\src\lib\db.ts (01c — 确认 getDataDir),
    D:\project\gal-lib\src\App.tsx (01a 旧版 — 全量覆写),
    D:\project\gal-lib\src\main.tsx (01a/01b 旧版 — 改 router 入口),
    D:\project\gal-lib\.planning\phases\01-foundation\01-UI-SPEC.md (§Layout / §Color / §Copywriting / §Interaction)
  </read_first>
  <action>
    本任务把双栏布局真正"接通"：写 Sidebar、覆写 App.tsx 为 Layout、改 main.tsx 用 router 表。

    **1. 创建 `src/components/layout/Sidebar.tsx`**：
    ```tsx
    import { Settings as SettingsIcon } from "lucide-react";
    import { useLocation, useNavigate } from "react-router-dom";
    import { ScrollArea } from "@/components/ui/scroll-area";
    import { Separator } from "@/components/ui/separator";
    import {
      Tooltip,
      TooltipContent,
      TooltipProvider,
      TooltipTrigger,
    } from "@/components/ui/tooltip";
    import { cn } from "@/lib/utils";

    /** UI-SPEC §Copywriting Contract — order locked. */
    const PLACEHOLDER_CATEGORIES = ["全部", "收藏", "标签", "通关状态"] as const;

    export function Sidebar() {
      const navigate = useNavigate();
      const location = useLocation();
      const isSettingsActive = location.pathname === "/settings";

      return (
        <aside className="flex h-full w-[220px] shrink-0 flex-col bg-card border-r border-border">
          <ScrollArea className="flex-1">
            <div className="flex flex-col py-2">
              {/* Section heading: 分类 */}
              <div className="px-4 py-2 text-label text-muted-foreground select-none">
                分类
              </div>

              {/* Placeholder categories — non-interactive in P1 */}
              <TooltipProvider delayDuration={300}>
                <ul className="flex flex-col">
                  {PLACEHOLDER_CATEGORIES.map((label) => (
                    <li key={label}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            aria-disabled="true"
                            className={cn(
                              "px-4 py-2 text-body select-none",
                              "cursor-not-allowed text-muted-foreground",
                            )}
                          >
                            {label}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right">即将开放</TooltipContent>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
              </TooltipProvider>
            </div>
          </ScrollArea>

          {/* Bottom: Separator + 设置 nav */}
          <div className="flex flex-col">
            <Separator />
            <button
              type="button"
              onClick={() => navigate("/settings")}
              aria-current={isSettingsActive ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-2 px-4 py-2 text-body text-foreground",
                "transition-colors duration-150",
                "hover:bg-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isSettingsActive && "bg-accent",
              )}
            >
              {isSettingsActive && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-0 h-full w-[2px] bg-ring"
                />
              )}
              <SettingsIcon size={16} />
              <span>设置</span>
            </button>
          </div>
        </aside>
      );
    }
    ```
    注意细节：
    - 根用 `<aside>`（语义化），`w-[220px]`（**严格 220px** — UI-SPEC 锁定值）+ `shrink-0`（不被 main flex 压缩）
    - `flex flex-col`：上面分类区 + 下面 nav 区
    - 分类 heading「分类」用 `text-label text-muted-foreground`（13px / 500 / 1.4 / muted）
    - 4 个占位项：每项独立 `<Tooltip>`，外层共享 `<TooltipProvider delayDuration={300}>`（300ms 比默认 700ms 更接近 1s 直觉，但仍 P1 无动画 spec — 取 shadcn 默认 700 也接受）
    - `cursor-not-allowed text-muted-foreground select-none`：占位项视觉表达「不可交互」
    - `<TooltipTrigger asChild>` 包一个 `<div>` 而不是 `<button>` —— 因为是 disabled 状态，HTML `<button disabled>` 会丢 hover 事件，shadcn 推荐对 disabled 项用 `<div>` 加 `aria-disabled`
    - 底部分类与 nav 间 `<Separator>` 横线（默认 horizontal）
    - 设置 nav 用 `<button>` 而不是 `<Link>` —— `useNavigate()` 更直接；Tailwind class 模拟 Button ghost variant 的视觉但不引入 shadcn Button（避免 Button 内置 padding 与 sidebar 自定义 padding 冲突）
    - active 状态：`bg-accent` 高亮 + 左侧 2px `bg-ring` 竖条（绝对定位，不挤压内容）
    - lucide `Settings` icon 别名 `SettingsIcon`，避免与 `Settings` 路由组件名冲突（注意：本文件不 import Settings 组件，但导入路径可读性更好）
    - `aria-current="page"` 当 active —— 无障碍标准

    **2. 全量覆写 `src/App.tsx`**（替换 01a 的 inline-style "Hello gal-lib"）：
    ```tsx
    import { useEffect } from "react";
    import { Outlet } from "react-router-dom";
    import { TitlebarSlot } from "@/components/layout/TitlebarSlot";
    import { Sidebar } from "@/components/layout/Sidebar";
    import { useAppStore } from "@/store/app";
    import { getDataDir } from "@/lib/db";

    /**
     * Application root layout.
     *
     * Structure (top-to-bottom, then horizontally):
     *   <flex flex-col h-screen>
     *     <TitlebarSlot/>          (h-9, bg-card, border-b)  — 01e replaces this stub
     *     <flex flex-1 min-h-0>
     *       <Sidebar/>             (w-[220px], bg-card, border-r)
     *       <main flex-1 min-w-0>  (bg-background)
     *         <Outlet/>            (Library / Settings)
     *       </main>
     *     </div>
     *   </div>
     */
    export default function App() {
      const setDataDir = useAppStore((s) => s.setDataDir);

      useEffect(() => {
        let cancelled = false;
        getDataDir()
          .then((dir) => {
            if (!cancelled) setDataDir(dir);
          })
          .catch((err) => {
            // 01c's get_data_dir command is registered + capability allowed.
            // If this fails the most likely cause is running outside Tauri
            // (e.g. plain `pnpm dev`); log and let the UI render anyway.
            // eslint-disable-next-line no-console
            console.error("[gal-lib] failed to resolve data dir:", err);
          });
        return () => {
          cancelled = true;
        };
      }, [setDataDir]);

      return (
        <div className="flex h-screen flex-col bg-background text-foreground">
          <TitlebarSlot />
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="min-w-0 flex-1 bg-background">
              <Outlet />
            </main>
          </div>
        </div>
      );
    }
    ```
    注意：
    - **default export**（router.tsx import 默认导出）
    - 外层 `flex h-screen flex-col`：竖向堆叠 Titlebar + 主体
    - 主体 `flex min-h-0 flex-1`：横向 Sidebar + Main；`min-h-0` 必须有，否则 Sidebar/Main 内的 ScrollArea 不会出现滚动条
    - Main `min-w-0 flex-1`：`min-w-0` 防止 flex item 被内容撑大、溢出 sidebar
    - `bg-background text-foreground` 在外层声明，让 portal 内容（Tooltip 等）也继承
    - useEffect 依赖 `[setDataDir]`：zustand 的 action ref 稳定，effect 实际只跑一次
    - cancelled flag 防止 unmount 后 setState 警告
    - **不**调用 `getDb()`（留给 Phase 2）
    - **不**做 try/catch 包 useEffect 整体（只 catch promise）

    **3. 改 `src/main.tsx`** —— 把 01a/01b 留下的 inline createHashRouter 抽到 router.tsx，main.tsx 只剩 mount：
    ```tsx
    import "./index.css";
    import { createRoot } from "react-dom/client";
    import { RouterProvider } from "react-router-dom";
    import { router } from "./router";

    const rootEl = document.getElementById("root");
    if (!rootEl) {
      throw new Error("#root element not found in index.html");
    }
    createRoot(rootEl).render(<RouterProvider router={router} />);
    ```
    注意：
    - 第一行 `import "./index.css"` 必须保留（01b 接通的样式入口）
    - **不**保留 01a 的 inline `createHashRouter([{ path: "/", element: <App /> }])`
    - **不** import `App` —— App 现在通过 router 表注入，不在 main.tsx 直接 mount
    - **不**用 React.StrictMode 包（避免 Tauri dev 下 useEffect 双调引入 spurious `get_data_dir` 调用 — 这是有意决策；如未来开 StrictMode，需要在 useEffect 内做 idempotent 处理）

    **4. 类型与启动验证**：
    ```powershell
    cd D:\project\gal-lib
    pnpm tsc --noEmit
    ```
    期望退出码 0。如果失败：
    - `Cannot find module '@/store/app'` → 检查 `tsconfig.json` paths alias `@/*` -> `src/*`（01a 应已设；如未设，本任务**不**修改 tsconfig，反而排错确认 Task 1 文件路径正确）
    - lucide-react 类型错 → 01b 已 install lucide-react，确认 `package.json` 含
    - shadcn Tooltip / ScrollArea props 错 → 检查 01b 的 src/components/ui/* 是否完整

    **5. 视觉烟测**：
    ```powershell
    pnpm tauri dev
    ```
    期望（截图或文字描述记录到 SUMMARY）：
    - 主窗口顶部出现一条 36px 高的深灰条（bg-card #181B22）+ 1px border-bottom #2A2F3A — 这是 TitlebarSlot
    - 下方左 220px Sidebar：「分类」标签（muted 灰色）→ 4 行占位项「全部/收藏/标签/通关状态」（muted 灰色 + cursor-not-allowed）→ Separator → 「设置」nav（白色 + 齿轮 icon）
    - hover 任一占位项 ~300ms 后弹出 tooltip 「即将开放」
    - 右侧 Main：垂直水平居中显示「还没有游戏」（白色大字 18px）+ 灰色副文「请到设置页添加扫描根目录」+ ghost 按钮「打开设置」
    - 点击「打开设置」按钮 → URL 变为 `#/settings` → Main 区切到「设置 — 即将上线」 + Sidebar 底部「设置」nav 出现 2px 紫色 (#7C5CFF) 左竖条 + bg-accent 背景
    - 浏览器/Tauri 控制台无 React 错误、无 shadcn 错误、无 path alias 错误

    看到全部上述行为后 Ctrl+C 中断 dev。在 SUMMARY.md 中记录烟测时间 + 截图链接（或文字描述每一项）。

    **6. 不要触碰**：
    - `tauri.conf.json`（01e 范围）
    - `Cargo.toml`（01c/01e 范围）
    - `index.html`（01b 已设 `<html lang="zh-CN" class="dark">`，本任务不动）
    - `tailwind.config.ts` / `src/index.css` / `components.json`（01b 锁定）
    - `src/lib/db.ts` / `src/lib/utils.ts` / `src/components/ui/*`（01b/01c 已交付）
  </action>
  <verify>
    <automated>
      cd D:\project\gal-lib && \
      test -f src/components/layout/Sidebar.tsx && \
      test -f src/App.tsx && \
      test -f src/main.tsx && \
      grep -q 'export function Sidebar' src/components/layout/Sidebar.tsx && \
      grep -q 'w-\[220px\]' src/components/layout/Sidebar.tsx && \
      ! grep -q 'w-56' src/components/layout/Sidebar.tsx && \
      grep -q 'shrink-0' src/components/layout/Sidebar.tsx && \
      grep -q 'bg-card' src/components/layout/Sidebar.tsx && \
      grep -q 'border-r' src/components/layout/Sidebar.tsx && \
      grep -q '分类' src/components/layout/Sidebar.tsx && \
      grep -q '全部' src/components/layout/Sidebar.tsx && \
      grep -q '收藏' src/components/layout/Sidebar.tsx && \
      grep -q '标签' src/components/layout/Sidebar.tsx && \
      grep -q '通关状态' src/components/layout/Sidebar.tsx && \
      grep -q '设置' src/components/layout/Sidebar.tsx && \
      grep -q '即将开放' src/components/layout/Sidebar.tsx && \
      grep -q 'TooltipProvider' src/components/layout/Sidebar.tsx && \
      grep -q 'TooltipContent' src/components/layout/Sidebar.tsx && \
      grep -q 'TooltipTrigger' src/components/layout/Sidebar.tsx && \
      grep -q 'Separator' src/components/layout/Sidebar.tsx && \
      grep -q 'cursor-not-allowed' src/components/layout/Sidebar.tsx && \
      grep -q 'text-muted-foreground' src/components/layout/Sidebar.tsx && \
      grep -q 'select-none' src/components/layout/Sidebar.tsx && \
      grep -q 'useNavigate' src/components/layout/Sidebar.tsx && \
      grep -q 'useLocation' src/components/layout/Sidebar.tsx && \
      grep -q 'navigate("/settings")' src/components/layout/Sidebar.tsx && \
      grep -q 'isSettingsActive' src/components/layout/Sidebar.tsx && \
      grep -q 'bg-ring' src/components/layout/Sidebar.tsx && \
      grep -q 'bg-accent' src/components/layout/Sidebar.tsx && \
      grep -q 'lucide-react' src/components/layout/Sidebar.tsx && \
      grep -q 'export default function App' src/App.tsx && \
      grep -q 'TitlebarSlot' src/App.tsx && \
      grep -q 'Sidebar' src/App.tsx && \
      grep -q 'Outlet' src/App.tsx && \
      grep -q 'flex h-screen flex-col' src/App.tsx && \
      grep -q 'flex min-h-0 flex-1' src/App.tsx && \
      grep -q 'getDataDir' src/App.tsx && \
      grep -q 'useAppStore' src/App.tsx && \
      grep -q 'setDataDir' src/App.tsx && \
      grep -q 'useEffect' src/App.tsx && \
      ! grep -q 'Hello gal-lib' src/App.tsx && \
      grep -q 'import "./index.css"' src/main.tsx && \
      grep -q 'RouterProvider' src/main.tsx && \
      grep -q 'import { router } from "./router"' src/main.tsx && \
      ! grep -q 'createHashRouter' src/main.tsx && \
      ! grep -q 'BrowserRouter' src/main.tsx && \
      pnpm tsc --noEmit
    </automated>
  </verify>
  <acceptance_criteria>
    - `src/components/layout/Sidebar.tsx` 存在，含 23 个 grep 锚点：
      * 结构：`export function Sidebar` / `w-[220px]`（严格、**未命中** `w-56`） / `shrink-0` / `bg-card` / `border-r`
      * Copy（5 条 locked strings）：`分类` / `全部` / `收藏` / `标签` / `通关状态` / `设置` / `即将开放`
      * shadcn 组件：`TooltipProvider` / `TooltipContent` / `TooltipTrigger` / `Separator`
      * Disabled 视觉：`cursor-not-allowed` / `text-muted-foreground` / `select-none`
      * 路由集成：`useNavigate` / `useLocation` / `navigate("/settings")` / `isSettingsActive`
      * Active 视觉：`bg-ring`（2px 竖条颜色）/ `bg-accent`（active 背景）
      * Icon：`lucide-react`
    - `src/App.tsx` 是 default export 名为 `App` 的函数组件，含 `TitlebarSlot` / `Sidebar` / `Outlet` / `flex h-screen flex-col` / `flex min-h-0 flex-1` / `getDataDir` / `useAppStore` / `setDataDir` / `useEffect`，**未命中** `Hello gal-lib`（01a 旧文案已被覆盖）
    - `src/main.tsx` 含 `import "./index.css"` / `RouterProvider` / `import { router } from "./router"`，**未命中** `createHashRouter`（已搬到 router.tsx） / `BrowserRouter` / `MemoryRouter`
    - `pnpm tsc --noEmit` 退出码 0
    - 执行者亲眼确认 `pnpm tauri dev` 启动后画面满足完整烟测描述（在 SUMMARY 中按列表逐项确认）
    - **未**触碰 `tauri.conf.json` / `Cargo.toml` / `index.html` / `tailwind.config.ts` / `src/index.css` / `src/lib/db.ts` / `src/lib/utils.ts` / `src/components/ui/*` / `components.json`
  </acceptance_criteria>
  <done>
    Phase 1 双栏 App Shell 视觉端到端打通：HashRouter + Layout（TitlebarSlot + Sidebar + Main）+ Sidebar（4 占位 + Tooltip + 设置 nav active 状态）+ Library 空状态 + Settings 占位 + Zustand store boot-time fill 全部就绪。01e 接管时只需覆写 TitlebarSlot.tsx 即可注入真实 Titlebar，01d 的 Layout / 路由 / 占位 copy 已经满足 LIB-01 + APP-02。
  </done>
</task>

</tasks>

<verification>
**Plan-level checks（执行完所有 task 后整体复验）：**

1. **8 条 locked copy 字符串全部存在（UI-SPEC §Copywriting Contract）**：
   ```powershell
   cd D:\project\gal-lib
   findstr /C:"还没有游戏" src\routes\Library.tsx
   findstr /C:"请到设置页添加扫描根目录" src\routes\Library.tsx
   findstr /C:"打开设置" src\routes\Library.tsx
   findstr /C:"设置 — 即将上线" src\routes\Settings.tsx
   findstr /C:"分类" src\components\layout\Sidebar.tsx
   findstr /C:"全部" src\components\layout\Sidebar.tsx
   findstr /C:"收藏" src\components\layout\Sidebar.tsx
   findstr /C:"标签" src\components\layout\Sidebar.tsx
   findstr /C:"通关状态" src\components\layout\Sidebar.tsx
   findstr /C:"即将开放" src\components\layout\Sidebar.tsx
   findstr /C:"设置" src\components\layout\Sidebar.tsx
   ```
   全部命中。任意一条不命中即视为缺陷。

2. **HashRouter 锁定（防止误用 BrowserRouter）**：
   ```powershell
   findstr /C:"createHashRouter" src\router.tsx       # 必须命中
   findstr /C:"BrowserRouter" src                     # 必须无命中（递归扫描）
   findstr /C:"MemoryRouter" src                      # 必须无命中
   ```

3. **Sidebar 220px 严格锁定（UI-SPEC §Layout）**：
   ```powershell
   findstr /C:"w-[220px]" src\components\layout\Sidebar.tsx     # 必须命中
   findstr /C:"w-56" src\components\layout\Sidebar.tsx          # 必须无命中
   findstr /C:"w-[14rem]" src\components\layout\Sidebar.tsx     # 必须无命中
   findstr /C:"width: 220" src\components\layout\Sidebar.tsx    # 必须无命中（不要 inline style）
   ```

4. **TitlebarSlot stub 契约（01e 接管点）**：
   ```powershell
   findstr /C:"data-testid=\"titlebar-slot\"" src\components\layout\TitlebarSlot.tsx   # 必须命中
   findstr /C:"h-9" src\components\layout\TitlebarSlot.tsx                              # 必须命中（36px）
   findstr /C:"bg-card" src\components\layout\TitlebarSlot.tsx                          # 必须命中
   ```

5. **Zustand 引入但 store 仍极简**：
   ```powershell
   findstr /C:"\"zustand\"" package.json              # 必须命中
   findstr /C:"useAppStore" src\store\app.ts          # 必须命中
   findstr /C:"middleware" src\store                  # 必须无命中（不引入 middleware）
   findstr /C:"persist" src\store                     # 必须无命中
   ```

6. **Tauri command 调用而非直接 fs**：
   ```powershell
   findstr /C:"getDataDir" src\App.tsx                # 必须命中（来自 01c 的 helper）
   findstr /C:"current_exe" src                       # 必须无命中（前端禁止直接 fs）
   findstr /C:"@tauri-apps/plugin-fs" src             # 必须无命中（不在本期范围）
   ```

7. **TS strict + 视觉烟测双绿**：
   ```powershell
   pnpm tsc --noEmit
   # 然后 pnpm tauri dev → 双栏布局可见、Tooltip 弹出「即将开放」、点「打开设置」跳 /settings、Sidebar 底「设置」active 时显示 2px 紫色竖条
   ```

8. **本 plan 不应越界写入下游 plan 的字段**：
   ```powershell
   findstr /C:"decorations" src-tauri\tauri.conf.json   # 必须无命中（01e 才写）
   findstr /C:"data-tauri-drag-region" src              # 必须无命中（01e 才用）
   findstr /C:"WindowControls" src                      # 必须无命中（01e 才有）
   findstr /C:"appWindow" src                           # 必须无命中（01e 才用）
   findstr /C:"getCurrentWindow" src                    # 必须无命中（01e 才用）
   ```

9. **数据目录隔离继承（与 01a/01b/01c 一致）**：
   ```powershell
   if (Test-Path D:\project\gal-lib\data) { exit 1 }
   # data/ 目录必须由运行时（01c 实现）首次启动时创建在 src-tauri/target/debug/data/，
   # 不应在仓库根目录预先存在
   ```

10. **文件清单严格（防止越权）**：
    本 plan 应仅修改/创建以下 8 个源文件 + 2 个 lockfile：
    - 修改：`src/main.tsx`、`src/App.tsx`、`package.json`、`pnpm-lock.yaml`
    - 新建：`src/router.tsx`、`src/routes/Library.tsx`、`src/routes/Settings.tsx`、`src/components/layout/Sidebar.tsx`、`src/components/layout/TitlebarSlot.tsx`、`src/store/app.ts`
    其它文件应保持 01a/01b/01c 交付状态不变。
</verification>

<success_criteria>
1. App Shell 双栏布局在 `pnpm tauri dev` 主窗口可见：上 36px TitlebarSlot 灰条（bg-card #181B22 + border-b）+ 下方双栏（左 220px Sidebar bg-card / 右 Main bg-background）— LIB-01 满足
2. Sidebar 含完整 4 段：「分类」section heading + 4 个静态占位项「全部/收藏/标签/通关状态」（cursor-not-allowed + text-muted-foreground + Tooltip「即将开放」）+ Separator + 底部「设置」nav（active 时 2px #7C5CFF 竖条 + bg-accent）
3. Main 在 `/` 路由显示居中空状态：H2「还没有游戏」+ Body「请到设置页添加扫描根目录」+ ghost Button「打开设置」（点击跳 `/settings`）— APP-02 启动后空状态可见
4. Main 在 `/settings` 路由显示「设置 — 即将上线」H2 占位
5. 路由：`createHashRouter`（**非** BrowserRouter / MemoryRouter）；只两条 `/` 与 `/settings`；用 layout-route 模式让 `<App/>` 通过 `<Outlet/>` 渲染子路由
6. Zustand store `useAppStore` 含 `dataDir: string | null` + `setDataDir` action；App mount 时通过 01c 的 `getDataDir()` 异步填充
7. UI-SPEC §Copywriting Contract 8 条 locked copy 全部 grep 命中（4 占位项 + 设置 + 即将开放 + 还没有游戏 + 请到设置页添加扫描根目录 + 打开设置 + 设置 — 即将上线 + 分类）
8. UI-SPEC §Layout Contract 220px sidebar 锁定（grep `w-[220px]` 命中、`w-56` 与 `w-[14rem]` 与 inline style `width: 220` 均未命中）
9. TitlebarSlot stub 文件就位（`h-9` + `bg-card` + `data-testid="titlebar-slot"`），作为 01e 的明确接管点
10. `pnpm tsc --noEmit` 退出码 0；视觉烟测每一项（Tooltip 弹出 / `打开设置`跳 `/settings` / Sidebar active 状态紫色竖条）经执行者亲眼确认并记入 SUMMARY
11. 零越界写入：未触碰 `tauri.conf.json`、`Cargo.toml`、`index.html`、`tailwind.config.ts`、`src/index.css`、`components.json`、`src/lib/db.ts`、`src/lib/utils.ts`、`src/components/ui/*`；未预创建 `data/` 目录；未引入 React.StrictMode、zustand middleware、@tauri-apps/plugin-fs、`getCurrentWindow` 等下游 plan 范围的内容
</success_criteria>

<output>
After completion, create `D:\project\gal-lib\.planning\phases\01-foundation\01d-SUMMARY.md` 含：

- 实际安装的 zustand 版本号（对照 RESEARCH.md `^5.0.x`，标注偏离）
- `pnpm tsc --noEmit` 通过的时间戳
- `pnpm tauri dev` 视觉烟测的时间戳 + 逐项确认列表（10 条核对项 — 见 Task 2 步骤 5）
- 截图（建议）：
  1. `/` 路由：完整 App Shell 画面（titlebar slot + sidebar + main 空状态）
  2. `/settings` 路由：sidebar 底部「设置」nav active 状态 + main「设置 — 即将上线」
  3. Tooltip「即将开放」hover 状态
- Zustand store `dataDir` 实测值（在 DevTools console `useAppStore.getState().dataDir`）—— 应为 01c 写入的绝对路径（如 `C:\Users\...\gal-lib\src-tauri\target\debug\data` 形式），非 null 即视为 01c→01d 桥接成功
- 任何偏离 UI-SPEC §Copywriting Contract 的事项（应当为空 — 偏离即视为缺陷）
- 已知遗留：
  - TitlebarSlot 仍是 stub，等 01e 覆写为真实 Titlebar；当下 Tauri 默认装饰栏仍在画面顶部（窗口标题+三个系统按钮），与 TitlebarSlot 灰条并列出现 — 这是 wave 3 中间态，01e 完成后才视觉收敛
  - Settings 路由只是占位 H2，真实交互（添加扫描根目录、设置 LE 路径、locale 默认值等）在 Phase 4
  - 4 个 Sidebar 占位项均不可点击；筛选交互在 Phase 4
  - useAppStore 仅一字段，未来 Phase 2/3 会扩展 selectedGameId / scanProgress / sessionState 等
- React 版本提示：本 plan 在 React 19 下使用 zustand 5 + react-router-dom v6.30 的组合；如未来 RR v7 升级或 React Compiler 启用，需回顾 useEffect 中的 cancelled flag 与 zustand action ref 稳定性假设
</output>
