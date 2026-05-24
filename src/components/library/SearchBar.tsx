/**
 * SearchBar — top-of-Library 搜索栏 / 多维筛选入口。
 *
 * Quick 260524-dlr 新增：
 *   - 左前缀类型下拉：游戏名(默认) / 品牌 / 声优 / 标签
 *     · 「游戏名」：与 v1.0 相同 —— 本地 mirror state，200ms 防抖 commit 到
 *       store.searchQuery，触发后端 LIKE。
 *     · 其余三类：input 仅作本地 fuzzy 关键词，不写 store.searchQuery；候选
 *       从 props.filterOptions 派生（brands / voices / official_tags），下拉
 *       展示前 N 项；点击 / 回车选中 → setAdvFilter 把该项加入对应多选 Set，
 *       清空 input、保留焦点便于继续选择。已选项立刻在外层 FilterPanel
 *       的「筛选 N」徽章里显示。
 *   - 右尾部：有内容时显示 X 清空按钮（清 input + 必要时清 store.searchQuery）；
 *     无内容时回退到 ⌘K 键提示。
 *
 * 多选筛选数据流：本组件与 FilterPanel 共用 useLibraryStore.advFilter；这里
 * 只「加 chip」（搜索 → 选条目 → 入库），删 / 重置走 FilterPanel 弹窗或
 * 现有「重置」入口。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, ChevronDown } from "lucide-react";
import { useLibraryStore } from "@/store/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FilterOptions, PersonOption } from "@/lib/persons";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 200;
const CANDIDATE_CAP = 12;

type SearchKind = "name" | "brand" | "voice" | "tag";

const KIND_OPTIONS: Array<{ value: SearchKind; label: string }> = [
  { value: "name", label: "游戏名" },
  { value: "brand", label: "品牌" },
  { value: "voice", label: "声优" },
  { value: "tag", label: "标签" },
];

const KIND_LABEL_MAP: Record<SearchKind, string> = {
  name: "游戏名",
  brand: "品牌",
  voice: "声优",
  tag: "标签",
};

const KIND_PLACEHOLDER: Record<SearchKind, string> = {
  name: "搜索游戏 / 标签 / 品牌…",
  brand: "输入品牌关键字…",
  voice: "输入声优关键字…",
  tag: "输入标签关键字…",
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
interface VoiceCandidate {
  kind: "voice";
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
type Candidate = BrandCandidate | VoiceCandidate | TagCandidate;

export function SearchBar({ filterOptions }: SearchBarProps) {
  const storeQuery = useLibraryStore((s) => s.searchQuery);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);
  const advFilter = useLibraryStore((s) => s.advFilter);
  const setAdvFilter = useLibraryStore((s) => s.setAdvFilter);

  const [kind, setKind] = useState<SearchKind>("name");
  const [value, setValue] = useState(storeQuery);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 外部把 store.searchQuery 改了（清除全部筛选等）时，name 模式下同步 input。
  useEffect(() => {
    if (kind !== "name") return;
    if (storeQuery !== value) setValue(storeQuery);
    // 故意忽略 value 依赖：只在 storeQuery 变化时同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeQuery, kind]);

  // name 模式 → debounce 写回 store。其他模式 value 不进 store。
  useEffect(() => {
    if (kind !== "name") return;
    if (value === storeQuery) return;
    const t = setTimeout(() => setSearchQuery(value), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value, storeQuery, setSearchQuery, kind]);

  // Ctrl+K（Win 项目）/ ⌘+K（Mac 兼容）→ 聚焦搜索框；input 已聚焦则一并选中
  // 内容便于直接覆盖输入。捕获 input/textarea 内按下，便于无论焦点在哪都生效。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isK = e.key === "k" || e.key === "K";
      if (!isK) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.altKey || e.shiftKey) return;
      e.preventDefault();
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 切换 kind 时清 input；name → 其他时把 store.searchQuery 也清掉；切到
  // 非 name 时自动开下拉显示该类型全部候选（前 N 项），便于无需输入即点选。
  function onKindChange(next: SearchKind) {
    if (next === kind) return;
    setKind(next);
    setValue("");
    if (kind === "name" && storeQuery !== "") setSearchQuery("");
    setDropdownOpen(next !== "name");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // 候选列表 —— 非 name 模式下持续返回前 CANDIDATE_CAP 项（已选项排除），
  // 有 query 则在已过滤集合上再做 fuzzy 包含匹配。input 清空仍展示「全部
  // 候选」，便于用户连续多选而不需要再次输入关键词。
  const candidates = useMemo<Candidate[]>(() => {
    if (kind === "name") return [];
    if (!filterOptions) return [];
    const q = value.trim().toLowerCase();
    if (kind === "brand") {
      const selected = advFilter.brands;
      return filterOptions.brands
        .filter((b) => {
          if (selected.has(b.name)) return false;
          return q === "" || b.name.toLowerCase().includes(q);
        })
        .slice(0, CANDIDATE_CAP)
        .map<BrandCandidate>((b) => ({
          kind: "brand",
          key: `brand:${b.name}`,
          name: b.name,
          count: b.count,
        }));
    }
    if (kind === "voice") {
      const selected = advFilter.staffIds;
      return filterOptions.voices
        .filter((p: PersonOption) => {
          if (selected.has(p.id)) return false;
          if (q === "") return true;
          const cn = (p.name_cn ?? "").toLowerCase();
          return p.name.toLowerCase().includes(q) || cn.includes(q);
        })
        .slice(0, CANDIDATE_CAP)
        .map<VoiceCandidate>((p) => ({
          kind: "voice",
          key: `voice:${p.id}`,
          id: p.id,
          name: p.name,
          nameCn: p.name_cn,
          count: p.count,
        }));
    }
    // tag
    const selected = advFilter.officialTags;
    return filterOptions.official_tags
      .filter((t) => {
        if (selected.has(t.name)) return false;
        return q === "" || t.name.toLowerCase().includes(q);
      })
      .slice(0, CANDIDATE_CAP)
      .map<TagCandidate>((t) => ({
        kind: "tag",
        key: `tag:${t.name}`,
        name: t.name,
        count: t.count,
      }));
  }, [kind, value, filterOptions, advFilter]);

  // 切到 name 模式强制关下拉；其他模式由用户主动操作（focus / Esc / X /
  // 容器外点击）控制开关，pickCandidate 后保持打开以支持连续多选。
  useEffect(() => {
    if (kind === "name") setDropdownOpen(false);
  }, [kind]);

  // 点击容器外关闭下拉（避免和 input 失焦逻辑打架）。
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

  function pickCandidate(c: Candidate) {
    if (c.kind === "brand") {
      const next = new Set(advFilter.brands);
      next.add(c.name);
      setAdvFilter({ ...advFilter, brands: next });
    } else if (c.kind === "voice") {
      const next = new Set(advFilter.staffIds);
      next.add(c.id);
      setAdvFilter({ ...advFilter, staffIds: next });
    } else {
      const next = new Set(advFilter.officialTags);
      next.add(c.name);
      setAdvFilter({ ...advFilter, officialTags: next });
    }
    setValue("");
    // 多选：保留下拉打开 + 焦点，便于连续追加；已选项会立刻在 candidates
    // useMemo 里被排除，列表自然刷新。
    setDropdownOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (dropdownOpen) {
        e.stopPropagation();
        setDropdownOpen(false);
      } else if (value !== "") {
        e.stopPropagation();
        onClear();
      }
      return;
    }
    if (e.key === "Enter" && kind !== "name" && candidates.length > 0) {
      e.preventDefault();
      pickCandidate(candidates[0]);
    }
  }

  function onClear() {
    setValue("");
    if (kind === "name" && storeQuery !== "") setSearchQuery("");
    setDropdownOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const hasValue = value !== "";

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
              title="搜索类型"
              aria-label={`搜索类型：${KIND_LABEL_MAP[kind]}`}
            >
              <span>{KIND_LABEL_MAP[kind]}</span>
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
                {opt.label}
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
            placeholder={KIND_PLACEHOLDER[kind]}
            aria-label={`按${KIND_LABEL_MAP[kind]}搜索`}
            className="h-full w-full bg-transparent pl-8 pr-16 text-[12.5px] text-ink-0 outline-none placeholder:text-ink-3"
          />
          {/* 右尾部：X 清空 / ⌘K 键提示 */}
          {hasValue ? (
            <button
              type="button"
              onClick={onClear}
              aria-label="清空搜索"
              title="清空"
              className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center text-ink-3 transition-colors hover:bg-bg-1 hover:text-ink-0"
              style={{ borderRadius: "var(--r-sm)" }}
            >
              <X size={12} strokeWidth={2} />
            </button>
          ) : (
            <span
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 border border-line px-1 font-mono text-[9.5px] text-ink-3"
              style={{ borderRadius: "var(--r-sm)" }}
            >
              ⌘K
            </span>
          )}
        </div>
      </div>

      {/* 候选下拉（非 name 模式） */}
      {dropdownOpen && kind !== "name" && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto border border-line-strong bg-bg-1 shadow-lift"
          style={{ borderRadius: "var(--r-md)" }}
          // 阻止鼠标按下使 input 失焦后立刻关闭下拉
          onMouseDown={(e) => e.preventDefault()}
        >
          {candidates.length === 0 ? (
            <div className="px-3 py-2.5 font-mono text-[10.5px] text-ink-3">
              {filterOptions == null ? "加载候选中…" : "无匹配候选"}
            </div>
          ) : (
            <ul className="flex flex-col py-1">
              {candidates.map((c, i) => (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => pickCandidate(c)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[12px] text-ink-1 transition-colors hover:bg-bg-2 hover:text-ink-0",
                      i === 0 && "bg-bg-2/40",
                    )}
                    title={candidateTooltip(c)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {c.kind === "voice"
                        ? c.nameCn ?? c.name
                        : c.name}
                      {c.kind === "voice" && c.nameCn && c.nameCn !== c.name && (
                        <span className="ml-1.5 text-ink-3 text-[10.5px]">
                          ({c.name})
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-3">
                      {c.count} 部
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function candidateTooltip(c: Candidate): string {
  if (c.kind === "voice") {
    const cn = c.nameCn ?? c.name;
    if (c.nameCn && c.nameCn !== c.name) return `${cn}（${c.name}）— ${c.count} 部`;
    return `${cn} — ${c.count} 部`;
  }
  return `${c.name} — ${c.count} 部作品`;
}
