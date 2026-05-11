/**
 * Phase 13 (PER-03) — CoStaffStrip
 *
 * Horizontal scroll strip on `/persons/:id` showing other persons who often
 * appear alongside the target. Click navigates to that person's page.
 *
 * Layout: compact card — 40px round avatar fallback (text monogram, replaced
 * by portrait in 13d) + name + count chip + role hint subtitle.
 *
 * Empty results (no co-occurring person with coshare >= 2) → component
 * renders nothing.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  getOrFetchPortrait,
  listCoStaffForPerson,
  type CoStaffRow,
  type StaffRole,
} from "@/lib/persons";

interface CoStaffStripProps {
  personId: number;
  limit?: number;
}

const ROLE_HINT_LABELS: Record<StaffRole, string> = {
  scenario: "编剧",
  artist: "原画",
  voice: "声优",
  music: "音乐",
};

/** Two-letter monogram from the most-readable name field. */
function monogram(row: CoStaffRow): string {
  const src = row.name_cn ?? row.name ?? "?";
  const chars = src.replace(/\s+/g, " ").trim();
  if (!chars) return "?";
  return chars.slice(0, 1).toUpperCase();
}

export function CoStaffStrip({ personId, limit }: CoStaffStripProps) {
  const [rows, setRows] = useState<CoStaffRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dataDir, setDataDir] = useState<string | null>(null);
  // Map of `${source}-${source_id}` → resolved cover URL (or null when miss).
  const [portraits, setPortraits] = useState<Record<string, string | null>>({});

  useEffect(() => {
    invoke<string>("get_data_dir").then(setDataDir).catch(() => {});
  }, []);

  useEffect(() => {
    if (!Number.isFinite(personId)) return;
    let cancelled = false;
    listCoStaffForPerson(personId, limit)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(String(e));
          setRows([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [personId, limit]);

  // Portrait fire-and-forget per row. Bangumi 1 req/s + cache-first means
  // first visit drips in, subsequent visits hit disk immediately. We honor
  // the limiter at the Rust layer; here we just issue requests in order.
  useEffect(() => {
    if (!rows || !dataDir) return;
    let cancelled = false;
    (async () => {
      for (const row of rows) {
        const key = `${row.source}-${row.source_id}`;
        // Skip if already resolved (or in-flight from a previous render).
        if (key in portraits) continue;
        try {
          const rel = await getOrFetchPortrait(row.source, row.source_id);
          if (cancelled) return;
          setPortraits((prev) => ({ ...prev, [key]: rel }));
        } catch {
          if (!cancelled) setPortraits((prev) => ({ ...prev, [key]: null }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, dataDir]);

  // Suppress error display — co-staff is a non-critical adornment.
  void error;

  if (!rows || rows.length === 0) return null;

  return (
    <section className="mb-10">
      <header className="mb-3 flex items-baseline justify-between border-b border-line pb-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-1">
          常与 · 共同出现
        </span>
        <span className="font-mono text-[10.5px] text-ink-3">
          {rows.length} 位
        </span>
      </header>
      <div
        className="flex gap-3.5 overflow-x-auto pb-2"
        style={{ scrollSnapType: "x proximity", scrollbarWidth: "thin" }}
      >
        {rows.map((row) => {
          const key = `${row.source}-${row.source_id}`;
          const rel = portraits[key];
          const src =
            rel && dataDir
              ? convertFileSrc(`${dataDir.replace(/\\/g, "/")}/${rel}`)
              : null;
          return (
          <Link
            key={row.person_id}
            to={`/persons/${row.person_id}`}
            className="group flex w-[160px] shrink-0 items-center gap-2.5 rounded border border-line bg-surface px-2.5 py-2 transition-colors hover:border-brand/60 hover:bg-brand-soft/40"
            style={{ scrollSnapAlign: "start" }}
          >
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-3/15 font-serif text-[13px] text-ink-1 ring-1 ring-line group-hover:ring-brand/40">
              {src ? (
                <img
                  src={src}
                  alt={row.name_cn ?? row.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                monogram(row)
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-serif text-[12.5px] text-ink-1">
                {row.name_cn ?? row.name}
              </span>
              <span className="flex items-baseline gap-1.5 font-mono text-[10px] text-ink-3">
                <span>
                  {row.role_hint
                    ? ROLE_HINT_LABELS[row.role_hint]
                    : row.source.toUpperCase()}
                </span>
                <span className="rounded bg-brand-soft px-1 text-[10px] text-brand">
                  共 {row.coshare}
                </span>
              </span>
            </div>
          </Link>
        );
        })}
      </div>
    </section>
  );
}
