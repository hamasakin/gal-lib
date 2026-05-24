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
import { useTranslation } from "react-i18next";
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
import type { FilterOptions, PersonOption } from "@/lib/persons";

interface FilterPanelProps {
  games: Game[];
  filter: AdvancedFilter;
  onChange: (next: AdvancedFilter) => void;
  /**
   * Multi-dim facet payload from `getFilterOptions()`. `null` while loading;
   * facet sections render placeholders or hide entirely until populated.
   */
  options: FilterOptions | null;
}

/**
 * Cap each chip list's initial render — when more entries exist we show a
 * "更多 >" expander chip that reveals the rest in-place. Keeps the panel from
 * blowing past one screen on large libraries (a 200-game library can easily
 * hit 80+ unique voice actors).
 */
const CHIP_CAP = 60;

// module-level 常量改 i18nKey 配对（render 时用 t() 解析），避免 i18n 未 ready
// 时被冻成中文。
const STATUS_OPTIONS: Array<{ value: Game["status"]; i18nKey: string }> = [
  { value: "playing", i18nKey: "chips.playing" },
  { value: "cleared", i18nKey: "chips.cleared" },
  { value: "unplayed", i18nKey: "chips.unplayed" },
  { value: "dropped", i18nKey: "chips.dropped" },
];

const DURATION_OPTIONS: Array<{ value: DurationBucket; i18nKey: string }> = [
  { value: "none", i18nKey: "filter_panel.duration.none" },
  { value: "lt1h", i18nKey: "filter_panel.duration.lt1h" },
  { value: "h1to10", i18nKey: "filter_panel.duration.h1to10" },
  { value: "h10to50", i18nKey: "filter_panel.duration.h10to50" },
  { value: "h50plus", i18nKey: "filter_panel.duration.h50plus" },
];

function cloneFilter(f: AdvancedFilter): AdvancedFilter {
  return {
    statuses: new Set(f.statuses),
    ratingMin: f.ratingMin,
    ratingMax: f.ratingMax,
    years: new Set(f.years),
    durations: new Set(f.durations),
    reviewOnly: f.reviewOnly,
    brands: new Set(f.brands),
    staffIds: new Set(f.staffIds),
    officialTags: new Set(f.officialTags),
  };
}

export function FilterPanel({ games, filter, onChange, options }: FilterPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AdvancedFilter>(() => cloneFilter(filter));

  // Local search inputs for each facet section — purely client-side filter
  // over the option lists; not debounced because the filter is in-memory.
  const [brandQuery, setBrandQuery] = useState("");
  const [scenarioQuery, setScenarioQuery] = useState("");
  const [artistQuery, setArtistQuery] = useState("");
  const [voiceQuery, setVoiceQuery] = useState("");
  const [tagQuery, setTagQuery] = useState("");

  // "更多 >" expansion state, per facet — a section keeps its expanded state
  // until the popover closes (cheap UX win; users routinely re-open and want
  // their previous expansion preserved? actually no — we reset on close so
  // each open starts compact again).
  const [brandExpanded, setBrandExpanded] = useState(false);
  const [scenarioExpanded, setScenarioExpanded] = useState(false);
  const [artistExpanded, setArtistExpanded] = useState(false);
  const [voiceExpanded, setVoiceExpanded] = useState(false);
  const [tagExpanded, setTagExpanded] = useState(false);

  // Reset draft to current applied filter every time the popover opens, so
  // users see the same state they're observing in the grid.
  useEffect(() => {
    if (open) setDraft(cloneFilter(filter));
    if (!open) {
      setBrandQuery("");
      setScenarioQuery("");
      setArtistQuery("");
      setVoiceQuery("");
      setTagQuery("");
      setBrandExpanded(false);
      setScenarioExpanded(false);
      setArtistExpanded(false);
      setVoiceExpanded(false);
      setTagExpanded(false);
    }
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

  // Quick 260524-dlr — 「筛选」按钮加快捷清空：activeCount>0 时按钮右侧追加
  // 独立 X 按钮，一键 reset 全部 advFilter（与「重置」按钮等价）；点击 X 通过
  // stopPropagation + 不在 PopoverTrigger 里来避免顺带打开 popover。
  function quickClear(e: React.MouseEvent) {
    e.stopPropagation();
    const empty = cloneFilter(EMPTY_ADV_FILTER);
    setDraft(empty);
    onChange(empty);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "inline-flex h-8 items-stretch overflow-hidden border transition-colors",
          activeCount > 0
            ? "border-brand bg-brand-soft text-ink-0"
            : "border-line bg-bg-1 text-ink-1 hover:border-line-strong hover:bg-bg-2 hover:text-ink-0",
        )}
        style={{ borderRadius: "9999px" }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 bg-transparent px-3 font-mono text-[11px]"
            aria-label={t("filter_panel.trigger_label")}
            title={t("filter_panel.trigger_label")}
          >
            <ListFilter size={12} strokeWidth={1.7} />
            <span>{t("filter_panel.title")}</span>
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
        {activeCount > 0 && (
          <button
            type="button"
            onClick={quickClear}
            aria-label={t("filter_panel.quick_clear")}
            title={t("filter_panel.quick_clear")}
            className="grid w-7 place-items-center border-l border-brand/40 text-ink-1 transition-colors hover:bg-brand hover:text-[var(--accent-on)]"
          >
            <X size={11} strokeWidth={2} />
          </button>
        )}
      </div>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn(
          "z-50 flex w-[320px] flex-col gap-0 border border-line-strong bg-bg-1 p-0 shadow-lift",
        )}
        style={{ borderRadius: "var(--r-md)" }}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <div className="font-serif text-[14px] text-ink-0">{t("filter_panel.title")}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
              {t("filter_panel.subtitle", { count: games.length })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("common.close")}
            className="grid h-6 w-6 place-items-center rounded-sm text-ink-3 hover:bg-bg-2 hover:text-ink-0"
          >
            <X size={12} />
          </button>
        </header>

        <div className="flex flex-col divide-y divide-line overflow-y-auto px-4 max-h-[480px]">
          {/* 状态 */}
          <Section label={t("filter_panel.section.status")}>
            <div className="flex flex-col gap-1.5">
              {STATUS_OPTIONS.map(({ value, i18nKey }) => (
                <CheckRow
                  key={value}
                  label={t(i18nKey)}
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
                label={t("filter_panel.review_only")}
                accent
                on={draft.reviewOnly}
                onClick={() =>
                  setDraft({ ...draft, reviewOnly: !draft.reviewOnly })
                }
              />
            </div>
          </Section>

          {/* 评分范围 */}
          <Section label={t("filter_panel.section.rating")}>
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
            <Section label={t("filter_panel.section.year")}>
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
          <Section label={t("filter_panel.section.duration")}>
            <div className="flex flex-col gap-1.5">
              {DURATION_OPTIONS.map(({ value, i18nKey }) => (
                <CheckRow
                  key={value}
                  label={t(i18nKey)}
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

          {/* ── Phase 11 multi-dim facets ── */}
          {options === null && (
            <Section label={t("filter_panel.section.more")}>
              <div className="font-mono text-[10.5px] text-ink-3">{t("common.loading")}</div>
            </Section>
          )}

          {options !== null && options.brands.length > 0 && (
            <Section label={t("filter_panel.section.brand")}>
              <FacetSearchInput
                value={brandQuery}
                placeholder={t("filter_panel.search.brand")}
                onChange={setBrandQuery}
              />
              <BrandChipList
                items={options.brands}
                query={brandQuery}
                selected={draft.brands}
                expanded={brandExpanded}
                onToggleExpand={() => setBrandExpanded((v) => !v)}
                onToggle={(name) =>
                  setDraft({ ...draft, brands: toggleSet(draft.brands, name) })
                }
              />
            </Section>
          )}

          {options !== null && options.scenarios.length > 0 && (
            <Section label={t("filter_panel.section.scenario")}>
              <FacetSearchInput
                value={scenarioQuery}
                placeholder={t("filter_panel.search.scenario")}
                onChange={setScenarioQuery}
              />
              <PersonChipList
                items={options.scenarios}
                query={scenarioQuery}
                selected={draft.staffIds}
                expanded={scenarioExpanded}
                onToggleExpand={() => setScenarioExpanded((v) => !v)}
                onToggle={(id) =>
                  setDraft({ ...draft, staffIds: toggleSet(draft.staffIds, id) })
                }
              />
            </Section>
          )}

          {options !== null && options.artists.length > 0 && (
            <Section label={t("filter_panel.section.artist")}>
              <FacetSearchInput
                value={artistQuery}
                placeholder={t("filter_panel.search.artist")}
                onChange={setArtistQuery}
              />
              <PersonChipList
                items={options.artists}
                query={artistQuery}
                selected={draft.staffIds}
                expanded={artistExpanded}
                onToggleExpand={() => setArtistExpanded((v) => !v)}
                onToggle={(id) =>
                  setDraft({ ...draft, staffIds: toggleSet(draft.staffIds, id) })
                }
              />
            </Section>
          )}

          {options !== null && options.voices.length > 0 && (
            <Section label={t("filter_panel.section.voice")}>
              <FacetSearchInput
                value={voiceQuery}
                placeholder={t("filter_panel.search.voice")}
                onChange={setVoiceQuery}
              />
              <PersonChipList
                items={options.voices}
                query={voiceQuery}
                selected={draft.staffIds}
                expanded={voiceExpanded}
                onToggleExpand={() => setVoiceExpanded((v) => !v)}
                onToggle={(id) =>
                  setDraft({ ...draft, staffIds: toggleSet(draft.staffIds, id) })
                }
              />
            </Section>
          )}

          {options !== null && options.official_tags.length > 0 && (
            <Section label={t("filter_panel.section.official_tags")}>
              <FacetSearchInput
                value={tagQuery}
                placeholder={t("filter_panel.search.tag")}
                onChange={setTagQuery}
              />
              <TagChipList
                items={options.official_tags}
                query={tagQuery}
                selected={draft.officialTags}
                expanded={tagExpanded}
                onToggleExpand={() => setTagExpanded((v) => !v)}
                onToggle={(name) =>
                  setDraft({
                    ...draft,
                    officialTags: toggleSet(draft.officialTags, name),
                  })
                }
              />
            </Section>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-line bg-bg-0 px-4 py-3">
          <button
            type="button"
            onClick={reset}
            className="font-mono text-[10.5px] text-ink-3 hover:text-ink-0"
          >
            {t("filter_panel.reset")}
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
            {t("filter_panel.apply")}
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

/** Local search input for a facet section (purely client-side filter). */
function FacetSearchInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="search"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="mb-2 h-7 w-full border border-line bg-bg-2 px-2 font-mono text-[10.5px] text-ink-1 outline-none placeholder:text-ink-3 focus:border-line-strong"
      style={{ borderRadius: "var(--r-sm)" }}
    />
  );
}

/**
 * Single chip element used by all three chip lists. `mono` toggles the
 * monospaced display style for brand/tag (which show a count suffix); person
 * chips use the default proportional font.
 */
function Chip({
  label,
  on,
  title,
  mono,
  onClick,
}: {
  label: React.ReactNode;
  on: boolean;
  title?: string;
  mono?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "h-6 max-w-full px-2 transition-colors",
        mono ? "font-mono text-[10px]" : "text-[11px]",
        "truncate",
        on
          ? "border border-brand bg-brand-soft text-ink-0"
          : "border border-line bg-bg-2 text-ink-1 hover:border-line-strong",
      )}
      style={{ borderRadius: "var(--r-sm)" }}
    >
      {label}
    </button>
  );
}

/** "更多 N >" / "收起" toggle chip used at the end of capped chip lists. */
function MoreChip({
  hidden,
  expanded,
  onClick,
}: {
  hidden: number;
  expanded: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-6 px-2 font-mono text-[10px] text-ink-2 transition-colors hover:bg-bg-2 hover:text-ink-0"
      style={{
        borderRadius: "var(--r-sm)",
        border: "1px dashed var(--line)",
      }}
    >
      {expanded ? t("filter_panel.collapse") : t("filter_panel.more", { count: hidden })}
    </button>
  );
}

function BrandChipList({
  items,
  query,
  selected,
  expanded,
  onToggleExpand,
  onToggle,
}: {
  items: Array<{ name: string; count: number }>;
  query: string;
  selected: Set<string>;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggle: (name: string) => void;
}) {
  const { t } = useTranslation();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return items;
    return items.filter((it) => it.name.toLowerCase().includes(q));
  }, [items, query]);
  const visible = expanded ? filtered : filtered.slice(0, CHIP_CAP);
  const hidden = filtered.length - visible.length;

  if (filtered.length === 0) {
    return (
      <div className="font-mono text-[10.5px] text-ink-3">{t("filter_panel.no_match")}</div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((it) => (
        <Chip
          key={it.name}
          label={`${it.name} · ${it.count}`}
          mono
          on={selected.has(it.name)}
          title={t("filter_panel.tooltip.works", { name: it.name, count: it.count })}
          onClick={() => onToggle(it.name)}
        />
      ))}
      {(hidden > 0 || expanded) && filtered.length > CHIP_CAP && (
        <MoreChip
          hidden={hidden}
          expanded={expanded}
          onClick={onToggleExpand}
        />
      )}
    </div>
  );
}

function PersonChipList({
  items,
  query,
  selected,
  expanded,
  onToggleExpand,
  onToggle,
}: {
  items: PersonOption[];
  query: string;
  selected: Set<number>;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggle: (id: number) => void;
}) {
  const { t } = useTranslation();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return items;
    return items.filter((it) => {
      const name = (it.name_cn ?? it.name).toLowerCase();
      return name.includes(q) || it.name.toLowerCase().includes(q);
    });
  }, [items, query]);
  const visible = expanded ? filtered : filtered.slice(0, CHIP_CAP);
  const hidden = filtered.length - visible.length;

  if (filtered.length === 0) {
    return (
      <div className="font-mono text-[10.5px] text-ink-3">{t("filter_panel.no_match")}</div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((it) => {
        const display = it.name_cn ?? it.name;
        const tooltip =
          it.name_cn != null
            ? t("filter_panel.tooltip.person_cn", {
                cn: it.name_cn,
                name: it.name,
                count: it.count,
              })
            : t("filter_panel.tooltip.person", { name: it.name, count: it.count });
        return (
          <Chip
            key={it.id}
            label={display}
            on={selected.has(it.id)}
            title={tooltip}
            onClick={() => onToggle(it.id)}
          />
        );
      })}
      {(hidden > 0 || expanded) && filtered.length > CHIP_CAP && (
        <MoreChip
          hidden={hidden}
          expanded={expanded}
          onClick={onToggleExpand}
        />
      )}
    </div>
  );
}

function TagChipList({
  items,
  query,
  selected,
  expanded,
  onToggleExpand,
  onToggle,
}: {
  items: Array<{ name: string; count: number }>;
  query: string;
  selected: Set<string>;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggle: (name: string) => void;
}) {
  const { t } = useTranslation();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return items;
    return items.filter((it) => it.name.toLowerCase().includes(q));
  }, [items, query]);
  const visible = expanded ? filtered : filtered.slice(0, CHIP_CAP);
  const hidden = filtered.length - visible.length;

  if (filtered.length === 0) {
    return (
      <div className="font-mono text-[10.5px] text-ink-3">{t("filter_panel.no_match")}</div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((it) => (
        <Chip
          key={it.name}
          label={`${it.name} · ${it.count}`}
          mono
          on={selected.has(it.name)}
          title={t("filter_panel.tooltip.works", { name: it.name, count: it.count })}
          onClick={() => onToggle(it.name)}
        />
      ))}
      {(hidden > 0 || expanded) && filtered.length > CHIP_CAP && (
        <MoreChip
          hidden={hidden}
          expanded={expanded}
          onClick={onToggleExpand}
        />
      )}
    </div>
  );
}
