/**
 * ScreenshotsTab — Phase 5 / 05e Detail page tab.
 *
 * Renders the per-game screenshots gallery: a 3-column thumbnail grid with
 * hover-revealed delete + export affordances and click-to-open lightbox.
 *
 * Data flow:
 *   1. Mount → `getScreenshots(gameId)` → cache into
 *      `useLibraryStore.screenshotsByGame[gameId]`. Render reads from the
 *      store so concurrent mutations (delete) refresh the grid without
 *      passing prop callbacks back up to Detail.
 *   2. Image `<img src>` resolves the relative DB path against `dataDir`
 *      using `convertFileSrc` (Tauri asset protocol). When `dataDir` is
 *      not yet hydrated, tiles render with a dim placeholder rather than
 *      a broken-image icon — saves the user a flash of error UI on cold load.
 *   3. Hover overlay shows two icon buttons: 导出 (download icon →
 *      `save()` save-dialog → `exportScreenshot(id, target)`) and 删除
 *      (× icon → AlertDialog confirm → `deleteScreenshot(id)`). Both
 *      stop event propagation so they don't trigger the underlying
 *      lightbox-open click.
 *   4. Click on the image (NOT the buttons) opens a shadcn `Dialog`
 *      lightbox — full-resolution rendering at the screen's natural
 *      aspect ratio. v1 has no carousel / keyboard navigation; the user
 *      closes via the dialog's built-in close affordance.
 *
 * Locked Chinese copy (UI-SPEC contract — do not edit without re-locking):
 *   还没有截图 — 启动游戏后将自动捕获 / 确定删除这张截图？/ 已删除截图 /
 *   导出 / 删除 / 取消 / 确定 / PNG 图片
 *
 * Empty state: shown when `screenshots.length === 0` AFTER the fetch
 * resolves. We track a `loaded` flag to avoid flashing the empty state
 * during the initial fetch (before the store is populated).
 */

import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Download, Trash2, ImageOff } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  deleteScreenshot,
  exportScreenshot,
  getScreenshots,
  type Screenshot,
} from "@/lib/screenshots";
import { useLibraryStore } from "@/store/library";
import { cn } from "@/lib/utils";

interface ScreenshotsTabProps {
  gameId: number;
  /** Absolute path to the portable `data/` dir; null until App boot resolves. */
  dataDir: string | null;
}

export function ScreenshotsTab({ gameId, dataDir }: ScreenshotsTabProps) {
  const screenshotsByGame = useLibraryStore((s) => s.screenshotsByGame);
  const setScreenshotsForGame = useLibraryStore((s) => s.setScreenshotsForGame);
  const screenshots: Screenshot[] = screenshotsByGame[gameId] ?? [];

  const [loaded, setLoaded] = useState(false);
  const [lightboxShot, setLightboxShot] = useState<Screenshot | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Screenshot | null>(null);

  // Refetch helper — called on mount and after every mutation.
  async function refetch() {
    try {
      const rows = await getScreenshots(gameId);
      setScreenshotsForGame(gameId, rows);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[ScreenshotsTab] getScreenshots failed:", e);
      toast.error(`加载截图失败 — ${String(e)}`);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(gameId)) return;
    setLoaded(false);
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // ── Resolve a DB-relative `path` to a webview-loadable URL ───────────────
  // The DB stores paths like `screenshots/<gameId>/<file>.png` relative to
  // `dataDir`. `convertFileSrc` converts an absolute fs path → asset:// URL.
  function resolveSrc(rel: string): string | null {
    if (!dataDir) return null;
    const normalized = dataDir.replace(/\\/g, "/");
    return convertFileSrc(`${normalized}/${rel}`);
  }

  // ── Export handler ───────────────────────────────────────────────────────
  async function onExport(shot: Screenshot, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      // Default file name = the original PNG basename so the user doesn't
      // have to think; they can rename in the dialog.
      const basename = shot.path.split(/[\\/]/).pop() ?? "screenshot.png";
      const target = await saveDialog({
        defaultPath: basename,
        filters: [{ name: "PNG 图片", extensions: ["png"] }],
      });
      if (!target) return; // user cancelled
      await exportScreenshot(shot.id, target);
      toast.success(`已导出截图 — ${target}`);
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error("[ScreenshotsTab] export failed:", err);
      toast.error(`导出失败 — ${String(err)}`);
    }
  }

  // ── Delete confirm handler (commits after AlertDialog confirm) ──────────
  async function onDeleteConfirmed() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    try {
      await deleteScreenshot(id);
      toast.success("已删除截图");
      await refetch();
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error("[ScreenshotsTab] delete failed:", err);
      toast.error(`删除失败 — ${String(err)}`);
    } finally {
      setPendingDelete(null);
    }
  }

  if (loaded && screenshots.length === 0) {
    return (
      <p className="text-body text-muted-foreground">
        还没有截图 — 启动游戏后将自动捕获
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {screenshots.map((shot) => {
          const src = resolveSrc(shot.path);
          return (
            <button
              type="button"
              key={shot.id}
              onClick={() => setLightboxShot(shot)}
              className={cn(
                "group relative aspect-square overflow-hidden rounded-md border border-border bg-secondary",
                "transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              aria-label={`截图 ${shot.captured_at}`}
            >
              {src ? (
                <img
                  src={src}
                  alt={shot.captured_at}
                  draggable={false}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display =
                      "none";
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <ImageOff className="size-6" aria-hidden />
                </div>
              )}
              {/* Hover overlay with action buttons */}
              <div
                className={cn(
                  "absolute inset-0 flex items-end justify-end gap-1 bg-black/40 p-1.5 opacity-0",
                  "transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
                )}
              >
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => void onExport(shot, e)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void onExport(shot, e as unknown as React.MouseEvent);
                    }
                  }}
                  className="inline-flex size-7 items-center justify-center rounded-md bg-background/80 text-foreground hover:bg-background"
                  aria-label="导出"
                  title="导出"
                >
                  <Download className="size-3.5" aria-hidden />
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete(shot);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      setPendingDelete(shot);
                    }
                  }}
                  className="inline-flex size-7 items-center justify-center rounded-md bg-background/80 text-rose-400 hover:bg-background"
                  aria-label="删除"
                  title="删除"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Lightbox Dialog ────────────────────────────────────────────── */}
      <Dialog
        open={lightboxShot != null}
        onOpenChange={(open) => {
          if (!open) setLightboxShot(null);
        }}
      >
        <DialogContent className="max-w-[90vw] p-0 sm:max-w-[80vw]">
          <DialogTitle className="sr-only">
            {lightboxShot ? `截图 ${lightboxShot.captured_at}` : "截图"}
          </DialogTitle>
          {lightboxShot &&
            (() => {
              const src = resolveSrc(lightboxShot.path);
              if (!src) {
                return (
                  <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
                    <ImageOff className="size-10" aria-hidden />
                  </div>
                );
              }
              return (
                <img
                  src={src}
                  alt={lightboxShot.captured_at}
                  draggable={false}
                  className="max-h-[85vh] w-full object-contain"
                />
              );
            })()}
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm AlertDialog ─────────────────────────────────── */}
      <AlertDialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定删除这张截图？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作将同时删除磁盘上的 PNG 文件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" size="sm">
                取消
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void onDeleteConfirmed()}
              >
                确定
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
