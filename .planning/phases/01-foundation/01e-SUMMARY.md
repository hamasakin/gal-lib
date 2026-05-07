---
phase: 01-foundation
plan: 01e
subsystem: app-shell
tags: [titlebar, window-controls, tauri-v2, drag-region, capabilities]
requires:
  - 01a (tauri.conf.json initial scaffold)
  - 01b (Tailwind tokens, lucide-react)
  - 01d (App.tsx imports TitlebarSlot stub)
provides:
  - "36px custom titlebar with drag region (left) and 3 window controls (right)"
  - "core:window:* capabilities for minimize/toggle-maximize/close/start-dragging"
  - "Tauri main window decorations: false (native chrome removed)"
affects:
  - "src-tauri/tauri.conf.json (added decorations: false)"
  - "src-tauri/capabilities/default.json (appended 4 window perms)"
  - "src/components/layout/TitlebarSlot.tsx (overwrote 01d stub with re-export)"
tech-stack:
  added:
    - "@tauri-apps/api/window v2 getCurrentWindow() API"
  patterns:
    - "data-tauri-drag-region on parent + explicit data-tauri-drag-region=\"false\" on button wrapper (RESEARCH §Pitfall 5)"
    - "Stub-to-re-export overwrite for Wave 3 0-conflict parallelism (01d↔01e seam)"
key-files:
  created:
    - "src/components/layout/Titlebar.tsx"
    - "src/components/layout/WindowControls.tsx"
    - "src/styles/titlebar.css"
  modified:
    - "src-tauri/tauri.conf.json"
    - "src-tauri/capabilities/default.json"
    - "src/components/layout/TitlebarSlot.tsx (overwrote stub)"
    - "src/index.css (appended @import)"
key-decisions:
  - "Use getCurrentWindow() (v2) not appWindow (v1 deprecated)"
  - "Native <button> not shadcn <Button> for window controls (size variant mismatch)"
  - "TitlebarSlot.tsx remains the App.tsx-facing import; rewritten to re-export real Titlebar"
  - "4-permission capability set (no core:window:default to avoid over-permission)"
metrics:
  completed: 2026-05-07
---

# Phase 1 Plan 01e: Custom Titlebar + Window Controls Summary

实装 gal-lib 主窗口自定义 36px titlebar + 3 个窗口控制按钮（最小化/最大化/关闭），关闭原生 chrome，仅追加 4 条最小必要 window capability，与 01d 在 Wave 3 通过 TitlebarSlot 覆写实现 0 文件冲突并行交付。

## What Was Built

### Task 1 — Tauri 配置层（commit `705dae4`）

**`src-tauri/tauri.conf.json`** — 在 `app.windows[0]` 中追加 `"decorations": false`。其余尺寸契约（`width: 1280`, `height: 800`, `minWidth: 960`, `minHeight: 600`, `title: "gal-lib"`, `resizable: true`, `center: true`）由 01a 已写入并保留。

**`src-tauri/capabilities/default.json`** — `permissions` 数组追加 4 条：

```json
"core:window:allow-minimize",
"core:window:allow-toggle-maximize",
"core:window:allow-close",
"core:window:allow-start-dragging"
```

`core:window:allow-start-dragging` 是 `data-tauri-drag-region` 在 Tauri v2 下生效的必需权限（RESEARCH §Pitfall 5 锁定）。未使用泛权限 `core:window:default` 以避免过度授权（如 set-position / set-size 当前不需要）。01a 已有的 `core:default` + `sql:*` 4 条保留不删。

### Task 2 — 前端 titlebar 实装（commit `51d98ae`）

**`src/components/layout/Titlebar.tsx`**（新建）— 36px `<header>`：
- 外层 `<header>` 持 layout 类（`titlebar-root flex items-center h-9 bg-card border-b border-border text-foreground`），自身**不**带 drag region。
- 第一个子 `<div>` 持 `data-tauri-drag-region`，占 `flex-1`，左侧渲染 `<Library size={14}/>` + `<span>gal-lib</span>`（Display 13px / 500 / line-height 1.0 = `text-[13px] font-medium leading-none`）。
- `<WindowControls/>` 作为兄弟节点，与 drag region div 同级。

**`src/components/layout/WindowControls.tsx`**（新建）— 3 个原生 `<button>`：
- 外层 wrapper 显式 `data-tauri-drag-region="false"`（RESEARCH §Pitfall 5 双重防御，即使父 div 不传播也兜一层）。
- 用 v2 API：`const win = getCurrentWindow();` → `void win.minimize() / .toggleMaximize() / .close()`。`void` 显式忽略 Promise 回避 `no-floating-promises`。
- lucide 图标：`<Minus size={14}/>`、`<Square size={12}/>`、`<X size={14}/>`。
- hover 着色：minimize/maximize → `hover:bg-accent`（#21252E 暗灰），close → `hover:bg-destructive hover:text-white`（#EF4444 红）。
- 中文 `aria-label`：`最小化` / `最大化` / `关闭`。

**`src/components/layout/TitlebarSlot.tsx`**（覆写 01d 桩）— 一行 re-export：

```tsx
export { Titlebar as TitlebarSlot } from './Titlebar';
```

01d 的 `data-testid="titlebar-slot"` 桩被替换；命名导出保持 `TitlebarSlot`，App.tsx 的 `import { TitlebarSlot } from './components/layout/TitlebarSlot'` 0 修改即接通真实 titlebar。

**`src/styles/titlebar.css`**（新建）— 局部样式：
- `.titlebar-root`：`position: sticky; top: 0; z-index: 50; user-select: none; -webkit-user-select: none;`
- `.window-ctrl-btn`：`width: 36px; height: 36px; border-radius: 4px;`（UI-SPEC titlebar buttons radius=4 锁定，比 controls baseline 6px 更小），`cursor: default`（桌面 chrome 控件不应有 web hand cursor），`-webkit-app-region: no-drag` 兜底。
- `.window-ctrl-btn:focus { outline: none; }` + `.window-ctrl-btn:focus-visible { outline: 2px solid #7C5CFF; outline-offset: 2px; }` —— 严格遵守 UI-SPEC focus contract。

**`src/index.css`**（追加）— 在 `@layer base { ... }` 块之后追加 `@import './styles/titlebar.css';`，单点入口加载 titlebar 局部样式。

## How It Works

### Drag Region 防御策略（RESEARCH §Pitfall 5 两道闸）

Tauri 的 `data-tauri-drag-region` 属性**不会**自动传播到子元素：父元素带该属性时，事件冒泡到父级才触发 start-dragging hook。为兼容防御未来重构（万一有人把按钮塞进 drag region 内部），WindowControls 外层显式 `data-tauri-drag-region="false"` —— 即使将来按钮区被嵌套到 drag region 下，也能拒绝拖拽继承。

### Wave 3 0-冲突并行（01d ↔ 01e seam）

01d 在不知道 Titlebar 长什么样的情况下，先在 `TitlebarSlot.tsx` 写了 36px 占位 stub，让 App.tsx 的双栏布局可以独立通过类型检查。01e 完整覆写同一文件为一行 re-export，**不动 App.tsx 一个字符**。这是 Phase 1 计划阶段就锁定的「stub → re-export」契约。

## Verification

| Check                                                   | Result          |
| ------------------------------------------------------- | --------------- |
| `tauri.conf.json` 含 `decorations: false`               | 通过            |
| `tauri.conf.json` 尺寸契约 1280×800 / minWidth 960      | 通过            |
| `capabilities/default.json` 含 4 条 window 权限         | 通过            |
| `pnpm tsc --noEmit`                                     | 退出码 0        |
| `Titlebar.tsx` 含 `data-tauri-drag-region`              | 命中            |
| `WindowControls.tsx` 含 `data-tauri-drag-region="false"` | 命中            |
| `TitlebarSlot.tsx` 含 `Titlebar as TitlebarSlot`        | 命中            |
| `titlebar.css` 含 `:focus-visible` + `#7C5CFF` + `outline-offset: 2px` | 命中 |
| `index.css` 末尾含 `@import './styles/titlebar.css'`    | 命中            |
| App.tsx 是否被本 plan 修改                              | **未修改**（契约保持） |

`cargo check` 与 `pnpm tauri dev` 烟测属 phase 级人工验收（01-RUN-PHASE / 01f 二次确认范围），本 plan 自动化部分以 `tsc --noEmit` + JSON schema 校验为收口。

## Deviations from Plan

无。RESEARCH §Pattern 4 / §Pitfall 5 严格遵守：
- drag region 在父 `<div>` 而非子节点；
- 按钮 wrapper 显式 `data-tauri-drag-region="false"`（不仅依赖属性不传播，还显式拒绝）；
- `select-none` 等价 CSS `user-select: none` 双面布署（Tailwind 类名 + `.titlebar-root` 直写）；
- v2 API `getCurrentWindow()`，未误用 v1 `appWindow`；
- 仅授权 4 条最小必要 capability，未使用 `core:window:default` 泛授权。

## Commits

| Task | Commit    | Description                                              |
| ---- | --------- | -------------------------------------------------------- |
| 1    | `705dae4` | disable native chrome and grant window capabilities      |
| 2    | `51d98ae` | implement custom titlebar with drag region and window controls |

## Self-Check: PASSED

- FOUND: src-tauri/tauri.conf.json (decorations: false)
- FOUND: src-tauri/capabilities/default.json (4 window perms)
- FOUND: src/components/layout/Titlebar.tsx
- FOUND: src/components/layout/WindowControls.tsx
- FOUND: src/components/layout/TitlebarSlot.tsx (re-export)
- FOUND: src/styles/titlebar.css
- FOUND: src/index.css (@import titlebar.css)
- FOUND commit: 705dae4
- FOUND commit: 51d98ae
