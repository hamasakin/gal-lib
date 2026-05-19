/**
 * RemovedDirs — L9N-02 — Scan 页『已删除条目』区域。
 *
 * 列出所有 scan_roots 下带 `.gal-lib-removed` 标记的目录 —— 这些是用户从库中
 * 删除过的游戏，删除时写了磁盘标记，后续扫描会跳过它们（不会自动加回）。
 * 用户在此区域点「重新添加」即可：删标记 + 把目录作为新条目重新导入库。
 *
 * 挂载时调 `listRemovedDirs()` 填列表；列表为空时显示空态文案。
 * 「重新添加」乐观地从本地列表移除该行，成功 toast、失败 refetch 回滚。
 * 成功后调用 `onRestored?.()` 让父组件刷新 KPI / 触发 games-changed。
 *
 * 容器 / header / 空态样式与 ReviewQueue.tsx 保持一致。
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { listRemovedDirs, restoreRemovedDir } from "@/lib/scanReview";

interface RemovedDirsProps {
  /** 重新添加成功后回调 —— 父组件用来刷新 KPI strip / 触发 games 列表刷新。 */
  onRestored?: () => void;
}

/** 取路径的最后一段（目录名）作为展示用的简短名。 */
function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function RemovedDirs({ onRestored }: RemovedDirsProps) {
  const [dirs, setDirs] = useState<string[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const rows = await listRemovedDirs();
      setDirs(rows);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[RemovedDirs] list failed:", e);
      setDirs([]);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const onRestore = useCallback(
    async (path: string) => {
      setRestoring(path);
      // Optimistic: drop the row before the async returns.
      setDirs((prev) => prev?.filter((d) => d !== path) ?? null);
      try {
        await restoreRemovedDir(path);
        toast.success(`已重新加入「${basename(path)}」`);
        onRestored?.();
      } catch (e: unknown) {
        toast.error(`重新添加失败 — ${String(e)}`);
        // Reconcile — bring the row back if the restore failed.
        await refetch();
      } finally {
        setRestoring(null);
      }
    },
    [onRestored, refetch],
  );

  return (
    <div
      className="flex flex-col border border-line bg-bg-1"
      style={{ borderRadius: "var(--r-md)" }}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
          已删除条目
        </h2>
        <span className="font-mono text-[10px] text-ink-3">
          {dirs?.length ?? "—"} 项
        </span>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        {dirs === null ? (
          <div className="grid place-items-center py-10 font-mono text-[11px] text-ink-3">
            读取中…
          </div>
        ) : dirs.length === 0 ? (
          <div className="grid place-items-center px-6 py-10 text-center font-mono text-[11px] text-ink-3">
            没有被标记删除的目录 —— 删除游戏后可在此恢复
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {dirs.map((path) => {
              const busy = restoring === path;
              return (
                <li
                  key={path}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-bg-2"
                >
                  <Trash2
                    size={14}
                    strokeWidth={1.7}
                    className="flex-shrink-0 text-ink-3"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-ink-0">
                      {basename(path)}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-3">
                      {path}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onRestore(path)}
                    disabled={busy}
                    className={cn(
                      "inline-flex h-7 flex-shrink-0 items-center gap-1.5 border border-line bg-bg-1 px-2.5 text-[11px] text-ink-1 transition-colors hover:border-line-strong hover:text-ink-0",
                      busy && "cursor-not-allowed opacity-60",
                    )}
                    style={{ borderRadius: "var(--r-sm)" }}
                  >
                    {busy ? (
                      <Loader2 size={12} strokeWidth={1.7} className="animate-spin" />
                    ) : (
                      <RotateCcw size={12} strokeWidth={1.7} />
                    )}
                    {busy ? "添加中…" : "重新添加"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
