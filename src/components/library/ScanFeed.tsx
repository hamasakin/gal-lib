/**
 * ScanFeed — Phase 12 — rolling live log of scan + meta-fetch events.
 *
 * Left column of the /scan page. Subscribes to the two existing event streams
 * (`scan-progress` from start_scan/refresh_all_metadata; `meta-fetch-progress`
 * from per-game ingest/bind/refresh paths) and maintains a local rolling
 * buffer of the latest 200 lines. No persistence — this is a session-only
 * log; restarting the app clears it.
 *
 * Format: `[hh:mm:ss] <icon> <message>` rendered as mono 11px lines, newest
 * on top. Each line is plain text — no actions, no click handlers — so the
 * feed stays predictable when 100+ lines stream by during a full rescan.
 */

import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ScanProgress } from "@/lib/scan";
import { useLibraryStore } from "@/store/library";

const BUFFER_CAP = 200;

interface FeedLine {
  /** Stable key — `${perf.now()}-${seq}` works because `perf.now()` is
   *  monotonic within a session. Used by React's reconciler. */
  key: string;
  /** Pre-formatted hh:mm:ss prefix. */
  time: string;
  /** Body text — the event description. */
  body: string;
  /** Severity controls the dot color. */
  variant: "scan" | "meta" | "terminal";
}

function fmtTime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function ScanFeed() {
  const [lines, setLines] = useState<FeedLine[]>([]);
  const seqRef = useRef(0);
  const games = useLibraryStore((s) => s.games);

  // game_id → display name (best-effort; meta-fetch-progress only carries id).
  // Looking this up at render time would re-render the whole feed on every
  // games[] update; instead pre-resolve at push time so the line is immutable.
  const idToName = useRef(new Map<number, string>());
  useEffect(() => {
    const m = new Map<number, string>();
    for (const g of games) m.set(g.id, g.name_cn || g.name);
    idToName.current = m;
  }, [games]);

  useEffect(() => {
    let unlistenScan: UnlistenFn | null = null;
    let unlistenMeta: UnlistenFn | null = null;

    const push = (line: Omit<FeedLine, "key" | "time">) => {
      seqRef.current += 1;
      const key = `${performance.now()}-${seqRef.current}`;
      const time = fmtTime(new Date());
      setLines((prev) => {
        const next = [{ key, time, ...line }, ...prev];
        return next.length > BUFFER_CAP ? next.slice(0, BUFFER_CAP) : next;
      });
    };

    listen<ScanProgress>("scan-progress", (e) => {
      const { current_dir, completed, total, status } = e.payload;
      switch (status) {
        case "running":
          if (current_dir) {
            push({
              body: `扫描中 · ${completed}/${total} · ${current_dir}`,
              variant: "scan",
            });
          }
          break;
        case "completed":
          push({
            body: `扫描完成 · 共 ${total} 款`,
            variant: "terminal",
          });
          break;
        case "cancelled":
          push({ body: "扫描已取消", variant: "terminal" });
          break;
        case "failed":
          push({ body: "扫描失败", variant: "terminal" });
          break;
      }
    }).then((fn) => {
      unlistenScan = fn;
    });

    listen<{ game_id: number; phase: "started" | "finished" }>(
      "meta-fetch-progress",
      (e) => {
        const { game_id, phase } = e.payload;
        const name = idToName.current.get(game_id) ?? `游戏 #${game_id}`;
        push({
          body:
            phase === "started"
              ? `抓取元数据 · ${name}`
              : `抓取完成 · ${name}`,
          variant: "meta",
        });
      },
    ).then((fn) => {
      unlistenMeta = fn;
    });

    return () => {
      unlistenScan?.();
      unlistenMeta?.();
    };
  }, []);

  return (
    <div className="flex h-full min-h-[420px] flex-col border border-line bg-bg-1" style={{ borderRadius: "var(--r-md)" }}>
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
          实时日志
        </h2>
        <span className="font-mono text-[10px] text-ink-3">
          {lines.length} / {BUFFER_CAP}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: "thin" }}>
        {lines.length === 0 ? (
          <div className="grid h-full place-items-center font-mono text-[11px] text-ink-3">
            等待扫描事件…
          </div>
        ) : (
          <ul className="space-y-1">
            {lines.map((l) => (
              <li key={l.key} className="flex items-baseline gap-2 font-mono text-[11px] leading-snug">
                <span className="text-ink-3 tabular-nums">{l.time}</span>
                <span
                  aria-hidden
                  className={
                    l.variant === "scan"
                      ? "mt-[5px] inline-block h-1.5 w-1.5 flex-shrink-0 bg-brand"
                      : l.variant === "meta"
                        ? "mt-[5px] inline-block h-1.5 w-1.5 flex-shrink-0 bg-ink-2"
                        : "mt-[5px] inline-block h-1.5 w-1.5 flex-shrink-0 bg-ink-stamp"
                  }
                  style={{ borderRadius: "var(--r-sm)" }}
                />
                <span className="flex-1 break-all text-ink-1">{l.body}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
