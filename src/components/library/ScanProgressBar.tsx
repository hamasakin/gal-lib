/**
 * ScanProgressBar — sticky-top scan progress + cancel.
 *
 * v1.1 restyle — preserves auto-hide + cancel-confirmation behavior, swaps
 * shadcn Progress for a 2px gradient bar (var(--accent)→var(--accent-deep))
 * and adopts mono-font status copy.
 */

import { useEffect, useState } from "react";
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
import { toast } from "sonner";
import { cancelScan } from "@/lib/scan";
import { useLibraryStore } from "@/store/library";

const AUTO_HIDE_MS = 5_000;

export function ScanProgressBar() {
  const scanProgress = useLibraryStore((s) => s.scanProgress);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!scanProgress) {
      setHidden(false);
      return;
    }
    const isTerminal =
      scanProgress.status === "completed" ||
      scanProgress.status === "cancelled" ||
      scanProgress.status === "failed";
    if (!isTerminal) {
      setHidden(false);
      return;
    }
    const timer = setTimeout(() => setHidden(true), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [scanProgress]);

  if (!scanProgress || hidden) return null;

  const { current_dir, completed, total, status, phase } = scanProgress;
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  // Quick 260515-prog — copy now distinguishes the two pipeline phases:
  // Pass 1 (discovering) shows "扫描目录中"; Pass 2 (enriching) shows
  // "获取元数据"; terminal events fold into a single "扫描完成" copy so the
  // user doesn't see a two-step "目录扫描完成" → "元数据获取完成" flicker.
  let summary: string;
  switch (status) {
    case "running":
      if (phase === "discovering") {
        summary = `扫描目录中 — ${current_dir || "…"}`;
      } else {
        summary = `获取元数据 — ${current_dir || "…"}`;
      }
      break;
    case "completed":
      summary = `扫描完成 — 共 ${total} 款游戏`;
      break;
    case "cancelled":
      summary = "扫描已取消";
      break;
    case "failed":
      summary = "扫描失败";
      break;
  }

  async function onConfirmCancel() {
    try {
      await cancelScan();
      toast.info("扫描已取消");
    } catch (e: unknown) {
      toast.error(`取消失败 — ${String(e)}`);
    }
  }

  return (
    <div className="sticky top-0 z-10 border-b border-line bg-bg-0/95 backdrop-blur">
      {/* 2px gradient progress line */}
      <div className="relative h-[2px] w-full bg-bg-2">
        <div
          className="absolute left-0 top-0 h-full transition-[width] duration-300"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--accent), var(--accent-deep))",
          }}
        />
      </div>
      <div className="flex h-12 items-center justify-between px-8">
        <div className="flex min-w-0 items-baseline gap-3">
          <span
            className="truncate font-mono text-[11.5px] text-ink-1"
            title={summary}
          >
            {summary}
          </span>
          {status === "running" && (
            <span className="font-mono text-[10.5px] text-ink-3">
              {completed} / {total} · {pct}%
            </span>
          )}
        </div>
        {status === "running" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                className="inline-flex h-7 items-center px-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-2 transition-colors hover:text-ink-0"
              >
                取消
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确定取消扫描？</AlertDialogTitle>
                <AlertDialogDescription>
                  已扫描的游戏会保留
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => void onConfirmCancel()}>
                  确定
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}
