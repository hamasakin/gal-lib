# Phase 4 — Deferred Items

Items discovered during execution that are out of scope for the current plan.
They are NOT bugs introduced by the plan and should be addressed by a dedicated
follow-up plan or filed as their own issue.

## D-04a-1 — vite/postcss `@import` order warning  (Phase 1/3 carryover)

- **Discovered during:** 04a Task 2 dev smoke (`pnpm tauri dev`).
- **Symptom (from vite log):**
  ```
  [vite:css][postcss] @import must precede all other statements (besides @charset or empty @layer)
  72 |  @import './styles/titlebar.css';
       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  ```
- **Source file:** `src/index.css` line 72 has `@import './styles/titlebar.css'` AFTER other `@layer` / `@tailwind` directives.
- **Why deferred:** Pre-existing from Phase 1 / 3 (App Shell). Not introduced by 04a (we did not touch `src/index.css`). Warning only — does NOT break build, dev server, typecheck, or production bundle. SCOPE BOUNDARY rule: "Pre-existing warnings, linting errors, or failures in unrelated files are out of scope."
- **Recommended fix:** Move the titlebar `@import` to the top of `src/index.css` (immediately after `@charset` if any, before `@tailwind base`). One-line edit.
- **Suggested home:** Folded into the next CSS-touching plan (04d Library route polish or a dedicated `chore` commit before Phase 4 closes).
