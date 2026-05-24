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
import { ErrorBoundary } from "@/components/common/ErrorBoundary";

void getDb().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[gal-lib] failed to initialize DB:", e);
});

// Module-level Tauri event subscriptions.
//
// Attached at app entrypoint (NOT inside a component) so subscriptions
// outlive any single route mount.
//
// Why a globalThis registry: the original `let __xxxUnsub: ...` guards
// were no-ops — `let` declarations re-evaluate to `undefined` on every
// module evaluation, so `if (!__xxxUnsub)` was always true. The first
// guard worked by accident (because `if (!undefined)` happens to be true
// on first run too) but provided zero protection against Vite HMR
// re-evaluating main.tsx, after which the previous module's listeners
// were leaked and every event was consumed N times (BL-01 in 260524
// review).
//
// The registry lives on `globalThis` so HMR survives, and an
// `import.meta.hot.dispose` hook clears the old listeners before the new
// module evaluates and re-registers fresh ones.
type Unsub = () => void;
const REGISTRY_KEY = "__galLibListenerRegistry";
interface RegistryEntry {
  unsub?: Unsub;
  cancelled: boolean;
}
const w = globalThis as unknown as {
  [REGISTRY_KEY]?: Map<string, RegistryEntry>;
};
const registry: Map<string, RegistryEntry> = w[REGISTRY_KEY] ?? new Map();
w[REGISTRY_KEY] = registry;

function registerOnce(key: string, attach: () => Promise<Unsub>): void {
  if (registry.has(key)) return;
  const entry: RegistryEntry = { cancelled: false };
  registry.set(key, entry);
  attach()
    .then((unsub) => {
      if (entry.cancelled) {
        // HMR disposed before listen() resolved — fire the unsub immediately
        // so the listener never leaks.
        try {
          unsub();
        } catch {
          /* swallow */
        }
      } else {
        entry.unsub = unsub;
      }
    })
    .catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error(`[gal-lib] failed to subscribe ${key}:`, e);
      registry.delete(key);
    });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const entry of registry.values()) {
      entry.cancelled = true;
      try {
        entry.unsub?.();
      } catch {
        /* swallow */
      }
    }
    registry.clear();
  });
}

// 02f: Global scan-progress subscription.
//
// Outlives any single route mount; ScanProgressBar and Library both read
// the latest payload from the Zustand store regardless of triggering
// route. Bulk-clears fetchingMetaIds on terminal status as a safety net
// for any missed `meta-fetch-progress { phase: "finished" }` (backend
// panic between started/finished, mid-iteration kill).
registerOnce("scan-progress", () =>
  onScanProgress((p) => {
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
  }),
);

// 20260509f: Global meta-fetch-progress subscription.
//
// Per-game pulse highlight stream. `started` marks the id as "in_flight";
// `finished` transitions it to "awaiting_refetch" (Library.tsx clears it
// once the throttled `games-changed` refetch reflects the bound row).
// Covers all four backend trigger paths.
registerOnce("meta-fetch-progress", () =>
  onMetaFetchProgress((p) => {
    const store = useLibraryStore.getState();
    if (p.phase === "started") {
      store.addFetchingMetaId(p.game_id);
      return;
    }
    // Quick 260515-loading-phase-sort — finished transitions phase from
    // "in_flight" to "awaiting_refetch". The id stays in the map (loading
    // visual persists); Library.tsx's reconcile effect only checks bound
    // state for "awaiting_refetch" entries, which preserves the
    // loading-persist intent without wiping the loading visual the instant
    // `started` fires for an already-bound row (refresh_metadata_smart).
    store.markFetchingMetaFinished(p.game_id);
  }),
);

// 03f: Global active-session subscription.
//
// Backend emits both "session started" (Some) and "session ended" (null)
// on this channel; we mirror both into Zustand verbatim (no client-side
// fan-out logic). Boot-time hydration via getActiveSession() runs once so
// a webview reload mid-session re-populates the store without waiting for
// the next event.
void getActiveSession()
  .then((s) => {
    useLibraryStore.getState().setActiveSession(s);
  })
  .catch((e: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[gal-lib] failed to hydrate active session:", e);
  });
registerOnce("active-session-changed", () =>
  onActiveSessionChanged((s) => {
    useLibraryStore.getState().setActiveSession(s);
  }),
);

// 03f: Close-to-tray toast (first-time-only).
//
// 03e's WindowEvent::CloseRequested interceptor hides the window AND emits
// the "close-to-tray" event so the frontend can show a one-shot toast
// reassuring the user the app didn't quit. localStorage holds the
// "不再提示" dismissal.
const TRAY_TOAST_DISMISSED_KEY = "gal-lib:tray-toast-dismissed";
registerOnce("close-to-tray", () =>
  onCloseToTray(() => {
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
  }),
);

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("#root element not found in index.html");
}
createRoot(rootEl).render(
  <>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
    <Toaster richColors position="top-right" />
  </>
);
