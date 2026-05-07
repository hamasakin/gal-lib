/**
 * ScanProgressBar — sticky-top progress + cancel-button bar.
 *
 * 02-UI-SPEC §Scan Progress Bar contract:
 *   - sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border h-14
 *   - 4px shadcn Progress block with track bg-secondary, indicator bg-ring (#7C5CFF — 3rd accent use)
 *   - Status text: "扫描中 ({current_dir}) — 已完成 {completed} / 共 {total}"
 *   - 取消 button (right) → AlertDialog "确定取消扫描？已扫描的游戏会保留" Yes/No
 *
 * Lifecycle behavior:
 *   - Hidden (returns null) when scanProgress is null OR after a 5s timeout
 *     following a terminal status (completed / cancelled / failed)
 *   - When the next "running" event arrives, the bar reappears and the
 *     auto-hide timer is cleared
 *
 * Throttle: per CONTEXT.md the consumer should throttle render to ~100ms.
 * For now we render every store change because the backend already emits
 * per-directory (not per-file), so update rate is naturally bounded.
 */

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
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
import { toast } from "sonner";
import { cancelScan } from "@/lib/scan";
import { useLibraryStore } from "@/store/library";

const AUTO_HIDE_MS = 5_000;

export function ScanProgressBar() {
  const scanProgress = useLibraryStore((s) => s.scanProgress);
  const [hidden, setHidden] = useState(false);

  // Auto-hide after terminal status. Re-arm the timer on each terminal event.
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

  const { current_dir, completed, total, status } = scanProgress;
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  // Status-specific summary line (running shows current_dir; terminal shows outcome)
  let summary: string;
  switch (status) {
    case "running":
      summary = `扫描中 (${current_dir || "…"}) — 已完成 ${completed} / 共 ${total}`;
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
    <div className="sticky top-0 z-10 h-14 border-b border-border bg-background/95 backdrop-blur">
      <Progress value={pct} className="h-1 rounded-none" />
      <div className="flex h-[calc(100%-4px)] items-center justify-between px-6">
        <span className="truncate text-body text-foreground" title={summary}>
          {summary}
        </span>
        {status === "running" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm">
                取消
              </Button>
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
