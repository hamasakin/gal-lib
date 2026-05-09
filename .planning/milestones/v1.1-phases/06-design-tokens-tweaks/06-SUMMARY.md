---
phase: 6
plan: 06
status: complete
completed: 2026-05-08
---

# Phase 6 Summary: Design Tokens & Tweaks

## What Shipped

**Design token system** — 5 axes switchable via `<html data-*>`:
- `data-theme`: midnight (default) / papyrus / ink
- `data-accent`: violet (default) / teal / sakura / matcha
- `data-radius`: sharp (default) / soft
- `data-sidebar`: narrow / regular (default) / wide
- `data-density`: small / medium (default) / large

**Tweaks panel** — 40×40 floating gear button bottom-right → shadcn Popover with:
- 主题 section: theme segmented + accent color chips + radius segmented
- 布局 section: sidebar-width segmented + cover-density segmented
- 跳转 section: 4 page jumps (图书馆 / 统计 / 详情 / 设置)

**Persistence** — All 5 axes round-trip through `localStorage["gal-lib:prefs"]` via Zustand store in `src/store/preferences.ts`. Boot-time `applyPreferences(loadPreferences())` in `main.tsx` paints data-* before first React render to avoid flash-of-default.

## Files Touched

| Action | Path | Notes |
|--------|------|-------|
| Edit | `index.html` | `class="dark"` → `data-theme/-accent/-radius/-sidebar/-density`; Google Fonts preconnect + link |
| Replace | `src/index.css` | Full design token layer + shadcn aliases (background/foreground/card/border → bg-0/ink-0/bg-1/line); pulse keyframe; grain helper class; titlebar.css moved to top to satisfy @import-before-@tailwind |
| Edit | `tailwind.config.ts` | `hsl(var(--X))` → `var(--X)`; new `bg-bg-1`, `text-ink-2`, `text-brand`, `text-ink-stamp`, `border-line` utilities; fontFamily.serif/mono; radius scale → `var(--r-*)`; `shadow-card`/`shadow-lift`; `gallib-pulse` keyframe + animation |
| Edit | `src/styles/titlebar.css` | Color refs swapped: `hsl(var(--foreground))` → `var(--ink-1)`; focus ring → `var(--accent)`; close hover bumped to red |
| New | `src/lib/preferences.ts` | Typed enums + `loadPreferences/savePreferences/applyPreferences`; defensive parse + per-axis whitelist |
| New | `src/store/preferences.ts` | Zustand store mirroring `src/store/library.ts` style; setters chain `applyPreferences` + `savePreferences` after every mutation |
| New | `src/components/tweaks/TweaksPanel.tsx` | Popover with custom Segmented + AccentChips + JumpButton subcomponents; uses `useNavigate` for jumps; reads `useLibraryStore.games[0]` for sample-game detail jump |
| Edit | `src/main.tsx` | `applyPreferences(loadPreferences())` before `createRoot.render()` |
| Edit | `src/App.tsx` | mount `<TweaksPanel />` as last child of root flex column |

## Verification

- `pnpm typecheck` — clean
- `pnpm build` — clean (47.78 KB CSS, 1156 KB JS gzip 342 KB; no @import warnings)
- D-04a-1 deferred carry-over from v1.0 fixed: `@import "./styles/titlebar.css"` moved BEFORE `@tailwind base` directives, postcss no longer complains

## Decisions Made

- shadcn HSL aliases preserved through `:root { --background: var(--bg-0); ... }` mapping, so existing 50+ `bg-background` / `text-foreground` callsites need zero rewrites
- `[data-radius]` controls are propagated to shadcn `--radius` via `var(--r-md)`, so existing `rounded-md` calls also re-shape on radius switch
- Tweaks "scan / shots" jumps deferred — those routes don't exist (scan is sticky bar in `/`, shots is a tab on `/games/:id`); kept 4 functional jumps, will revisit if Phase 9/10 adds dedicated routes
- Detail jump uses `games[0].id` from library store; gracefully disabled with hint when library is empty
- Dropped React 18 + babel-standalone CDN approach from design prototype; we keep the project's existing React 19 + Vite + TS + Tailwind v3 + shadcn + Zustand stack. Design contract maps to: CSS variables, color values, type stack, `data-*` switching protocol — all platform-agnostic
