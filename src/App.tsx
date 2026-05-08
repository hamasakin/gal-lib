import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { TitlebarSlot } from "@/components/layout/TitlebarSlot";
import { Sidebar } from "@/components/layout/Sidebar";
import { TweaksPanel } from "@/components/tweaks/TweaksPanel";
import { useAppStore } from "@/store/app";
import { getDataDir } from "@/lib/db";

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

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TitlebarSlot />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 bg-background">
          <Outlet />
        </main>
      </div>
      <TweaksPanel />
    </div>
  );
}
