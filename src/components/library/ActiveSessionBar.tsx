/**
 * ActiveSessionBar — "now-playing" strip rendered above the library grid.
 *
 * v1.1 redesign — adopts design's `.now-playing` aesthetic:
 *   - 64px cover thumbnail (3:4) at left
 *   - Left accent border 3px (--accent)
 *   - "正在游玩 · 第 N 次会话" mono uppercase breadcrumb with pulsing dot
 *   - Serif title 18px
 *   - Mono session timer (1Hz tick) + total + LE profile hint
 *   - Right: 强制结束 button (with confirmation AlertDialog)
 *
 * Hidden when activeSession is null.
 */

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
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

function fmtSessionTimer(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s]
    .map((n) => n.toString().padStart(2, "0"))
    .join(":");
}

function fmtTotal(sec: number): string {
  if (!sec) return "首次会话";
  const totalMin = Math.floor(sec / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `总计 ${m} 分钟`;
  return m === 0 ? `总计 ${h} 小时` : `总计 ${h} 时 ${m} 分`;
}

function elapsedSec(startedAt: string): number {
  const startMs = Date.parse(startedAt);
  if (Number.isNaN(startMs)) return 0;
  return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
}

export function ActiveSessionBar() {
  const activeSession = useLibraryStore((s) => s.activeSession);
  const games = useLibraryStore((s) => s.games);
  const [, setTick] = useState(0);
  const [dataDir, setDataDir] = useState<string | null>(null);

  useEffect(() => {
    invoke<string>("get_data_dir")
      .then(setDataDir)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[ActiveSessionBar] get_data_dir failed:", e);
      });
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [activeSession]);

  if (!activeSession) return null;

  const game = games.find((g) => g.id === activeSession.game_id);
  const displayName = game?.name_cn ?? game?.name ?? activeSession.game_name;
  const coverSrc =
    game?.cover_path && dataDir
      ? convertFileSrc(`${dataDir.replace(/\\/g, "/")}/${game.cover_path}`) +
        `?v=${encodeURIComponent(game.last_scanned_at ?? "")}`
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
    <div
      className="mx-8 mt-5 grid items-center gap-4 border border-line bg-bg-1 p-4"
      style={{
        gridTemplateColumns: "64px 1fr auto",
        borderLeftWidth: 3,
        borderLeftColor: "var(--accent)",
        borderRadius: "var(--r-md)",
      }}
    >
      {/* Cover thumbnail */}
      <div
        className="aspect-[3/4] w-16 overflow-hidden bg-bg-2"
        style={{ borderRadius: "var(--r-sm)" }}
      >
        {coverSrc ? (
          <img
            src={coverSrc}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-3">
            <ImageOff className="size-4" aria-hidden />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">
          <span
            aria-hidden
            className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand animate-gallib-pulse"
          />
          <span>正在游玩</span>
        </div>
        <div
          className="mt-1 truncate font-serif text-[18px] text-ink-0"
          title={displayName}
        >
          {displayName}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-ink-2">
          <span className="text-ink-1">{fmtSessionTimer(elapsed)}</span>
          <span className="mx-2">·</span>
          <span>{fmtTotal(game?.total_playtime_sec ?? 0)}</span>
        </div>
      </div>

      {/* Actions */}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-2 border border-line bg-bg-2 px-3 text-[12px] text-ink-1 transition-colors hover:border-line-strong hover:bg-bg-3 hover:text-ink-0"
            style={{ borderRadius: "var(--r-md)" }}
          >
            强制结束
          </button>
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
  );
}
