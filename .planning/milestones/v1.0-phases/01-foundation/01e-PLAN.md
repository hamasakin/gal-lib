---
phase: 01-foundation
plan: 01e
type: execute
wave: 5
depends_on: [01b, 01c, 01d]
files_modified:
  - src-tauri/tauri.conf.json
  - src-tauri/capabilities/default.json
  - src/components/layout/Titlebar.tsx
  - src/components/layout/WindowControls.tsx
  - src/components/layout/TitlebarSlot.tsx
  - src/styles/titlebar.css
  - src/index.css
autonomous: true
requirements: [LIB-01]
must_haves:
  truths:
    - "Tauri 主窗口启动后窗口顶部呈现自定义 36px 高 titlebar：左侧显示 lucide `Library` 图标 + 文字 `gal-lib`（13px/500/1.0 Display），右侧显示三个 36×36 控制按钮（Minus/Square/X）；原生窗口 chrome（OS 默认标题栏）已消失"
    - "用户在 titlebar 左半（图标/文字所在区域）按住鼠标可拖动窗口，但在右侧 3 个按钮区域按住鼠标**不会**触发拖动（按钮的 click 事件正常派发，不会被 drag region 偷走）"
    - "点击最小化按钮窗口最小化到任务栏；点击最大化按钮窗口在最大化/还原间切换；点击关闭按钮 Tauri 主窗口关闭、应用退出"
    - "主窗口默认尺寸 1280×800，最小尺寸 960×600（拖到更小不允许），可调整大小"
    - "键盘 Tab 聚焦到 3 个窗口控制按钮中任一时，按钮外侧出现 2px `#7C5CFF` (accent) focus ring + 2px offset，符合 UI-SPEC focus 契约"
    - "最小化、最大化按钮的悬停背景为 `#21252E` (`bg-accent` aka surface elevated)；关闭按钮的悬停背景为 `#EF4444` (`bg-destructive`)；非悬停态三按钮均透明融入 titlebar"
    - "App.tsx 中 `<TitlebarSlot/>` 引用路径无需任何修改（01d 已导入 `from './components/layout/TitlebarSlot'`）；01e 仅覆写 TitlebarSlot.tsx 内容为对 Titlebar 的一行 re-export，运行时实际渲染真实 titlebar"
    - "`pnpm tsc --noEmit` 通过；`pnpm tauri dev` 能启动且无 capability 拒绝错误（最小化/最大化/关闭/拖动均不报权限拒绝）"
  artifacts:
    - path: "src-tauri/tauri.conf.json"
      provides: "Tauri 主窗口配置：`app.windows[0]` 的 `decorations: false`、`width: 1280`、`height: 800`、`minWidth: 960`、`minHeight: 600`、`title: \"gal-lib\"`、`resizable: true`"
      contains: "\"decorations\": false"
    - path: "src-tauri/capabilities/default.json"
      provides: "默认 capability set 追加 4 条 window 权限：`core:window:allow-minimize`、`core:window:allow-toggle-maximize`、`core:window:allow-close`、`core:window:allow-start-dragging`"
      contains: "core:window:allow-start-dragging"
    - path: "src/components/layout/Titlebar.tsx"
      provides: "36px 高 titlebar 组件：外层 wrapper 持有 `data-tauri-drag-region` 属性，左侧 lucide Library 图标 + `gal-lib` 文字，右侧渲染 `<WindowControls/>` 作为兄弟节点（不在 drag region 内部）"
      contains: "data-tauri-drag-region"
    - path: "src/components/layout/WindowControls.tsx"
      provides: "3 个窗口控制按钮组件：调用 `getCurrentWindow()` 的 `.minimize()` / `.toggleMaximize()` / `.close()`；wrapper 上显式 `data-tauri-drag-region=\"false\"` 阻止拖拽继承"
      contains: "getCurrentWindow"
    - path: "src/components/layout/TitlebarSlot.tsx"
      provides: "一行 re-export：`export { Titlebar as TitlebarSlot } from './Titlebar';`，覆写 01d 写入的 stub，让 App.tsx 的现有 `import { TitlebarSlot } from '...'` 直接渲染真实 titlebar"
      contains: "Titlebar as TitlebarSlot"
    - path: "src/styles/titlebar.css"
      provides: "titlebar 局部样式：`.titlebar-root` 设置 `position: sticky; top: 0; z-index: 50; user-select: none;`；`:focus-visible` 在窗口控制按钮上呈现 2px `#7C5CFF` accent focus ring + 2px offset"
      contains: "focus-visible"
    - path: "src/index.css"
      provides: "在 01b 已建立的 Tailwind 入口基础上 `@import` 引入 `./styles/titlebar.css`，确保 titlebar 样式被打包"
      contains: "titlebar.css"
  key_links:
    - from: "src/components/layout/Titlebar.tsx"
      to: "src/components/layout/WindowControls.tsx"
      via: "JSX 兄弟节点（外层 drag region 之外）"
      pattern: "<WindowControls\\s*/>"
    - from: "src/components/layout/WindowControls.tsx"
      to: "@tauri-apps/api/window getCurrentWindow"
      via: "import + 函数调用"
      pattern: "from ['\"]@tauri-apps/api/window['\"]"
    - from: "src/components/layout/WindowControls.tsx button onClick"
      to: "Tauri Rust core window plugin"
      via: "IPC（需 capability `core:window:allow-{minimize,toggle-maximize,close}`）"
      pattern: "\\.(minimize|toggleMaximize|close)\\(\\)"
    - from: "src/components/layout/Titlebar.tsx data-tauri-drag-region 元素"
      to: "Tauri Rust core window plugin start-dragging command"
      via: "WebView 内置 hook（需 capability `core:window:allow-start-dragging`）"
      pattern: "data-tauri-drag-region"
    - from: "src/components/layout/TitlebarSlot.tsx"
      to: "src/components/layout/Titlebar.tsx"
      via: "named re-export"
      pattern: "export\\s*\\{\\s*Titlebar as TitlebarSlot"
---

<objective>
为 gal-lib 主窗口实装自定义 36px titlebar 与 3 个窗口控制按钮（最小化/最大化/关闭），关闭原生窗口 chrome（`decorations: false`）、设置默认尺寸 1280×800、最小尺寸 960×600。前端使用 `@tauri-apps/api/window` v2 的 `getCurrentWindow()` API 调用 minimize/toggleMaximize/close；拖动通过 `data-tauri-drag-region` 实现，按钮区作为 drag region 的兄弟节点显式标注 `data-tauri-drag-region="false"` 以避免事件被拖动 hook 偷走（RESEARCH §Pitfall 5）。

Purpose（覆盖 LIB-01 收尾的可见上沿，是 Wave 3 与 01d 双栏布局并行交付的两块拼图之一）：
- 让 UI-SPEC 锁定的「Titlebar 36px + 自定义控件 + drag region」契约从设计文档落到运行时。
- 通过 capability 收敛：仅追加 4 条 window 权限，避免泛授权扩大攻击面。
- 通过 TitlebarSlot.tsx 的「stub → re-export」覆写策略，与 01d 在 Wave 3 严格 0 文件冲突地并行（01d 写 stub 时不知道 Titlebar 长什么样，01e 写真实组件时不需要再动 App.tsx）。

Output:
- 修改 `src-tauri/tauri.conf.json`：window decorations off、尺寸约束。
- 修改 `src-tauri/capabilities/default.json`：追加 4 条 window 权限。
- 新增 `src/components/layout/Titlebar.tsx`、`src/components/layout/WindowControls.tsx`、`src/styles/titlebar.css`。
- 覆写 `src/components/layout/TitlebarSlot.tsx` 为一行 re-export。
- 修改 `src/index.css` 追加 titlebar 样式 import。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/phases/01-foundation/01-UI-SPEC.md
@.planning/phases/01-foundation/01-RESEARCH.md
@.planning/phases/01-foundation/01-PLAN-OUTLINE.md
@.planning/phases/01-foundation/01a-PLAN.md
@.planning/phases/01-foundation/01b-PLAN.md
@.planning/phases/01-foundation/01d-PLAN.md

<interfaces>
<!-- @tauri-apps/api/window v2 contract — 直接使用，不要再去翻 codebase。 -->

```ts
// from @tauri-apps/api/window (v2.x)
export function getCurrentWindow(): Window;

interface Window {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  // ... 其他不在本 plan 使用
}
```

```ts
// from lucide-react (01b 已安装)
export const Library: LucideIcon;
export const Minus: LucideIcon;
export const Square: LucideIcon;
export const X: LucideIcon;
// 用法：<Library size={14} strokeWidth={2} />
```

```ts
// 01b 已经把以下 Tailwind 颜色 token 映射到 UI-SPEC 调色板：
//   bg-card        → #181B22  (titlebar 背景 / sidebar 背景)
//   bg-accent      → #21252E  (悬停时的 surface elevated)
//   bg-destructive → #EF4444  (close 按钮悬停)
//   text-foreground→ #E5E7EB  (titlebar 文字)
//   border-border  → #2A2F3A  (titlebar 底部 1px 分隔线)
//   ring-ring      → #7C5CFF  (focus ring accent)
```
</interfaces>

<wave_safety>
本 plan 与 01d 并行（同 Wave 3，01d depends_on=[01b,01c]、01e depends_on=[01b]）。文件占用约定如下，必须严格遵守以保证 0 冲突：

- 01d 拥有的、本 plan **不得修改** 的文件：
  - `src/main.tsx`、`src/App.tsx`、`src/router.tsx`、`src/routes/Library.tsx`、`src/routes/Settings.tsx`、`src/components/layout/Sidebar.tsx`、`src/store/app.ts`、`package.json`、`pnpm-lock.yaml`
- 本 plan 拥有的、01d **已完成且不再回看** 的契约：
  - `src/components/layout/TitlebarSlot.tsx` 由 01d 写入 stub（一个含 `data-testid="titlebar-slot"` 的 36px 占位 div），App.tsx 通过 `import { TitlebarSlot } from './components/layout/TitlebarSlot'` 引用。本 plan **完整覆写** 该文件为一行 re-export `export { Titlebar as TitlebarSlot } from './Titlebar';`，**保持 named export 名称 `TitlebarSlot`**、保持文件路径，App.tsx 无需任何修改即生效。

`tauri.conf.json` 串行约定：01a 写入初版（含 productName/identifier/window 1280×800 占位）→ 01e 在 `app.windows[0]` 中追加 `decorations: false` 并校正/补齐尺寸字段（如已有则保持不变）→ 01f 追加 bundle target/icons/产物名。本 plan 必须使用「读取-修改-写回」模式，不能整文件覆盖。

`capabilities/default.json` 串行约定：01a 写入初版（含 `core:default` 等基础权限）→ 01e 在 `permissions` 数组中**追加** 4 条 window 权限（不删除任何现有项）→ 后续 phase 视需要再追加。

`src/index.css` 串行约定：01b 写入 Tailwind 入口（`@tailwind base/components/utilities` + `:root/.dark` CSS 变量）→ 01e 在文件**末尾**追加一行 `@import "./styles/titlebar.css";`（PostCSS 允许文件末尾 import；如果环境严格要求 import 在最前，则将其放在 `@tailwind` 之前）。
</wave_safety>
</context>

<tasks>

<task type="auto">
  <name>Task 1: 关闭原生 window decorations + 校正窗口尺寸 + 追加 window capability</name>
  <files>src-tauri/tauri.conf.json, src-tauri/capabilities/default.json</files>
  <read_first>
    1. 用 Read 工具读取 `src-tauri/tauri.conf.json` 完整内容（01a 已写入初版）。识别 `app.windows` 数组（注意 v2 schema 是 `app.windows`，不是 `tauri.windows`）。
    2. 用 Read 工具读取 `src-tauri/capabilities/default.json` 完整内容（01a 已写入初版）。识别其 `permissions` 数组的现有元素（应至少含 `core:default`，可能也含 sql:* 之类，取决于 01a/01c 顺序）。
    3. 用 Grep 搜索 `decorations|minWidth|minHeight` 确认 01a 是否已经写过这些字段——若已存在则保持值正确（width=1280/height=800/minWidth=960/minHeight=600），不重复添加。
  </read_first>
  <action>
    **A. 修改 `src-tauri/tauri.conf.json`**

    用 Edit 工具就地编辑 `app.windows[0]` 这一对象（v2 schema 路径就是 `app.windows`）。最终该对象必须包含且仅包含与窗口契约相关的以下字段（其他无关字段如 `url` 等如已存在保留不动）：

    ```json
    {
      "title": "gal-lib",
      "width": 1280,
      "height": 800,
      "minWidth": 960,
      "minHeight": 600,
      "resizable": true,
      "decorations": false
    }
    ```

    要点：
    - `decorations: false` 关闭原生窗口 chrome（无原生 titlebar、无原生最小化/最大化/关闭按钮、无原生窗口边框装饰）。
    - `title: "gal-lib"` 即使 decorations 关掉也保留，便于任务栏/Alt+Tab 识别。
    - **不要** 写 `transparent: true`（v1 默认不透明，本 phase 不要求毛玻璃，避免引入额外 macOS-only 配置噪声 — 本项目仅 Windows）。
    - **不要** 写 `fullscreen` / `alwaysOnTop` 等字段。
    - 如果 01a 写过 `width`/`height` 但值正确，保持不变；只追加缺失字段。
    - 编辑时严格保持 JSON 合法（无尾逗号），并保持 2 空格缩进与原文一致。

    **B. 修改 `src-tauri/capabilities/default.json`**

    用 Edit 工具在 `permissions` 数组中追加以下 4 条字符串（顺序按下述写入；保留 01a 已有的所有 permission，不删除）：

    ```json
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-start-dragging"
    ```

    要点：
    - 这 4 条与 RESEARCH 锁定的 capability 名称一字不差（RESEARCH 第 465-468 行已 VERIFIED）。
    - `core:window:allow-start-dragging` 是 `data-tauri-drag-region` 在 Tauri v2 下生效的**必需**权限（即使 HTML 上加了属性，没这条 capability 拖拽也不会触发）。
    - 不要使用 `core:window:default`（过度授权，会包含 set-position / set-size 等当前不需要的命令）。

    **C. 不要做的事**
    - 不要在 tauri.conf.json 里加 `app.security.csp` 改动（不是本 plan 范围）。
    - 不要在 capabilities 里加 sql:* 或 fs:* 权限（属于 01c 范围）。
    - 不要新建额外的 capabilities 文件（`default.json` 已是默认 capability，追加即可）。
  </action>
  <verify>
    <automated>
      cd D:\project\gal-lib;
      node -e "const c=require('./src-tauri/tauri.conf.json');const w=c.app.windows[0];if(w.decorations!==false)throw new Error('decorations not false');if(w.width!==1280||w.height!==800)throw new Error('size mismatch');if(w.minWidth!==960||w.minHeight!==600)throw new Error('minSize mismatch');if(w.title!=='gal-lib')throw new Error('title mismatch');if(w.resizable!==true)throw new Error('resizable not true');console.log('tauri.conf.json window OK');";
      node -e "const c=require('./src-tauri/capabilities/default.json');const need=['core:window:allow-minimize','core:window:allow-toggle-maximize','core:window:allow-close','core:window:allow-start-dragging'];for(const p of need){if(!c.permissions.includes(p))throw new Error('missing '+p);}console.log('capabilities OK');"
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -F '"decorations": false' src-tauri/tauri.conf.json` 命中 1 行
    - `grep -F '"minWidth": 960' src-tauri/tauri.conf.json` 命中 1 行
    - `grep -F '"minHeight": 600' src-tauri/tauri.conf.json` 命中 1 行
    - `grep -F '"title": "gal-lib"' src-tauri/tauri.conf.json` 命中 1 行
    - `grep -F 'core:window:allow-start-dragging' src-tauri/capabilities/default.json` 命中 1 行
    - `grep -F 'core:window:allow-minimize' src-tauri/capabilities/default.json` 命中 1 行
    - `grep -F 'core:window:allow-toggle-maximize' src-tauri/capabilities/default.json` 命中 1 行
    - `grep -F 'core:window:allow-close' src-tauri/capabilities/default.json` 命中 1 行
    - `node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json'))"` 不抛
    - `node -e "JSON.parse(require('fs').readFileSync('src-tauri/capabilities/default.json'))"` 不抛
    - 01a 已有的其他 permission 数量未减少（不允许误删）
  </acceptance_criteria>
  <done>
    Tauri 配置层完成：window decorations 关闭、尺寸契约就位、4 条 window 权限授予。下一步可在前端代码中安全调用 minimize/toggleMaximize/close 与依赖 drag region 拖动。
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: 实装 Titlebar.tsx + WindowControls.tsx + titlebar.css + 覆写 TitlebarSlot.tsx</name>
  <files>src/components/layout/Titlebar.tsx, src/components/layout/WindowControls.tsx, src/components/layout/TitlebarSlot.tsx, src/styles/titlebar.css, src/index.css</files>
  <read_first>
    1. 用 Read 工具读取 `src/components/layout/TitlebarSlot.tsx` 当前内容（01d 写入的 stub），确认其 default/named export 形态——本 plan 必须**保留 named export `TitlebarSlot`**。
    2. 用 Read 工具读取 `src/index.css`（01b 写入的 Tailwind 入口），确认末尾可以安全追加 `@import` 行；检查 01b 是否已有 `@import` 前缀——若有则将本次 import 紧跟其后；若无则追加到文件末尾。
    3. 用 Grep 在 `src/components/ui/` 下确认 `button.tsx` 已存在（01b 已 ship），但本 plan 的窗口控制按钮**不**复用 shadcn `<Button>`（其 padding/size variants 与 36×36 方形 hit-target 不匹配；直接用原生 `<button>` + Tailwind）。
    4. 用 Grep 在 `package.json` 中确认 `lucide-react` 与 `@tauri-apps/api` 都已声明（01a 与 01b 应已加），无需本任务安装新依赖。
  </read_first>
  <action>
    **A. 新建 `src/components/layout/WindowControls.tsx`**

    完整文件内容：

    ```tsx
    import { getCurrentWindow } from '@tauri-apps/api/window';
    import { Minus, Square, X } from 'lucide-react';

    /**
     * 三个窗口控制按钮（最小化 / 最大化切换 / 关闭）。
     *
     * Pitfall guard (RESEARCH §Pitfall 5):
     * - 外层 wrapper 显式标注 `data-tauri-drag-region="false"`，阻止 drag region
     *   行为继承到按钮上；这是必要的，因为父级 Titlebar 的 drag region 属性虽然
     *   不会自动传播到子元素，但为防御未来重构（万一有人把按钮塞进 drag region 内），
     *   这里再加一道显式拒绝。
     * - 按钮自身使用原生 <button>，不依赖 shadcn <Button>（后者的 size variant
     *   与 36x36 方形 hit-target 不匹配）。
     */
    export function WindowControls() {
      const win = getCurrentWindow();

      return (
        <div
          data-tauri-drag-region="false"
          className="flex h-full items-stretch"
          aria-label="窗口控制"
        >
          <button
            type="button"
            onClick={() => void win.minimize()}
            className="window-ctrl-btn hover:bg-accent"
            aria-label="最小化"
          >
            <Minus size={14} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => void win.toggleMaximize()}
            className="window-ctrl-btn hover:bg-accent"
            aria-label="最大化"
          >
            <Square size={12} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => void win.close()}
            className="window-ctrl-btn hover:bg-destructive hover:text-white"
            aria-label="关闭"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      );
    }
    ```

    要点：
    - `getCurrentWindow()` 是 v2 API（v1 的 `appWindow` 顶层导出已废弃，见 RESEARCH 第 910 行）。
    - `void win.xxx()` 显式标注忽略 Promise，避免 `@typescript-eslint/no-floating-promises` 警告。
    - `aria-label` 中文，便于无障碍读屏；按钮不放可见文字（图标足够）。
    - `window-ctrl-btn` 的具体尺寸/focus 样式由 titlebar.css 定义（保持 Tailwind utility + 一个语义类 hybrid 模式，避免堆砌过长的 className）。

    **B. 新建 `src/components/layout/Titlebar.tsx`**

    完整文件内容：

    ```tsx
    import { Library } from 'lucide-react';
    import { WindowControls } from './WindowControls';

    /**
     * 自定义 36px 高度 titlebar。
     *
     * 结构契约 (RESEARCH §Pattern 4 + §Pitfall 5):
     * - 外层 <header> 是 layout 容器，**自身不带** data-tauri-drag-region。
     * - drag region 是 <header> 的第一个子节点 <div>，占据 flex-1 的所有剩余空间，
     *   左侧渲染 app 图标 + 文字 `gal-lib`（这两者直接作为 drag region 的子节点，
     *   即使 data-tauri-drag-region 不传播给它们也无所谓 —— 用户在它们之上按住
     *   时，鼠标事件冒泡到 drag region div 上仍然触发拖拽 hook，这是 Tauri 推荐
     *   的 "drag region 含子节点" 模式）。
     * - WindowControls 作为 <header> 的兄弟节点（与 drag region div 同级），
     *   显式 data-tauri-drag-region="false" 确保按钮区不被拖动 hook 偷走 click。
     */
    export function Titlebar() {
      return (
        <header
          className="titlebar-root flex items-center h-9 bg-card border-b border-border text-foreground"
        >
          <div
            data-tauri-drag-region
            className="flex-1 h-full flex items-center gap-2 px-3"
          >
            <Library size={14} strokeWidth={2} aria-hidden="true" />
            <span className="text-[13px] font-medium leading-none tracking-tight">
              gal-lib
            </span>
          </div>
          <WindowControls />
        </header>
      );
    }
    ```

    要点：
    - `h-9` = 36px（Tailwind 默认 spacing scale 9 × 4px）。
    - `bg-card` / `border-border` / `text-foreground` 直接用 01b 已映射到 UI-SPEC 调色板的 token，**不**写裸十六进制色值。
    - `Display` 字号契约：13px / 500 / line-height 1.0 → `text-[13px] font-medium leading-none`。
    - `gap-2` = 8px，符合 spacing token `sm`（图标-文字间距）。
    - `px-3` = 12px 内边距，比文档示例的 `px-3` 一致（介于 spacing `sm`/`md` 之间，视觉上紧凑但不压迫）。
    - **绝对不要**在 `<span>` 上加 `data-tauri-drag-region`（错误示例），父 div 已经持有；保持 RESEARCH §Pitfall 5 推荐的「drag div + 直接子节点」模式。

    **C. 覆写 `src/components/layout/TitlebarSlot.tsx`**

    完整文件内容（一行）：

    ```tsx
    export { Titlebar as TitlebarSlot } from './Titlebar';
    ```

    要点：
    - 保持文件路径与 named export 名称稳定，App.tsx 的 `import { TitlebarSlot } from './components/layout/TitlebarSlot'` 直接生效，无需修改 App.tsx。
    - **不要**保留 01d 的 `data-testid="titlebar-slot"` —— 真实 titlebar 不需要测试桩；如果未来要做 e2e 选择器，应在 `<header>` 上加 `data-testid="titlebar"`（本 plan 暂不引入）。

    **D. 新建 `src/styles/titlebar.css`**

    完整文件内容：

    ```css
    /* Titlebar 局部样式：sticky 行为、按钮尺寸、focus ring。
     * 全局调色板 token 由 01b 在 src/index.css 提供。
     */

    .titlebar-root {
      position: sticky;
      top: 0;
      z-index: 50;
      user-select: none;
      -webkit-user-select: none;
    }

    .window-ctrl-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 4px;
      background-color: transparent;
      color: hsl(var(--foreground));
      transition: background-color 150ms ease, color 150ms ease;
      cursor: default;
      -webkit-app-region: no-drag; /* 即便环境忽略 data-tauri-drag-region，也兜一层 */
    }

    .window-ctrl-btn:focus {
      outline: none;
    }

    .window-ctrl-btn:focus-visible {
      outline: 2px solid #7C5CFF;
      outline-offset: 2px;
    }
    ```

    要点：
    - `border-radius: 4px` 与 UI-SPEC「Border-radius scale: 4px (titlebar buttons)」一致。
    - `width: 36px; height: 36px` 是显式 hit-target（Tailwind 也能写 `w-9 h-9`，但单独 CSS 文件统一管理 titlebar 局部样式更清晰）。
    - focus ring 严格按 UI-SPEC「Interaction Contract」: 2px `#7C5CFF` accent + 2px offset。
    - `:focus` outline none 避免 Chrome 默认蓝框与 accent ring 叠加；`:focus-visible` 仅键盘 Tab 进入时显示。
    - `cursor: default` —— 桌面 chrome 控件不应该出现 web 风格的 hand cursor。
    - hover 颜色由 Tailwind class `hover:bg-accent` / `hover:bg-destructive` 在 JSX 中处理，CSS 文件不重复定义。

    **E. 修改 `src/index.css`**

    用 Edit 工具在文件**末尾**追加一行（保留 01b 写入的所有 `@tailwind` 与 `:root` 块）：

    ```css
    @import './styles/titlebar.css';
    ```

    要点：
    - 如果 PostCSS 在严格模式下抱怨 `@import` 必须在所有规则之前，把这行移到文件最顶部（在 `@tailwind base` 之前）。两种位置在 Tailwind v3 + 默认 PostCSS pipeline 下都被接受，按构建报错决定。
    - **不要**用 Vite 的 `import './styles/titlebar.css'` 在 main.tsx 里再 import 一遍（会产生重复加载），由 index.css 单点入口更清晰。

    **F. 不要做的事**
    - 不要修改 `src/App.tsx`（它的 `<TitlebarSlot/>` 引用已经在 01d 写好，且本 plan 通过 TitlebarSlot 覆写实现透明替换）。
    - 不要修改 `package.json` 添加新依赖（lucide-react / @tauri-apps/api 都已就位）。
    - 不要新增其他 layout 文件（Sidebar 是 01d 范围）。
    - 不要在 Titlebar 里调用 `getCurrentWindow()`（只 WindowControls 调用；保持职责单一）。
  </action>
  <verify>
    <automated>
      cd D:\project\gal-lib;
      pnpm tsc --noEmit;
      grep -c "getCurrentWindow" src/components/layout/WindowControls.tsx;
      grep -c "data-tauri-drag-region" src/components/layout/Titlebar.tsx;
      grep -c "data-tauri-drag-region=\"false\"" src/components/layout/WindowControls.tsx;
      grep -c "h-9" src/components/layout/Titlebar.tsx;
      grep -c "Titlebar as TitlebarSlot" src/components/layout/TitlebarSlot.tsx;
      grep -c "focus-visible" src/styles/titlebar.css;
      grep -c "#7C5CFF" src/styles/titlebar.css;
      grep -c "titlebar.css" src/index.css
    </automated>
  </verify>
  <acceptance_criteria>
    - `pnpm tsc --noEmit` 退出码 0（无 TS 报错；尤其是 `getCurrentWindow` 的 import 路径在 v2 下能解析）
    - `grep -v '^[[:space:]]*//' src/components/layout/WindowControls.tsx | grep -c "getCurrentWindow"` ≥ 2（一次 import + 至少一次调用）
    - `grep -v '^[[:space:]]*//' src/components/layout/Titlebar.tsx | grep -c "data-tauri-drag-region"` ≥ 1（drag region 父 div）
    - `grep -F 'data-tauri-drag-region="false"' src/components/layout/WindowControls.tsx` 命中 1 行（按钮 wrapper 显式拒绝拖拽）
    - `grep -E 'h-9|h-\[36px\]' src/components/layout/Titlebar.tsx` 命中 ≥ 1 行（titlebar 高度 36px）
    - `grep -F 'export { Titlebar as TitlebarSlot }' src/components/layout/TitlebarSlot.tsx` 命中 1 行
    - `grep -F 'data-testid="titlebar-slot"' src/components/layout/TitlebarSlot.tsx` 命中 0 行（01d 的 stub testid 已被替换）
    - `grep -F ':focus-visible' src/styles/titlebar.css` 命中 1 行
    - `grep -F '#7C5CFF' src/styles/titlebar.css` 命中 ≥ 1 行（focus ring 颜色）
    - `grep -E 'outline-offset:\s*2px' src/styles/titlebar.css` 命中 1 行
    - `grep -F 'titlebar.css' src/index.css` 命中 1 行
    - `grep -F 'gal-lib' src/components/layout/Titlebar.tsx` 命中 1 行（app 名文案）
    - `grep -E 'Library|Minus|Square|X' src/components/layout/Titlebar.tsx src/components/layout/WindowControls.tsx | wc -l` ≥ 4（4 个 lucide 图标都引用）
    - `pnpm tauri dev`（人工短暂启动验证）窗口呈现自定义 titlebar、原生 chrome 消失、可拖动、3 按钮可点击；本任务自动化部分不阻塞，由 must_haves 在 phase 验收时人验
  </acceptance_criteria>
  <done>
    自定义 titlebar 全套前端代码就位：Titlebar 组件 + WindowControls 组件 + titlebar.css 局部样式 + TitlebarSlot 透明替换。`pnpm tsc --noEmit` 通过；与 01d 的 App.tsx 0 修改即接通；运行时窗口呈现 36px 自定义 titlebar、可拖、3 按钮工作、focus ring 可见。
  </done>
</task>

</tasks>

<verification>
最终验收（phase 级，run-phase / 01f 二次确认）：

1. `pnpm tauri dev` 启动后，主窗口顶部是自定义 36px 暗色 titlebar，**没有** Windows 原生标题栏 / 边框。
2. 按住 titlebar 左半（`gal-lib` 文字与 Library 图标所在区域）拖动鼠标，窗口跟随移动；按住 3 个按钮**不会**移动窗口（按钮的 hover 与 click 正常）。
3. 点击最小化 → 窗口最小化；点击最大化 → 窗口在最大化/还原间切换；点击关闭 → 应用退出（无确认弹框）。
4. 用键盘 Tab 聚焦到任一窗口控制按钮，按钮外侧呈现 2px `#7C5CFF` 紫色 focus ring（视觉上有 2px 间隙 offset）。
5. 鼠标拖动窗口边缘可调整尺寸；拖到 < 960×600 时被阻止（窗口不会再小）；初始打开是 1280×800。
6. 关闭按钮悬停背景为红色 `#EF4444`，最小化/最大化按钮悬停背景为 `#21252E`。
7. `pnpm tsc --noEmit` 退出码 0；`pnpm tauri dev` console 无 capability 拒绝错误（如 `permission "core:window:allow-minimize" not granted`）。
</verification>

<success_criteria>
- LIB-01 的「上沿契约」实装完成：UI-SPEC 锁定的 36px titlebar + drag region + 3 控制按钮 + focus ring 全部可见可用。
- 与 01d 在 Wave 3 0 文件冲突地并行交付；通过 TitlebarSlot 一行 re-export 让 01d 的 App.tsx 无需任何后续修改。
- Tauri capability 最小化授予（仅 4 条 window 权限），不引入 over-permission。
- RESEARCH §Pitfall 5 显式遵守：drag region 属性在父 div、按钮 wrapper 显式 `data-tauri-drag-region="false"`、`select-none` / `user-select: none` 锁定 titlebar 不可文本选中。
- 准备好被 01f 打包验证：dev 模式与 release 模式行为应一致（decorations 关闭与 capability 授权都在编译期决定，与 dev/release 无关）。
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-01e-SUMMARY.md` documenting:
- The 4 capabilities added to default.json
- The TitlebarSlot stub-to-re-export overwrite strategy (so future readers understand the 01d ↔ 01e Wave 3 contract)
- Confirmation that App.tsx was NOT modified
- Any deviation from RESEARCH §Pattern 4 / §Pitfall 5 (none expected)
</output>
