/**
 * ReviewQueue — Phase 12 — persistent review-queue list with Bangumi vs VNDB
 * side-by-side candidate compare.
 *
 * Right column of the /scan page. Mount + post-event refresh of
 * `list_scan_review_queue`; expanding a card lazily fetches
 * `fetch_review_candidates` (top-1 per source). User actions:
 *   - "采用 Bangumi" / "采用 VNDB" → acceptReviewCandidate (auto rebinds via
 *     bind_metadata; queue row cleared by the IPC).
 *   - "手工绑定…"               → opens existing MetadataPicker.
 *   - "不再提示"                → dismissReviewItem.
 *
 * Optimistic update: on accept/dismiss, the row is removed locally before
 * the async returns; a refetch reconciles.
 *
 * Cover thumbnail uses the same `convertFileSrc + ?v=last_scanned_at`
 * cache-buster as GameGrid (quick task 20260512). Without dataDir resolved
 * we render the lucide ImageOff fallback.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useTauriListen } from "@/hooks/useTauriListen";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  ImageOff,
  Loader2,
  Settings2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { listGames, type Game } from "@/lib/games";
import { useLibraryStore } from "@/store/library";
import { MetadataPicker } from "@/components/library/MetadataPicker";
import {
  acceptReviewCandidate,
  dismissReviewItem,
  fetchReviewCandidates,
  listScanReviewQueue,
  type ReviewCandidates,
  type ReviewItem,
} from "@/lib/scanReview";
import type { Candidate } from "@/lib/metadata";

interface ReviewQueueProps {
  /** Called after accept / dismiss completes so the parent can refresh the
   *  KPI strip (and any sidebar pulse-dot). */
  onMutated?: () => void;
  /** Quick 20260512c — bumped by the parent after a reseed_review_queue IPC
   *  so the queue refetches even though reseed doesn't emit scan-progress
   *  events. Optional; omit for non-Scan-page mounts. */
  reseedSeq?: number;
}

export function ReviewQueue({ onMutated, reseedSeq }: ReviewQueueProps) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<ReviewCandidates | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [picker, setPicker] = useState<Game | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const games = useLibraryStore((s) => s.games);
  const setGames = useLibraryStore((s) => s.setGames);

  const gameMap = useMemo(() => {
    const m = new Map<number, Game>();
    for (const g of games) m.set(g.id, g);
    return m;
  }, [games]);

  useEffect(() => {
    invoke<string>("get_data_dir")
      .then(setDataDir)
      .catch(() => setDataDir(null));
  }, []);

  const refetch = useCallback(async () => {
    try {
      const rows = await listScanReviewQueue();
      setItems(rows);
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.error("[ReviewQueue] list failed:", e);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Refetch on scan / meta events that may mutate the queue (ingest enqueues,
  // bind/refresh dequeue). Throttle with a 600 ms tail so a 200-game backfill
  // doesn't refetch 400 times. The timer ref persists across the two listens
  // so they share one debounce window.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );
  const debounced = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void refetch();
    }, 600);
  }, [refetch]);

  useTauriListen("scan-progress", debounced);
  useTauriListen("meta-fetch-progress", debounced);

  // Quick 20260512c — refetch on reseedSeq bump (parent just called reseed
  // IPC). Skip the initial mount value (handled by the effect above).
  useEffect(() => {
    if (reseedSeq === undefined || reseedSeq === 0) return;
    void refetch();
  }, [reseedSeq, refetch]);

  const expand = useCallback(
    async (id: number) => {
      if (expandedId === id) {
        setExpandedId(null);
        setCandidates(null);
        return;
      }
      setExpandedId(id);
      setCandidates(null);
      setLoadingCandidates(true);
      try {
        const c = await fetchReviewCandidates(id);
        setCandidates(c);
      } catch (e: unknown) {
        toast.error(`拉取候选失败 — ${String(e)}`);
        setCandidates({ bangumi: null, vndb: null });
      } finally {
        setLoadingCandidates(false);
      }
    },
    [expandedId],
  );

  const onAccept = useCallback(
    async (gameId: number, source: "bangumi" | "vndb", sourceId: string) => {
      // Optimistic: drop the row + collapse + clear candidates.
      setItems((prev) => prev?.filter((x) => x.game_id !== gameId) ?? null);
      if (expandedId === gameId) {
        setExpandedId(null);
        setCandidates(null);
      }
      try {
        await acceptReviewCandidate(gameId, source, sourceId);
        toast.success(`已采用 ${source === "bangumi" ? "Bangumi" : "VNDB"} 元数据`);
        // Reconcile both queue + games list (rebind changes name/cover).
        await refetch();
        try {
          const fresh = await listGames();
          setGames(fresh);
        } catch {
          /* non-fatal */
        }
        onMutated?.();
      } catch (e: unknown) {
        toast.error(`绑定失败 — ${String(e)}`);
        await refetch();
      }
    },
    [expandedId, refetch, setGames, onMutated],
  );

  const onDismiss = useCallback(
    async (gameId: number) => {
      setItems((prev) => prev?.filter((x) => x.game_id !== gameId) ?? null);
      if (expandedId === gameId) {
        setExpandedId(null);
        setCandidates(null);
      }
      try {
        await dismissReviewItem(gameId);
        onMutated?.();
      } catch (e: unknown) {
        toast.error(`移除失败 — ${String(e)}`);
        await refetch();
      }
    },
    [expandedId, refetch, onMutated],
  );

  const resolveCover = useCallback(
    (item: ReviewItem): string | null => {
      if (!item.cover_path || !dataDir) return null;
      const abs = `${dataDir.replace(/\\/g, "/")}/${item.cover_path}`;
      // Cache-buster (quick 20260512) — last_scanned_at not present on the
      // queue row; use created_at as a stable suffix (re-enqueue resets).
      return `${convertFileSrc(abs)}?v=${encodeURIComponent(item.created_at)}`;
    },
    [dataDir],
  );

  return (
    <div
      className="flex h-full max-h-[calc(100vh-280px)] min-h-[420px] flex-col border border-line bg-bg-1"
      style={{ borderRadius: "var(--r-md)" }}
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
          待复核
        </h2>
        <span className="font-mono text-[10px] text-ink-3">
          {items?.length ?? "—"} 项
        </span>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        {items === null ? (
          <div className="grid h-full place-items-center font-mono text-[11px] text-ink-3">
            读取中…
          </div>
        ) : items.length === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center font-mono text-[11px] text-ink-3">
            队列为空 —— 扫描后置信度 &lt; 80 的游戏会出现在这里
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((it) => {
              const expanded = expandedId === it.game_id;
              const cover = resolveCover(it);
              const name = it.name ?? it.game_path.split(/[\\/]/).pop() ?? `游戏 #${it.game_id}`;
              return (
                <li key={it.game_id}>
                  <button
                    type="button"
                    onClick={() => void expand(it.game_id)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                      expanded ? "bg-bg-2" : "hover:bg-bg-2",
                    )}
                  >
                    <div
                      className="relative h-16 w-12 flex-shrink-0 overflow-hidden border border-line bg-bg-2"
                      style={{ borderRadius: "var(--r-sm)" }}
                    >
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageOff size={16} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-ink-3" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-ink-0">{name}</div>
                      <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-3">
                        {it.game_path}
                      </div>
                    </div>
                    <ConfidencePill confidence={it.current_confidence} source={it.current_source} />
                    {expanded ? (
                      <ChevronUp size={16} className="text-ink-3" />
                    ) : (
                      <ChevronDown size={16} className="text-ink-3" />
                    )}
                  </button>

                  {expanded && (
                    <ExpandedCompare
                      item={it}
                      candidates={candidates}
                      loading={loadingCandidates}
                      onAccept={(src, sid) => void onAccept(it.game_id, src, sid)}
                      onDismiss={() => void onDismiss(it.game_id)}
                      onManual={() => {
                        const g = gameMap.get(it.game_id);
                        if (g) setPicker(g);
                        else toast.error("游戏数据未加载，请先回到图书馆刷新一次");
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <MetadataPicker
        game={picker}
        onClose={() => {
          setPicker(null);
          // After picker closes, the queue may need refresh (bind cleared row).
          void refetch();
          onMutated?.();
        }}
      />
    </div>
  );
}

function ConfidencePill({
  confidence,
  source,
}: {
  confidence: number;
  source: string | null;
}) {
  // 0 = no match at all (source='none'); 1..79 = low; ≥80 wouldn't be here.
  const noMatch = !source || source === "none" || confidence <= 0;
  const tone = noMatch
    ? "border-destructive/40 text-destructive"
    : "border-line text-ink-2";
  const label = noMatch ? "无匹配" : `${confidence}%`;
  return (
    <span
      className={cn(
        "border px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
        tone,
      )}
      style={{ borderRadius: "var(--r-sm)" }}
    >
      {label}
    </span>
  );
}

function ExpandedCompare({
  item,
  candidates,
  loading,
  onAccept,
  onDismiss,
  onManual,
}: {
  item: ReviewItem;
  candidates: ReviewCandidates | null;
  loading: boolean;
  onAccept: (source: "bangumi" | "vndb", sourceId: string) => void;
  onDismiss: () => void;
  onManual: () => void;
}) {
  return (
    <div className="space-y-4 border-t border-line bg-bg-1 px-4 py-4">
      {loading ? (
        <div className="grid place-items-center py-8 font-mono text-[11px] text-ink-3">
          <Loader2 size={16} className="animate-spin" />
          <span className="mt-2">拉取双源候选…</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <CandidateCard
            source="bangumi"
            label="Bangumi"
            candidate={candidates?.bangumi ?? null}
            onAccept={(sid) => onAccept("bangumi", sid)}
          />
          <CandidateCard
            source="vndb"
            label="VNDB"
            candidate={candidates?.vndb ?? null}
            onAccept={(sid) => onAccept("vndb", sid)}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line pt-3 font-mono text-[10.5px] text-ink-3">
        <span>入队 {item.created_at.slice(0, 19).replace("T", " ")}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onManual}
            className="inline-flex items-center gap-1.5 border border-line bg-bg-1 px-2.5 py-1 text-[11px] text-ink-1 transition-colors hover:border-line-strong hover:text-ink-0"
            style={{ borderRadius: "var(--r-sm)" }}
          >
            <Settings2 size={12} strokeWidth={1.7} />
            手工绑定…
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center gap-1.5 border border-line bg-bg-1 px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-destructive/50 hover:text-destructive"
            style={{ borderRadius: "var(--r-sm)" }}
          >
            <X size={12} strokeWidth={1.7} />
            不再提示
          </button>
        </div>
      </div>
    </div>
  );
}

function CandidateCard({
  source,
  label,
  candidate,
  onAccept,
}: {
  source: "bangumi" | "vndb";
  label: string;
  candidate: Candidate | null;
  onAccept: (sourceId: string) => void;
}) {
  if (!candidate) {
    return (
      <div
        className="flex h-full flex-col border border-dashed border-line bg-bg-2/60 p-3"
        style={{ borderRadius: "var(--r-sm)" }}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          {label}
        </div>
        <div className="mt-3 flex flex-1 items-center justify-center font-mono text-[11px] text-ink-3">
          未找到匹配
        </div>
      </div>
    );
  }
  const summary = candidate.summary?.slice(0, 200) ?? "";
  const externalUrl =
    source === "bangumi"
      ? `https://bgm.tv/subject/${candidate.source_id}`
      : `https://vndb.org/${candidate.source_id}`;
  return (
    <div
      className="flex flex-col border border-line bg-bg-1 p-3"
      style={{ borderRadius: "var(--r-sm)" }}
    >
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
          {label}
        </div>
        <span className="font-mono text-[10px] tabular-nums text-ink-3">
          conf {candidate.confidence}
        </span>
      </div>

      <div className="mt-2 flex gap-3">
        <div
          className="relative h-20 w-[60px] flex-shrink-0 overflow-hidden border border-line bg-bg-2"
          style={{ borderRadius: "var(--r-sm)" }}
        >
          {candidate.cover_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={candidate.cover_url}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            // CR-04 fix: parent needs `relative` and the icon needs an
            // anchor (`left-1/2 top-1/2`) before the translate-centring
            // works. Without this the icon was positioned against some
            // ancestor and rendered off-card.
            <ImageOff
              size={14}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-ink-3"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[14px] leading-snug text-ink-0">
            {candidate.title}
          </div>
          {candidate.alias.length > 0 && (
            <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-3">
              {candidate.alias.slice(0, 3).join(" · ")}
            </div>
          )}
          {candidate.release_date && (
            <div className="mt-0.5 font-mono text-[10.5px] text-ink-3">
              {candidate.release_date}
            </div>
          )}
        </div>
      </div>

      {summary && (
        <p className="mt-2 line-clamp-3 text-[12px] leading-snug text-ink-1">
          {summary}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[10.5px] text-ink-3 transition-colors hover:text-ink-0"
        >
          <ExternalLink size={11} strokeWidth={1.6} />
          {candidate.source_id}
        </a>
        <button
          type="button"
          onClick={() => onAccept(candidate.source_id)}
          className="inline-flex h-7 items-center gap-1.5 bg-brand px-3 text-[11px] font-medium text-brand-on transition-opacity hover:opacity-90"
          style={{ borderRadius: "var(--r-sm)" }}
        >
          采用 {label}
        </button>
      </div>
    </div>
  );
}
