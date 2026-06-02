import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { TitlebarSlot } from "@/components/layout/TitlebarSlot";
import { Sidebar } from "@/components/layout/Sidebar";
import { TweaksPanel } from "@/components/tweaks/TweaksPanel";
import { useAppStore } from "@/store/app";
import { getDataDir } from "@/lib/db";
import { addGames } from "@/lib/scan";
import { getSidebarCategories, searchGames } from "@/lib/search";
import { useLibraryStore } from "@/store/library";
import { checkForUpdates, relaunchApp } from "@/lib/updater";
import { usePreferencesStore } from "@/store/preferences";

/**
 * Application root layout.
 *
 * Structure (top-to-bottom, then horizontally):
 *   <flex flex-col h-screen>
 *     <TitlebarSlot/>          (h-9, bg-card, border-b)  — 01e replaces this stub
 *     <flex flex-1 min-h-0>
 *       <Sidebar/>             (w-[220px], bg-card, border-r)
 *       <main flex-1 min-w-0>  (bg-background)
 *         <Outlet/>            (Library / Settings)
 *       </main>
 *     </div>
 *   </div>
 *
 * Boot side-effect: resolve portable data dir via 01c's `getDataDir()` Tauri
 * command and write to Zustand store. The cancelled flag guards against
 * unmount-during-async setState. The action ref from zustand is stable, so
 * the effect only runs once in practice.
 */
export default function App() {
  const { t } = useTranslation();
  const setDataDir = useAppStore((s) => s.setDataDir);
  const autoCheckUpdate = usePreferencesStore((s) => s.autoCheckUpdate);
  // Quick 260531-x57 — drag-drop overlay flag. `enter`/`over` raise it,
  // `leave`/`drop` lower it. Purely visual; the actual ingest runs on `drop`.
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDataDir()
      .then((dir) => {
        if (!cancelled) setDataDir(dir);
      })
      .catch((err) => {
        // 01c's get_data_dir command is registered + capability allowed.
        // If this fails the most likely cause is running outside Tauri
        // (e.g. plain `pnpm dev`); log and let the UI render anyway.
        // eslint-disable-next-line no-console
        console.error("[gal-lib] failed to resolve data dir:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [setDataDir]);

  // Quick 260514-upd — startup auto-update check (silent). 5 s delay keeps
  // first paint snappy and avoids racing with data-dir resolution. Errors
  // (offline / no release / unsigned bundle) are swallowed by silent mode.
  useEffect(() => {
    if (!autoCheckUpdate) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      void checkForUpdates({ silent: true }).then((state) => {
        if (cancelled) return;
        if (state.phase === "ready") {
          toast.success(t("toast.update_ready", { version: state.version }), {
            description: t("toast.update_ready_desc"),
            duration: Infinity,
            action: {
              label: t("toast.restart_now"),
              onClick: () => {
                void relaunchApp();
              },
            },
          });
        }
      });
    }, 5000);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [autoCheckUpdate, t]);

  // Quick 260531-x57 — explorer drag-drop → batch addGame.
  //
  // Uses Tauri v2's webview-level `onDragDropEvent` (NOT the v1
  // `tauri://file-drop` event). `dragDropEnabled: true` on the main window
  // (tauri.conf.json) keeps this firing as an explicit contract.
  //
  // The `cancelled` + then-fires-immediately pattern mirrors useTauriListen:
  // `onDragDropEvent` resolves a `Promise<UnlistenFn>`, and React StrictMode /
  // HMR can run effect cleanup before that promise settles, so a captured
  // unlisten would still be null and the subscription would leak + double-fire.
  //
  // Quick 260603-2g0 — on `drop`, all dropped paths go to the batch `addGames`
  // command in ONE call. The backend inserts every placeholder row first
  // (each emits `games-changed`, so all cards surface instantly), then enriches
  // them one by one. Library.tsx's existing `games-changed` subscription drives
  // the live grid refresh, so cards appear immediately and backfill metadata
  // progressively — no more "nothing happens until the whole batch finishes".
  // A non-directory / unresolvable / unsafe path is counted as `failed` on the
  // Rust side (no plugin-fs probe needed, zero new deps).
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    let processing = false;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        switch (payload.type) {
          case "enter":
          case "over":
            setDragActive(true);
            break;
          case "leave":
            setDragActive(false);
            break;
          case "drop": {
            setDragActive(false);
            const paths = payload.paths ?? [];
            // Guard against re-entrancy: ignore a second drop while a batch is
            // still ingesting (serial loop below owns the rate-limiter budget).
            if (processing) return;
            if (paths.length === 0) {
              toast.error(t("dragdrop.none"));
              return;
            }
            processing = true;
            // Immediate dynamic feedback: a loading toast on drop, kept up while
            // the batch enriches, then swapped for the terminal result.
            const loadingId = toast.loading(t("dragdrop.adding"));
            void (async () => {
              let ok = 0;
              let fail = 0;
              try {
                const res = await addGames(paths);
                ok = res.added;
                fail = res.failed;
              } catch (e: unknown) {
                fail = paths.length;
                // eslint-disable-next-line no-console
                console.error("[dragdrop] addGames failed:", e);
              }
              toast.dismiss(loadingId);
              if (ok > 0) {
                // Safety net for the case where the drop happened while the
                // Library route (and its `games-changed` subscription) wasn't
                // mounted — refresh the store directly. When Library IS mounted,
                // its live subscription already kept the grid current.
                try {
                  const [games, sidebar] = await Promise.all([
                    searchGames(null, "last_played", "desc", null),
                    getSidebarCategories(),
                  ]);
                  useLibraryStore.getState().setGames(games);
                  useLibraryStore.getState().setSidebar(sidebar);
                } catch (e: unknown) {
                  // eslint-disable-next-line no-console
                  console.error("[dragdrop] refresh after add failed:", e);
                }
                if (fail > 0) {
                  toast.warning(t("dragdrop.partial", { ok, fail }));
                } else {
                  toast.success(t("dragdrop.added", { count: ok }));
                }
              } else {
                toast.error(t("dragdrop.none"));
              }
              processing = false;
            })();
            break;
          }
          default:
            break;
        }
      })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [t]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TitlebarSlot />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <Outlet />
          {/* Quick 260531-x57 — drag-drop overlay. `pointer-events-none` so it
              never intercepts the OS drop; mirrors the dark dialog-overlay
              tone used by MetadataPicker / alert-dialog. */}
          {dragActive ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-black/55 backdrop-blur-[2px]"
            >
              <div
                className="border-2 border-dashed border-brand bg-bg-1/90 px-8 py-6 font-serif text-[16px] text-ink-0 shadow-[0_12px_32px_-10px_rgba(0,0,0,.6)]"
                style={{ borderRadius: "var(--r-md)" }}
              >
                {t("dragdrop.overlay")}
              </div>
            </div>
          ) : null}
        </main>
      </div>
      <TweaksPanel />
    </div>
  );
}
