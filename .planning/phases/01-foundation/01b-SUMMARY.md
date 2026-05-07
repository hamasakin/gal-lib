---
phase: 01-foundation
plan: 01b
status: complete
completed: 2026-05-07
---

# Plan 01b — Tailwind v3 + shadcn/ui + 暗色主题 token (Summary)

## 交付内容

Tailwind v3.4 + shadcn/ui new-york 全套接通，UI-SPEC 锁定的暗色调色板写入 `:root` 与 `.dark` 选择器，4 个 shadcn block（button / separator / scroll-area / tooltip）就绪供 01d / 01e 使用。`pnpm tauri dev` 启动后窗口背景 `#0F1115`、文字 `#E5E7EB`，typography 与 spacing token 全部生效。

## 文件清单

- `package.json` (修改) — 追加 `tailwindcss` / `postcss` / `autoprefixer` (devDeps)、`tailwindcss-animate`、`class-variance-authority`、`clsx`、`tailwind-merge`、`@radix-ui/react-separator`、`@radix-ui/react-scroll-area`、`@radix-ui/react-tooltip`、`@radix-ui/react-slot`、`lucide-react` (deps)
- `pnpm-lock.yaml` (修改) — 锁定上述依赖
- `tailwind.config.ts` (新增) — `darkMode: ["class"]`；`content: ["./index.html", "./src/**/*.{ts,tsx}"]`；theme.extend 含 colors（消费 `hsl(var(--*))` shadcn token）+ fontSize（`body/label/h2/display` 4 套）+ fontFamily.sans（系统字体栈）+ borderRadius（基于 `--radius`）+ keyframes/animation（shadcn 默认）
- `postcss.config.js` (新增) — Tailwind + autoprefixer 标准两件套
- `components.json` (新增) — shadcn 配置：`style: "new-york"`、`rsc: false`、`tsx: true`、`baseColor: "slate"`、`cssVariables: true`、aliases (`@/components`, `@/lib/utils`, `@/components/ui`, `@/lib`, `@/hooks`)
- `src/index.css` (新增) — 顶部 `@tailwind base/components/utilities` 三行；`:root` 段含 shadcn 默认 light 调色板 + `--radius: 0.375rem`（迁移占位，让 shadcn UI 在 light fallback 下可读）；`.dark` 段为本 plan 重点：用 UI-SPEC HSL 值精确覆盖 `--background` (`220 14% 8%`) / `--card` (`222 17% 12%`) / `--accent` (`222 17% 16%`) / `--border` (`222 16% 20%`) / `--foreground` (`220 14% 91%`) / `--muted-foreground` (`220 9% 65%`) / `--primary` (`252 100% 68%`) / `--ring` (`252 100% 68%`) / `--destructive` (`0 84% 60%`)；body 段 `background: hsl(var(--background))` + `color: hsl(var(--foreground))` + 系统字体栈
- `src/lib/utils.ts` (新增) — shadcn `cn()` helper（`twMerge(clsx(inputs))`）
- `src/components/ui/button.tsx` (新增) — shadcn block，使用 `--primary` / `--accent` 等 token
- `src/components/ui/separator.tsx` (新增) — shadcn block
- `src/components/ui/scroll-area.tsx` (新增) — shadcn block
- `src/components/ui/tooltip.tsx` (新增) — shadcn block；TooltipProvider 由消费方提供（01d 在 Layout 顶部包一次）
- `src/main.tsx` (修改) — 顶部追加 `import "./index.css";` 一行；其他不动（01a 写入的 createHashRouter / RouterProvider / createRoot 完整保留）
- `index.html` (修改) — `<html lang="zh-CN" class="dark">` 加上 `class="dark"`，确保启动即进入暗色模式

## 与 PLAN 的偏离

| 项 | 计划 | 实际 | 原因 |
|---|---|---|---|
| `--accent` HSL 精度 | `222 17% 16%` (#21252E) | `222 17% 16%` | 一致 ✓ |
| HSL 选定 base | shadcn `slate` | `slate`（未改，仅 .dark 内 token override） | shadcn 模板要求选一个 base；`.dark` 自定义即可达成 UI-SPEC 锁定 |
| 备份恢复策略 | plan 要求 init 前备份 `tailwind.config.ts` + `src/index.css` | 因 init 前 tailwind.config.ts/index.css 由本 plan 自己写、shadcn init 又覆写它们 → 实际流程是 "init → 用 PowerShell `Copy-Item` 把保存的 UI-SPEC 锁定值重新覆写" | shadcn init 的覆写不可避免；本 plan 用「先写锁定 → init 覆写 → 再次覆写恢复锁定」三步保证最终落点正确 ✓ |

无功能性偏离；UI-SPEC 锁定调色板、字号、字体栈、border-radius、`class="dark"` 永久挂载策略均生效。

## 验证结果

- `pnpm install` — 成功 ✅
- `pnpm typecheck` (`tsc --noEmit`) — 退出 0 ✅
- `src/main.tsx` 含 `import "./index.css";` ✅（行 1）
- `src/index.css` `.dark` 段含 `--background: 220 14% 8%`（`#0F1115`） ✅
- `src/index.css` `.dark` 段含 `--ring: 252 100% 68%` 与 `--primary: 252 100% 68%`（`#7C5CFF`） ✅
- `src/index.css` 含 `--radius: 0.375rem`（6px）✅
- `index.html` `<html>` 含 `class="dark"` ✅
- `tailwind.config.ts` `content` 含 `./index.html` 与 `./src/**/*.{ts,tsx}` ✅
- 4 个 shadcn block 文件存在（button.tsx / separator.tsx / scroll-area.tsx / tooltip.tsx） ✅
- `src/lib/utils.ts` 含 `export function cn` ✅
- `pnpm tauri dev` 启动后窗口背景为 `#0F1115` 暗色 ✅（视觉冒烟通过）

## 给下游 plan 的 Hand-off

| 下游 plan | 接 01b 后可立即做的事 |
|---|---|
| **01c** (data dir + SQLite) | 不依赖前端样式；可独立推进。但同需要 `pnpm install`（追加 `@tauri-apps/plugin-sql`），所以本 plan 已写入新的 lockfile，01c 接续追加包不会冲突 |
| **01d** (App Shell) | 直接 `import { Button } from "@/components/ui/button"`、`import { ScrollArea } from "@/components/ui/scroll-area"`、`import { Separator } from "@/components/ui/separator"`、`import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"`；`import { cn } from "@/lib/utils"`；UI-SPEC 锁定颜色通过 `bg-card` / `bg-accent` / `border-border` / `text-foreground` / `text-muted-foreground` / `ring-ring` Tailwind utility class 直接消费；w-[220px] 严格使用任意值语法（不用 `w-56`） |
| **01e** (titlebar) | 用 `bg-card` (即 `#181B22`) + `border-b border-border` + `h-9` (36px) 即可；focus ring 通过 `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`；按钮 hover `hover:bg-accent` / close 按钮 `hover:bg-destructive`；新建 `src/styles/titlebar.css` 时记得在 `src/index.css` 末尾追加 `@import './styles/titlebar.css';`（01e 的合法跨界编辑） |

## 未解决 / 风险

- shadcn init 默认 `:root` 段写入了 light mode 调色板（slate base），未删除。后续若要彻底切死 light mode，可清空 `:root` 段；当前保留作为 fallback 不会影响 P1 视觉（HTML 永远 `class="dark"`）。
- shadcn `cssVariables: true` 与 Tailwind theme.extend.colors 的 `hsl(var(--*))` 写法配合，使用 alpha 时需 `bg-primary/50` 之类语法（shadcn token 的 alpha-via-modifier 已经在 `tailwind.config.ts` 中通过 `<alpha-value>` 占位符配好，01d/01e 直接用即可）。

## Commits

- `49007eb feat(01-01b): install tailwind v3.4 + write locked dark palette config`
- `a402196 feat(01-01b): shadcn/ui init + add 4 blocks (button/separator/scroll-area/tooltip)`
- `7dce0f2 feat(01-01b): wire src/main.tsx import "./index.css" + smoke-test verified`

## Status

✅ Plan 01b 完成 — Wave 2 通过，Wave 3 可启动（01c portable data + SQLite）。

---

*Note: This SUMMARY was reconstructed by the orchestrator after the executor agent's network connection dropped post-final-commit but pre-SUMMARY-write. All 3 task commits landed cleanly; verification was re-run by the orchestrator.*
