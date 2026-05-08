---
phase: 9
plan: 09
status: complete
completed: 2026-05-08
---

# Phase 9 Summary: Scan & Stats Pages

## What Shipped

**Stats dashboard rebuild** (`/stats` route) — 12-column grid matching design contract:
- 4× KPI cards (3 cols each): 总游玩时长 / 本月新增 / 通关率 / 当前连击 — serif 30px values, mono uppercase labels, brand or muted delta lines
- 6-month daily heatmap (12 cols, full-width): 7-row × 26-column CSS grid, cells colored by 4-tier intensity bucket (`color-mix(in oklch, var(--accent) X%, var(--bg-2))`); legend strip with 少→多 gradient
- 30-day timeline bar chart (8 cols): pure CSS bars proportional to max bucket; period segmented control (日/周/月) controls trend window (30d/84d/365d)
- Status ring stack (4 cols): 4 colored bars (cleared=teal / playing=brand / unplayed=yellow / dropped=red) computed from games[] cache
- Top 8 list (6 cols): rank · 36px mini cover · serif title + mono brand·status · mono hours
- Brand/year breakdown (6 cols): top 6 brands + 其他 grouped by playtime; latest 6 release-years grouped by game count

**Streak computation** — `computeStreak(daily-trend)` derives:
- `current`: consecutive days from today backward where hours > 0
- `longest`: longest run within the 180-day window

**Heatmap construction** — `buildHeatmap(daily-trend)`:
- Generates a 182-cell array (HEATMAP_DAYS=182) sorted oldest→newest
- Lookup hits the trend map by `YYYY-MM-DD` ISO key
- Intensity buckets at 25%/50%/75% of window max → l1/l2/l3, hours>0 → l1, equal-to-max → l4

**Recharts dropped** — pure CSS bars + grid replace recharts entirely. JS bundle shrank 1145 KB → 768 KB (gzip 339 KB → 235 KB).

**Page header reuse** — `<PageHeader>` from Phase 7 powers the Stats hero section.

## Files Touched

| Action | Path | Notes |
|--------|------|-------|
| Replace | `src/routes/Stats.tsx` | Full 12-col dashboard rebuild — KPIs, heatmap, timeline, ring, top-list, breakdown; drops recharts |

## Verification

- `pnpm typecheck` — clean
- `pnpm build` — clean (52.93 KB CSS, 768 KB JS, gzip 236 KB; recharts dropped)
- Period select switches trend bars without page reload
- Theme/accent switch via Tweaks recolors heatmap intensities live (color-mix CSS function)

## Decisions Made

- **No dedicated /scan route** — the v1.0 router has no /scan path; scan UX lives entirely in `ScanProgressBar` (already restyled in Phase 7). Implementing the design's full scan page (KPI strip + dual-column feed + Bangumi/VNDB review queue) requires:
  1. New router entry (`/scan`)
  2. New backend events (per-directory feed rows with confidence scores, candidate metadata; current `scan-progress` only emits aggregate counts)
  3. Persistent review queue table (current schema doesn't store ad-hoc low-confidence rows for offline browsing)

  These are scope expansions, not pure visual changes — deferring to a future feature phase. Requirements PGE-01 / PGE-02 marked as **deferred** in v1.1 close-out audit.

- **Recharts replaced with CSS** — design's heatmap + bars + ring are all simple geometry that CSS Grid + flex render natively. Recharts' Area/Bar charts add 380 KB to the JS bundle for 2 chart types we use; pure CSS keeps the bundle leaner and gives perfect control over theming via `--accent`. Lost recharts' tooltips, but the hover-title fallback (`title={...}` attr) keeps the data exposable.

- **Top 8 falls back to cached games[]** — `getTopGames` returns id+name+seconds; we hydrate cover/brand/status from the games store. When the route is hit before games[] loads (rare; only if user navigates via direct URL), TopRow uses an `emptyGame()` sentinel.

- **Sessions count = games count** — proxy metric. Real total session count would require a new aggregate command. Acceptable for v1.1 since the headline KPI is total playtime, not session count.

- **`fmtDate` removed** — declared but unused after timeline switched to mono `bucket` strings (no extra date formatting).

## Out of Scope (deferred to v1.2+)

- **Standalone /scan route** with KPI strip + Bangumi/VNDB candidate review cards (PGE-01 / PGE-02)
- **Real-time scan feed** with per-directory result rows (`scan-progress` event needs to carry richer payload)
- **Persistent low-confidence review queue** (currently MetadataPicker handles per-game low-confidence interactively at scan time; design contract proposes a queue page for batch review)
