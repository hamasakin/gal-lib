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
import { listGames, type Game } from "@/lib/games";
import { useLibraryStore } from "@/store/library";

interface MetadataPickerProps {
  /** When non-null the dialog is open; null closes. */
  game: Game | null;
  onClose: () => void;
}

type Source = "bangumi" | "vndb";

export function MetadataPicker({ game, onClose }: MetadataPickerProps) {
  const setGames = useLibraryStore((s) => s.setGames);

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
      setQuery(game.name ?? "");
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
      const fresh = await listGames();
      setGames(fresh);
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {game ? `重新匹配元数据 — ${game.name_cn ?? game.name}` : "重新匹配元数据"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Search input + source toggle */}
          <div className="flex items-center gap-3">
            <Input
              placeholder="搜索 Bangumi 或 VNDB"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1"
            />
            <ToggleGroup
              type="single"
              value={source}
              onValueChange={(v) => {
                if (v === "bangumi" || v === "vndb") setSource(v);
              }}
            >
              <ToggleGroupItem value="bangumi">Bangumi</ToggleGroupItem>
              <ToggleGroupItem value="vndb">VNDB</ToggleGroupItem>
            </ToggleGroup>
          </div>

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

          {/* Candidate list */}
          <ScrollArea className="max-h-[400px]">
            <ul className="flex flex-col gap-2">
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
                  return (
                    <li key={`${c.source}-${c.source_id}`}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelected({
                            source: c.source === "bangumi" || c.source === "vndb" ? c.source : "bangumi",
                            sourceId: c.source_id,
                          })
                        }
                        className={`flex w-full items-start gap-3 rounded-md border p-3 text-left transition ${
                          isSelected
                            ? "border-ring bg-accent/20"
                            : "border-border hover:bg-secondary"
                        }`}
                      >
                        <div className="size-[60px_80px] shrink-0 overflow-hidden rounded bg-secondary" style={{ width: 60, height: 80 }}>
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
                        <div className="flex flex-1 flex-col gap-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate text-body font-medium text-foreground">
                              {c.title}
                            </span>
                            {confidenceBadge(c.confidence)}
                          </div>
                          {c.alias.length > 0 && (
                            <span className="truncate text-label text-muted-foreground">
                              {c.alias.join(" · ")}
                            </span>
                          )}
                          <span className="text-label text-muted-foreground">
                            {c.source.toUpperCase()} · {c.source_id}
                            {c.release_date ? ` · ${c.release_date}` : ""}
                          </span>
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
