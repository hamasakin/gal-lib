/**
 * SearchBar — top-of-Library 搜索栏 / 多维筛选入口。
 *
 * Quick 260524-dlr 当前形态：
 *   - 左前缀类型下拉：游戏名(默认) / 品牌 / 画师 / 声优 / 标签
 *     · 「游戏名」：本地 mirror state，200ms 防抖 commit 到 store.searchQuery，
 *       触发后端 LIKE。
 *     · 其余四类：input 仅作本地 fuzzy 关键词，不写 store.searchQuery；候选
 *       从 props.filterOptions 派生（brands / artists / voices / official_tags），
 *       下拉展示前 N 项 + checkbox。**多选走 draft 模式**：点击候选只切换
 *       本地 draft，底部「确定」才把 draft 写入 advFilter；「取消」/Esc/容
 *       器外点击丢弃 draft。Enter 等价确定。
 *     · 画师 / 声优 共用 advFilter.staffIds（后端 SearchFilter.staff_ids 不
 *       按 role 区分）。apply 时按当前 kind 的「人物池」做差集 + 并集，避免
 *       一个 facet 的提交吞掉另一个 facet 已选项。
 *   - 右尾部：有内容时显示 X 清空按钮；无内容时回退到 ⌘K 键提示。
 *   - Ctrl+K / ⌘+K 全局快捷键聚焦输入框。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search, X, ChevronDown } from "lucide-react";
import { useLibraryStore } from "@/store/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FilterOptions, PersonOption } from "@/lib/persons";
import type { AdvancedFilter } from "@/lib/advancedFilter";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 200;
const CANDIDATE_CAP = 12;

type SearchKind = "name" | "brand" | "artist" | "voice" | "tag";
type FacetKind = Exclude<SearchKind, "name">;

// module-level 常量改 i18nKey 配对（render 时用 t() 解析），避免 i18n 未 ready
// 时被冻成中文。
const KIND_OPTIONS: Array<{ value: SearchKind; i18nKey: string }> = [
  { value: "name", i18nKey: "search_bar.kind.name" },
  { value: "brand", i18nKey: "search_bar.kind.brand" },
  { value: "artist", i18nKey: "search_bar.kind.artist" },
  { value: "voice", i18nKey: "search_bar.kind.voice" },
  { value: "tag", i18nKey: "search_bar.kind.tag" },
];

const KIND_LABEL_KEY: Record<SearchKind, string> = {
  name: "search_bar.kind.name",
  brand: "search_bar.kind.brand",
  artist: "search_bar.kind.artist",
  voice: "search_bar.kind.voice",
  tag: "search_bar.kind.tag",
};

const KIND_PLACEHOLDER_KEY: Record<SearchKind, string> = {
  name: "search_bar.placeholder.name",
  brand: "search_bar.placeholder.brand",
  artist: "search_bar.placeholder.artist",
  voice: "search_bar.placeholder.voice",
  tag: "search_bar.placeholder.tag",
};

interface SearchBarProps {
  /** Multi-dim facet payload from `getFilterOptions()`; null while loading. */
  filterOptions: FilterOptions | null;
}

interface BrandCandidate {
  kind: "brand";
  key: string;
  name: string;
  count: number;
}
interface PersonCandidate {
  kind: "artist" | "voice";
  key: string;
  id: number;
  name: string;
  nameCn: string | null;
  count: number;
}
interface TagCandidate {
  kind: "tag";
  key: string;
  name: string;
  count: number;
}
type Candidate = BrandCandidate | PersonCandidate | TagCandidate;

interface DraftSets {
  brand: Set<string>;
  artist: Set<number>;
  voice: Set<number>;
  tag: Set<string>;
}

function emptyDraft(): DraftSets {
  return { brand: new Set(), artist: new Set(), voice: new Set(), tag: new Set() };
}

export function SearchBar({ filterOptions }: SearchBarProps) {
  const { t } = useTranslation();
  const storeQuery = useLibraryStore((s) => s.searchQuery);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);
  const advFilter = useLibraryStore((s) => s.advFilter);
  const setAdvFilter = useLibraryStore((s) => s.setAdvFilter);

  const [kind, setKind] = useState<SearchKind>("name");
  const [value, setValue] = useState(storeQuery);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [draft, setDraft] = useState<DraftSets>(emptyDraft);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 人物池 id 集合 —— 用于「voice / artist 共用 staffIds 但 draft 互不污染」
  // 的差集合并 (见 applyDraft / draft 初始化)。
  const voicePoolIds = useMemo<Set<number>>(() => {
    if (!filterOptions) return new Set();
    return new Set(filterOptions.voices.map((p) => p.id));
  }, [filterOptions]);
  const artistPoolIds = useMemo<Set<number>>(() => {
    if (!filterOptions) return new Set();
    return new Set(filterOptions.artists.map((p) => p.id));
  }, [filterOptions]);

  // 外部把 store.searchQuery 改了（清除全部筛选等）时，name 模式下同步 input。
  useEffect(() => {
    if (kind !== "name") return;
    if (storeQuery !== value) setValue(storeQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeQuery, kind]);

  // name 模式 → debounce 写回 store。其他模式 value 不进 store。
  useEffect(() => {
    if (kind !== "name") return;
    if (value === storeQuery) return;
    const t = setTimeout(() => setSearchQuery(value), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, storeQuery, setSearchQuery, kind]);

  // Ctrl+K / ⌘+K 聚焦 + 全选输入框内容，便于直接覆盖。
  // WR-03 fix: 跳过 textarea / contentEditable target 以免在 Detail 笔记
  // 编辑器里按 Ctrl+K 被这里抢焦。input 不跳过——SearchBar 自己就是 input，
  // 已聚焦时再 select() 是希望的覆盖行为。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isK = e.key === "k" || e.key === "K";
      if (!isK) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 下拉打开 / kind 切换 → 从 advFilter 重新克隆当前 kind 的 draft Set。
  // 故意不依赖 advFilter：用户编辑期间外部 setAdvFilter（详情页跳转等）不
  // 应当覆盖编辑中的 draft；下一次打开下拉时再同步。
  useEffect(() => {
    if (!dropdownOpen) return;
    if (kind === "brand") {
      setDraft((d) => ({ ...d, brand: new Set(advFilter.brands) }));
    } else if (kind === "tag") {
      setDraft((d) => ({ ...d, tag: new Set(advFilter.officialTags) }));
    } else if (kind === "voice") {
      const subset = new Set<number>();
      for (const id of advFilter.staffIds) if (voicePoolIds.has(id)) subset.add(id);
      setDraft((d) => ({ ...d, voice: subset }));
    } else if (kind === "artist") {
      const subset = new Set<number>();
      for (const id of advFilter.staffIds) if (artistPoolIds.has(id)) subset.add(id);
      setDraft((d) => ({ ...d, artist: subset }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropdownOpen, kind, voicePoolIds, artistPoolIds]);

  function onKindChange(next: SearchKind) {
    if (next === kind) return;
    const wasName = kind === "name";
    setKind(next);
    setValue("");
    if (wasName && storeQuery !== "") setSearchQuery("");
    setDropdownOpen(next !== "name");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // 候选 —— 非 name 模式持续返回前 CANDIDATE_CAP 项；draft 多选模式下已选
  // 项要显示为已勾选（不排除），便于用户取消。
  const candidates = useMemo<Candidate[]>(() => {
    if (kind === "name") return [];
    if (!filterOptions) return [];
    const q = value.trim().toLowerCase();
    if (kind === "brand") {
      return filterOptions.brands
        .filter((b) => q === "" || b.name.toLowerCase().includes(q))
        .slice(0, CANDIDATE_CAP)
        .map<BrandCandidate>((b) => ({
          kind: "brand",
          key: `brand:${b.name}`,
          name: b.name,
          count: b.count,
        }));
    }
    if (kind === "voice" || kind === "artist") {
      const pool = kind === "voice" ? filterOptions.voices : filterOptions.artists;
      return pool
        .filter((p: PersonOption) => {
          if (q === "") return true;
          const cn = (p.name_cn ?? "").toLowerCase();
          return p.name.toLowerCase().includes(q) || cn.includes(q);
        })
        .slice(0, CANDIDATE_CAP)
        .map<PersonCandidate>((p) => ({
          kind,
          key: `${kind}:${p.id}`,
          id: p.id,
          name: p.name,
          nameCn: p.name_cn,
          count: p.count,
        }));
    }
    return filterOptions.official_tags
      .filter((t) => q === "" || t.name.toLowerCase().includes(q))
      .slice(0, CANDIDATE_CAP)
      .map<TagCandidate>((t) => ({
        kind: "tag",
        key: `tag:${t.name}`,
        name: t.name,
        count: t.count,
      }));
  }, [kind, value, filterOptions]);

  // 切到 name 强制关下拉。
  useEffect(() => {
    if (kind === "name") setDropdownOpen(false);
  }, [kind]);

  // 点击容器外 = 取消（关下拉丢弃 draft）。
  useEffect(() => {
    if (!dropdownOpen) return;
    function onDoc(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [dropdownOpen]);

  function isDraftSelected(c: Candidate): boolean {
    if (c.kind === "brand") return draft.brand.has(c.name);
    if (c.kind === "voice") return draft.voice.has(c.id);
    if (c.kind === "artist") return draft.artist.has(c.id);
    return draft.tag.has(c.name);
  }

  function toggleDraft(c: Candidate) {
    if (c.kind === "brand") {
      const next = new Set(draft.brand);
      if (next.has(c.name)) next.delete(c.name);
      else next.add(c.name);
      setDraft({ ...draft, brand: next });
    } else if (c.kind === "voice") {
      const next = new Set(draft.voice);
      if (next.has(c.id)) next.delete(c.id);
      else next.add(c.id);
      setDraft({ ...draft, voice: next });
    } else if (c.kind === "artist") {
      const next = new Set(draft.artist);
      if (next.has(c.id)) next.delete(c.id);
      else next.add(c.id);
      setDraft({ ...draft, artist: next });
    } else {
      const next = new Set(draft.tag);
      if (next.has(c.name)) next.delete(c.name);
      else next.add(c.name);
      setDraft({ ...draft, tag: next });
    }
  }

  function applyDraft() {
    if (kind === "name") return;
    if (kind === "brand") {
      setAdvFilter({ ...advFilter, brands: new Set(draft.brand) });
    } else if (kind === "tag") {
      setAdvFilter({ ...advFilter, officialTags: new Set(draft.tag) });
    } else if (kind === "voice") {
      const next = mergeStaffIds(advFilter.staffIds, voicePoolIds, draft.voice);
      setAdvFilter({ ...advFilter, staffIds: next });
    } else if (kind === "artist") {
      const next = mergeStaffIds(advFilter.staffIds, artistPoolIds, draft.artist);
      setAdvFilter({ ...advFilter, staffIds: next });
    }
    setValue("");
    setDropdownOpen(false);
  }

  function cancelDraft() {
    setValue("");
    setDropdownOpen(false);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (dropdownOpen) {
        e.stopPropagation();
        cancelDraft();
      } else if (value !== "") {
        e.stopPropagation();
        onClear();
      }
      return;
    }
    if (e.key === "Enter") {
      if (kind !== "name" && dropdownOpen) {
        e.preventDefault();
        applyDraft();
      }
    }
  }

  function onClear() {
    setValue("");
    if (kind === "name" && storeQuery !== "") setSearchQuery("");
    setDropdownOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const hasValue = value !== "";
  const draftSize = currentDraftSize(draft, kind);
  const appliedSize = currentAppliedSize(advFilter, kind, voicePoolIds, artistPoolIds);
  const dirty =
    kind !== "name" &&
    !setsEqual(
      draftOf(draft, kind as FacetKind),
      appliedSubsetOf(advFilter, kind as FacetKind, voicePoolIds, artistPoolIds),
    );

  return (
    <div ref={containerRef} className="relative w-[360px]">
      <div className="flex h-8 items-stretch border border-line bg-bg-2 transition-colors focus-within:border-brand" style={{ borderRadius: "var(--r-md)" }}>
        {/* 类型前缀下拉 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 border-r border-line px-2.5 font-mono text-[11px] text-ink-1 transition-colors hover:bg-bg-1 hover:text-ink-0"
              style={{ borderTopLeftRadius: "var(--r-md)", borderBottomLeftRadius: "var(--r-md)" }}
              title={t("search_bar.kind_select")}
              aria-label={t("search_bar.kind_select_aria", { kind: t(KIND_LABEL_KEY[kind]) })}
            >
              <span>{t(KIND_LABEL_KEY[kind])}</span>
              <ChevronDown size={11} strokeWidth={1.8} className="opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-28">
            {KIND_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onSelect={() => onKindChange(opt.value)}
                className={cn(
                  "text-[12px]",
                  kind === opt.value && "text-brand",
                )}
              >
                {t(opt.i18nKey)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 输入区 */}
        <div className="relative flex-1">
          <Search
            size={13}
            strokeWidth={1.7}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.currentTarget.value);
              if (kind !== "name") setDropdownOpen(true);
            }}
            onKeyDown={onInputKeyDown}
            onFocus={() => {
              if (kind !== "name") setDropdownOpen(true);
            }}
            placeholder={t(KIND_PLACEHOLDER_KEY[kind])}
            aria-label={t("search_bar.input_aria", { kind: t(KIND_LABEL_KEY[kind]) })}
            className="h-full w-full bg-transparent pl-8 pr-16 text-[12.5px] text-ink-0 outline-none placeholder:text-ink-3"
          />
          {hasValue ? (
            <button
              type="button"
              onClick={onClear}
              aria-label={t("search_bar.clear_aria")}
              title={t("search_bar.clear")}
              className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center text-ink-3 transition-colors hover:bg-bg-1 hover:text-ink-0"
              style={{ borderRadius: "var(--r-sm)" }}
            >
              <X size={12} strokeWidth={2} />
            </button>
          ) : (
            <span
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 border border-line px-1 font-mono text-[9.5px] text-ink-3"
              style={{ borderRadius: "var(--r-sm)" }}
              title={t("search_bar.shortcut_hint")}
            >
              Ctrl+K
            </span>
          )}
        </div>
      </div>

      {/* 候选下拉（非 name 模式） */}
      {dropdownOpen && kind !== "name" && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 flex max-h-[420px] flex-col border border-line-strong bg-bg-1 shadow-lift"
          style={{ borderRadius: "var(--r-md)" }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex-1 overflow-y-auto">
            {candidates.length === 0 ? (
              <div className="px-3 py-2.5 font-mono text-[10.5px] text-ink-3">
                {filterOptions == null
                  ? t("search_bar.candidates_loading")
                  : t("search_bar.no_candidates")}
              </div>
            ) : (
              <ul className="flex flex-col py-1">
                {candidates.map((c) => {
                  const on = isDraftSelected(c);
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        onClick={() => toggleDraft(c)}
                        role="checkbox"
                        aria-checked={on}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] text-ink-1 transition-colors hover:bg-bg-2 hover:text-ink-0",
                          on && "text-ink-0",
                        )}
                        title={
                          c.kind === "voice" || c.kind === "artist"
                            ? c.nameCn && c.nameCn !== c.name
                              ? t("filter_panel.tooltip.person_cn", {
                                  cn: c.nameCn,
                                  name: c.name,
                                  count: c.count,
                                })
                              : t("filter_panel.tooltip.person", {
                                  name: c.nameCn ?? c.name,
                                  count: c.count,
                                })
                            : t("filter_panel.tooltip.works", {
                                name: c.name,
                                count: c.count,
                              })
                        }
                      >
                        <CheckBox on={on} />
                        <span className="min-w-0 flex-1 truncate">
                          {c.kind === "voice" || c.kind === "artist"
                            ? c.nameCn ?? c.name
                            : c.name}
                          {(c.kind === "voice" || c.kind === "artist") &&
                            c.nameCn &&
                            c.nameCn !== c.name && (
                              <span className="ml-1.5 text-ink-3 text-[10.5px]">
                                ({c.name})
                              </span>
                            )}
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-ink-3">
                          {t("search_bar.candidate_count", { count: c.count })}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-line bg-bg-0 px-3 py-2">
            <span className={cn("font-mono text-[10.5px] text-ink-3", draftSize > 0 && "text-ink-0")}>
              {t("search_bar.selected", { count: draftSize })}
              {appliedSize > 0 && !dirty && (
                <span className="ml-1.5 text-ink-3">{t("search_bar.applied")}</span>
              )}
              {dirty && <span className="ml-1.5 text-[#ffd166]">{t("search_bar.pending")}</span>}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={cancelDraft}
                className="inline-flex h-7 items-center px-3 font-mono text-[11px] text-ink-2 transition-colors hover:bg-bg-2 hover:text-ink-0"
                style={{ borderRadius: "var(--r-sm)" }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={applyDraft}
                className="inline-flex h-7 items-center px-3 text-[11px] font-medium text-[var(--accent-on)]"
                style={{ background: "var(--accent)", borderRadius: "var(--r-sm)" }}
              >
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckBox({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className="grid h-[14px] w-[14px] shrink-0 place-items-center"
      style={{
        borderRadius: 3,
        border: on ? "1px solid var(--accent)" : "1px solid var(--line-strong)",
        background: on ? "var(--accent)" : "transparent",
        color: "var(--accent-on)",
      }}
    >
      {on && (
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
      )}
    </span>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

function mergeStaffIds(
  existing: Set<number>,
  pool: Set<number>,
  draftSet: Set<number>,
): Set<number> {
  // 应用某 facet（voice 或 artist）draft 时：从 advFilter.staffIds 移除「当
  // 前池里的所有 id」，再并入 draft；保留池外的（其他 facet 已选）id。
  const next = new Set<number>();
  for (const id of existing) if (!pool.has(id)) next.add(id);
  for (const id of draftSet) next.add(id);
  return next;
}

function draftOf(d: DraftSets, kind: FacetKind): Set<string | number> {
  if (kind === "brand") return d.brand;
  if (kind === "voice") return d.voice;
  if (kind === "artist") return d.artist;
  return d.tag;
}

function appliedSubsetOf(
  adv: AdvancedFilter,
  kind: FacetKind,
  voicePool: Set<number>,
  artistPool: Set<number>,
): Set<string | number> {
  if (kind === "brand") return adv.brands;
  if (kind === "tag") return adv.officialTags;
  const pool = kind === "voice" ? voicePool : artistPool;
  const out = new Set<number>();
  for (const id of adv.staffIds) if (pool.has(id)) out.add(id);
  return out;
}

function currentDraftSize(d: DraftSets, kind: SearchKind): number {
  if (kind === "brand") return d.brand.size;
  if (kind === "voice") return d.voice.size;
  if (kind === "artist") return d.artist.size;
  if (kind === "tag") return d.tag.size;
  return 0;
}

function currentAppliedSize(
  adv: AdvancedFilter,
  kind: SearchKind,
  voicePool: Set<number>,
  artistPool: Set<number>,
): number {
  if (kind === "brand") return adv.brands.size;
  if (kind === "tag") return adv.officialTags.size;
  if (kind === "voice") {
    let n = 0;
    for (const id of adv.staffIds) if (voicePool.has(id)) n++;
    return n;
  }
  if (kind === "artist") {
    let n = 0;
    for (const id of adv.staffIds) if (artistPool.has(id)) n++;
    return n;
  }
  return 0;
}

function setsEqual(a: Set<string | number>, b: Set<string | number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
