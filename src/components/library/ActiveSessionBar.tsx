/**
 * ActiveSessionBar — sticky-top "currently playing" indicator.
 *
 * 03-CONTEXT § Active Session UI Indicator contract:
 *   - Same visual position as ScanProgressBar (sticky top-0 z-10
 *     bg-background/95 backdrop-blur border-b border-border h-14)
 *   - Left: cover thumbnail (24×24 at h-10 w-10 / 40px CSS) + game name +
 *     elapsed-time text (re-tick every 1s while session is running)
 *   - Right: ghost-variant 强制结束 button → AlertDialog confirmation →
 *     `endActiveSession()` + toast.info "已结束游戏会话"
 *   - Hidden when `activeSession` is null (the only visibility gate;
 *     no auto-hide timer like ScanProgressBar's terminal-state fade —
 *     session lifecycle is binary in the store: active = bar shown,
 *     null = bar hidden)
 *
 * Elapsed format (locked CONTEXT § §Active Session UI Indicator):
 *   - ≥1h  → "已游玩 {H}时{M}分"
 *   - <1h  → "已游玩 {M}分"
 *   - 0min → "已游玩 0分" (covers the brief window between session start
 *            and the first 1s tick — avoids flashing an empty/blank label)
 *
 * Cover URL resolution mirrors GameGrid: combine `dataDir` (resolved once
 * via `get_data_dir`) with the active game's `cover_path` then run through
 * `convertFileSrc`. We can't reach into GameGrid's internal cache, so this
 * component owns its own `dataDir` ref. If the active game's `cover_path`
 * is null OR `dataDir` hasn't resolved yet, the placeholder ImageOff icon
 * renders in place of the thumbnail.
 *
 * Priority interaction with ScanProgressBar:
 *   - When both are visible (rare — scan + active session simultaneously),
 *     scan stays on top (it ships first in Library.tsx render order). Both
 *     bars stack; ActiveSessionBar appears below ScanProgressBar. Users can
 *     scroll the main content (sticky positioning is per-element relative
 *     to its scroll container).
 */

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { endActiveSession } from "@/lib/launch";
import { useLibraryStore } from "@/store/library";

/**
 * Format `已游玩 {H}时{M}分` (or `{M}分` when <1h). Caller passes a
 * non-negative integer second-count; we don't clamp (negative input would
 * indicate clock skew which the orchestrator already guards against).
 */
function formatElapsed(seconds: number): string {
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `已游玩 ${h}时${m}分` : `已游玩 ${m}分`;
}

/**
 * Resolve `started_at` (RFC3339 UTC string from the backend) to elapsed
 * seconds vs. now. Uses Date.parse which accepts the `Z`-suffixed RFC3339
 * shape sqlx emits. Negative result clamped to 0 — defensive against any
 * clock skew between the Rust process and the webview JS runtime (in
 * practice they share a wall clock, but a brief skew during NTP step is
 * possible).
 */
function elapsedSec(startedAt: string): number {
  const startMs = Date.parse(startedAt);
  if (Number.isNaN(startMs)) return 0;
  return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
}

export function ActiveSessionBar() {
  const activeSession = useLibraryStore((s) => s.activeSession);
  const games = useLibraryStore((s) => s.games);
  const [now, setNow] = useState(() => Date.now());
  const [dataDir, setDataDir] = useState<string | null>(null);

  // Resolve dataDir once for cover-URL composition. Same pattern as
  // GameGrid; component is mounted once at Library.tsx scope.
  useEffect(() => {
    invoke<string>("get_data_dir")
      .then(setDataDir)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[ActiveSessionBar] get_data_dir failed:", e);
      });
  }, []);

  // 1Hz tick driving the elapsed-time re-render. Only ticks while the bar
  // is actually mounted with an active session — when activeSession is null
  // the bar early-returns below and the interval is implicitly cleaned up
  // by React unmount.
  useEffect(() => {
    if (!activeSession) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [activeSession]);

  // Reference `now` to keep TS satisfied that the state is consumed; the
  // actual elapsed read happens below using Date.now() directly to avoid
  // a stale-state flash on first render after activeSession arrives.
  void now;

  if (!activeSession) return null;

  // Look up the corresponding Game row for cover + display name. Falls
  // back to the event payload's `game_name` when the games slice hasn't
  // hydrated yet (e.g. session started before listGames() resolved).
  const game = games.find((g) => g.id === activeSession.game_id);
  const displayName = game?.name_cn ?? game?.name ?? activeSession.game_name;
  const coverSrc =
    game?.cover_path && dataDir
      ? convertFileSrc(`${dataDir.replace(/\\/g, "/")}/${game.cover_path}`)
      : null;

  const elapsed = elapsedSec(activeSession.started_at);

  async function onConfirmEnd() {
    try {
      await endActiveSession();
      toast.info("已结束游戏会话");
    } catch (e: unknown) {
      toast.error(`结束失败 — ${String(e)}`);
    }
  }

  return (
    <div className="sticky top-0 z-10 h-14 border-b border-border bg-background/95 backdrop-blur">
      <div className="flex h-full items-center justify-between gap-3 px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-10 flex-shrink-0 overflow-hidden rounded bg-secondary">
            {coverSrc ? (
              <img
                src={coverSrc}
                alt={displayName}
                draggable={false}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                <ImageOff className="size-4" aria-hidden />
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-col">
            <span
              className="truncate text-body font-medium text-foreground"
              title={displayName}
            >
              游戏中 — {displayName}
            </span>
            <span className="text-label text-muted-foreground">
              {formatElapsed(elapsed)}
            </span>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm">
              强制结束
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确定强制结束游戏？</AlertDialogTitle>
              <AlertDialogDescription>
                本次会话将记为已取消
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction onClick={() => void onConfirmEnd()}>
                确定
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
