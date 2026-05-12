/**
 * Scan route — `/scan` — Phase 12 — review-queue centric scan workbench.
 *
 * Layout:
 *   <ScanProgressBar />          ← sticky top (auto-hides post-terminal)
 *   <PageHeader>                  ← breadcrumb · serif H1 · sub · actions
 *     actions: 增量扫描 / 全量扫描 / 取消（active 时）
 *   <KpiStrip>                    ← 4 KPI cards (12-col grid, span-3 each)
 *   <TwoColumnFeed>               ← grid 12-col: 5 (feed) + 7 (queue)
 *     <ScanFeed />                  ← rolling 200-line live log (left)
 *     <ReviewQueue />               ← persistent review queue (right)
 *
 * State refresh:
 *   - KPI fetched on mount + after scan-progress terminal events + after
 *     ReviewQueue onMutated callback (accept/dismiss).
 *
 * Routing-export note: router.tsx uses `import Scan from "./Scan"` — keep
 * the DEFAULT export.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { ListRestart, RefreshCw, Search, X } from "lucide-react";
import { PageHeader } from "@/components/library/PageHeader";
import { ScanProgressBar } from "@/components/library/ScanProgressBar";
import { ScanFeed } from "@/components/library/ScanFeed";
import { ReviewQueue } from "@/components/library/ReviewQueue";
import {
  cancelScan,
  getScanKpis,
  listScanRoots,
  startScan,
  type ScanKpis,
  type ScanProgress,
} from "@/lib/scan";
import { reseedReviewQueue } from "@/lib/scanReview";
import { cn } from "@/lib/utils";
import { useLibraryStore } from "@/store/library";

const TOOLBAR_BTN =
  "inline-flex h-8 items-center gap-2 border border-line bg-bg-1 px-3.5 text-[12.5px] text-ink-1 transition-colors hover:border-line-strong hover:bg-bg-2 hover:text-ink-0";

export default function Scan() {
  const navigate = useNavigate();
  const scanProgress = useLibraryStore((s) => s.scanProgress);
  const scanRunning = scanProgress?.status === "running";
  const [kpis, setKpis] = useState<ScanKpis | null>(null);
  // Quick 20260512c — bumped on every reseed to force ReviewQueue to refetch
  // (reseed doesn't emit scan-progress / meta-fetch-progress events, so the
  // queue's existing event-driven debounced refresh wouldn't pick it up).
  const [reseedSeq, setReseedSeq] = useState(0);
  const [reseeding, setReseeding] = useState(false);

  const refreshKpis = useCallback(async () => {
    try {
      const k = await getScanKpis();
      setKpis(k);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[Scan] getScanKpis failed:", e);
    }
  }, []);

  useEffect(() => {
    void refreshKpis();
    let unlisten: UnlistenFn | null = null;
    listen<ScanProgress>("scan-progress", (e) => {
      if (
        e.payload.status === "completed" ||
        e.payload.status === "cancelled" ||
        e.payload.status === "failed"
      ) {
        void refreshKpis();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [refreshKpis]);

  const onScan = useCallback(
    async (mode: "incremental" | "full") => {
      try {
        const roots = await listScanRoots();
        if (roots.length === 0) {
          toast.error("还没有扫描根目录 — 请先到设置页添加");
          navigate("/settings");
          return;
        }
        await startScan(mode);
        toast.info(mode === "full" ? "已开始全量重扫" : "已开始增量扫描");
      } catch (e: unknown) {
        toast.error(`扫描失败 — ${String(e)}`);
      }
    },
    [navigate],
  );

  const onCancel = useCallback(async () => {
    try {
      await cancelScan();
      toast.info("已发送取消请求");
    } catch (e: unknown) {
      toast.error(`取消失败 — ${String(e)}`);
    }
  }, []);

  const onReseed = useCallback(async () => {
    setReseeding(true);
    try {
      const n = await reseedReviewQueue();
      setReseedSeq((s) => s + 1);
      void refreshKpis();
      toast.success(
        n > 0
          ? `已把 ${n} 部未匹配/低置信度游戏放入复核队列`
          : "没有需要复核的游戏（库里都已绑定）",
      );
    } catch (e: unknown) {
      toast.error(`回灌失败 — ${String(e)}`);
    } finally {
      setReseeding(false);
    }
  }, [refreshKpis]);

  const total = kpis?.total ?? 0;
  const bound = kpis?.bound ?? 0;
  const reviewPending = kpis?.review_pending ?? 0;
  const unmatched = kpis?.unmatched ?? 0;
  const boundPct = total > 0 ? Math.round((bound / total) * 100) : 0;

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      <ScanProgressBar />

      <PageHeader
        crumb="扫描 / SCAN"
        title={
          <>
            <span className="text-brand italic">{reviewPending}</span> 项等待复核
          </>
        }
        sub={
          total > 0
            ? `共 ${total} 部作品 · 已绑定 ${bound} 部（${boundPct}%）· 无匹配 ${unmatched} 部`
            : "尚未扫描 — 先到设置页添加根目录"
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => void onScan("incremental")}
              disabled={scanRunning}
              className={cn(TOOLBAR_BTN, scanRunning && "cursor-not-allowed opacity-60")}
              style={{ borderRadius: "var(--r-md)" }}
            >
              <RefreshCw size={14} strokeWidth={1.7} />
              <span>增量扫描</span>
            </button>
            <button
              type="button"
              onClick={() => void onScan("full")}
              disabled={scanRunning}
              className={cn(TOOLBAR_BTN, scanRunning && "cursor-not-allowed opacity-60")}
              style={{ borderRadius: "var(--r-md)" }}
            >
              <Search size={14} strokeWidth={1.7} />
              <span>全量重扫</span>
            </button>
            <button
              type="button"
              onClick={() => void onReseed()}
              disabled={reseeding}
              className={cn(TOOLBAR_BTN, reseeding && "cursor-not-allowed opacity-60")}
              style={{ borderRadius: "var(--r-md)" }}
              title="把所有未匹配 / 低置信度的游戏一次性加入复核队列（包含历史老库 unmatched 项）"
            >
              <ListRestart size={14} strokeWidth={1.7} />
              <span>{reseeding ? "回灌中…" : "重新生成待复核队列"}</span>
            </button>
            {scanRunning && (
              <button
                type="button"
                onClick={() => void onCancel()}
                className={TOOLBAR_BTN}
                style={{ borderRadius: "var(--r-md)" }}
              >
                <X size={14} strokeWidth={1.7} />
                <span>取消</span>
              </button>
            )}
          </>
        }
      />

      <div className="px-8 pb-10 pt-6">
        {/* KPI strip */}
        <div className="grid grid-cols-12 gap-4">
          <KpiCard label="已扫游戏" value={total} unit="部" delta="入库总数" />
          <KpiCard
            label="已绑定"
            value={bound}
            unit="部"
            delta={total > 0 ? `${boundPct}% · 含 manual 绑定` : "暂无绑定"}
          />
          <KpiCard
            label="待复核"
            value={reviewPending}
            unit="项"
            delta={reviewPending > 0 ? "需要人工确认" : "队列已清空"}
            highlight={reviewPending > 0}
          />
          <KpiCard
            label="无匹配"
            value={unmatched}
            unit="部"
            delta={unmatched > 0 ? "Bangumi/VNDB 都未命中" : "全部命中"}
            tone="muted"
          />
        </div>

        {/* Two-column feed (5 + 7 of 12) */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <ScanFeed />
          </div>
          <div className="lg:col-span-7">
            <ReviewQueue
              reseedSeq={reseedSeq}
              onMutated={() => void refreshKpis()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  unit,
  delta,
  highlight,
  tone,
}: {
  label: string;
  value: number;
  unit: string;
  delta?: string;
  highlight?: boolean;
  tone?: "muted";
}) {
  return (
    <div
      className={cn(
        "border bg-bg-1 p-5",
        highlight ? "border-brand/40" : "border-line",
      )}
      style={{
        gridColumn: "span 3 / span 3",
        borderRadius: "var(--r-md)",
      }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
        {label}
      </div>
      <div className="mt-2 font-serif text-[30px] leading-[1.1] text-ink-0">
        {value}
        <span className="ml-1 font-mono text-[12px] text-ink-2">{unit}</span>
      </div>
      {delta && (
        <div
          className={cn(
            "mt-1 font-mono text-[10.5px]",
            tone === "muted"
              ? "text-ink-3"
              : highlight
                ? "text-brand"
                : "text-ink-2",
          )}
        >
          {delta}
        </div>
      )}
    </div>
  );
}
