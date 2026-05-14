import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { toast } from "sonner";
import { TitlebarSlot } from "@/components/layout/TitlebarSlot";
import { Sidebar } from "@/components/layout/Sidebar";
import { TweaksPanel } from "@/components/tweaks/TweaksPanel";
import { useAppStore } from "@/store/app";
import { getDataDir } from "@/lib/db";
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
  const setDataDir = useAppStore((s) => s.setDataDir);
  const autoCheckUpdate = usePreferencesStore((s) => s.autoCheckUpdate);

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
          toast.success(`更新已就绪 v${state.version}`, {
            description: "下次启动生效，或立即重启应用",
            duration: Infinity,
            action: {
              label: "立即重启",
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
  }, [autoCheckUpdate]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TitlebarSlot />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <Outlet />
        </main>
      </div>
      <TweaksPanel />
    </div>
  );
}
