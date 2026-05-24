/**
 * Phase 13 (POL-03) — BackfillProgressBar
 *
 * Surfaces the in-flight `backfill_metadata_enrichment` loop on the Library
 * PageHeader's lower edge. Mirrors `ScanProgressBar`'s visual language:
 * 2px gradient bar, mono status copy, cancel confirmation, auto-hide.
 *
 * Drives off two event streams from the Rust backfill task:
 *   • `meta-fetch-progress-meta` — { total } at start, { done } on
 *     completion, { cancelled } on user cancel.
 *   • `meta-fetch-progress` — per-game { game_id, phase, name }. We
 *     increment `current` on every `finished` and snapshot `name` on every
 *     `started` to drive the "正在抓取：xxx" line.
 *
 * Hidden when no backfill has been observed in this session (initial mount
 * state) or after a terminal status sticks for AUTO_HIDE_MS.
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
import {
  cancelBackfill,
  type MetaFetchProgress,
  type MetaFetchProgressMeta,
} from "@/lib/persons";
import { useTauriListen } from "@/hooks/useTauriListen";

const AUTO_HIDE_MS = 5_000;

type Status = "idle" | "running" | "cancelled" | "done";

export function BackfillProgressBar() {
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0);
  const [currentName, setCurrentName] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [hidden, setHidden] = useState(true);

  useTauriListen<MetaFetchProgressMeta>("meta-fetch-progress-meta", (e) => {
    const p = e.payload;
    if (typeof p.total === "number" && p.total > 0) {
      setTotal(p.total);
      setCurrent(0);
      setCurrentName("");
      setStatus("running");
      setHidden(false);
      return;
    }
    if (p.cancelled) {
      setStatus("cancelled");
      return;
    }
    if (p.done) {
      setStatus("done");
    }
  });

  useTauriListen<MetaFetchProgress>("meta-fetch-progress", (e) => {
    const p = e.payload;
    // Only update current name on `started` so the label tracks the
    // active fetch rather than the previous one.
    if (p.phase === "started") {
      if (p.name) setCurrentName(p.name);
      return;
    }
    if (p.phase === "finished") {
      setCurrent((c) => c + 1);
    }
  });

  // Auto-hide a few seconds after the terminal state lands. A new backfill
  // run resets `hidden` via the `meta` event with a fresh total.
  useEffect(() => {
    if (status === "running" || status === "idle") return;
    const timer = setTimeout(() => setHidden(true), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (hidden || status === "idle") return null;

  const pct =
    total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  let summary: string;
  switch (status) {
    case "running":
      summary = currentName
        ? `补齐元数据 — ${currentName}`
        : "补齐元数据 — 正在排队…";
      break;
    case "cancelled":
      summary = "补齐已取消";
      break;
    case "done":
      summary = `补齐完成 — 共 ${total} 款游戏`;
      break;
    default:
      summary = "";
  }

  async function onConfirmCancel() {
    try {
      await cancelBackfill();
      toast.info("已请求取消，当前游戏抓取完毕后停止");
    } catch (e: unknown) {
      toast.error(`取消失败 — ${String(e)}`);
    }
  }

  return (
    <div className="border-b border-line bg-bg-0/95 backdrop-blur">
      <div className="relative h-[2px] w-full bg-bg-2">
        <div
          className="absolute left-0 top-0 h-full transition-[width] duration-300"
          style={{
            width: `${pct}%`,
            background:
              "linear-gradient(90deg, var(--accent), var(--accent-deep))",
          }}
        />
      </div>
      <div className="flex h-10 items-center justify-between px-8">
        <div className="flex min-w-0 items-baseline gap-3">
          <span
            className="truncate font-mono text-[11.5px] text-ink-1"
            title={summary}
          >
            {summary}
          </span>
          {status === "running" ? (
            <span className="font-mono text-[10.5px] text-ink-3">
              {current} / {total} · {pct}%
            </span>
          ) : null}
        </div>
        {status === "running" ? (
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
                <AlertDialogTitle>确定取消补齐？</AlertDialogTitle>
                <AlertDialogDescription>
                  已补齐的游戏会保留；当前正在抓取的会等本游戏完成后停止。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>继续</AlertDialogCancel>
                <AlertDialogAction onClick={() => void onConfirmCancel()}>
                  取消补齐
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </div>
  );
}
