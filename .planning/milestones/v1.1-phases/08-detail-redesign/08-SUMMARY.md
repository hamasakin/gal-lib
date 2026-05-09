---
phase: 8
plan: 08
status: complete
completed: 2026-05-08
---

# Phase 8 Summary: Detail Page Redesign

## What Shipped

**Immersive hero (380px)**:
- Full-bleed blurred cover bg (`filter: blur(36px) saturate(1.1) brightness(.5)` + `transform: scale(1.15)`)
- Linear-gradient veil (top 20% transparent → bg-0)
- 220×293 cover-big in 3-column grid (220px / 1fr / auto), with `marginBottom: -60px` so it overflows the hero edge and overlaps the body section
- Info column: ← 图书馆 mono breadcrumb + brand · year + 38px serif H1 + alt name + meta pills row
- Actions column: 36px favorite heart + 36px more dots + signature LaunchButton
- Pills row supports status (with brand dot), playtime, rating, BGM id, exe basename, and 「待复核」when match_confidence < 80

**Signature LaunchButton (`src/components/library/LaunchButton.tsx`)**:
- 44px circle, hover/focus expands to 240px showing 「启动 + LE Profile」 label
- Brand drop-shadow + brand-soft expanded ring on hover
- Opens 260px popover above with 4 LE profile rows (Japanese / Simplified Chinese / Traditional Chinese / Custom)
- Active state (game running): solid red square stop button, no popover
- Disabled state when other game active or no exe

**Body section (1fr + 320px)**:
- Top padding 84px to clear cover-big overflow
- Left column: serif tabs (总览 / 笔记 / 会话历史 / 截图 / 存档 / 启动配置) with brand-color underline indicator
- Right meta sidebar: 条目信息 kv-list + 标签 list + 路径 (mono code + copy + cover-source actions)

**Tabs visual**:
- shadcn `variant="line"` reused for accessibility
- Custom `.detail-tabs` class in index.css recolors after-pseudo to `var(--accent)` instead of `var(--foreground)` (brand consistency)
- Triggers use serif font 12.5px tracking-wide; ink-2 → ink-0 on active

**Sessions panel** (会话历史 tab):
- Replaces shadcn list+badge layout with design's session-row pattern
- Each row: mono date · serif status · 4px accent progress bar (proportional to max session in window) · mono duration

**Logic preserved**: All v1.0 functional features intact:
- refreshGame() on mount + after every mutation
- Notes 800ms debounced autosave + "已保存 N 秒前" 1Hz tick
- Sessions auto-refetch when active session ENDS for this game
- Per-game screenshot interval (Phase 5 / 05e)
- Launch config save flow + StarRating
- TagPicker still embedded for editing tags (now in right sidebar)

## Files Touched

| Action | Path | Notes |
|--------|------|-------|
| New | `src/components/library/LaunchButton.tsx` | 44px circle → 240px hover; LE profile popover; active/disabled states |
| Replace | `src/routes/Detail.tsx` | Full hero+body redesign: blurred bg, cover overflow, pills row, brand-accent tabs, 320px right meta sidebar |
| Edit | `src/index.css` | `.detail-tabs [data-slot=tabs-trigger]::after { background: var(--accent) }` to recolor underline indicator |

## Verification

- `pnpm typecheck` — clean
- `pnpm build` — clean (52.39 KB CSS, 1155 KB JS, gzip 342 KB; no warnings)
- LaunchButton: 4 profiles list above the button on hover; click selects + closes; active session collapses to red stop variant
- Hero blurred bg responds to theme switch (papyrus mode rebuilds with light tones automatically)
- Tab indicator switches color when accent changes from violet → teal/sakura/matcha

## Decisions Made

- **Tags moved to right sidebar** — design's spec; reduces tab count from 7→6, keeps standalone TagPicker editor
- **Removed 用日区启动器 secondary button** — LaunchButton's profile popover already lets user pick non-Japanese profile; design has only one launch button
- **Removed 状态 pill duplicate** — appeared twice in v1.0 (once as Badge, once as Select); kept Select inside 总览 → 常用操作 section, and one read-only pill in hero pills row
- **Open-directory action dropped** — no `open_directory` Tauri command exists; deferred to a future Phase as a Rust-side `tauri-plugin-opener` integration
- **Sessions list capped at 12** — design's "近 8 次" hint was tighter; 12 keeps the last week of typical play within view without scrolling
- **Tabs: 简介 → 总览** — design contract rename; consolidates summary + 常用操作 in one tab
- **Tabs: 设置 → 启动配置** — clearer Chinese label (was scoped to launch tooling, not general settings)
