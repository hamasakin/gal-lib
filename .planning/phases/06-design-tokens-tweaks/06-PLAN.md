---
phase: 6
plan: 06
status: in_progress
---

# Phase 6 Plan: Design Tokens & Tweaks

**Goal:** Token system + Tweaks panel + localStorage persistence + font loading.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Edit | `index.html` | replace `class="dark"` with `data-theme="midnight" data-accent="violet" data-radius="sharp" data-sidebar="regular" data-density="medium"`; add Google Fonts preconnect + link |
| Replace | `src/index.css` | full design token system + shadcn aliases + global resets + grain pattern + scrollbars |
| Edit | `tailwind.config.ts` | swap `hsl(var(--X))` → `var(--X)`; add fontFamily.serif/mono and ink/bg/line color utilities |
| Edit | `src/styles/titlebar.css` | swap shadcn HSL refs → design tokens |
| New | `src/lib/preferences.ts` | typed Preferences + load/save/apply functions |
| New | `src/components/tweaks/TweaksPanel.tsx` | floating gear button → popover with 5 dimension switches + 6 page jumps |
| Edit | `src/main.tsx` | invoke `applyPreferences(loadPreferences())` before `createRoot.render()` |
| Edit | `src/App.tsx` | mount `<TweaksPanel />` as final child of root layout |

## Tasks

1. **Tokens layer** (index.css + tailwind.config + titlebar.css) — design tokens replace shadcn HSL; old `bg-background` etc still work via aliases.
2. **Preferences module** (lib/preferences.ts) — single source of truth for the 5 dimensions; localStorage round-trip.
3. **Tweaks panel** (components/tweaks/TweaksPanel.tsx) — accessible Popover with 5 RadioGroups + 6 jump buttons.
4. **Bootstrap** (main.tsx + App.tsx + index.html) — apply preferences pre-render, mount panel, load fonts.
5. **Verify** — `pnpm typecheck` clean, `pnpm tauri dev` boots and renders, all themes/accents/radii/sidebars/densities switchable from Tweaks.

## Verification

- typecheck green
- vite build green
- 切换 Tweaks 面板的任一维度，全应用即时换装无刷新
- localStorage 写入 `gal-lib:prefs` 键，重启后状态恢复
- 三主题任意 + 四强调色任意 + 两圆角任意都能正常渲染（共 24 组合，抽样 4 组验证 Library/Detail/Settings 三页面对比可读）
