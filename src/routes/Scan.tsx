/**
 * Scan route — `/scan` — Phase 12 — review-queue centric scan workbench.
 *
 * Layout:
 *   <ScanProgressBar />          ← sticky top (auto-hides post-terminal)
 *   <PageHeader>                  ← breadcrumb · serif H1 · sub · actions
 *     actions: 扫描 / 重新生成待复核队列 / 取消（active 时）
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
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useTauriListen } from "@/hooks/useTauriListen";
import { ListRestart, Search, X } from "lucide-react";
import { PageHeader } from "@/components/library/PageHeader";
import { ScanProgressBar } from "@/components/library/ScanProgressBar";
import { ScanFeed } from "@/components/library/ScanFeed";
import { ReviewQueue } from "@/components/library/ReviewQueue";
import { RemovedDirs } from "@/components/library/RemovedDirs";
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
  const { t } = useTranslation();
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
  }, [refreshKpis]);

  // WR-01 (routes report) + CR-01 (components report) co-fix: use the
  // race-safe useTauriListen hook and let the StrictMode/HMR-aware impl
  // handle subscribe/unsubscribe. The previous .then() pattern leaked the
  // listener if cleanup fired before the listen() Promise resolved.
  useTauriListen<ScanProgress>("scan-progress", (e) => {
    if (
      e.payload.status === "completed" ||
      e.payload.status === "cancelled" ||
      e.payload.status === "failed"
    ) {
      void refreshKpis();
    }
  });

  const onScan = useCallback(async () => {
    try {
      const roots = await listScanRoots();
      if (roots.length === 0) {
        toast.error(t("toast.no_scan_roots"));
        navigate("/settings");
        return;
      }
      await startScan("full");
      toast.info(t("toast.scan_started"));
    } catch (e: unknown) {
      toast.error(t("toast.scan_failed", { err: String(e) }));
    }
  }, [navigate, t]);

  const onCancel = useCallback(async () => {
    try {
      await cancelScan();
      // Quick 260515-cancel — optimistic flip to cancelled so the sticky
      // progress bar starts its short auto-hide right away (instead of
      // waiting for the backend's terminal emit).
      const st = useLibraryStore.getState();
      if (st.scanProgress && st.scanProgress.status === "running") {
        st.setScanProgress({ ...st.scanProgress, status: "cancelled" });
        st.clearFetchingMetaIds();
      }
      toast.info(t("toast.cancel_requested"));
    } catch (e: unknown) {
      toast.error(t("toast.cancel_failed", { err: String(e) }));
    }
  }, [t]);

  const onReseed = useCallback(async () => {
    setReseeding(true);
    try {
      const n = await reseedReviewQueue();
      setReseedSeq((s) => s + 1);
      void refreshKpis();
      toast.success(
        n > 0
          ? t("toast.reseed_success", { count: n })
          : t("toast.reseed_empty"),
      );
    } catch (e: unknown) {
      toast.error(t("toast.reseed_failed", { err: String(e) }));
    } finally {
      setReseeding(false);
    }
  }, [refreshKpis, t]);

  const total = kpis?.total ?? 0;
  const bound = kpis?.bound ?? 0;
  const reviewPending = kpis?.review_pending ?? 0;
  const unmatched = kpis?.unmatched ?? 0;
  const boundPct = total > 0 ? Math.round((bound / total) * 100) : 0;

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      <ScanProgressBar />

      <PageHeader
        crumb={t("scan.crumb")}
        title={
          <>
            <span className="text-brand italic">{reviewPending}</span> {t("scan.title_suffix")}
          </>
        }
        sub={
          total > 0
            ? t("scan.sub.with_total", { total, bound, pct: boundPct, unmatched })
            : t("scan.sub.no_scan")
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => void onScan()}
              disabled={scanRunning}
              className={cn(TOOLBAR_BTN, scanRunning && "cursor-not-allowed opacity-60")}
              style={{ borderRadius: "var(--r-md)" }}
            >
              <Search size={14} strokeWidth={1.7} />
              <span>{t("scan.btn.scan")}</span>
            </button>
            <button
              type="button"
              onClick={() => void onReseed()}
              disabled={reseeding}
              className={cn(TOOLBAR_BTN, reseeding && "cursor-not-allowed opacity-60")}
              style={{ borderRadius: "var(--r-md)" }}
              title={t("scan.btn.reseed_tooltip")}
            >
              <ListRestart size={14} strokeWidth={1.7} />
              <span>{reseeding ? t("scan.btn.reseeding") : t("scan.btn.reseed")}</span>
            </button>
            {scanRunning && (
              <button
                type="button"
                onClick={() => void onCancel()}
                className={TOOLBAR_BTN}
                style={{ borderRadius: "var(--r-md)" }}
              >
                <X size={14} strokeWidth={1.7} />
                <span>{t("scan.btn.cancel")}</span>
              </button>
            )}
          </>
        }
      />

      <div className="px-8 pb-10 pt-6">
        {/* KPI strip */}
        <div className="grid grid-cols-12 gap-4">
          <KpiCard
            label={t("scan.kpi.scanned")}
            value={total}
            unit={t("scan.unit.works")}
            delta={t("scan.kpi.delta.total")}
          />
          <KpiCard
            label={t("scan.kpi.bound")}
            value={bound}
            unit={t("scan.unit.works")}
            delta={
              total > 0
                ? t("scan.kpi.delta.bound_pct", { pct: boundPct })
                : t("scan.kpi.delta.no_bound")
            }
          />
          <KpiCard
            label={t("scan.kpi.review_pending")}
            value={reviewPending}
            unit={t("scan.unit.items")}
            delta={
              unmatched > 0
                ? t("scan.kpi.delta.has_unmatched", { count: unmatched })
                : reviewPending > 0
                  ? t("scan.kpi.delta.need_review")
                  : t("scan.kpi.delta.queue_empty")
            }
            highlight={reviewPending > 0}
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

        {/* L9N-02 — 已删除条目区域（删除后写了 .gal-lib-removed 标记的目录） */}
        <div className="mt-6">
          <RemovedDirs onRestored={() => void refreshKpis()} />
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
        gridColumn: "span 4 / span 4",
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
