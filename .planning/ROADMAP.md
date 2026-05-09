# Roadmap: gal-lib

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-05-08) — see [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 UI Redesign** — Phases 6-10 (shipped 2026-05-09) — see [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-5) — SHIPPED 2026-05-08</summary>

- [x] Phase 1: Foundation (6/6 plans) — completed 2026-05-06
- [x] Phase 2: Library Ingest (6/6 plans) — completed 2026-05-07
- [x] Phase 3: Launch & Playtime (6/6 plans) — completed 2026-05-07
- [x] Phase 4: Library Polish (6/6 plans) — completed 2026-05-08
- [x] Phase 5: Stats / Screenshots / Saves (5/5 plans) — completed 2026-05-08

</details>

<details>
<summary>✅ v1.1 UI Redesign (Phases 6-10) — SHIPPED 2026-05-09 — 27/30 reqs (1 reverted, 2 deferred)</summary>

- [x] Phase 6: Design Tokens & Tweaks (1/1 plans) — completed 2026-05-08
- [x] Phase 7: Library Page Redesign (1/1 plans) — completed 2026-05-08
- [x] Phase 8: Detail Page Redesign (1/1 plans) — completed 2026-05-08
- [x] Phase 9: Scan & Stats Pages (1/1 plans, partial — Scan deferred) — completed 2026-05-08
- [x] Phase 10: Settings & Screenshots (1/1 plans) — completed 2026-05-08

</details>

### 📋 v1.2 (Planned)

Carry-over tech debt + deferred items from v1.1 audit (run `/gsd-new-milestone` to formalise scope):

- LIB-02 magazine asymmetric grid (revisit or drop spec)
- PGE-01 / PGE-02 standalone `/scan` route + Bangumi/VNDB review queue (needs IPC payload + schema work)
- Detail `?tab=` deeplink parsing
- Open-directory / open-screenshots-dir actions (needs `tauri-plugin-opener` / `open_path` IPC)
- UIPreferences stale-copy cleanup

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | 6/6 | Complete | 2026-05-06 |
| 2. Library Ingest | v1.0 | 6/6 | Complete | 2026-05-07 |
| 3. Launch & Playtime | v1.0 | 6/6 | Complete | 2026-05-07 |
| 4. Library Polish | v1.0 | 6/6 | Complete | 2026-05-08 |
| 5. Stats / Screenshots / Saves | v1.0 | 5/5 | Complete | 2026-05-08 |
| 6. Design Tokens & Tweaks | v1.1 | 1/1 | Complete | 2026-05-08 |
| 7. Library Page Redesign | v1.1 | 1/1 | Complete (LIB-02 reverted) | 2026-05-08 |
| 8. Detail Page Redesign | v1.1 | 1/1 | Complete | 2026-05-08 |
| 9. Scan & Stats Pages | v1.1 | 1/1 | Complete (Scan deferred) | 2026-05-08 |
| 10. Settings & Screenshots | v1.1 | 1/1 | Complete | 2026-05-08 |
