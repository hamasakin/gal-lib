# Hakoniwa · 箱庭 (gal-lib)

> **Turn the messy folders of galgame on your disk into a searchable, launchable, trackable library.**

A galgame collection & launcher manager for Windows.

[**Download latest →**](https://github.com/hamasakin/gal-lib/releases/latest) ・ [简体中文](./README.md) ・ [日本語](./README.ja.md)

---

## What is this

**Hakoniwa** (箱庭, "miniature garden") is a galgame collection & launcher manager for Windows. It scans your local game directories, automatically fetches covers / synopses / staff / tags from **Bangumi and VNDB**, launches games in Japanese locale through **Locale Emulator** with one click, and tracks playtime by watching the game process.

The whole app ships as a single ~10MB executable, with all user data living in a `data/` folder next to the exe — **drop it on a USB stick, hand it to a friend, leave no trace on the host system**.

## Why it exists

Chinese-speaking galgame players usually hit three pain points:

1. **Dozens to hundreds of games scattered across multiple root folders — impossible to find or remember.**
2. **Japanese galgames need a locale-switching tool to launch** — Locale Emulator works, but configuring every single game gets tedious fast.
3. **After finishing a game you want to know how long you played, what you played recently, or every game a specific illustrator worked on** — local folders give you none of that.

Existing tools like LaunchBox / Playnite / Heroic target commercial PC games and don't cover galgame essentials: the Bangumi metadata source, mandatory locale switching, and person-level aggregation. Hakoniwa commits fully to the **library** metaphor: collection stamps, card grid, person pages, timelines — it should look like a library, not a wall of wallpapers.

## Features

### 📚 Collection & Scanning
- **Multi-root scanning**, configurable depth per root
- Heuristic exe scoring auto-detects executables; low-confidence matches go to a **`/scan` review queue** with side-by-side Bangumi/VNDB candidate comparison
- Incremental / full scan with live progress
- Custom tags, favorites, 1-10 ratings, completion status, notes (800ms autosave)

### 🌐 Automatic Metadata
- **Bangumi-first + VNDB-fallback** dual sourcing (token-bucket rate-limited)
- Auto-fetched: cover, synopsis, brand, release year, official tags, **production staff** (scenario / artist / voice / music)
- Manual Bangumi/VNDB ID binding for low-confidence matches
- **Cross-source person deduplication**: when the same writer appears in both Bangumi and VNDB, the rows are merged in the UI

### 🎮 One-Click Locale Launch
- Built-in **Locale Emulator** path autodetection
- Per-game LE profile / working directory configuration
- Automatic screenshot capture (per-game scope + adjustable interval)
- Save-folder one-click backup / restore

### ⏱ Playtime Tracking
- Process-alive timing — single session + cumulative total
- System-tray background tracking — keeps counting after you close the main window
- Stats dashboard: KPIs, 6-month heatmap, 30-day bar chart, per-game ringstack, Top 8, brand / year distribution

### 👤 Person Aggregation (v1.2+)
- `/persons/:id` page: 4 role-grouped grids of every game this person worked on
- **Timeline**: horizontal year bubbles, bubble height mapped to playtime
- **"Frequent collaborators"** strip: auto-recommends people who often appear together
- Local portrait cache (`data/portraits/`) — works offline

### 🎨 5-Axis Design Tokens
Switch via `<html data-*>` in real time — **pure CSS variables, no JS re-render**:
- 3 themes (light / dark / system) × 4 accent colors × 2 radii × 3 sidebar widths × 3 cover densities
- Floating Tweaks panel for live tuning
- Persisted to localStorage

### 📦 Engineering
- **Portable**: all data lives in `data/`, easy to USB-carry or share with friends
- **Single exe**: ~10MB Tauri bundle (NSIS installer), target < 30MB
- **Auto-update**: GitHub Releases + minisign signing (`tauri-plugin-updater`)

## Tech Stack

| Layer | Tech |
|---|---|
| Shell | Tauri 2 (Rust) |
| Frontend | React 19 + TypeScript + Vite + Tailwind v3 + shadcn/ui + Zustand |
| DB | SQLite via `tauri-plugin-sql` + `sqlx` (schema v12) |
| HTTP | reqwest + governor (token-bucket rate limiting) |
| Process tracking | sysinfo + Windows API (OpenProcess / WaitForSingleObject) |
| Platform | Windows 10/11 only |

## Install

Download the `.exe` (NSIS) installer from [Releases](https://github.com/hamasakin/gal-lib/releases/latest) and run it; first launch creates a `data/` folder next to the exe.
Requires [Locale Emulator](https://github.com/xupefei/Locale-Emulator) to be installed (Hakoniwa auto-detects its path).

## Development

```bash
# prerequisites: Node.js 20+, pnpm, Rust toolchain (stable), Windows 10/11
pnpm install

# dev (vite + tauri dev)
pnpm tauri dev

# typecheck
pnpm typecheck

# production build → NSIS installer in src-tauri/target/release/bundle/
pnpm tauri build

# release (bumps version, commits, tags, pushes — triggers GitHub Actions release.yml)
pnpm release
```

Cargo tests: `cd src-tauri && cargo test`.

### Project Layout

```
src/                 React 19 + TS frontend (routes/, components/, store/, hooks/)
src-tauri/src/       Rust backend
  ├── scan/          multi-root walker, exe scoring, removed-marker
  ├── metadata/      bangumi.rs, vndb.rs, rate limiter, match scoring
  ├── launch/        LE detection, orchestrator, process tracking, session timing
  ├── ingest.rs      writes scan results + staff + tags into SQLite
  ├── tray.rs        system tray with background timing
  └── commands.rs    Tauri IPC surface
src-tauri/migrations/  SQLite schema v1 → v12
```
