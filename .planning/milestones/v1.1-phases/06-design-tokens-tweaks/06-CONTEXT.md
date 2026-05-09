# Phase 6: Design Tokens & Tweaks — Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Mode:** Auto-generated from design contract (autonomous)

<domain>
## Phase Boundary

铺设全局设计令牌基础设施 + Tweaks 实时调样面板。

**In scope:**
- 替换 `src/index.css` 现有的 shadcn HSL token 为设计契约的 `--bg-0..3 / --ink-0..3 / --line / --line-strong / --accent / --accent-deep / --accent-soft / --shadow-card / --shadow-lift / --grain-opacity` token 体系
- 用 `<html data-theme/data-accent/data-radius/data-sidebar/data-density>` 切换 5 个维度，每维度组合都是合法的（midnight × violet × sharp × regular × medium 是默认）
- 加载 Noto Serif SC + Noto Sans SC + JetBrains Mono Google Fonts (preconnect + link)，离线 fallback 到系统字体
- shadcn 既有 token (`--background`, `--foreground`, `--card`, `--border`, `--accent`, `--ring` 等) 别名到设计 token，保证现有 shadcn 组件不破坏
- `src/lib/preferences.ts` 管理 5 个维度的 localStorage 读写 + `applyPreferences(<html>)` 副作用
- 屏幕右下浮动 Tweaks 面板：齿轮按钮 fixed bottom-right → 点击展开 280px 卡片含 5 组开关 + 6 个页面跳转快捷
- main.tsx 在 React render 前调用一次 `applyPreferences(loadPreferences())`，避免首屏闪屏

**Out of scope (留给 Phase 7+):**
- 卡片重设计、网格布局调整、Sidebar 状态色 dot、招牌启动按钮——都依赖 Phase 6 的 token，但视觉实现归各自 phase
- 业务页面内的样式重塑——本 phase 只动 token 层和 Tweaks 控件

</domain>

<decisions>
## Implementation Decisions

### shadcn 兼容策略
现有 50+ 处 `bg-background` / `text-foreground` / `border-border` 调用必须保留。方案：
- Tailwind config 把 `hsl(var(--X))` 改成 `var(--X)`，让 CSS var 直接吃十六进制
- 在 `:root[data-theme="midnight"]` (默认) 块内同时定义设计 token (`--bg-0`) 和 shadcn 别名 (`--background: var(--bg-0)`)
- `.dark` class 不再需要——`data-theme="midnight"` 已经决定深浅；index.html 移除 `class="dark"`，加 `data-theme="midnight"`

### Tweaks 面板实现
不抄设计原型的 `__edit_mode_*` postMessage 协议（那是 Claude Design 评审环境专用）。改成纯本地组件：
- shadcn `Popover` + `Button` 实现折叠/展开
- 内部用 Radix `RadioGroup` + 自定义色卡按钮做选项
- 5 维度 + 6 跳转，分 3 个 section
- 默认折叠状态只显示一个 36×36 齿轮按钮

### 字体加载
Google Fonts CDN，`preconnect` + `link rel="stylesheet"` 在 index.html `<head>`。Tauri 自身允许出站 HTTPS（除非 CSP 限制；当前 capabilities 不限制）。离线 fallback 到 Songti SC / PingFang SC / SF Mono / 系统字体。

### CSS @import 顺序
`titlebar.css` 由 `index.css` `@import` 放在最后。新加的 grain 纹理走 `.main::before` 伪元素，不引入新 CSS 文件。

</decisions>

<code_context>
## Existing Code Insights

- `src/index.css` 当前用 shadcn 默认 HSL token，`html, body, #root { height: 100% }` 全局 reset 已有，保留
- `src/styles/titlebar.css` 用 `hsl(var(--foreground))`——切换到设计 token 后会变成 `var(--ink-0)`
- `tailwind.config.ts` 已注册 `aspect-cover` (3/4) + `text-h3` 等业务 token，保留；改色相关时把 `hsl(var(--X))` → `var(--X)`
- `src/main.tsx` 当前在 react render 前已经做了一些 fire-and-forget 初始化（DB / scan-progress / active-session）；可以同位置加 `applyPreferences(loadPreferences())`
- `index.html` `<html lang="zh-CN" class="dark">`——把 `class="dark"` 替换为 `data-theme="midnight" data-accent="violet" data-radius="sharp" data-sidebar="regular" data-density="medium"`，避免首屏闪屏

</code_context>

<specifics>
## Specific Ideas

### 设计令牌完整列表（来自 styles.css §:root + 三主题块）

**Midnight（默认深色）：**
- `--bg-0: #0e0d10` / `--bg-1: #16151a` / `--bg-2: #1d1c22` / `--bg-3: #26252c`
- `--line: rgba(255,255,255,.07)` / `--line-strong: rgba(255,255,255,.14)`
- `--ink-0: #f3efe6` / `--ink-1: #c8c2b6` / `--ink-2: #8b867d` / `--ink-3: #5a554d`
- `--ink-stamp: #d96f5a`
- `--shadow-card: 0 1px 0 rgba(255,255,255,.04) inset, 0 18px 40px -20px rgba(0,0,0,.7)`
- `--shadow-lift: 0 1px 0 rgba(255,255,255,.06) inset, 0 30px 80px -28px rgba(0,0,0,.8)`
- `--grain-opacity: .035`
- `color-scheme: dark`

**Papyrus / Ink** 同款结构，色值参考 styles.css L26-60。

**Accent presets：**
- violet: `--accent: #b18bff` / `--accent-deep: #7a52e5` / `--accent-soft: rgba(177,139,255,.16)`
- teal / sakura / matcha 同款结构。

**Radius / Sidebar / Density：**
- `[data-radius="sharp"] { --r-sm: 2px; --r-md: 3px; --r-lg: 4px; --r-xl: 6px }`
- `[data-radius="soft"] { --r-sm: 6px; --r-md: 10px; --r-lg: 14px; --r-xl: 20px }`
- `[data-sidebar="narrow|regular|wide"] { --sidebar-w: 200|248|296px }`
- `[data-density="small|medium|large"] { --card-w: 132|172|224px }`

**Type stack：**
- `--serif: "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif`
- `--sans: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
- `--mono: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace`

</specifics>

<deferred>
## Deferred Ideas

- 三主题切换的 prefers-color-scheme 自动响应——v1.1 仅手动切换，不做 OS 跟随
- 自定义强调色（用户输入色值）——v1.1 仅四档预设
- Tweaks 面板拖拽——v1.1 fixed bottom-right，不做拖动
- 跳转快捷键（k/d/s/g/p）——v1.1 仅 6 个跳转按钮，不绑键

</deferred>
