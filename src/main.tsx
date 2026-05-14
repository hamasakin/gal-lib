import "./index.css";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { applyPreferences, loadPreferences } from "@/lib/preferences";

// v1.1 — apply persisted theme/accent/radius/sidebar/density to <html>
// BEFORE first render to prevent flash-of-default-theme. The store hydrates
// from the same loadPreferences() so this is a no-op once mounted.
applyPreferences(loadPreferences());
// 01c: fire-and-forget DB warm-up so tauri-plugin-sql's lazy Database.load
// actually executes (and runs the 0001 migration) on first dev launch.
// Without this trigger, app.db never materializes. Errors are swallowed:
// Phase 2 will introduce real DB consumers with proper error handling.
import { getDb } from "./lib/db";
import { onMetaFetchProgress, onScanProgress } from "@/lib/scan";
import {
  getActiveSession,
  onActiveSessionChanged,
  onCloseToTray,
} from "@/lib/launch";
import { useLibraryStore } from "@/store/library";

void getDb().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[gal-lib] failed to initialize DB:", e);
});

// 02f: Global scan-progress subscription.
//
// Attached at app entrypoint (NOT inside a component) so the subscription
// outlives any single route; the Library route + ScanProgressBar can read
// the latest payload from the Zustand store regardless of whether the user
// triggered the scan from /settings then immediately navigated to / before
// the first event arrived.
//
// Idempotency: this module is import-evaluated exactly once per app load
// (Vite caches modules; we don't HMR the listener attach below). If we ever
// adopt strict-mode double-mount in dev or move this into a component, we
// must add a module-scope guard to prevent duplicate listener accumulation.
let __scanProgressUnsub: (() => void) | undefined;
if (!__scanProgressUnsub) {
  void onScanProgress((p) => {
    // 20260509f — single getState() for both calls (avoids two-pass overhead)
    // and bulk-clears fetchingMetaIds on terminal status as a safety net for
    // any missed `meta-fetch-progress { phase: "finished" }` (e.g. a backend
    // panic between started/finished, or a process kill mid-iteration).
    const store = useLibraryStore.getState();
    // Quick 260515-cancel — once we've recorded a `cancelled` terminal event,
    // ignore any further events for this run. The backend's ingest task may
    // still flush a trailing scan-progress payload after `abort_all` (rare
    // race), and we don't want it to reset the progress-bar hide timer that
    // ScanProgressBar starts on cancel.
    const prev = store.scanProgress;
    if (prev?.status === "cancelled" && p.status !== "running") {
      // The next "running" event (a brand-new scan starting) is allowed
      // through; only suppress repeated/late terminal echoes.
      return;
    }
    store.setScanProgress(p);
    if (
      p.status === "completed" ||
      p.status === "cancelled" ||
      p.status === "failed"
    ) {
      store.clearFetchingMetaIds();
    }
  })
    .then((unsub) => {
      __scanProgressUnsub = unsub;
    })
    .catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[gal-lib] failed to subscribe to scan-progress:", e);
    });
}

// 20260509f: Global meta-fetch-progress subscription.
//
// Per-game pulse highlight stream. Each `started` adds the game's id to the
// store's fetchingMetaIds set; each `finished` removes it. Covers all four
// backend trigger paths (start_scan ingest loop / refresh_all_metadata /
// refresh_metadata / bind_metadata).
//
// Terminal-status fallback for missed finishes lives in the scan-progress
// listener above (clearFetchingMetaIds on completed/cancelled/failed).
// bind_metadata + single refresh_metadata don't go through scan-progress —
// they rely on the inner async-block wrapping in commands.rs to guarantee
// the finished emit fires on both success and error paths.
let __metaFetchProgressUnsub: (() => void) | undefined;
if (!__metaFetchProgressUnsub) {
  void onMetaFetchProgress((p) => {
    const store = useLibraryStore.getState();
    if (p.phase === "started") {
      store.addFetchingMetaId(p.game_id);
      return;
    }
    // Quick 260515-loading-persist — finished does NOT remove the id here.
    // Removal is driven by Library.tsx watching the `games` array: once the
    // refetched row reflects metadata_source !== "none" (or last_scanned_at
    // is set on a failed match), the id is dropped from fetchingMetaIds and
    // the loading visual ends.
    //
    // Why: backend emits `meta-fetch-progress.finished` immediately after
    // `apply_ingest_result` writes the row, but the frontend grid only
    // refetches via the 600 ms-throttled `games-changed` listener. Between
    // those two events the card sits with cover_path=null and would flicker
    // from "fetching" → "pending" → final state. Anchoring the loading
    // visual to the row's actual data avoids that window.
    //
    // Bulk safety net for missed/late removals (backend panic mid-task,
    // single-game paths that don't trigger a grid-wide refetch) lives in
    // the `scan-progress` terminal listener (clearFetchingMetaIds).
  })
    .then((unsub) => {
      __metaFetchProgressUnsub = unsub;
    })
    .catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error(
        "[gal-lib] failed to subscribe to meta-fetch-progress:",
        e,
      );
    });
}

// 03f: Global active-session subscription.
//
// Same rationale as scan-progress above — module-scope so the bar stays
// in sync regardless of which route is mounted. The backend emits both
// "session started" (Some) and "session ended" (null) on this channel;
// we mirror both into Zustand verbatim (no client-side fan-out logic).
//
// Boot-time hydration: getActiveSession() is invoked once so a webview
// reload mid-session re-populates the store without waiting for the next
// event (which only fires on lifecycle transitions). Errors are non-fatal
// — a missing session simply means no rehydration is needed.
let __activeSessionUnsub: (() => void) | undefined;
if (!__activeSessionUnsub) {
  void getActiveSession()
    .then((s) => {
      useLibraryStore.getState().setActiveSession(s);
    })
    .catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[gal-lib] failed to hydrate active session:", e);
    });
  void onActiveSessionChanged((s) => {
    useLibraryStore.getState().setActiveSession(s);
  })
    .then((unsub) => {
      __activeSessionUnsub = unsub;
    })
    .catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error(
        "[gal-lib] failed to subscribe to active-session-changed:",
        e,
      );
    });
}

// 03f: Close-to-tray toast (first-time-only).
//
// 03e's WindowEvent::CloseRequested interceptor hides the window AND emits
// the "close-to-tray" event so the frontend can show a one-shot toast
// reassuring the user the app didn't quit. The user can dismiss permanently
// via the "不再提示" action — that flips a localStorage flag which we check
// before rendering each subsequent toast.
//
// localStorage is the right persistence layer here (NOT a backend config
// field): the dismissal is purely a UI affordance, doesn't need to survive
// a full-uninstall, and writes are synchronous which the action handler
// expects.
const TRAY_TOAST_DISMISSED_KEY = "gal-lib:tray-toast-dismissed";
let __closeToTrayUnsub: (() => void) | undefined;
if (!__closeToTrayUnsub) {
  void onCloseToTray(() => {
    if (localStorage.getItem(TRAY_TOAST_DISMISSED_KEY) === "1") return;
    toast.info("已最小化到系统托盘", {
      description: "应用仍在后台运行；右键托盘图标可恢复或退出",
      duration: 6000,
      action: {
        label: "不再提示",
        onClick: () => {
          localStorage.setItem(TRAY_TOAST_DISMISSED_KEY, "1");
        },
      },
    });
  })
    .then((unsub) => {
      __closeToTrayUnsub = unsub;
    })
    .catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[gal-lib] failed to subscribe to close-to-tray:", e);
    });
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("#root element not found in index.html");
}
createRoot(rootEl).render(
  <>
    <RouterProvider router={router} />
    <Toaster richColors position="top-right" />
  </>
);
