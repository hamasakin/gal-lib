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
// Quick 260515-cancel — cancelled is a user-driven terminal state; user just
// asked for the scan to stop, so we shouldn't make them stare at a stale bar
// for 5 s. 1.2 s is enough to read the "已取消" copy and confirm it took.
const AUTO_HIDE_CANCELLED_MS = 1_200;

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
    const delay =
      scanProgress.status === "cancelled"
        ? AUTO_HIDE_CANCELLED_MS
        : AUTO_HIDE_MS;
    const timer = setTimeout(() => setHidden(true), delay);
    return () => clearTimeout(timer);
  }, [scanProgress]);

  if (!scanProgress || hidden) return null;

  const { current_dir, completed, total, status, phase } = scanProgress;
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  // Quick 260515-prog — copy now distinguishes the two pipeline phases:
  // Pass 1 (discovering) shows "扫描目录中"; Pass 2 (enriching) shows
  // "获取元数据"; terminal events fold into a single "扫描完成" copy so the
  // user doesn't see a two-step "目录扫描完成" → "元数据获取完成" flicker.
  // CR-05 fix: every branch must initialize `summary`, otherwise an
  // unforeseen `status` value (e.g. a new backend status added in a future
  // phase) leaves `summary` in the TDZ and triggers a ReferenceError when
  // the JSX below reads it. Initialise upfront and let each case overwrite.
  let summary = "";
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
    default:
      // Future-proof: surface the unknown status verbatim so it's visible
      // in dev instead of silently swallowed.
      summary = `扫描状态 — ${String(status)}`;
  }

  async function onConfirmCancel() {
    try {
      await cancelScan();
      // Quick 260515-cancel — flip the store optimistically so the bar
      // shows "已取消" + starts its 1.2 s auto-hide immediately, rather
      // than waiting for the backend's terminal Cancelled emit (which can
      // take a brief moment while the JoinSet drains its abort).
      const st = useLibraryStore.getState();
      if (st.scanProgress && st.scanProgress.status === "running") {
        st.setScanProgress({ ...st.scanProgress, status: "cancelled" });
        st.clearFetchingMetaIds();
      }
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
          {status === "running" &&
            (total > 0 ? (
              <span className="font-mono text-[10.5px] text-ink-3">
                {completed} / {total} · {pct}%
              </span>
            ) : (
              // WR-12 fix: total=0 while running means we've started a
              // pass but haven't enumerated entries yet. Showing
              // "0 / 0 · 0%" looked stuck; this 准备中 copy makes the
              // indeterminate state explicit until total lands.
              <span className="font-mono text-[10.5px] text-ink-3">准备中…</span>
            ))}
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
