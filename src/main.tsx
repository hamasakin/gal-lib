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
import { onScanProgress } from "@/lib/scan";
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
    useLibraryStore.getState().setScanProgress(p);
  })
    .then((unsub) => {
      __scanProgressUnsub = unsub;
    })
    .catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[gal-lib] failed to subscribe to scan-progress:", e);
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
