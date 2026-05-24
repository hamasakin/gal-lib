/**
 * MetadataPicker — modal for re-matching a game against Bangumi/VNDB.
 *
 * 02-UI-SPEC §Metadata Picker Modal contract:
 *   - shadcn Dialog max-w-2xl, max-h-[80vh]
 *   - Title "重新匹配元数据 — {game.name}"
 *   - Input "搜索 Bangumi 或 VNDB" (debounce 400ms on change)
 *   - ToggleGroup Bangumi/VNDB (default Bangumi)
 *   - Collapsible "直接绑定 ID" (bgm_id / vndb_id text inputs)
 *   - Candidate list (60×80 cover + title + alias + confidence Badge)
 *   - Footer "应用" / "取消"
 *
 * Behavior:
 *   - Search auto-triggers when (debounced query, source) changes; empty
 *     query keeps the candidate list cleared (no-op call).
 *   - User selects a candidate → "应用" calls `bindMetadata(gameId, source, source_id)`
 *     OR if direct-ID mode → uses the typed source_id.
 *   - On success: refetch `listGames()`, close modal, toast "已应用元数据".
 *   - On failure: toast.error with message; modal stays open so user can retry.
 *
 * Empty / failed states:
 *   - Empty query → muted "搜索 Bangumi 或 VNDB" placeholder feedback (UI-SPEC: no
 *     empty list ever rendered until query non-empty)
 *   - Search returns 0 → "未找到匹配项 — 请尝试不同关键词"
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  bindMetadata,
  searchMetadata,
  type Candidate,
} from "@/lib/metadata";
import { type Game } from "@/lib/games";
import { useLibraryStore } from "@/store/library";
import { getSidebarCategories, searchGames } from "@/lib/search";
import { displayGameName } from "@/lib/display";
import {
  bangumiSubjectUrl,
  openExternalUrl,
  vndbVnUrl,
} from "@/lib/persons";

interface MetadataPickerProps {
  /** When non-null the dialog is open; null closes. */
  game: Game | null;
  onClose: () => void;
}

type Source = "bangumi" | "vndb";

export function MetadataPicker({ game, onClose }: MetadataPickerProps) {
  const setGames = useLibraryStore((s) => s.setGames);
  const setSidebar = useLibraryStore((s) => s.setSidebar);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const sortBy = useLibraryStore((s) => s.sortBy);
  const filter = useLibraryStore((s) => s.filter);

  // Form state — reset when a different game opens the dialog.
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Source>("bangumi");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<{ source: Source; sourceId: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [showDirect, setShowDirect] = useState(false);
  const [directBgm, setDirectBgm] = useState("");
  const [directVndb, setDirectVndb] = useState("");
  const [applying, setApplying] = useState(false);

  // Reset form when the dialog opens for a new game.
  useEffect(() => {
    if (game) {
      // Seed the search box with the user-facing name (basename for unmatched
      // entries) — that's the title most likely to match upstream search
      // for a game the cleaner stripped to a stub.
      setQuery(displayGameName(game));
      setSource("bangumi");
      setCandidates([]);
      setSelected(null);
      setSearching(false);
      setSearched(false);
      setShowDirect(false);
      setDirectBgm("");
      setDirectVndb("");
      setApplying(false);
    }
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search trigger — runs whenever (query, source) settles for 400ms.
  useEffect(() => {
    if (!game) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setCandidates([]);
      setSearched(false);
      return;
    }
    const timer = setTimeout(() => {
      setSearching(true);
      searchMetadata(trimmed, source)
        .then((c) => {
          setCandidates(c);
          setSearched(true);
        })
        .catch((e: unknown) => {
          toast.error(`搜索失败 — ${String(e)}`);
          setCandidates([]);
          setSearched(true);
        })
        .finally(() => {
          setSearching(false);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [query, source, game]);

  function confidenceBadge(c: number) {
    if (c >= 80) return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">{c}</Badge>;
    if (c >= 70) return <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30">{c}</Badge>;
    return <Badge variant="destructive">{c}</Badge>;
  }

  async function onApply() {
    if (!game) return;

    // Resolve which source + sourceId to apply: direct-ID inputs take
    // precedence if non-empty; otherwise the selected candidate.
    let toApply: { source: Source; sourceId: string } | null = null;
    if (showDirect) {
      if (directBgm.trim().length > 0) {
        toApply = { source: "bangumi", sourceId: directBgm.trim() };
      } else if (directVndb.trim().length > 0) {
        toApply = { source: "vndb", sourceId: directVndb.trim() };
      }
    }
    if (!toApply) toApply = selected;
    if (!toApply) {
      toast.error("请先选择候选项或填入 ID");
      return;
    }

    setApplying(true);
    try {
      await bindMetadata(game.id, toApply.source, toApply.sourceId);
      // 04d: refetch via searchGames so the active search/sort/filter
      // triple is preserved (pre-04d this used listGames which would
      // bypass any filter the user had set). Sidebar counts may shift
      // because the new metadata can introduce a brand / release_year
      // not previously seen — refresh those too.
      const trimmed = searchQuery.trim();
      const queryArg = trimmed === "" ? null : trimmed;
      const filterArg =
        filter.tag_id == null &&
        filter.status == null &&
        !filter.favorite &&
        filter.brand == null &&
        filter.year_decade == null
          ? null
          : filter;
      const fresh = await searchGames(queryArg, sortBy, filterArg);
      setGames(fresh);
      try {
        const cats = await getSidebarCategories();
        setSidebar(cats);
      } catch (e: unknown) {
        // Sidebar refresh is best-effort; don't fail the rebind on this.
        // eslint-disable-next-line no-console
        console.error("[MetadataPicker] sidebar refresh failed:", e);
      }
      toast.success("已应用元数据");
      onClose();
    } catch (e: unknown) {
      toast.error(`应用失败 — ${String(e)}`);
    } finally {
      setApplying(false);
    }
  }

  const open = !!game;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent
        className="grid-cols-1 sm:max-w-2xl overflow-hidden"
        // Quick 260519-21s — 关闭 picker 时不要把焦点强行甩回打开它的菜单
        // 触发元素。Dialog 默认的 onCloseAutoFocus 会聚焦回 ContextMenu /
        // DropdownMenu 的 Trigger，进而可能重放上一个被激活过的菜单项
        // （「打开目录」），导致重复弹出文件管理器窗口。配合菜单项改用
        // onSelect，从事件链路上彻底断掉这次重放。
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="min-w-0">
          <DialogTitle
            className="block min-w-0 max-w-full truncate pr-8"
            title={game ? displayGameName(game) : undefined}
          >
            {game
              ? `重新匹配元数据 — ${displayGameName(game)}`
              : "重新匹配元数据"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          {/* Source pill row — supplementary §5 design moves the toggle to its
              own row at the top, above the search input. */}
          <ToggleGroup
            type="single"
            value={source}
            variant="outline"
            size="sm"
            onValueChange={(v) => {
              if (v === "bangumi" || v === "vndb") setSource(v);
            }}
            className="self-start"
          >
            <ToggleGroupItem value="bangumi" variant="outline" size="sm">
              Bangumi
            </ToggleGroupItem>
            <ToggleGroupItem value="vndb" variant="outline" size="sm">
              VNDB
            </ToggleGroupItem>
          </ToggleGroup>

          <Input
            placeholder="搜索 Bangumi 或 VNDB"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full min-w-0"
          />

          {/* Direct ID toggle */}
          <div>
            <button
              type="button"
              onClick={() => setShowDirect((s) => !s)}
              className="text-label text-muted-foreground hover:text-foreground"
            >
              {showDirect ? "▾ 直接绑定 ID" : "▸ 直接绑定 ID"}
            </button>
            {showDirect && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Input
                  placeholder="bgm_id (例如 12345)"
                  value={directBgm}
                  onChange={(e) => setDirectBgm(e.target.value)}
                />
                <Input
                  placeholder="vndb_id (例如 v1234)"
                  value={directVndb}
                  onChange={(e) => setDirectVndb(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Candidate list
              Quick 260524-dlr — 行内文案宽度严格收敛到容器：
                · button 三件套 w-full / max-w-full / min-w-0 + overflow-hidden
                  确保 flex item 不被子内容撑开
                · 文本块统一用 <div> + break-words（CJK 长串无空格也能换行），
                  以兼容 line-clamp 触发条件
                · 标题 / 简介保留 line-clamp-3，溢出依靠 button 上的 title
                  做 hover tooltip 展示完整原文 */}
          <ScrollArea className="max-h-[400px] min-w-0 max-w-full overflow-x-hidden">
            <ul className="flex w-full min-w-0 max-w-full flex-col gap-2">
              {searching && (
                <li className="rounded-md border border-dashed border-border p-4 text-center text-body text-muted-foreground">
                  搜索中…
                </li>
              )}
              {!searching && searched && candidates.length === 0 && (
                <li className="rounded-md border border-dashed border-border p-4 text-center text-body text-muted-foreground">
                  未找到匹配项 — 请尝试不同关键词
                </li>
              )}
              {!searching &&
                candidates.map((c) => {
                  const isSelected =
                    selected?.source === c.source && selected?.sourceId === c.source_id;
                  const hoverTitle = [
                    c.title,
                    c.alias.length > 0 ? `别名：${c.alias.join(" · ")}` : null,
                    c.summary && c.summary.trim().length > 0 ? c.summary : null,
                    "(双击打开源数据页)",
                  ]
                    .filter(Boolean)
                    .join("\n\n");
                  // Quick 260524-dlr — 双击直接外开 Bangumi / VNDB 源页面。
                  // openExternalUrl 后端只放行 http(s)，已经把不合法 source
                  // 兜底成 bangumi，所以这里再做一次窄化保险。
                  function openSourcePage() {
                    const src: "bangumi" | "vndb" =
                      c.source === "vndb" ? "vndb" : "bangumi";
                    const url =
                      src === "vndb"
                        ? vndbVnUrl(c.source_id)
                        : bangumiSubjectUrl(c.source_id);
                    void openExternalUrl(url).catch((e: unknown) => {
                      toast.error(`打开失败 — ${String(e)}`);
                    });
                  }
                  return (
                    <li key={`${c.source}-${c.source_id}`} className="w-full min-w-0 max-w-full">
                      <button
                        type="button"
                        title={hoverTitle}
                        onClick={() =>
                          setSelected({
                            source: c.source === "bangumi" || c.source === "vndb" ? c.source : "bangumi",
                            sourceId: c.source_id,
                          })
                        }
                        onDoubleClick={openSourcePage}
                        className={`flex w-full min-w-0 max-w-full items-start gap-3 overflow-hidden border p-3 text-left transition ${
                          isSelected
                            ? "border-brand bg-brand-soft border-l-[3px]"
                            : "border-line hover:border-line-strong hover:bg-bg-2"
                        }`}
                        style={{ borderRadius: "var(--r-md)" }}
                      >
                        <div
                          className="flex-shrink-0 overflow-hidden rounded bg-secondary"
                          style={{ width: 60, height: 80 }}
                        >
                          {c.cover_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={c.cover_url}
                              alt={c.title}
                              className="h-full w-full object-cover"
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.display = "none";
                              }}
                            />
                          ) : null}
                        </div>
                        <div className="flex min-w-0 max-w-full flex-1 flex-col gap-1 overflow-hidden">
                          <div className="flex min-w-0 max-w-full items-start gap-2">
                            <div
                              className="min-w-0 flex-1 line-clamp-3 break-words text-body font-medium text-foreground"
                              title={c.title}
                            >
                              {c.title}
                            </div>
                            <span className="mt-0.5 flex-shrink-0">
                              {confidenceBadge(c.confidence)}
                            </span>
                          </div>
                          {c.alias.length > 0 && (
                            <div
                              className="line-clamp-2 break-words text-label text-muted-foreground"
                              title={c.alias.join(" · ")}
                            >
                              {c.alias.join(" · ")}
                            </div>
                          )}
                          {c.summary && c.summary.trim().length > 0 && (
                            <div
                              className="line-clamp-3 break-words text-label text-muted-foreground/80"
                              title={c.summary}
                            >
                              {c.summary}
                            </div>
                          )}
                          <div className="truncate text-label text-muted-foreground">
                            {c.source.toUpperCase()} · {c.source_id}
                            {c.release_date ? ` · ${c.release_date}` : ""}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
            </ul>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={applying}>
            取消
          </Button>
          <Button onClick={() => void onApply()} disabled={applying}>
            {applying ? "应用中…" : "应用"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
