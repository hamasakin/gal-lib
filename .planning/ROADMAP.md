# Roadmap: gal-lib

## Milestones

- ✅ **v1.0 MVP** — Phases 1-5 (shipped 2026-05-08) — see [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 UI Redesign** — Phases 6-10 (shipped 2026-05-09) — see [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Metadata Enrichment & Filtering** — Phase 11 (shipped 2026-05-09) — see [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)

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

<details>
<summary>✅ v1.2 Metadata Enrichment (Phase 11) — SHIPPED 2026-05-09 — 16/18 reqs (3 UI deferred to real-app smoke)</summary>

- [x] Phase 11: Metadata Enrichment & Multi-dim Filtering (7/7 plans, 11a-g) — completed 2026-05-09

</details>

### 📋 v1.3 (Planned)

Carry-over from v1.1 + v1.2 — run `/gsd-new-milestone` to formalise scope:

- LIB-02 magazine asymmetric grid (revisit or drop spec) — v1.1 carry
- PGE-01 / PGE-02 standalone `/scan` route + Bangumi/VNDB review queue (needs IPC payload + schema) — v1.1 carry
- Detail `?tab=` deeplink parsing — v1.1 carry
- Open-directory / open-screenshots-dir actions (needs `tauri-plugin-opener` / `open_path` IPC) — v1.1 carry
- UIPreferences stale-copy cleanup — v1.1 carry
- Cross-source person dedup (Bangumi+VNDB → 1 row) — v1.2 carry
- Persons aggregate page enrichment (作品时光轴 / 同台伙伴推荐) — v1.2 seed
- Person portrait local caching — v1.2 carry
- Backfill progress UI (full PageHeader bar) — v1.2 carry

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
| 11. Metadata Enrichment & Multi-dim Filtering | v1.2 | 7/7 | Complete (UI-01/02/03 human-eye deferred) | 2026-05-09 |
