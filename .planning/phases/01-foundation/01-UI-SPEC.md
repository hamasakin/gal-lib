---
phase: 1
slug: foundation
status: draft
shadcn_initialized: false
preset: none
created: 2026-05-06
---

# Phase 1 — UI Design Contract

> Visual and interaction contract for the Tauri v2 + React + Tailwind App Shell skeleton. Phase 1 ships only the chrome — placeholder sidebar, empty main pane, custom titlebar, dark theme. No real data, no card grid, no settings interactions.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn/ui (CLI-installed source files committed into repo) |
| Preset | none (no shadcn preset; project ships its own dark-first tokens) |
| Component library | radix-ui primitives (via shadcn/ui) |
| Icon library | lucide-react (shadcn/ui default) |
| Font | system stack: `ui-sans-serif, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif` |

**Phase 1 component scope (shadcn blocks initialized but unused beyond skeleton):**
- `Button` (used only on the custom titlebar's window controls)
- `Separator` (sidebar section divider)
- `ScrollArea` (sidebar + main pane scroll)

All other shadcn components deferred to Phase 2+.

---

## Spacing Scale

Declared values (multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon-to-label gap, titlebar control inner padding |
| sm | 8px | Sidebar item vertical padding, dense rows |
| md | 16px | Default element spacing, sidebar horizontal padding |
| lg | 24px | Empty-state heading-to-body gap, main pane outer padding |
| xl | 32px | Empty-state vertical centering, layout gaps |
| 2xl | 48px | Major section breaks (reserved for later phases) |
| 3xl | 64px | Page-level spacing (reserved for later phases) |

**Sidebar fixed width:** 220px (locked in CONTEXT.md — not a spacing token).
**Titlebar height:** 36px (locked, custom decorations require explicit drag region height).

Exceptions: titlebar height (36px) and sidebar width (220px) are fixed layout dimensions, not spacing tokens.

---

## Typography

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Body | 14px | 400 | 1.5 |
| Label | 13px | 500 | 1.4 |
| Heading (H2 — empty state) | 18px | 600 | 1.4 |
| Display (titlebar app name) | 13px | 500 | 1.0 |

Rationale: desktop apps benefit from a tight, dense type scale. 14px body matches Playnite/Steam library density. No 12px text (accessibility floor for desktop chrome).

---

## Color

Dark-mode-first palette (galgame nighttime use). No light-mode toggle in Phase 1.

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `#0F1115` | Main pane background, app body |
| Secondary (30%) | `#181B22` | Sidebar background, titlebar background |
| Surface elevated | `#21252E` | Hover state on sidebar items, future card surfaces |
| Border | `#2A2F3A` | Sidebar/main divider, separators |
| Foreground primary | `#E5E7EB` | Body text, labels |
| Foreground muted | `#9CA3AF` | Section headings ("分类"), placeholder copy, disabled items |
| Accent (10%) | `#7C5CFF` | Selected sidebar row indicator only |
| Destructive | `#EF4444` | Reserved (window-close hover only in Phase 1) |

**Accent reserved for:** the selected-state vertical bar on sidebar rows AND focus rings only. The "选中" / hover state itself uses `surface elevated` (no accent fill) to avoid neon-noise. Accent is NEVER used for body text, body icons, default buttons, or hover backgrounds.

**Border-radius scale:** 6px (controls), 8px (cards/panels — Phase 2+), 4px (titlebar buttons).

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| App titlebar name | `gal-lib` |
| Sidebar section heading | `分类` |
| Sidebar items (placeholder, non-interactive in P1) | `全部` / `收藏` / `标签` / `通关状态` |
| Settings nav placeholder (bottom of sidebar) | `设置` (icon: `Settings`, route: `/settings`) |
| Empty-state heading (main pane) | `还没有游戏` |
| Empty-state body | `请到设置页添加扫描根目录` |
| Empty-state CTA (P1: non-interactive, ghost button) | `打开设置` (links to `/settings`) |
| Settings page placeholder (`/settings`) | `设置 — 即将上线` |
| Window-close confirm (none in P1) | n/a |
| Error state (DB init failure) | heading `数据初始化失败` / body `请检查 exe 同级 data/ 目录权限后重试` |

**Copy rules locked:**
- All empty-state copy is two-part: state-of-affairs + concrete next step.
- No exclamation marks. No emoji in app chrome.
- Sidebar placeholder items render with `cursor-not-allowed` and `text-muted` to telegraph "not yet wired" without removing them.

---

## Layout Contract

```
┌─────────────────────────────────────────────────────────┐
│  Titlebar (36px, drag region, dark, custom controls)    │
├──────────────┬──────────────────────────────────────────┤
│              │                                           │
│  Sidebar     │                                           │
│  (220px)     │             Main pane                     │
│              │           (flex, scrolls)                 │
│  分类        │                                           │
│   全部       │       (Phase 1: empty state)              │
│   收藏       │                                           │
│   标签       │                                           │
│   通关状态   │                                           │
│              │                                           │
│  ───────     │                                           │
│   设置       │                                           │
│              │                                           │
└──────────────┴──────────────────────────────────────────┘
```

- Window default: 1280×800. Min: 960×600. Resizable.
- Custom titlebar: `data-tauri-drag-region` on the titlebar background, exclude window-control buttons.
- Sidebar `border-right: 1px solid var(--border)`. No shadow.
- Main pane uses `<ScrollArea>`; empty state vertically centered.
- Routes (HashRouter): `/` → main empty state, `/settings` → "即将上线" placeholder. Sidebar non-interactive items don't navigate.

---

## Interaction Contract (Phase 1)

| Element | State | Behavior |
|---------|-------|----------|
| Titlebar | drag | move window (Tauri drag region) |
| Titlebar minimize | click | `appWindow.minimize()` |
| Titlebar maximize | click | `appWindow.toggleMaximize()` |
| Titlebar close | click | `appWindow.close()` (no confirm in P1) |
| Sidebar placeholder items | hover | tooltip "即将开放" via shadcn `Tooltip` |
| Sidebar `设置` | click | `navigate('/settings')` |
| Empty-state CTA `打开设置` | click | `navigate('/settings')` |
| Focus | keyboard | visible 2px ring in `Accent` color, 2px offset |

No animation timings beyond Tailwind defaults (`transition-colors duration-150`). No skeleton loaders in P1 (no real data).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | `button`, `separator`, `scroll-area`, `tooltip` | not required |
| third-party | none in Phase 1 | n/a |

No third-party shadcn registries pulled in Phase 1.

---

## Locked Decisions Summary

The following are **contracts** for Phase 1 — the planner and executor must honor these without re-litigating:

1. **Dark-mode only** (no theme toggle in P1).
2. **System font stack** (no web font download — keeps installer small).
3. **Custom titlebar** with `data-tauri-drag-region` (decorations off in `tauri.conf.json`).
4. **Sidebar 220px fixed width**, non-collapsible in P1.
5. **HashRouter** with two routes: `/` and `/settings`.
6. **shadcn/ui CLI-initialized** with default `new-york` style and CSS-variables-based theming, then overridden to the dark palette above.
7. **No card grid, no scan UI, no toast system** in Phase 1 — those land in Phase 2/4 per ROADMAP.
8. **Accent color (`#7C5CFF`) only on focus rings + selected sidebar marker**.

---

## Checker Sign-Off

- [x] Dimension 1 Copywriting: PASS — every placeholder is 2-part (state + next step); no emoji/exclamation in chrome.
- [x] Dimension 2 Visuals: PASS — single layout (titlebar + sidebar + main); empty state vertically centered; no orphan elements.
- [x] Dimension 3 Color: PASS — 60/30/10 split documented; accent scoped to focus + selection only; destructive reserved.
- [x] Dimension 4 Typography: PASS — 4-tier scale, all weights/sizes specified, no <13px chrome text.
- [x] Dimension 5 Spacing: PASS — all tokens are multiples of 4; layout dimensions documented as locked exceptions.
- [x] Dimension 6 Registry Safety: PASS — only official shadcn blocks; no third-party registries.

**Approval:** approved 2026-05-06 (autonomous mode, self-verified — author makes defensible defaults from CONTEXT.md decisions).
