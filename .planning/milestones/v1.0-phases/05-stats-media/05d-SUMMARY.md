---
phase: 05-stats-media
plan: 05d
subsystem: frontend-route-stats-page
tags: [react, recharts, tauri, hashrouter, zustand, stats-ui]
requires:
  - "05a (sqlx GROUP BY playtime aggregation in commands.rs)"
  - "05b (get_playtime_trend + get_top_games registered in lib.rs)"
  - "05c (src/lib/stats.ts invoke wrappers + trend/topGames store slices)"
provides:
  - "src/routes/Stats.tsx — period select (每日/每周/每月) + AreaChart trend + horizontal BarChart top 15"
  - "/stats child route in HashRouter (App layout outlet)"
  - "Sidebar bottom-nav 统计 entry above 设置 (lucide BarChart3 icon, shared active-state styling)"
affects:
  - src/routes/Stats.tsx (new, ~227 lines)
  - src/router.tsx (+3 lines: import + route entry)
  - src/components/layout/Sidebar.tsx (+~30 lines: BarChart3 import + isStatsActive flag + 统计 nav button)
tech-stack:
  added: []  # recharts ^2.15.4 + lucide-react ^1.14.0 already in package.json
  patterns:
    - "Read-only route: page is pure view, only side-effect is the two stats invokes on mount + on period change"
    - "Cached store slices as render source (trend / topGames) — re-mounts paint instantly while fresh data lands in background"
    - "Period→days resolver centralized in daysForPeriod() helper (daily=30, weekly=84, monthly=365)"
    - "name_cn ?? name fallback for top-N category labels (Bangumi/VNDB sometimes omit Chinese title)"
    - "seconds → hours conversion done in component (server returns total_playtime_sec; YAxis unit='h')"
    - "Recharts color tokens: hsl(var(--ring)) series + hsl(var(--muted-foreground)) axes + hsl(var(--card)) tooltip — coherent with shell theme tokens"
    - "Sidebar nav ordering: 统计 above 设置 (per 05-CONTEXT §Stats Page); both share the 2px bg-ring left bar + bg-accent active-state visual"
key-files:
  created:
    - "src/routes/Stats.tsx (~227 lines) — Stats route component"
  modified:
    - "src/router.tsx — Stats import + { path: 'stats', element: <Stats /> } child route"
    - "src/components/layout/Sidebar.tsx — BarChart3 import, isStatsActive flag, 统计 nav button above 设置"
decisions:
  - "Lookback-window mapping locked in daysForPeriod(): daily=30 / weekly=84 / monthly=365 — chosen so each period bucket renders ~12-30 data points (readable trend without crowding the X axis)"
  - "Co-fetch top-N alongside trend on every period change (not just on mount) — single-row aggregate query is cheap, keeps the page coherent if the user changes period after a session ends"
  - "Use store slices (`trend`, `topGames`) as render source rather than local useState — re-mounts after sidebar nav round-trip render the previous data instantly while fresh fetch lands"
  - "Top-N series shaped in component (.map → {name, hours}) rather than at the store layer — keeps store purely state-holding (matches 05c Zustand pattern), and the recharts data shape is component-local concern"
  - "Sidebar 统计 entry rendered as two sibling buttons (统计 above 设置) rather than a NavLink list — matches the existing 设置 button styling verbatim, avoids pulling in react-router's NavLink which we don't use elsewhere in Sidebar"
  - "ScrollArea wrapper around the page body — long Top-15 BarChart at h-[420px] + AreaChart at h-[320px] + headers can exceed viewport height on small windows; matches Library/Detail page scroll convention"
metrics:
  duration_min: 5
  completed: 2026-05-08
---

# Phase 5 Plan 05d: Stats Page + Sidebar nav Summary

Stats route at `/stats` with period select (每日/每周/每月), AreaChart trend (X 日期 / Y 小时), and horizontal BarChart of top 15 games by lifetime hours; Sidebar gains a 统计 nav above 设置 with the lucide BarChart3 icon.

## What Was Built

**`src/routes/Stats.tsx`** (NEW, ~227 lines)

Read-only Stats route composing the 05a/05b/05c stats pipeline into a 2-section page:

1. **Header** — locked title `游玩统计` + shadcn `<Select>` period control (`daily` / `weekly` / `monthly`).
2. **Trend section** — locked heading `游玩时长趋势`; recharts `<AreaChart>` (X = bucket key, Y = hours, unit `h`); empty fallback `还没有游玩记录 — 启动游戏开始记录`.
3. **Top-N section** — locked heading `游戏时长 Top 15`; recharts horizontal `<BarChart>` (Y category = name_cn ?? name, X numeric = hours); empty fallback `还没有游戏 — 请到设置页扫描游戏库`.

Effect re-fetches both `getPlaytimeTrend(period, days)` and `getTopGames(15)` whenever `period` changes. The `daysForPeriod()` helper centralizes the period→lookback mapping (`daily` = 30, `weekly` = 84, `monthly` = 365).

Recharts color tokens use the existing design tokens — `hsl(var(--ring))` for stroke + fill (`fillOpacity={0.25}` on the area), `hsl(var(--muted-foreground))` for axes, `hsl(var(--border))` for the cartesian grid + tooltip border, and `hsl(var(--card))` for the tooltip background.

**`src/router.tsx`** (+3 lines)

Added `import Stats from "./routes/Stats"` and the `{ path: "stats", element: <Stats /> }` child route under the `<App />` layout (HashRouter, locked by CONTEXT.md). JSDoc updated with the Phase 5 (05d) addition note.

**`src/components/layout/Sidebar.tsx`** (+~30 lines)

- Added `BarChart3` to the existing `lucide-react` import.
- Added `isStatsActive = location.pathname === "/stats"` alongside the existing `isSettingsActive` flag.
- Added a 统计 nav button above the existing 设置 button. Both share identical class composition (`relative flex items-center gap-2 px-4 py-2 ...` + 2px bg-ring left bar when active + `bg-accent` active background) so the bottom-nav region reads as a coherent group. Order is locked by 05-CONTEXT §Stats Page (统计 above 设置).

## Locked UI Contract

All locked Chinese copy from execution-context guardrails landed verbatim:
- 游玩统计 / 游玩时长趋势 / 游戏时长 Top 15
- 每日 / 每周 / 每月
- 还没有游玩记录 — 启动游戏开始记录
- 还没有游戏 — 请到设置页扫描游戏库
- 统计 (Sidebar nav label)

Recharts color tokens match the contract:
- AreaChart: `stroke="hsl(var(--ring))"` `fill="hsl(var(--ring))"` `fillOpacity={0.25}`
- BarChart: `fill="hsl(var(--ring))"` (bar)
- Axes: `stroke="hsl(var(--muted-foreground))"` (both charts)
- Grid: `stroke="hsl(var(--border))"` `strokeDasharray="3 3"`
- Tooltip: `background: "hsl(var(--card))"` `border: "1px solid hsl(var(--border))"` `borderRadius: 6`

## Verification

```
pnpm typecheck    # green (no output = success)
pnpm vite build   # green: built in 3.99s, 2793 modules transformed
                  # (pre-existing CSS @import warning is unrelated to this plan)
```

All grep assertions from the plan's `<verify>` block pass:
- `Stats.tsx` exists, contains `getPlaytimeTrend`, `AreaChart`, `BarChart`
- `router.tsx` contains `stats`
- `Sidebar.tsx` contains both `BarChart3` and `统计`

## Guardrail Compliance

- Detail.tsx was NOT touched (05e scope). `git status --short` showed only Sidebar.tsx, router.tsx (modified) + Stats.tsx (new).
- No 05a/05b/05c artifacts were modified — the page consumes the existing `useLibraryStore.{trend, topGames, setTrend, setTopGames}` slices and the `getPlaytimeTrend` / `getTopGames` invoke wrappers from `src/lib/stats.ts`.

## Deviations from Plan

None — plan executed exactly as written. The plan's `<action>` block was followed literally, with the documented option (Stats nav above Settings) chosen per CONTEXT, and JSDoc/comments expanded on the in-plan template to match the project's documentation style.

## Commits

| Plan Task | Commit  | Files                                                                |
| --------- | ------- | -------------------------------------------------------------------- |
| Task 1    | d3598f8 | src/routes/Stats.tsx, src/router.tsx, src/components/layout/Sidebar.tsx |

## Self-Check: PASSED

- [x] `src/routes/Stats.tsx` — FOUND
- [x] `src/router.tsx` — modified (Stats import + /stats route)
- [x] `src/components/layout/Sidebar.tsx` — modified (BarChart3 + 统计 nav)
- [x] Commit `d3598f8` — FOUND in `git log`
- [x] `pnpm typecheck` — green
- [x] `pnpm vite build` — green
- [x] All locked Chinese copy strings present in Stats.tsx + Sidebar.tsx
- [x] Detail.tsx untouched (05e scope preserved)
