/**
 * FilterPanel — supplementary §6 advanced filter popover.
 *
 * Toolbar trigger button → 320px popover with grouped sections:
 *   - 状态 (multi-status, "只看待复核" toggle)
 *   - 评分范围 (1..10 dual-bound numeric, no slider widget yet — uses two
 *     compact mono inputs to keep the panel under one screen)
 *   - 发行年份 (chip multi-select, derived from current games' release_year set)
 *   - 累计时长 (5 bucket multi-select)
 *   - 重置 / 应用
 *
 * The panel is uncontrolled w.r.t. parent until "应用" — keeps draft state
 * local so users can scrub the rating range without firing N renders.
 *
 * Tag include/exclude (the design's ±tag picker) is omitted: backend
 * `SearchFilter` is single-tag and Game rows don't carry tag membership.
 * See lib/advancedFilter.ts for the rationale.
 */

import { useEffect, useMemo, useState } from "react";
import { ListFilter, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type AdvancedFilter,
  type DurationBucket,
  countActiveSlices,
  EMPTY_ADV_FILTER,
} from "@/lib/advancedFilter";
import type { Game } from "@/lib/games";

interface FilterPanelProps {
  games: Game[];
  filter: AdvancedFilter;
  onChange: (next: AdvancedFilter) => void;
}

const STATUS_OPTIONS: Array<{ value: Game["status"]; label: string }> = [
  { value: "playing", label: "游玩中" },
  { value: "cleared", label: "已通关" },
  { value: "unplayed", label: "未开始" },
  { value: "dropped", label: "弃坑" },
];

const DURATION_OPTIONS: Array<{ value: DurationBucket; label: string }> = [
  { value: "none", label: "未游玩" },
  { value: "lt1h", label: "< 1 h" },
  { value: "h1to10", label: "1–10 h" },
  { value: "h10to50", label: "10–50 h" },
  { value: "h50plus", label: "50 h+" },
];

function cloneFilter(f: AdvancedFilter): AdvancedFilter {
  return {
    statuses: new Set(f.statuses),
    ratingMin: f.ratingMin,
    ratingMax: f.ratingMax,
    years: new Set(f.years),
    durations: new Set(f.durations),
    reviewOnly: f.reviewOnly,
  };
}

export function FilterPanel({ games, filter, onChange }: FilterPanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AdvancedFilter>(() => cloneFilter(filter));

  // Reset draft to current applied filter every time the popover opens, so
  // users see the same state they're observing in the grid.
  useEffect(() => {
    if (open) setDraft(cloneFilter(filter));
  }, [open, filter]);

  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    for (const g of games) if (g.release_year != null) years.add(g.release_year);
    return Array.from(years).sort((a, b) => b - a);
  }, [games]);

  const activeCount = countActiveSlices(filter);

  function toggleSet<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  function apply() {
    onChange(draft);
    setOpen(false);
  }

  function reset() {
    const empty = cloneFilter(EMPTY_ADV_FILTER);
    setDraft(empty);
    onChange(empty);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 border px-3 font-mono text-[11px] transition-colors",
            activeCount > 0
              ? "border-brand bg-brand-soft text-ink-0"
              : "border-line bg-bg-1 text-ink-1 hover:border-line-strong hover:bg-bg-2 hover:text-ink-0",
          )}
          style={{ borderRadius: "9999px" }}
          aria-label="高级筛选"
          title="高级筛选"
        >
          <ListFilter size={12} strokeWidth={1.7} />
          <span>筛选</span>
          {activeCount > 0 && (
            <span
              className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center bg-brand px-1 text-[9.5px] text-[var(--accent-on)]"
              style={{ borderRadius: 999 }}
            >
              {activeCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn(
          "z-50 flex w-[320px] flex-col gap-0 border border-line-strong bg-bg-1/95 p-0 shadow-lift backdrop-blur-md",
        )}
        style={{ borderRadius: "var(--r-md)" }}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="font-serif text-[14px] text-ink-0">筛选</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
              客户端二次过滤 · {games.length} 部
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="关闭"
            className="grid h-6 w-6 place-items-center rounded-sm text-ink-3 hover:bg-bg-2 hover:text-ink-0"
          >
            <X size={12} />
          </button>
        </header>

        <div className="flex flex-col divide-y divide-line overflow-y-auto px-4 max-h-[480px]">
          {/* 状态 */}
          <Section label="状态">
            <div className="flex flex-col gap-1.5">
              {STATUS_OPTIONS.map(({ value, label }) => (
                <CheckRow
                  key={value}
                  label={label}
                  on={draft.statuses.has(value)}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      statuses: toggleSet(draft.statuses, value),
                    })
                  }
                />
              ))}
              <CheckRow
                label="只看待复核"
                accent
                on={draft.reviewOnly}
                onClick={() =>
                  setDraft({ ...draft, reviewOnly: !draft.reviewOnly })
                }
              />
            </div>
          </Section>

          {/* 评分范围 */}
          <Section label="评分范围">
            <div className="flex items-center gap-2">
              <RatingInput
                value={draft.ratingMin}
                placeholder="≥"
                onChange={(v) => setDraft({ ...draft, ratingMin: v })}
              />
              <span className="font-mono text-[10px] text-ink-3">…</span>
              <RatingInput
                value={draft.ratingMax}
                placeholder="≤"
                onChange={(v) => setDraft({ ...draft, ratingMax: v })}
              />
              <span className="font-mono text-[10px] text-ink-3">/ 10</span>
            </div>
          </Section>

          {/* 发行年份 */}
          {yearOptions.length > 0 && (
            <Section label="发行年份">
              <div className="flex flex-wrap gap-1.5">
                {yearOptions.map((y) => {
                  const on = draft.years.has(y);
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() =>
                        setDraft({ ...draft, years: toggleSet(draft.years, y) })
                      }
                      className={cn(
                        "h-6 px-2 font-mono text-[10.5px] transition-colors",
                        on
                          ? "border border-brand bg-brand-soft text-ink-0"
                          : "border border-line bg-bg-2 text-ink-1 hover:border-line-strong",
                      )}
                      style={{ borderRadius: "var(--r-sm)" }}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          {/* 累计时长 */}
          <Section label="累计时长">
            <div className="flex flex-col gap-1.5">
              {DURATION_OPTIONS.map(({ value, label }) => (
                <CheckRow
                  key={value}
                  label={label}
                  on={draft.durations.has(value)}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      durations: toggleSet(draft.durations, value),
                    })
                  }
                />
              ))}
            </div>
          </Section>
        </div>

        <footer className="flex items-center justify-between border-t border-line bg-bg-0 px-4 py-3">
          <button
            type="button"
            onClick={reset}
            className="font-mono text-[10.5px] text-ink-3 hover:text-ink-0"
          >
            重置
          </button>
          <button
            type="button"
            onClick={apply}
            className="inline-flex h-8 items-center px-4 text-[12px] font-medium text-[var(--accent-on)]"
            style={{
              background: "var(--accent)",
              borderRadius: "var(--r-md)",
            }}
          >
            应用筛选
          </button>
        </footer>
      </PopoverContent>
    </Popover>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-3">
      <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">
        {label}
      </div>
      {children}
    </section>
  );
}

function CheckRow({
  label,
  on,
  accent,
  onClick,
}: {
  label: string;
  on: boolean;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="checkbox"
      aria-checked={on}
      className={cn(
        "flex items-center gap-2 py-1 text-left text-[12.5px] transition-colors",
        accent ? "text-[#ffd166]" : "text-ink-1",
        "hover:text-ink-0",
      )}
    >
      <span
        aria-hidden
        className="grid h-[14px] w-[14px] place-items-center"
        style={{
          borderRadius: 3,
          border: on
            ? "1px solid var(--accent)"
            : "1px solid var(--line-strong)",
          background: on ? "var(--accent)" : "transparent",
          color: "var(--accent-on)",
        }}
      >
        {on && <CheckGlyph />}
      </span>
      <span className="flex-1">{label}</span>
    </button>
  );
}

function CheckGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden>
      <path
        d="M2.5 6.4 L5 9 L9.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RatingInput({
  value,
  placeholder,
  onChange,
}: {
  value: number | null;
  placeholder: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      type="number"
      min={1}
      max={10}
      step={0.5}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          onChange(null);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 1 && n <= 10) onChange(n);
      }}
      className="h-7 w-14 border border-line bg-bg-2 px-2 font-mono text-[11px] text-ink-1 outline-none"
      style={{ borderRadius: "var(--r-sm)" }}
    />
  );
}
