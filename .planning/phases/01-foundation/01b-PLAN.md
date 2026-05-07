---
phase: 01-foundation
plan: 01b
type: execute
wave: 2
depends_on: [01a]
files_modified:
  - package.json
  - pnpm-lock.yaml
  - tailwind.config.ts
  - postcss.config.js
  - components.json
  - src/index.css
  - src/main.tsx
  - src/lib/utils.ts
  - src/components/ui/button.tsx
  - src/components/ui/separator.tsx
  - src/components/ui/scroll-area.tsx
  - src/components/ui/tooltip.tsx
autonomous: true
requirements: [LIB-01]
must_haves:
  truths:
    - "`@tailwind base/components/utilities` 已被前端 bundle 加载（`pnpm tauri dev` 主窗口背景为 #0F1115、文字为 #E5E7EB）"
    - "Tailwind 类 `bg-background`、`text-foreground`、`border-border`、`bg-card`、`text-muted-foreground`、`ring-ring` 在源代码中可使用并解析为 UI-SPEC 锁定颜色"
    - "shadcn `<Button>`、`<Separator>`、`<ScrollArea>`、`<Tooltip>` 四个组件源文件在 `src/components/ui/` 下存在并可被 `@/components/ui/...` import"
    - "shadcn `cn()` helper 在 `src/lib/utils.ts` 中存在并可被 `@/lib/utils` import"
    - "HTML 根元素 `<html lang=\"zh-CN\" class=\"dark\">`，`.dark` 选择器下的 CSS 变量生效"
    - "`pnpm tauri dev` 仍能成功启动主窗口（无样式回归 vs 01a baseline），主窗口画面背景为 #0F1115（不是浏览器默认白底）"
    - "`pnpm tsc --noEmit` 通过（shadcn 组件 + path alias `@/*` 在 strict 模式下无类型错误）"
  artifacts:
    - path: "tailwind.config.ts"
      provides: "Tailwind 主题配置：darkMode class 模式 + content scan + theme.extend (colors/fontSize/fontFamily/borderRadius)"
      contains: "darkMode"
    - path: "postcss.config.js"
      provides: "PostCSS pipeline：tailwindcss + autoprefixer"
      contains: "tailwindcss"
    - path: "src/index.css"
      provides: "Tailwind 入口 + :root/.dark CSS 变量层 + html/body base 字体"
      contains: "@tailwind base"
    - path: "components.json"
      provides: "shadcn CLI 配置：new-york style + cssVariables=true + slate baseColor + path aliases"
      contains: "new-york"
    - path: "src/lib/utils.ts"
      provides: "shadcn cn() helper（clsx + tailwind-merge）"
      contains: "tailwind-merge"
    - path: "src/components/ui/button.tsx"
      provides: "shadcn Button 组件源文件（受 cva variants 控制）"
      contains: "buttonVariants"
    - path: "src/components/ui/separator.tsx"
      provides: "shadcn Separator 组件源文件（Radix Separator primitive）"
      contains: "@radix-ui/react-separator"
    - path: "src/components/ui/scroll-area.tsx"
      provides: "shadcn ScrollArea 组件源文件（Radix ScrollArea primitive）"
      contains: "@radix-ui/react-scroll-area"
    - path: "src/components/ui/tooltip.tsx"
      provides: "shadcn Tooltip 组件源文件（Radix Tooltip primitive）"
      contains: "@radix-ui/react-tooltip"
    - path: "package.json"
      provides: "运行时新增 dependencies：clsx, tailwind-merge, class-variance-authority, lucide-react, @radix-ui/react-{slot,separator,scroll-area,tooltip}, tailwindcss-animate；devDependencies 新增 tailwindcss@^3.4, postcss, autoprefixer"
      contains: "tailwindcss"
  key_links:
    - from: "src/main.tsx"
      to: "src/index.css"
      via: "import \"./index.css\""
      pattern: "import\\s+\"\\./index\\.css\""
    - from: "src/index.css"
      to: "tailwind.config.ts"
      via: "@tailwind base/components/utilities + theme.extend.colors 引 hsl(var(--*))"
      pattern: "@tailwind\\s+base"
    - from: "tailwind.config.ts"
      to: "src/index.css 的 CSS 变量"
      via: "darkMode: ['class'] + theme.extend.colors: { background: 'hsl(var(--background))' ... }"
      pattern: "hsl\\(var\\(--background\\)\\)"
    - from: "src/components/ui/button.tsx"
      to: "src/lib/utils.ts (cn helper)"
      via: "import { cn } from \"@/lib/utils\""
      pattern: "import\\s+\\{\\s*cn\\s*\\}\\s+from\\s+[\"']@/lib/utils[\"']"
    - from: "components.json"
      to: "tailwind.config.ts + src/index.css + src/lib/utils.ts + src/components/ui"
      via: "shadcn aliases (utils/components/ui/lib) + tailwind.config + tailwind.css 字段"
      pattern: "\"style\"\\s*:\\s*\"new-york\""
---

<objective>
为 gal-lib 前端样式层落地：Tailwind v3.4.x 接入 → shadcn/ui CLI init（new-york + cssVariables + slate base）→ 四个 shadcn block（button / separator / scroll-area / tooltip）安装 → 用 UI-SPEC 锁定的暗色调色板覆盖 `.dark` 选择器下的 shadcn CSS 变量 → 用 UI-SPEC 锁定的字号/行高/字体栈扩展 Tailwind theme → 在 `src/main.tsx` 接通 `import "./index.css"`。

Purpose: 为 01d（Layout/Sidebar/空状态/Settings 路由）与 01e（自定义 titlebar）提供「直接可消费」的 Tailwind 类与 shadcn 组件源文件 —— 不再需要它们临时拉依赖、不再需要它们决定调色板。本 plan 不创建 Layout、Sidebar、Titlebar、空状态等任何 UI 组件（那是 01d/01e）；不动 SQLite/数据目录（那是 01c）；不改 tauri.conf.json 的 decorations/window 字段（那是 01e）。

Output:
- `tailwind.config.ts` + `postcss.config.js` 就位，Tailwind utilities 在 React 树中可用
- `src/index.css` 含 `@tailwind` 三层指令 + `.dark` 选择器下的 8 个角色色 + 1 个 radius + base 字体栈
- `components.json` 含 shadcn 标准配置（new-york / cssVariables: true / baseColor: slate / path aliases）
- `src/lib/utils.ts` 含 shadcn `cn()` helper
- `src/components/ui/{button,separator,scroll-area,tooltip}.tsx` 四个源文件
- `src/main.tsx` 含 `import "./index.css"`（取代 01a 留下的注释占位）
- `pnpm tauri dev` 启动后主窗口画面背景为 `#0F1115`、文字为 `#E5E7EB`（视觉验证：从浏览器默认白底切换为暗色已生效）
- `pnpm tsc --noEmit` 通过（path alias `@/*` 与四个 shadcn 组件类型干净）
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

<interfaces>
<!--
本 plan 在 01a 已经搭好的 pnpm + Vite + React 19 + TS strict 项目骨架上工作。
执行者必须严格遵守以下「锁定值」，不要从 npm latest 拉取，不要自创色名，不要改字号。
-->

**Locked package versions to add (RESEARCH.md § Standard Stack, VERIFIED 2026-05-07):**

devDependencies (新增):
- `tailwindcss@^3.4` (锁定 v3，禁止 v4 — UI-SPEC + CONTEXT 已锁定)
- `postcss@^8`
- `autoprefixer@^10`

dependencies (由 `shadcn add` 自动拉入，列出仅供事后核对 — 不需要手动 add):
- `@radix-ui/react-slot`
- `@radix-ui/react-separator`
- `@radix-ui/react-scroll-area`
- `@radix-ui/react-tooltip`
- `class-variance-authority`
- `clsx`
- `tailwind-merge`
- `lucide-react`
- `tailwindcss-animate` (Tailwind plugin，会被 tailwind.config.ts require)

**禁止**：手动 `pnpm add` 上述 radix-ui / cva / clsx 等。让 `pnpm dlx shadcn@latest add <block>` 自动处理依赖图，避免版本错配。

**components.json 锁定值（shadcn init 参数 — RESEARCH.md A7）:**
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

**`src/index.css` 完整内容（锁定 — 直接照抄；HSL 值已经过 hex→HSL 换算并通过 RESEARCH.md Pattern 5 复核）:**
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* shadcn defaults (light mode) — 保留以备未来扩展 light theme，本期不会被使用 */
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.375rem;
  }

  .dark {
    /* gal-lib 暗色 token — UI-SPEC §Color 锁定 */
    --background: 220 14% 8%;        /* #0F1115 — Dominant 60% */
    --foreground: 220 13% 91%;       /* #E5E7EB — Foreground primary */
    --card: 220 13% 12%;             /* #181B22 — Sidebar / titlebar / Secondary 30% */
    --card-foreground: 220 13% 91%;
    --popover: 220 13% 12%;          /* #181B22 — same as card */
    --popover-foreground: 220 13% 91%;
    --primary: 252 100% 68%;         /* #7C5CFF — Accent (used by shadcn primary buttons; UI-SPEC restricts use) */
    --primary-foreground: 220 13% 91%;
    --secondary: 220 13% 16%;        /* #21252E — Surface elevated */
    --secondary-foreground: 220 13% 91%;
    --muted: 220 13% 16%;            /* #21252E */
    --muted-foreground: 215 14% 64%; /* #9CA3AF — Foreground muted */
    --accent: 220 13% 16%;           /* #21252E — shadcn accent token = surface elevated (NOT the brand accent) */
    --accent-foreground: 220 13% 91%;
    --destructive: 0 84% 60%;        /* #EF4444 — Destructive */
    --destructive-foreground: 220 13% 91%;
    --border: 220 13% 20%;           /* #2A2F3A */
    --input: 220 13% 20%;            /* #2A2F3A */
    --ring: 252 100% 68%;            /* #7C5CFF — Focus ring = brand accent */
    --radius: 0.375rem;              /* 6px controls radius (UI-SPEC §Color border-radius scale) */
  }

  html, body, #root {
    height: 100%;
    margin: 0;
  }

  html, body {
    font-family: ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: hsl(var(--foreground));
    background: hsl(var(--background));
  }

  * {
    border-color: hsl(var(--border));
  }
}
```

> 关于命名歧义：UI-SPEC 把 `#21252E` 描述为 "Surface elevated"，把 `#7C5CFF` 描述为 "Accent (focus + selection only)"。但 shadcn 的 token 名 `--accent` 习惯指 hover/elevated 表面，`--ring` 指 focus 环。这里**严格按 shadcn 生态约定**：`--ring` = `#7C5CFF`、`--accent` = `#21252E`。若 01d/01e 需要 brand-accent 选中色块（侧栏选中竖条），它们应直接使用 `hsl(var(--ring))` 或加自定义 `--gallery-accent` 变量 —— 此 plan 仅锁定 shadcn 标准 token 集，不预先添加自定义 brand 变量（避免 over-engineering）。

**`tailwind.config.ts` 完整内容（锁定 — 直接照抄）:**
```ts
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          '"Segoe UI"',
          '"Microsoft YaHei"',
          "sans-serif",
        ],
      },
      fontSize: {
        // UI-SPEC §Typography — 4-tier scale locked
        body: ["14px", { lineHeight: "1.5", fontWeight: "400" }],
        label: ["13px", { lineHeight: "1.4", fontWeight: "500" }],
        h2: ["18px", { lineHeight: "1.4", fontWeight: "600" }],
        display: ["13px", { lineHeight: "1.0", fontWeight: "500" }],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
```

**`postcss.config.js` 完整内容（锁定）:**
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

> 注意：因为 `package.json` 含 `"type": "module"`（01a 已设），postcss 配置必须用 ESM `export default`；用 CommonJS `module.exports` 会被 Vite/PostCSS 报错。

**`src/lib/utils.ts` 完整内容（shadcn 默认 cn helper — 由 `shadcn init` 生成）:**
```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**01a 留下的待修补点（必须在 Task 3 处理）：** 01a 的 `src/main.tsx` 应当含一行被注释掉的 `// import "./index.css"; // wired in 01b`。本 plan Task 3 解开该注释。如果 01a 没留下该注释，Task 3 直接在 main.tsx 顶部追加 `import "./index.css";`（在 `import { createRoot } ...` 之前）。

</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: 安装 Tailwind v3 + 写入 tailwind.config.ts / postcss.config.js / src/index.css 三大配置文件</name>
  <files>
    package.json,
    pnpm-lock.yaml,
    tailwind.config.ts,
    postcss.config.js,
    src/index.css
  </files>
  <read_first>
    D:\project\gal-lib\package.json (01a 生成 — 确认当前 dependencies/devDependencies),
    D:\project\gal-lib\.planning\phases\01-foundation\01-UI-SPEC.md (§Color, §Typography, §Spacing — 调色板/字号/字体锁定值),
    D:\project\gal-lib\.planning\phases\01-foundation\01-RESEARCH.md (§ Pattern 5 Dark-First Theme via CSS Variables — 完整 src/index.css + tailwind.config.ts 模板, § Pitfall 8 — `.dark` 选择器策略, § Standard Stack — tailwindcss 3.4.19 锁定),
    D:\project\gal-lib\.planning\phases\01-foundation\01a-PLAN.md (verify 01a 已交付的项目结构 — 确认 src/, package.json scripts, tsconfig.json paths alias 已就位)
  </read_first>
  <action>
    本任务把 Tailwind v3 接入项目，但**不**调用 `pnpm dlx shadcn@latest init`（那是 Task 2，避免 init 命令覆盖本任务写好的 tailwind.config.ts / index.css）。

    1. 在仓库根目录 `D:\project\gal-lib\` 安装 Tailwind v3 工具链（仅 dev deps）：
       ```powershell
       cd D:\project\gal-lib
       pnpm add -D tailwindcss@^3.4 postcss@^8 autoprefixer@^10
       ```
       **关键**：必须用 `^3.4`，绝不允许 `latest` / `^4` —— shadcn/ui new-york 模板基于 v3，CONTEXT.md 已锁定。如果 pnpm 解析出 v4，删除 lockfile 后用精确版本 `tailwindcss@3.4.19` 再装一次。

    2. 用 Write 工具创建 `D:\project\gal-lib\tailwind.config.ts`，内容**严格照抄** `<interfaces>` 中给出的完整 `tailwind.config.ts`（含 darkMode/content/colors/borderRadius/fontFamily/fontSize/plugins）。
       - `content` 数组必须为 `["./index.html", "./src/**/*.{ts,tsx}"]` —— 任何 `.{js,jsx,ts,tsx}` 这种宽匹配会扫到 .d.ts 拖慢 build；任何缺 `./index.html` 会让 `<html class="dark">` 被 PurgeCSS 误剔。
       - 必须 `import type { Config } from "tailwindcss"` + `satisfies Config`（TS strict 下 darkMode tuple `["class"]` 类型推断需要）。

    3. 用 Write 工具创建 `D:\project\gal-lib\postcss.config.js`，内容**严格照抄** `<interfaces>` 中给出的 ESM 版本（`export default { plugins: { tailwindcss: {}, autoprefixer: {} } }`）。
       - **不要**用 CommonJS `module.exports`：01a 设了 `"type": "module"`，CJS 会报错。
       - **不要**用 `.cjs` / `.mjs` 扩展名 —— 用 `.js` 让 Node 按 package.json `"type"` 自动判定为 ESM。

    4. 用 Write 工具创建 `D:\project\gal-lib\src\index.css`，内容**严格照抄** `<interfaces>` 中给出的完整 `src/index.css`（含 `@tailwind` 三层指令 + `:root` light token + `.dark` 暗色 token + `html/body/#root` base 样式 + `* { border-color }` 默认）。
       - **每一个 HSL 值必须与 `<interfaces>` 中字符串完全一致**（精确到空格和百分号，不要重新换算 hex）：
         - `--background: 220 14% 8%;`  (#0F1115)
         - `--foreground: 220 13% 91%;` (#E5E7EB)
         - `--card: 220 13% 12%;`        (#181B22)
         - `--secondary: 220 13% 16%;`   (#21252E)
         - `--accent: 220 13% 16%;`      (#21252E — shadcn token name, NOT brand accent)
         - `--muted-foreground: 215 14% 64%;` (#9CA3AF)
         - `--border: 220 13% 20%;`       (#2A2F3A)
         - `--ring: 252 100% 68%;`        (#7C5CFF — focus ring = brand accent)
         - `--primary: 252 100% 68%;`     (#7C5CFF — shadcn primary，对齐 ring)
         - `--destructive: 0 84% 60%;`    (#EF4444)
         - `--radius: 0.375rem;`          (6px)
       - **HSL 写法必须是空格分隔（`220 14% 8%`），不要逗号、不要 `hsl(...)` 包裹** —— Tailwind config 用 `hsl(var(--background))` 包裹消费，CSS 变量自身只存 `H S% L%` 序列。这是 shadcn 2.x 标准。
       - HTML lang/class 已由 01a 设为 `<html lang="zh-CN" class="dark">`，**本任务不动 index.html**。

    5. 不要在本任务运行 `pnpm tauri dev` —— Task 2/3 完成 shadcn init + main.tsx import 后再统一启动验证。
  </action>
  <verify>
    <automated>
      cd D:\project\gal-lib; ^
      test -f tailwind.config.ts -a -f postcss.config.js -a -f src/index.css && ^
      grep -q '"tailwindcss"' package.json && ^
      grep -E '"tailwindcss"\s*:\s*"\^?3\.' package.json && ^
      ! grep -E '"tailwindcss"\s*:\s*"\^?4\.' package.json && ^
      grep -q '"postcss"' package.json && ^
      grep -q '"autoprefixer"' package.json && ^
      grep -q 'darkMode: \["class"\]' tailwind.config.ts && ^
      grep -q '"./index.html"' tailwind.config.ts && ^
      grep -q '"./src/\*\*/\*.{ts,tsx}"' tailwind.config.ts && ^
      grep -q 'hsl(var(--background))' tailwind.config.ts && ^
      grep -q 'hsl(var(--ring))' tailwind.config.ts && ^
      grep -q 'tailwindcss-animate' tailwind.config.ts && ^
      grep -q '"Microsoft YaHei"' tailwind.config.ts && ^
      grep -q 'export default' postcss.config.js && ^
      grep -q 'tailwindcss: {}' postcss.config.js && ^
      grep -q 'autoprefixer: {}' postcss.config.js && ^
      ! grep -q 'module.exports' postcss.config.js && ^
      grep -q '@tailwind base' src/index.css && ^
      grep -q '@tailwind components' src/index.css && ^
      grep -q '@tailwind utilities' src/index.css && ^
      grep -q '\.dark {' src/index.css && ^
      grep -q -- '--background: 220 14% 8%' src/index.css && ^
      grep -q -- '--foreground: 220 13% 91%' src/index.css && ^
      grep -q -- '--card: 220 13% 12%' src/index.css && ^
      grep -q -- '--secondary: 220 13% 16%' src/index.css && ^
      grep -q -- '--muted-foreground: 215 14% 64%' src/index.css && ^
      grep -q -- '--border: 220 13% 20%' src/index.css && ^
      grep -q -- '--ring: 252 100% 68%' src/index.css && ^
      grep -q -- '--destructive: 0 84% 60%' src/index.css && ^
      grep -q -- '--radius: 0.375rem' src/index.css && ^
      grep -q '"Microsoft YaHei"' src/index.css
    </automated>
  </verify>
  <acceptance_criteria>
    - `package.json` devDependencies 中 `tailwindcss` 在 `^3.4`/`^3` 范围（grep 命中 `"tailwindcss": "^3`），**绝不**含 `^4`
    - `package.json` devDependencies 中 `postcss` 与 `autoprefixer` 同时存在
    - `tailwind.config.ts` 含 `darkMode: ["class"]`、`content: [...]` 含 `./index.html` 与 `./src/**/*.{ts,tsx}`、`theme.extend.colors` 中至少 `background`/`foreground`/`border`/`ring`/`primary`/`card`/`muted`/`accent`/`popover`/`destructive`/`secondary`/`input` 12 个 token 全部用 `hsl(var(--*))` 包裹
    - `tailwind.config.ts` 含 `theme.extend.fontFamily.sans` 数组、`theme.extend.fontSize` 含 `body/label/h2/display` 四个 key
    - `tailwind.config.ts` 含 `plugins: [require("tailwindcss-animate")]`
    - `postcss.config.js` 用 ESM `export default`，**不**含 `module.exports`，含 `tailwindcss: {}` 与 `autoprefixer: {}`
    - `src/index.css` 顶部三行依次为 `@tailwind base;` / `@tailwind components;` / `@tailwind utilities;`
    - `src/index.css` 含 `.dark {` 选择器，且其内含表中所有 10 个 grep 锚点（背景/前景/卡片/secondary/muted-foreground/border/ring/primary/destructive/radius）每个 HSL 值都精确匹配
    - `src/index.css` 含 `font-family: ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif`（grep 命中 `"Microsoft YaHei"`）
    - 仓库根 `pnpm-lock.yaml` 已更新（mtime 大于本任务开始前），证明 install 成功
  </acceptance_criteria>
  <done>
    Tailwind v3 工具链就位，三个配置文件按 UI-SPEC + RESEARCH.md 锁定值写入，所有 grep 校验通过。Task 2 可在此基础上跑 shadcn init。
  </done>
</task>

<task type="auto">
  <name>Task 2: shadcn/ui CLI init + 安装 button/separator/scroll-area/tooltip 四个 block，并复核生成产物未覆盖 Task 1 锁定值</name>
  <files>
    components.json,
    src/lib/utils.ts,
    src/components/ui/button.tsx,
    src/components/ui/separator.tsx,
    src/components/ui/scroll-area.tsx,
    src/components/ui/tooltip.tsx,
    package.json,
    pnpm-lock.yaml,
    tailwind.config.ts,
    src/index.css
  </files>
  <read_first>
    D:\project\gal-lib\tailwind.config.ts (Task 1 写入 — 用作 init 后的回滚比对基线),
    D:\project\gal-lib\src\index.css (Task 1 写入 — 用作 init 后的回滚比对基线),
    D:\project\gal-lib\package.json (Task 1 后状态),
    D:\project\gal-lib\tsconfig.json (01a 写入 — 确认 paths alias `@/*` -> `src/*` 已存在),
    D:\project\gal-lib\.planning\phases\01-foundation\01-RESEARCH.md (§ Standard Stack 第 170-171 行 shadcn init 命令, § Pitfall 8 .dark 策略, § Architecture A7 new-york + slate base color)
  </read_first>
  <action>
    用 shadcn CLI 把 4 个 block 安装到项目里。**关键风险：`shadcn init` 会自作主张地覆写 `tailwind.config.ts` 与 `src/index.css`**（它会写入它默认的 light + dark 调色板，覆盖 Task 1 写好的 gal-lib 锁定值）。本任务的策略：先备份 → 跑 init → 立即恢复 Task 1 写的版本 → 再 add 4 个 block（add 命令不会改 config，只新增 ui/ 文件 + 拉依赖）。

    1. **备份 Task 1 写的两个文件**（用 PowerShell `Copy-Item`）：
       ```powershell
       cd D:\project\gal-lib
       Copy-Item tailwind.config.ts tailwind.config.ts.bak -Force
       Copy-Item src\index.css src\index.css.bak -Force
       ```

    2. 运行 shadcn init（非交互模式，传入所有选项 — 注意 shadcn CLI 当前 v2.x 的 init 签名）：
       ```powershell
       pnpm dlx shadcn@latest init --yes --base-color slate --css-variables
       ```
       如果 `shadcn@latest` 拒绝以上 flags（CLI 在 2.x 之间有版本飘移），回退到交互式：
       ```powershell
       pnpm dlx shadcn@latest init
       ```
       并依次回答：
       - Style: **`new-york`**
       - Base color: **`slate`**
       - CSS variables: **`yes`**
       - Tailwind config 路径: **`tailwind.config.ts`**（接受默认）
       - Global CSS 路径: **`src/index.css`**（接受默认）
       - tailwind.config.ts location alias: **`@/`**
       - 其它一律选默认（new-york / tsx: yes / RSC: no / iconLibrary: lucide）

       init 完成后会生成：
       - `components.json` (项目根)
       - `src/lib/utils.ts` (含 `cn()` helper)
       - 重写的 `tailwind.config.ts`（**会被下一步覆盖**）
       - 重写的 `src/index.css`（**会被下一步覆盖**）
       - 可能新增到 `package.json` 的 deps：`clsx`、`tailwind-merge`、`class-variance-authority`、`tailwindcss-animate`、`lucide-react`

    3. **立即恢复 Task 1 锁定值**（覆盖 init 写坏的两个文件）：
       ```powershell
       Copy-Item tailwind.config.ts.bak tailwind.config.ts -Force
       Copy-Item src\index.css.bak src\index.css -Force
       Remove-Item tailwind.config.ts.bak
       Remove-Item src\index.css.bak
       ```
       恢复后 `tailwind.config.ts` 和 `src/index.css` 必须完全等于 Task 1 写入版本（grep 校验同 Task 1）。

    4. **校验 components.json 内容**。打开 `D:\project\gal-lib\components.json`，确认它含 `<interfaces>` 中给出的所有字段：`style: "new-york"`、`tsx: true`、`tailwind.config: "tailwind.config.ts"`、`tailwind.css: "src/index.css"`、`tailwind.baseColor: "slate"`、`tailwind.cssVariables: true`、`aliases.utils: "@/lib/utils"`、`aliases.components: "@/components"`、`aliases.ui: "@/components/ui"`、`iconLibrary: "lucide"`。如果某些字段缺失（CLI 版本飘移），手动 Edit 补齐。

    5. **校验 `src/lib/utils.ts` 内容**。该文件应当被 init 自动生成，内容形似：
       ```ts
       import { clsx, type ClassValue } from "clsx";
       import { twMerge } from "tailwind-merge";

       export function cn(...inputs: ClassValue[]) {
         return twMerge(clsx(inputs));
       }
       ```
       如果文件不存在，手动 Write 创建（内容照抄 `<interfaces>`）。

    6. 安装 4 个 block（一条命令一次性安装，让 CLI 处理依赖去重）：
       ```powershell
       pnpm dlx shadcn@latest add button separator scroll-area tooltip --yes
       ```
       如果 `--yes` 不被识别，去掉它，CLI 会逐个询问"覆盖？"，全部回答 `n`（不应有冲突 —— 这 4 个文件都是首次创建）。

       完成后期望文件：
       - `src/components/ui/button.tsx`
       - `src/components/ui/separator.tsx`
       - `src/components/ui/scroll-area.tsx`
       - `src/components/ui/tooltip.tsx`

       `package.json` 应当被 add 自动追加 dependencies：
       - `@radix-ui/react-slot` (button 依赖)
       - `@radix-ui/react-separator`
       - `@radix-ui/react-scroll-area`
       - `@radix-ui/react-tooltip`
       - `class-variance-authority`
       - `clsx`
       - `tailwind-merge`
       - `lucide-react`
       - `tailwindcss-animate` (Tailwind plugin — 可能在 dev 或 dep；接受 CLI 默认)

    7. **再次校验 Task 1 锁定值未被 add 命令污染**（add 通常只改 components/ui 与 package.json，但稳妥起见复查）：
       ```powershell
       findstr /C:"--background: 220 14% 8%" src\index.css
       findstr /C:"darkMode: [\"class\"]" tailwind.config.ts
       ```
       两条都必须命中。如果未命中（罕见），从 git diff 还原。

    8. 运行 `pnpm install` 一次确保 lockfile 与 package.json 同步：
       ```powershell
       pnpm install
       ```

    9. 不要在本任务运行 `pnpm tauri dev` —— Task 3 接入 main.tsx import 后才统一启动验证。
  </action>
  <verify>
    <automated>
      cd D:\project\gal-lib && ^
      test -f components.json -a -f src/lib/utils.ts -a -f src/components/ui/button.tsx -a -f src/components/ui/separator.tsx -a -f src/components/ui/scroll-area.tsx -a -f src/components/ui/tooltip.tsx && ^
      grep -q '"style": "new-york"' components.json && ^
      grep -q '"tsx": true' components.json && ^
      grep -q '"baseColor": "slate"' components.json && ^
      grep -q '"cssVariables": true' components.json && ^
      grep -q '"@/components"' components.json && ^
      grep -q '"@/lib/utils"' components.json && ^
      grep -q '"@/components/ui"' components.json && ^
      grep -q 'tailwind-merge' src/lib/utils.ts && ^
      grep -q 'export function cn' src/lib/utils.ts && ^
      grep -q 'buttonVariants' src/components/ui/button.tsx && ^
      grep -q '@radix-ui/react-separator' src/components/ui/separator.tsx && ^
      grep -q '@radix-ui/react-scroll-area' src/components/ui/scroll-area.tsx && ^
      grep -q '@radix-ui/react-tooltip' src/components/ui/tooltip.tsx && ^
      grep -q 'from "@/lib/utils"' src/components/ui/button.tsx && ^
      grep -q '"@radix-ui/react-slot"' package.json && ^
      grep -q '"@radix-ui/react-separator"' package.json && ^
      grep -q '"@radix-ui/react-scroll-area"' package.json && ^
      grep -q '"@radix-ui/react-tooltip"' package.json && ^
      grep -q '"class-variance-authority"' package.json && ^
      grep -q '"clsx"' package.json && ^
      grep -q '"tailwind-merge"' package.json && ^
      grep -q '"lucide-react"' package.json && ^
      grep -q '"tailwindcss-animate"' package.json && ^
      grep -q -- '--background: 220 14% 8%' src/index.css && ^
      grep -q -- '--ring: 252 100% 68%' src/index.css && ^
      grep -q 'darkMode: \["class"\]' tailwind.config.ts && ^
      grep -q 'hsl(var(--ring))' tailwind.config.ts && ^
      ! test -f tailwind.config.ts.bak && ^
      ! test -f src/index.css.bak
    </automated>
  </verify>
  <acceptance_criteria>
    - `D:\project\gal-lib\components.json` 存在，且 grep 命中 `"style": "new-york"`、`"tsx": true`、`"baseColor": "slate"`、`"cssVariables": true`、aliases 含 `@/components`/`@/lib/utils`/`@/components/ui`
    - `D:\project\gal-lib\src\lib\utils.ts` 存在，含 `import` `tailwind-merge` 与 `export function cn`
    - `src/components/ui/button.tsx` 存在，含 `buttonVariants` 标识符（cva 标准导出名）与 `import { cn } from "@/lib/utils"`
    - `src/components/ui/separator.tsx`、`scroll-area.tsx`、`tooltip.tsx` 存在，且分别 import 各自的 `@radix-ui/react-*` primitive
    - `package.json` 已新增 8 个运行时依赖（`@radix-ui/react-{slot,separator,scroll-area,tooltip}`、`class-variance-authority`、`clsx`、`tailwind-merge`、`lucide-react`）+ 1 个 plugin (`tailwindcss-animate`)
    - **回滚校验**：`tailwind.config.ts` 仍含 `darkMode: ["class"]` 与 `hsl(var(--ring))`；`src/index.css` 仍含 `--background: 220 14% 8%` 与 `--ring: 252 100% 68%` —— 即 Task 1 锁定值**未被 init 污染**
    - 临时备份文件 `tailwind.config.ts.bak` 与 `src/index.css.bak` 已删除
    - `pnpm-lock.yaml` 已与 `package.json` 同步（mtime 大于 init 调用前）
  </acceptance_criteria>
  <done>
    四个 shadcn block + cn helper + components.json 就位；UI-SPEC 锁定的暗色 token 与字体配置在 init 操作中保持完整。01d/01e 可直接 `import { Button } from "@/components/ui/button"` 等使用。
  </done>
</task>

<task type="auto">
  <name>Task 3: 在 src/main.tsx 接通 `import "./index.css"` + 视觉烟测 + 类型/编译双绿验证</name>
  <files>
    src/main.tsx
  </files>
  <read_first>
    D:\project\gal-lib\src\main.tsx (01a 写入 — 找到被注释的 `// import "./index.css"; // wired in 01b` 行；如果不存在则在文件顶部追加),
    D:\project\gal-lib\src\App.tsx (01a 写入 — 确认其用 inline style 设了 #0F1115 背景；本任务不改 App.tsx),
    D:\project\gal-lib\src\index.css (Task 1 写入 — 确认 .dark 选择器与 html/body base 已就位),
    D:\project\gal-lib\index.html (01a 写入 — 确认 <html lang="zh-CN" class="dark">)
  </read_first>
  <action>
    最小一次性单行修改：让前端 bundle 真正包含 Tailwind 输出 + 我们在 index.css 写入的 CSS 变量层。然后做一次 `pnpm tauri dev` 烟测确认无样式回归 + 一次 `pnpm tsc --noEmit` 确认 shadcn 组件 + path alias `@/*` 类型干净。

    1. 编辑 `D:\project\gal-lib\src\main.tsx`：
       - **场景 A**：如果文件中存在被注释的 `// import "./index.css"; // wired in 01b`（或类似注释行），把它改为正式 import：`import "./index.css";`。
       - **场景 B**：如果不存在该注释（01a 直接省略了），则在文件**第一行**（任何其他 import 之前）插入 `import "./index.css";`。
       - 编辑完成后 main.tsx 的 import 顺序应为：
         ```tsx
         import "./index.css";
         import { createRoot } from "react-dom/client";
         import { createHashRouter, RouterProvider } from "react-router-dom";
         import App from "./App";
         ```
         其余内容保持 01a 原样（HashRouter `[{ path: "/", element: <App /> }]` + `createRoot(rootEl).render(<RouterProvider router={router} />)`）。
       - **不要**改 App.tsx（保留 01a 的 inline style "Hello gal-lib"，本期还没到 RootLayout — 那是 01d）。
       - **不要**改 index.html（01a 已设 `class="dark"`）。

    2. 运行 TS 类型检查：
       ```powershell
       cd D:\project\gal-lib
       pnpm tsc --noEmit
       ```
       期望：退出码 0。如果失败：
       - 报错 `Cannot find module '@/lib/utils'` → 检查 `tsconfig.json` 与 `tsconfig.app.json` 的 `compilerOptions.paths` 含 `"@/*": ["src/*"]` 与 `compilerOptions.baseUrl: "."`；如果 01a 没设，**本任务直接修复**这两个 tsconfig 文件（这是 01a 应做的，但 01b 是首个真正消费 alias 的 plan，必须保证它能用）。
       - 报错 `Cannot find module 'tailwindcss-animate'` → 走 `pnpm install` 一次。
       - 报错 shadcn 组件 props 类型不兼容 React 19 → 这是已知 radix-ui + React 19 的 peerDependency 警告但通常不影响 tsc；如果真的报错，临时在 `tsconfig.app.json` 加 `"skipLibCheck": true`（shadcn 官方文档示例就开了 skipLibCheck）。

    3. 视觉烟测 —— 启动 `pnpm tauri dev`：
       ```powershell
       pnpm tauri dev
       ```
       期望：cargo 增量 build 完成（首次编译 < 30s，因为 01a/01b 的 Rust 源未变）→ Vite dev server 启动 → 主窗口弹出 → 画面显示居中 `Hello gal-lib`，**背景色 = #0F1115（深色）**，文字色 = #E5E7EB。

       **关键判断**：
       - ✅ 如果背景是 #0F1115 暗色 → Tailwind base + index.css 的 `html/body { background: hsl(var(--background)) }` 已生效 + `.dark` 选择器命中（因为 `<html class="dark">`）。
       - ❌ 如果背景是浏览器默认白色 → `import "./index.css"` 没写对 / Vite 没 pick up index.css → 检查 main.tsx import 路径与 main.tsx 是否真的被 bundle（`pnpm dev` 不行就再 build 一次）。
       - ❌ 如果背景是 light 调色板（接近白）但不是浏览器默认白 → `<html class="dark">` 丢失 → 检查 index.html。
       - ❌ 如果出现 Vite 报错 `Unknown at rule @tailwind` → postcss.config.js 没生效或 postcss-load-config 找不到配置（检查文件名 / "type": "module"）。

       看到正确暗色画面后立即 Ctrl+C 中断 dev 进程。

    4. 在 SUMMARY.md 中记录视觉烟测时间戳 + 主窗口背景色（用 `#0F1115` 或截图链接确认），作为 01d/01e 的"暗色已生效"baseline。
  </action>
  <verify>
    <automated>
      cd D:\project\gal-lib && ^
      grep -q 'import "./index.css"' src/main.tsx && ^
      ! grep -q '// import "./index.css"' src/main.tsx && ^
      grep -q 'createHashRouter' src/main.tsx && ^
      grep -q 'RouterProvider' src/main.tsx && ^
      grep -q 'class="dark"' index.html && ^
      pnpm tsc --noEmit
    </automated>
  </verify>
  <acceptance_criteria>
    - `src/main.tsx` 含**未被注释**的 `import "./index.css";`（grep 命中正向、未命中以 `//` 开头的版本）
    - `src/main.tsx` 仍含 `createHashRouter` 与 `RouterProvider`（01a 的入口未被破坏）
    - `index.html` 仍含 `<html lang="zh-CN" class="dark">`（未被本任务误改）
    - `pnpm tsc --noEmit` 退出码 0（TS strict + path alias `@/*` + shadcn 组件类型全部通过）
    - 执行者亲眼确认 `pnpm tauri dev` 启动后主窗口背景色为 `#0F1115` 暗色（浅色或纯白即视为失败 —— 必须在 SUMMARY 中以截图或时间戳记录已观测到暗色）
    - **不应**有任何文件冲突：本任务只动 1 个文件（src/main.tsx），其它 01a 与 Task 1/2 的产物完全保留
  </acceptance_criteria>
  <done>
    Tailwind + shadcn + UI-SPEC 暗色 token 在运行时端到端打通：从 `<html class="dark">` → `src/index.css` 的 `.dark` 选择器 → `html/body { background: hsl(var(--background)) }` → 主窗口画面渲染 `#0F1115`。01d/01e 接管时无需关心样式管线，直接用 Tailwind 类与 shadcn 组件即可。
  </done>
</task>

</tasks>

<verification>
**Plan-level checks（执行完所有 task 后整体复验）：**

1. **依赖锁定校验**（Tailwind v3 而非 v4，shadcn deps 齐全）：
   ```powershell
   cd D:\project\gal-lib
   findstr /R /C:"\"tailwindcss\": \"\^3" package.json     # 必须命中
   findstr /R /C:"\"tailwindcss\": \"\^4" package.json     # 必须无命中
   findstr /C:"@radix-ui/react-slot" package.json          # 必须命中
   findstr /C:"@radix-ui/react-separator" package.json     # 必须命中
   findstr /C:"@radix-ui/react-scroll-area" package.json   # 必须命中
   findstr /C:"@radix-ui/react-tooltip" package.json       # 必须命中
   findstr /C:"tailwindcss-animate" package.json           # 必须命中
   ```

2. **暗色调色板锁定值校验**（每个 hex→HSL 都精确）：
   ```powershell
   findstr /C:"--background: 220 14% 8%" src\index.css     # #0F1115
   findstr /C:"--card: 220 13% 12%" src\index.css          # #181B22
   findstr /C:"--secondary: 220 13% 16%" src\index.css     # #21252E
   findstr /C:"--border: 220 13% 20%" src\index.css        # #2A2F3A
   findstr /C:"--foreground: 220 13% 91%" src\index.css    # #E5E7EB
   findstr /C:"--muted-foreground: 215 14% 64%" src\index.css  # #9CA3AF
   findstr /C:"--ring: 252 100% 68%" src\index.css         # #7C5CFF
   findstr /C:"--destructive: 0 84% 60%" src\index.css     # #EF4444
   findstr /C:"--radius: 0.375rem" src\index.css           # 6px
   ```
   九条都必须命中；任何一条不命中即视为调色板被污染。

3. **shadcn 4 个 block 完整性**：
   ```powershell
   if (-not (Test-Path src\components\ui\button.tsx)) { exit 1 }
   if (-not (Test-Path src\components\ui\separator.tsx)) { exit 1 }
   if (-not (Test-Path src\components\ui\scroll-area.tsx)) { exit 1 }
   if (-not (Test-Path src\components\ui\tooltip.tsx)) { exit 1 }
   if (-not (Test-Path src\lib\utils.ts)) { exit 1 }
   if (-not (Test-Path components.json)) { exit 1 }
   ```

4. **TS strict + 主窗口烟测**：
   ```powershell
   pnpm tsc --noEmit
   # 然后 pnpm tauri dev → 主窗口背景必须是 #0F1115 暗色，非白底
   ```

5. **本 plan 不应越界写入下游 plan 的字段**：
   ```powershell
   findstr /C:"decorations" src-tauri\tauri.conf.json      # 必须无命中（01e 才写）
   findstr /C:"tauri-plugin-sql" src-tauri\Cargo.toml      # 必须无命中（01c 才加）
   findstr /C:"data-tauri-drag-region" src              # 必须无命中（01e 才用，本期不该有 Titlebar 实现）
   if (Test-Path src\components\layout) { exit 1 }         # layout 目录是 01d/01e 的事，本 plan 不应创建
   if (Test-Path src\routes) { exit 1 }                    # routes 目录是 01d 的事
   ```

6. **数据目录隔离继承**（与 01a 一致 —— 仓库内不应预创建 data/）：
   ```powershell
   if (Test-Path D:\project\gal-lib\data) { exit 1 }
   ```
</verification>

<success_criteria>
1. Tailwind v3.4.x 工具链完整接入：`tailwind.config.ts` + `postcss.config.js` + `src/index.css` 三个文件按 RESEARCH.md Pattern 5 完整模板写入
2. 调色板严格忠实于 UI-SPEC §Color：`#0F1115`/`#181B22`/`#21252E`/`#2A2F3A`/`#E5E7EB`/`#9CA3AF`/`#7C5CFF`/`#EF4444` 八色 → 对应 HSL 写入 `.dark` 选择器；`--radius: 0.375rem` (6px) 写入；shadcn 默认 light token 保留在 `:root` 以备未来扩展
3. 字号体系（body 14/label 13/h2 18/display 13）写入 `theme.extend.fontSize`；字体栈 `ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif` 同时写入 Tailwind theme 与 index.css base 两处
4. shadcn/ui CLI init 通过、`components.json` 含 new-york + cssVariables + slate baseColor + 完整 aliases；`src/lib/utils.ts` 的 `cn()` helper 就位
5. 四个 shadcn block（button/separator/scroll-area/tooltip）源文件落在 `src/components/ui/` 下，每个都正确 `import { cn } from "@/lib/utils"` 并 import 自己的 radix primitive
6. `src/main.tsx` 接通 `import "./index.css"`，前端 bundle 真正加载 Tailwind 输出 + CSS 变量层
7. `pnpm tsc --noEmit` 通过（TS strict + path alias `@/*` + shadcn 组件类型干净）
8. 视觉端到端打通：`pnpm tauri dev` 启动后主窗口背景为 `#0F1115` 暗色（不是浏览器默认白底，证明 `.dark` 选择器命中且 Tailwind base 起效）
9. **零越界写入**：未动 `tauri.conf.json` 的 decorations/window 字段、未动 `Cargo.toml`、未创建 `src/components/layout/` 或 `src/routes/`、未预创建 `data/` 目录
10. **零调色板污染**：shadcn init 命令对 `tailwind.config.ts` 与 `src/index.css` 的覆写已被备份/恢复策略中和；最终调色板与 UI-SPEC 锁定值字节级一致
</success_criteria>

<output>
After completion, create `D:\project\gal-lib\.planning\phases\01-foundation\01b-SUMMARY.md` 含：

- 实际安装的 tailwindcss / @radix-ui/* / shadcn deps 版本号（对照 RESEARCH.md VERIFIED 列表，标注偏离）
- shadcn init 命令的实际交互/flag（哪些 flag 在当前 CLI 版本被接受 / 回退到交互式的回答路径）—— 为后续若需要再 add block（Phase 2+）留索引
- shadcn init 是否覆盖了 tailwind.config.ts / src/index.css（备份/恢复策略是否真的派上用场）
- TS strict（`pnpm tsc --noEmit`）通过的时间戳
- `pnpm tauri dev` 主窗口暗色画面观测时间戳 + 是否截图
- 任何偏离 UI-SPEC §Color HSL 锁定值的事项（应当为空 — 偏离即视为缺陷）
- 已知遗留：
  - shadcn init 默认 `--accent: 220 13% 16%` 占用了 "Surface elevated" 槽位，brand accent `#7C5CFF` 写到了 `--ring` + `--primary`；如果 01d 实现侧栏「选中竖条」时需要独立 brand accent 变量（例如 `--gallery-accent`），可在 01d 内追加（本 plan 不预先添加，避免 over-engineering）
  - shadcn 默认 `:root` light 调色板保留 → 未来如果实装 light mode toggle，去掉 `<html class="dark">` 即可切换，无需重写 token
</output>
