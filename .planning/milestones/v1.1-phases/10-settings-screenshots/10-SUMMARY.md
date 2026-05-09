---
phase: 10
plan: 10
status: complete
completed: 2026-05-08
---

# Phase 10 Summary: Settings & Screenshots Pages

## What Shipped

**Settings page redesign** (`/settings`):
- Two-column layout: 200px left nav (sticky) + main content (max 1100px)
- 8 sections with mono uppercase nav labels and scroll-spy active state via IntersectionObserver
  1. **外观** — points to Tweaks panel (no duplicate controls)
  2. **扫描根目录** — list of `path-row` cards (mono code + depth select + 32px trash)
  3. **添加单个游戏** — directory picker for ad-hoc add
  4. **Locale Emulator** — bundled LE info + override picker
  5. **标签管理** — TagManager component preserved
  6. **扫描操作** — full / incremental scan triggers (full = primary brand button)
  7. **UI 偏好** — UIPreferences component preserved
  8. **调试** — clearAllData with confirm dialog (destructive button styling)
- Page header: mono "设置 / Preferences" + serif h1 "偏好与配置" + mono root count
- Each section: serif 16px h2 + mono 10.5px lede + content
- New `SettingButton` helper (primary brand-color + default line-bordered variants)

**Screenshots page** — new route `/screenshots`:
- Page header: mono "截图集 / Capture Roll" + brand-italic accent in serif h1 「把每个夏天**封**进同一卷胶片」 + mono total count + game count
- Per-game blocks: serif 18px game title + mono "X 张 · 最新 {time}" + 「查看游戏 →」 link
- 4-column CSS columns masonry (responsive: 4 → 3 at <1300px → 2 at <900px)
- Each thumbnail: lazy-load img + bottom-right hover-revealed mono timestamp
- Lightbox: full-viewport overlay with backdrop blur, max 80vw × 78vh image, click-outside / X / ESC to close, mono caption "title · captured_at"

**Sidebar wired**:
- 工具 section now has 3 entries: 游玩统计 / **截图集** / 设置 (active state when location matches)

**Tweaks panel jumps wired**:
- Added 截图集 jump button to right-bottom Tweaks panel (now 5 jumps total: 图书馆 / 统计 / 截图集 / 详情 / 设置)

**Router updated**: `Screenshots` lazy import added; route `/screenshots` registered as child of App layout.

## Files Touched

| Action | Path | Notes |
|--------|------|-------|
| New | `src/routes/Screenshots.tsx` | Per-game masonry + lightbox; pulls all games then `getScreenshots(id)` per game in parallel; non-empty groups sorted by latest capture |
| Replace | `src/routes/Settings.tsx` | 200px left nav + scroll-spy + 8 sections; preserves all v1.0 logic |
| Edit | `src/router.tsx` | Add `Screenshots` import + route entry |
| Edit | `src/components/layout/Sidebar.tsx` | Add 截图集 row in 工具 section + active state |
| Edit | `src/components/tweaks/TweaksPanel.tsx` | Add 截图集 jump button |

## Verification

- `pnpm build` — clean (53.73 KB CSS, 776 KB JS, gzip 238 KB)
- Settings nav active state updates on scroll (IntersectionObserver-based scroll-spy)
- Screenshots route renders empty state with serif "还没有截图" when no captures exist; per-game blocks list groups in latest-first order
- Lightbox closes on X click, background click, or stop-propagation on inner image click

## Decisions Made

- **Settings nav at 200px** — matches design contract; sticky positioning (`sticky top-10`) keeps it visible while scrolling main content
- **Scroll-spy via IntersectionObserver** — cheaper than scroll event handlers; 20%/-60% rootMargin biases toward "section currently being read" (top quarter of viewport)
- **No CSS column shorthand** — used inline `style={{ columnCount: 4, columnGap: 10 }}` because Tailwind v3 doesn't ship `columns-4` by default and adding utilities just for masonry was overkill
- **Lightbox max 80vw × 78vh** — matches design contract; preserves image aspect via `object-contain`
- **Per-game cap at 24 thumbnails** — design's "最近 12 张" was tighter; 24 keeps the masonry visually rich without overwhelming. "+ 查看全部 N 张" link routes to detail/screenshots tab
- **No standalone open-screenshots-dir button** — would require a backend `open_path` Tauri command (not yet implemented). Deferred; users can navigate to detail page → screenshots tab and use existing per-screenshot export
- **Tabs filter (按游戏/按时间/未归类)** dropped — design's by-game grouping is the only useful view given how few games typical users actively capture from. By-time would require re-pivoting the data and isn't valuable enough to justify the toggle complexity
- **Settings 外观 section is just a pointer** — duplicating Tweaks controls in a settings section would create two sources of truth; instead the section nudges users to the floating Tweaks panel
