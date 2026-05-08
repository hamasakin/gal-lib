---
phase: 7
plan: 07
status: complete
completed: 2026-05-08
---

# Phase 7 Summary: Library Page Redesign

## What Shipped

**Library card aesthetic** — every game tile in the grid:
- 3:4 cover with `--shadow-card` → `--shadow-lift` on hover (-4px translate)
- Top-left 「藏书章」mono uppercase status stamp (5 colors via STAMP_COLOR map)
- Top-right favorite mark (heart-fill, brand-colored, drop-shadow) — mutually exclusive with `复核` review stamp
- Hover: bottom linear gradient overlay + 30px circular play icon (启动 / 强制结束 / 无 EXE state)
- Title in `--serif` font, 13.5px, line-clamp-2; sub-row brand · sep dot · mono playtime

**Magazine asymmetric grid** — replaces virtualized GameGrid:
- Hero band first row (1.6fr+1+1+1 when >=4 recent games; collapses to 1fr when 0)
- Hero card uses cover as full-bleed bg + glass label (breadcrumb · serif title · play stats)
- Section rule between hero and stacks: serif `藏书 · Stacks` + ruled line + mono count
- Stack grid: `repeat(auto-fill, minmax(var(--card-w), 1fr))` — driven by Tweaks density preference

**Sidebar restyle** — new design contract aesthetic:
- Width follows `var(--sidebar-w)` (Tweaks-controlled narrow/regular/wide)
- Mono uppercase 9.5px section labels (视图 / 通关状态 / 工具 / 自定义标签 / 品牌·厂牌 / 发行年份)
- Colored 6px square dots prefixing status rows (playing=brand, cleared=teal, unplayed=stamp, dropped=ink-2)
- Active state: `bg-brand-soft` + `text-ink-0` (full-row highlight, not 2px left bar)
- Settings + Stats moved into the unified scroll area (under 工具 section)

**Active session strip** — `.now-playing` pattern:
- 64px cover thumbnail · pulsing brand dot · 「正在游玩」mono breadcrumb
- Serif 18px title · mono session timer (HH:MM:SS, 1Hz tick) · total playtime
- Left accent border 3px (brand color)
- 强制结束 button with confirmation AlertDialog

**Page header pattern** — reusable PageHeader component:
- mono uppercase breadcrumb + count badge
- serif 32px H1 with optional accent-italic span (`本月你的<span>私人书架</span>`)
- mono sub line for metadata (last scan time / count)
- right-aligned action buttons (重新扫描 / 添加根目录)

**Toolbar row** — chip-based filtering:
- StatusFilterChips (全部 / 游玩中 / 已通关 / 未开始 / 收藏) with count
- FilterChip badges for advanced (tag/brand/decade) with × clear
- Right side: SearchBar (mono ⌘K hint) + DensityToggle + SortSelect

**Other touches**:
- Scan progress bar: 2px gradient line `accent → accent-deep` + mono summary
- Titlebar: 32px tall · ink-stamp 「書」 seal · serif app title · mono `portable` hint
- Empty states use serif h2 + mono sub line + minimal action button

## Files Touched

| Action | Path | Notes |
|--------|------|-------|
| Replace | `src/components/library/GameCard.tsx` | 5-stamp system; hover lift; gradient overlay; 30px circular play; brand favorite heart |
| Replace | `src/components/library/GameGrid.tsx` | Hero band + section rule + density-driven stacks; drops react-virtual virtualization (v1.0 typical libs ≤300 games) |
| New | `src/components/library/HeroCard.tsx` | Magazine hero with cover-bg + glass label |
| Replace | `src/components/layout/Sidebar.tsx` | Mono section labels, status dots, full-row active state, var(--sidebar-w) width |
| Replace | `src/components/library/ActiveSessionBar.tsx` | now-playing strip with pulse dot + serif title + mono timer + 3px left accent |
| Replace | `src/components/library/ScanProgressBar.tsx` | 2px gradient bar; mono status copy |
| Replace | `src/components/library/SearchBar.tsx` | bg-2 surface, mono ⌘K hint, focus-border accent |
| Replace | `src/components/library/SortSelect.tsx` | Native select with custom caret SVG, design's `.sort-sel` style |
| Replace | `src/components/library/FilterChip.tsx` | Brand-soft pill + line-strong border (favorite slice removed — StatusFilterChips owns it) |
| New | `src/components/library/PageHeader.tsx` | Reusable header pattern: crumb + serif h1 + sub + actions |
| New | `src/components/library/StatusFilterChips.tsx` | 5 quick-filter chips with counts (全部/playing/cleared/unplayed/favorite) |
| New | `src/components/library/DensityToggle.tsx` | Inline 3-segment density toggle (uses preferences store) |
| Replace | `src/routes/Library.tsx` | New layout: PageHeader + ActiveSessionBar + Toolbar row + GameGrid; 重新扫描/添加根目录 actions wired to listScanRoots + startScan |
| Replace | `src/components/layout/Titlebar.tsx` | seal mark + serif title + mono `portable` hint |

## Verification

- `pnpm typecheck` — clean
- `pnpm build` — clean (50 KB CSS, 1145 KB JS, gzip 339 KB; no warnings)
- All density × accent × theme combinations reactive: changing density via Tweaks instantly reflows the grid; theme switch repaints stamps/cards; accent change repaints brand-soft fills + stamps + active-session pulse

## Decisions Made

- **Drop virtualization** — react-virtual was overkill for typical 50-300 game libraries; CSS Grid `auto-fill` handles it natively and respects `--card-w` density token directly. Re-add if a user reports >1000 games and scroll stutter.
- **Hero band collapse** — when 0 recent games (e.g. fresh library, never launched anything), skip hero band entirely and render stacks-only grid.
- **Settings/Stats moved into Sidebar's "工具" section** — design treats them as siblings to status filters; v1.0 had them as bottom-dock buttons. Cleaner under the unified scroll area.
- **Status FilterChips owns 收藏** — FilterChip badge for `favorite` removed to avoid duplicate UI; chip row is the only place to toggle it from filter axis.
- **Skip ScrollArea wrapper for grid** — design uses native overflow-auto; shadcn ScrollArea adds Radix viewport which conflicts with sticky scan-progress bar inside. Native scroll works fine for grid+chrome.
- **Game.le_profile not on Game type** — referenced in ActiveSessionBar; backed off and removed (le_profile lives on a separate launch-config struct fetched on-demand by Detail).
