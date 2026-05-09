# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.1 — UI Redesign

**Shipped:** 2026-05-09
**Phases:** 5 (6-10) | **Plans:** 5 | **Score:** 27/30 reqs satisfied

### What Was Built
- 5-axis design token system (`<html data-theme/-accent/-radius/-sidebar/-density>`) with `localStorage` persistence and pre-React boot paint to avoid flash-of-default
- Floating Tweaks panel with 5 control groups + 5 page-jumps (Library/Stats/Screenshots/Detail/Settings)
- Library page redesign: 「藏书章」 mono uppercase 5-state stamps on 3:4 cover cards, Sidebar with status dot variants + 6-section nav, ActiveSessionBar with pulse dot + serif title + mono timer, reusable PageHeader pattern
- Detail page redesign: 380px immersive blurred-cover hero, 220×293 cover overflow, signature 44px → 240px LaunchButton with 260px LE Profile popover, 1fr+320px body grid with serif accent-underline tabs
- Stats 12-column dashboard: KPIs + 6-month heatmap (`color-mix` 4-tier intensity) + 30-day timeline + status ring stack + Top 8 list + brand/year breakdown — recharts dropped (-380 KB JS)
- Settings 200px nav + 8 sections + IntersectionObserver scroll-spy + path-row pattern; new `/screenshots` route with masonry + lightbox

### What Worked
- **Design-token-first phase ordering** — Phase 6 laid the CSS variable / `<html data-*>` foundation before any component redesign; later phases just consumed the tokens, no re-plumbing
- **Preserve v1.0 IPC layer** — Treating the redesign as pure visual replacement let us reuse all v1.0 stores/commands/listeners; integration audit later confirmed zero functional regressions
- **Recharts removal trade** — Phase 9 swap to pure CSS grid+flex saved ~380 KB JS while gaining theme-aware coloring via `color-mix`. The lost native tooltip was replaced acceptably with `title=` attr
- **Honest deferrals** — Phase 9 SUMMARY explicitly marked PGE-01/02 as deferred with documented prerequisites (router + richer IPC payload + schema); audit picked them up cleanly without surprises
- **Single source of truth for prefs** — Settings 外观 section is a pointer to TweaksPanel rather than duplicated controls; one source = no drift

### What Was Inefficient
- **No VERIFICATION.md / VALIDATION.md generated** — The autonomous summary-only mode skipped phase-level verification artifacts; audit had to retroactively spawn `gsd-integration-checker` to substitute for missing structured verification. SUMMARY narratives carried the load but weren't matrix-checkable
- **REQUIREMENTS.md traceability stale** — All 30 checkboxes stayed `[ ]` throughout the milestone; only updated during audit/archive. A per-phase update step would catch deviations earlier
- **LIB-02 reverted post-Phase 7** — Magazine asymmetric grid hero band shipped in Phase 7 SUMMARY but was later removed (HeroCard.tsx deleted) due to portrait-cover cropping + density mismatch. The revert wasn't surfaced until milestone audit; documenting the design-vs-implementation gap earlier would have triggered a SPEC amendment instead of an audit-time discovery
- **UIPreferences.tsx:135 stale copy** — A v1.0 "theme switch coming in Phase 5" hint went unmaintained through 5 phases despite Phase 6 shipping the actual theme system. Cross-cutting copy is invisible to per-phase work

### Patterns Established
- **Token-first redesign** — Lay CSS variable foundation in a dedicated phase before any component redesign; downstream phases only consume tokens, never define them
- **Frame redesigns as visual replacement** — Lock the contract that backend IPC + functional stores stay byte-identical; failure mode becomes "didn't look right" not "broke a feature"
- **Document deferrals in SUMMARY** — When a sub-requirement gets cut, the SUMMARY's "Out of Scope" / "Deferred" section is the canonical place; audit picks it up automatically
- **Deferred backlog → next-milestone PROJECT.md Active section** — At close, surface deferred items in Active explicitly, so they're visible during `/gsd-new-milestone` scope discussion

### Key Lessons
1. **Re-running `gsd-integration-checker` retroactively works** — When phases skip VERIFICATION.md, an integration agent can substitute by reading SUMMARYs + cross-referencing source code against a requirements list. Costly (~30 min agent time), but produces audit-grade output
2. **Visual regressions need their own gate** — A spec calling for "magazine hero band" can pass typecheck + build + unit tests while regressing visually. UI review at end of each frontend phase (we have `gsd-ui-review` for this) would have caught LIB-02 revert earlier
3. **Honest deferrals beat hopeful checkmarks** — Phase 9 SUMMARY's explicit "PGE-01/02 deferred to v1.2+" was the cleanest part of the audit. Other reverts (LIB-02) that weren't surfaced until audit cost more reconciliation effort
4. **Bundle audit is a measurable design output** — Phase 9's recharts removal was a deliberate trade with concrete numbers (-380 KB JS). Future redesigns should budget for bundle delta as a first-class success criterion alongside visual fidelity

### Cost Observations
- Total milestone duration: ~1 day (2026-05-08 → 2026-05-09)
- Average per phase: ~10-30 min for plan/execute; longest phase was Phase 9 (recharts replacement)
- Quick-task overhead (between phases): 7 quick tasks logged in v1.0 STATE.md (display fallbacks, top-nav, metadata quality, rescan retries, aggressive_candidates, realtime meta-fetch, scan cancel + virtualization) — total ~3-4 hours sprinkled across phases

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 MVP | 5 | 29 | Initial GSD workflow; full discuss→plan→execute→verify cycle |
| v1.1 UI Redesign | 5 | 5 | Summary-only mode (skip discuss/verification); single-plan-per-phase; design-token-first ordering |

### Cumulative Quality

| Milestone | Total Plans | Tauri Cmds | Bundle JS | Bundle CSS |
|-----------|-------------|------------|-----------|------------|
| v1.0 MVP | 29 | 43 | 1145 KB (gzip 339) | 47.78 KB |
| v1.1 UI Redesign | 5 | 44 (+ open_in_explorer quick task) | 776 KB (gzip 238) | 53.73 KB |

### Top Lessons (Verified Across Milestones)

1. **Lock dependencies at the foundation step of each phase** — v1.0 phases 02a/03a/04a/05a all opened with a dep-lockup plan; v1.1 Phase 6 mirrored this with `<html data-*>` + Tailwind v3 + Zustand prefs store. Downstream waves never had to add deps.
2. **Source-of-truth-is-DB / store, not the UI** — v1.0 settled on "no optimistic updates" (refetch after every mutation); v1.1 carried this forward via `applyPreferences → savePreferences` synchronous chain. Avoids drift between displayed state and persisted state.
3. **Defer scope expansions explicitly** — v1.0 Phase 5 deferred carousel/keyboard nav from screenshot lightbox; v1.1 Phase 9 deferred standalone /scan route. Both ship with documented prerequisites and avoid sneaking work into adjacent phases.
