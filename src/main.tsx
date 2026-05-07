import "./index.css";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { Toaster } from "@/components/ui/sonner";
// 01c: fire-and-forget DB warm-up so tauri-plugin-sql's lazy Database.load
// actually executes (and runs the 0001 migration) on first dev launch.
// Without this trigger, app.db never materializes. Errors are swallowed:
// Phase 2 will introduce real DB consumers with proper error handling.
import { getDb } from "./lib/db";
import { onScanProgress } from "@/lib/scan";
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
