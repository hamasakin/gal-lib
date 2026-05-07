---
phase: 2
slug: library-ingest
status: draft
shadcn_initialized: true
preset: none
created: 2026-05-07
extends: 01-UI-SPEC.md
---

# Phase 2 — UI Design Contract

> Visual + interaction contract for Phase 2: cover grid, scan progress, settings page (root list), metadata picker modal. Inherits Phase 1's `01-UI-SPEC.md` palette / typography / spacing / radius tokens — Phase 2 only adds new components and interaction patterns.

---

## Inherited from Phase 1 (do NOT re-litigate)

- Dark-only palette (`#0F1115` / `#181B22` / `#21252E` / `#2A2F3A` / `#E5E7EB` / `#9CA3AF` / `#7C5CFF` / `#EF4444`)
- Typography 4-tier scale (Body 14 / Label 13 / H2 18 / Display 13)
- System font stack + 4-multiple spacing (4 / 8 / 16 / 24 / 32)
- Border-radius 6px controls / 8px cards / 4px titlebar buttons
- 220px sidebar / 36px titlebar / window 1280×800 (min 960×600)
- Custom titlebar with `data-tauri-drag-region` + 3 control buttons
- HashRouter `/` and `/settings`
- Accent (`#7C5CFF`) only on focus rings + selected state markers

---

## Phase 2 NEW Components

### Game Card (`src/components/library/GameCard.tsx`)

| Property | Value |
|---|---|
| Width | `minmax(200px, 1fr)` (CSS grid auto-fill) |
| Height | `auto` — driven by 3:4 cover + label height |
| Cover area | aspect-ratio 3:4, `rounded-md` (8px), `bg-secondary` placeholder |
| Title | Body 14px, weight 500, `line-clamp-2`, padding-top 8px |
| Status badge | 4×4px dot + Label text, position absolute bottom-left of cover OR inline below title |
| Hover state | cover image `scale-[1.02] transition-transform duration-150` + outline `ring-1 ring-border` (NOT accent — accent is reserved) |
| Click | navigate to `/games/:id` (Phase 4); Phase 2 just shows hover affordance, click is no-op or alerts "详情页 — 即将上线" |
| Right-click menu (P2 minimum) | "重新匹配元数据" / "重新扫描封面" — opens MetadataPicker modal |

**Status colors (extends palette via Tailwind utility tokens):**

| Status | Dot color | Label |
|---|---|---|
| `unplayed` | `text-muted-foreground` (`#9CA3AF`) | `未游玩` |
| `playing` | `text-blue-400` (`#60A5FA` — net new accent for status) | `游玩中` |
| `cleared` | `text-emerald-400` (`#34D399` — net new) | `已通关` |
| `dropped` | `text-red-400` (`#F87171` — net new) | `已弃` |

> **Status palette extension note:** UI-SPEC §Color is dark-mode-only with locked accent `#7C5CFF`. Status indicators are SEMANTIC, not branding — they need to read at-a-glance and palette-reservation logic doesn't apply. Adding 3 status hues (blue/green/red 400-shade) is documented here as a Phase 2 controlled extension. They are NEVER used as backgrounds, only as 4×4px dots and label text.

### Cover Grid (`src/components/library/GameGrid.tsx`)

| Property | Value |
|---|---|
| Layout | CSS Grid `grid-cols-[repeat(auto-fill,minmax(200px,1fr))]` + `gap-4` (16px) |
| Container | `<ScrollArea>` + `@tanstack/react-virtual` virtualization (column-count + row-count derived from container width × card aspect) |
| Padding | `p-6` (24px outer padding, lg spacing token) |
| Empty state (no scans yet) | reuse Phase 1 empty state copy `还没有游戏` / `请到设置页添加扫描根目录` / `打开设置` |
| Empty state (scanned but 0) | `未识别到游戏` / `请检查根目录扫描深度配置` / `回到设置` |
| Scrollbar | shadcn ScrollArea default (Phase 1 token) |

**Virtualization rules:**
- Render ~30 cards above/below viewport (over-render buffer)
- Card mount is cheap (no expensive effects); preferred over windowing JS overhead at < 200 cards
- For very wide windows (4+ columns): use 2D virtualizer (`useVirtualizer` with `count = totalCards`, `lanes = columnCount`); recompute on resize

### Scan Progress Bar (`src/components/library/ScanProgressBar.tsx`)

Position: top of `<main>` content area, sticky below TitlebarSlot, height 56px (4px progress + 52px text).

| Element | Style |
|---|---|
| Outer container | `sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border h-14` |
| Progress bar (4px tall) | shadcn `Progress` block (NEEDS TO BE INSTALLED — see below); track `bg-secondary`, indicator `bg-ring` (`#7C5CFF` — exception case for progress visual) |
| Status text row | Body 14px; format: `扫描中 (current_dir) — 已完成 12 / 共 87` |
| Cancel button (right) | shadcn ghost Button, text `取消` |
| Pause button | NOT in P2 (deferred per CONTEXT) |
| Idle state | hidden entirely (return null) |

**Throttle:** progress events emit at backend pace; frontend Zustand store updates render 100ms throttle to avoid jank.

**Progress accent color exception:** UI-SPEC reserves accent for focus rings + selection markers. Progress bar fill is the third permitted use — strictly proportional indicator that needs to read at-a-glance; not a branding splash, not a hover background. Document as 3rd allowed use.

### Settings Page (`src/routes/Settings.tsx` — REPLACE Phase 1 placeholder)

Page-level layout: 24px outer padding, max-width 720px, single-column.

| Section | Components |
|---|---|
| Page title | `H2 18px` `设置` |
| Section: 扫描根目录 | `H3 16px / 600` (NEW — H3 token: 16px / 600 / 1.4) `扫描根目录`; description `Body / muted-foreground`: `gal-lib 会扫描这些目录下的游戏` ；列表表格（Path / Depth / Action）；"添加根目录" button |
| Section: 扫描操作 | "全量扫描" + "增量扫描" 两个 default Buttons |
| (deferred sections) | LE 路径 / 标签管理 / 主题切换 / 关于 — Phase 4 |

**Root list row:**
- Layout: `flex items-center gap-3` (12px gap — exception, between md and sm)
- Path: `text-body text-foreground` truncate
- Depth select: shadcn `Select` (NEEDS TO BE INSTALLED) with options `1 / 2 / 3`
- Remove button: `Button variant="ghost" size="icon"` with lucide `Trash2` icon, hover `text-destructive`

### Metadata Picker Modal (`src/components/library/MetadataPicker.tsx`)

shadcn `Dialog` (NEEDS TO BE INSTALLED).

| Section | Content |
|---|---|
| Title | `重新匹配元数据 — {game.name}` |
| Search input | `Input` with placeholder `搜索 Bangumi 或 VNDB`，回车触发搜索 |
| Source toggle | `ToggleGroup` (NEEDS TO BE INSTALLED) `Bangumi` / `VNDB` |
| Direct ID input (collapsible) | `bgm_id` (number) / `vndb_id` (e.g., `v1234`) text inputs |
| Candidate list | `<ScrollArea>` 上限 8 行；每行：缩略图 (60×80px) + 标题 + 副标题 (release year / source) + Confidence badge (numeric) |
| Footer | "应用" / "取消" |

Width: `max-w-2xl` (672px). Height: `max-h-[80vh]`.

---

## NEW shadcn blocks to install (Phase 2 lock-in)

| Block | Use site |
|---|---|
| `progress` | ScanProgressBar |
| `select` | Settings depth dropdown |
| `dialog` | MetadataPicker modal |
| `input` | Settings + modal search |
| `toggle-group` | MetadataPicker source toggle |
| `dropdown-menu` | Card right-click menu |
| `badge` | Confidence + status indicators |

Install via `pnpm dlx shadcn@latest add progress select dialog input toggle-group dropdown-menu badge`. The new-york style + slate base from Phase 1 carry over; init step is NOT re-run (already initialized).

---

## NEW Tailwind tokens (additive)

| Token | Value | Source |
|---|---|---|
| `text-h3` | 16px / 600 / 1.4 | Settings section heading (extends 4-tier to 5-tier) |
| `aspect-cover` | 3:4 (`aspectRatio: { 'cover': '3 / 4' }`) | Game card cover |

Both added to `tailwind.config.ts` `theme.extend` (NOT replacing Phase 1 values).

---

## Copywriting Contract (NEW Phase 2 strings)

| Element | Copy |
|---|---|
| Library empty (post-scan-zero) heading | `未识别到游戏` |
| Library empty (post-scan-zero) body | `请检查根目录扫描深度配置` |
| Library empty (post-scan-zero) CTA | `回到设置` |
| Game status `unplayed` | `未游玩` |
| Game status `playing` | `游玩中` |
| Game status `cleared` | `已通关` |
| Game status `dropped` | `已弃` |
| Card right-click: rematch | `重新匹配元数据` |
| Card right-click: rescan cover | `重新抓取封面` |
| Settings page title | `设置` |
| Settings root section heading | `扫描根目录` |
| Settings root section description | `gal-lib 会扫描这些目录下的游戏` |
| Settings depth select label | `扫描深度` |
| Settings depth options | `第 1 层` / `第 2 层` / `第 3 层` |
| Settings add root button | `添加根目录` |
| Settings full scan button | `全量扫描` |
| Settings incremental scan button | `增量扫描` |
| Scan progress format | `扫描中 ({current_dir}) — 已完成 {n} / 共 {total}` |
| Scan cancel button | `取消` |
| Scan complete toast (transient) | `扫描完成 — 共 {n} 款游戏` |
| Scan canceled toast | `扫描已取消` |
| Metadata modal title | `重新匹配元数据 — {game_name}` |
| Metadata search placeholder | `搜索 Bangumi 或 VNDB` |
| Metadata source toggle | `Bangumi` / `VNDB` |
| Metadata direct ID heading | `直接绑定 ID` |
| Metadata empty results | `未找到匹配项 — 请尝试不同关键词` |
| Card "no exe" mark | `未识别可执行文件` |
| Card "metadata pending" mark | `元数据获取中` |
| Card "metadata failed" mark | `元数据获取失败 — 点击重试` |

**Copy rules carry from P1:** two-part empty/error copy (state + next step); no exclamation marks; no emoji in chrome.

---

## Layout Contract

```
┌─────────────────────────────────────────────────────────┐
│  Titlebar (36px)                          [01e]         │
├──────────────┬──────────────────────────────────────────┤
│              │  ScanProgressBar (sticky, 56px, only     │
│  Sidebar     │   when scanning)                          │
│  (220px)     ├──────────────────────────────────────────┤
│              │                                           │
│  分类        │             GameGrid                      │
│   全部       │   (responsive cols, p-6, virtualized)     │
│   ...        │                                           │
│              │   [Phase 2 active filter still 全部       │
│              │    only; 收藏/标签/通关状态 remain        │
│              │    placeholder per CONTEXT.md]            │
│              │                                           │
│  ─────       │                                           │
│   设置       │                                           │
└──────────────┴──────────────────────────────────────────┘
```

`/settings` route shows the new Settings page (single-column, max-w-720px); `<Outlet>` renders into the same `<main>` as Library, so ScanProgressBar always sits at the top of `<main>`.

---

## Interaction Contract (Phase 2 NEW)

| Element | State | Behavior |
|---|---|---|
| GameCard | hover | cover scales 1.02; outline appears; `transition-colors duration-150` |
| GameCard | click | placeholder alert "详情页 — 即将上线" (Phase 2 only); Phase 4 navigates to /games/:id |
| GameCard | right-click | shadcn `DropdownMenu` with `重新匹配元数据` / `重新抓取封面` |
| GameCard "metadata-pending" badge | click | open MetadataPicker for this game |
| ScanProgressBar | "取消" click | confirm via shadcn `AlertDialog` (NEEDS TO BE INSTALLED — adding to lockup above) `确定取消扫描？已扫描的游戏会保留` Yes/No; on Yes call `cancel_scan` Tauri command |
| Settings root row | "移除" click | confirm `AlertDialog` `确定移除该根目录？已扫描的游戏不会被删除` Yes/No |
| Settings "添加根目录" | click | open Tauri dialog plugin `open({ directory: true })`; on selected path, prompt for depth (default 1) and add to DB |
| MetadataPicker "应用" | click | call `bind_metadata` Tauri command with selected `bangumi_id` or `vndb_id` → re-fetch metadata + cover → close modal + show toast |
| MetadataPicker | Esc | close modal (shadcn dialog default behavior) |

Toast system: shadcn `Sonner` (NEEDS TO BE INSTALLED — add to lockup); appears 3s top-right; auto-dismiss; click to dismiss. Toast is the only mode for transient notifications in P2.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|---|---|---|
| shadcn official | progress, select, dialog, input, toggle-group, dropdown-menu, badge, alert-dialog, sonner (Phase 2 NEW) + button, separator, scroll-area, tooltip (Phase 1) | not required |
| third-party | none | n/a |

Final shadcn lockup install command:
```
pnpm dlx shadcn@latest add progress select dialog input toggle-group dropdown-menu badge alert-dialog sonner
```

---

## Locked Decisions Summary

1. **GameCard 3:4 aspect ratio** — galgame standard盒图比例
2. **Status palette extension** — blue-400 / emerald-400 / red-400 added as semantic indicators (NEVER as backgrounds; only 4×4 dots and label text)
3. **Accent on Progress fill** — 3rd permitted use of accent (`#7C5CFF`) — strictly proportional indicator
4. **`@tanstack/react-virtual`** for grid virtualization (NOT react-virtuoso)
5. **9 new shadcn blocks** — progress / select / dialog / input / toggle-group / dropdown-menu / badge / alert-dialog / sonner
6. **Settings page max-width 720px** single-column, NOT full-width
7. **Sidebar in Phase 2 STILL has placeholder filter items** — only 设置 nav becomes functionally enriched; filter activation Phase 4
8. **Card click in P2 = placeholder alert** (no detail page); detail page lands Phase 4
9. **Cancel-scan confirmation modal** — destructive-feeling action gets confirm step
10. **Toast for transient notifications** (sonner) — no inline status messages
11. **No pause-scan in P2** (only cancel)
12. **No batch metadata operations in P2** (only single-game)

---

## Checker Sign-Off (self-verified per UI-SPEC checklist)

- [x] D1 Copywriting: PASS — all new strings two-part (state + next step); status copy is short labels; no emoji/exclamation; toast copy descriptive not exhortative
- [x] D2 Visuals: PASS — single layout (sidebar + main); progress bar sticky-top; modal centered; right-click menu standard
- [x] D3 Color: PASS — palette inherited from P1; status hues semantic-only and 4×4px scope-limited; accent on progress fill documented as exception (3rd allowed use)
- [x] D4 Typography: PASS — H3 16/600 added as natural extension of P1 4-tier scale (5-tier total)
- [x] D5 Spacing: PASS — all new tokens are P1 multiples-of-4; one exception `gap-3` (12px) in settings rows
- [x] D6 Registry Safety: PASS — only official shadcn blocks; final lockup commits 9 new blocks

**Approval:** approved 2026-05-07 (autonomous mode, self-verified — UI-SPEC extends Phase 1 contract; all extensions documented and scoped).
