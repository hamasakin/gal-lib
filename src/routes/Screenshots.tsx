/**
 * Screenshots route — `/screenshots` (v1.1 / Phase 10).
 *
 * Lists all games whose screenshots directory has at least one capture, in
 * masonry layout grouped by game. Each thumbnail opens a fullscreen lightbox.
 *
 * Data flow:
 *   1. On mount, hydrate games from store (or fetch via searchGames if empty)
 *   2. For each game, call `getScreenshots(gameId)` in parallel
 *   3. Filter to non-empty groups and render masonry per group
 *
 * Masonry implementation: CSS columns (`column-count: 4`, `column-gap: 10px`)
 * — same approach as the design contract. Each `.shot` is `break-inside:
 * avoid` so it doesn't fragment across columns. Heights derive from natural
 * image aspect ratios (no fixed heights — let images self-size).
 *
 * Lightbox: full-viewport overlay with backdrop blur, single image, close on
 * background click or X button.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ImageOff, X, FolderOpen } from "lucide-react";
import { useLibraryStore } from "@/store/library";
import { searchGames } from "@/lib/search";
import { getScreenshots, type Screenshot } from "@/lib/screenshots";
import { openGameDir } from "@/lib/games";
import { toast } from "sonner";
import { PageHeader } from "@/components/library/PageHeader";
import type { Game } from "@/lib/games";
import { cn } from "@/lib/utils";

interface GroupedShots {
  game: Game;
  shots: Screenshot[];
}

export default function Screenshots() {
  const { t } = useTranslation();
  const games = useLibraryStore((s) => s.games);
  const setGames = useLibraryStore((s) => s.setGames);
  const navigate = useNavigate();
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [groupedByGame, setGroupedByGame] = useState<GroupedShots[]>([]);
  const [active, setActive] = useState<{
    src: string;
    title: string;
    capturedAt: string;
  } | null>(null);

  useEffect(() => {
    invoke<string>("get_data_dir").then(setDataDir).catch(() => {});
  }, []);

  useEffect(() => {
    if (games.length === 0) {
      void searchGames(null, "last_played", null)
        .then(setGames)
        .catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[Screenshots] hydrate games failed:", e);
        });
    }
  }, [games.length, setGames]);

  // Fetch screenshots for every game in parallel; store only non-empty groups.
  useEffect(() => {
    if (games.length === 0) {
      setGroupedByGame([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        games.map(async (g) => {
          try {
            const shots = await getScreenshots(g.id);
            return shots.length > 0 ? { game: g, shots } : null;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      const nonEmpty = results.filter(
        (r): r is GroupedShots => r !== null,
      );
      // Sort groups by latest capture time desc
      nonEmpty.sort((a, b) => {
        const aT = a.shots[0]?.captured_at ?? "";
        const bT = b.shots[0]?.captured_at ?? "";
        return bT.localeCompare(aT);
      });
      setGroupedByGame(nonEmpty);
    })();
    return () => {
      cancelled = true;
    };
  }, [games]);

  const totalCount = useMemo(
    () => groupedByGame.reduce((a, g) => a + g.shots.length, 0),
    [groupedByGame],
  );

  function resolveSrc(path: string): string {
    if (!dataDir) return path;
    const abs = `${dataDir.replace(/\\/g, "/")}/${path}`;
    return convertFileSrc(abs);
  }

  function fmtTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(i18n.language, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="h-full overflow-auto">
      <PageHeader
        crumb={t("screenshots.crumb")}
        badge={t("screenshots.badge", { count: totalCount })}
        title={
          <>
            {t("screenshots.title_prefix")}
            <span className="text-brand italic">{t("screenshots.title_brand")}</span>
            {t("screenshots.title_suffix")}
          </>
        }
        sub={t("screenshots.sub", { count: groupedByGame.length })}
      />

      <div className="px-8 pb-16 pt-6">
        {groupedByGame.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-24">
            <p className="font-serif text-[20px] text-ink-1">{t("screenshots.empty_title")}</p>
            <p className="font-mono text-[11px] text-ink-3">
              {t("screenshots.empty_sub")}
            </p>
          </div>
        ) : (
          groupedByGame.map(({ game, shots }) => (
            <section key={game.id} className="mb-12">
              <header className="mb-3.5 flex items-baseline justify-between border-b border-line pb-2">
                <div className="flex items-baseline gap-3.5">
                  <span className="font-serif text-[18px] text-ink-0">
                    {game.name_cn ?? game.name}
                  </span>
                  <span className="font-mono text-[10.5px] text-ink-3">
                    {t("screenshots.group_count", {
                      count: shots.length,
                      datetime: fmtTime(shots[0]?.captured_at ?? ""),
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={!dataDir}
                    onClick={async () => {
                      if (!dataDir) return;
                      const dir = `${dataDir.replace(/\\/g, "/")}/screenshots/${game.id}`;
                      try {
                        await openGameDir(dir);
                      } catch (e: unknown) {
                        toast.error(t("toast.screenshot_dir_failed", { err: String(e) }));
                      }
                    }}
                    className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-ink-2 transition-colors hover:text-ink-0 disabled:cursor-not-allowed disabled:opacity-50"
                    title={t("screenshots.open_dir_tooltip")}
                  >
                    <FolderOpen size={12} strokeWidth={1.7} />
                    <span>{t("screenshots.open_dir")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/games/${game.id}`)}
                    className="font-mono text-[10.5px] text-ink-2 transition-colors hover:text-ink-0"
                  >
                    {t("screenshots.view_game")}
                  </button>
                </div>
              </header>

              <div
                style={{
                  columnCount: 4,
                  columnGap: 10,
                }}
                className="[@media(max-width:1300px)]:[column-count:3] [@media(max-width:900px)]:[column-count:2]"
              >
                {shots.slice(0, 24).map((s) => {
                  const src = resolveSrc(s.path);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setActive({
                          src,
                          title: game.name_cn ?? game.name,
                          capturedAt: s.captured_at,
                        })
                      }
                      className={cn(
                        "group relative mb-2.5 block w-full overflow-hidden border border-line",
                        "transition-transform hover:border-line-strong",
                      )}
                      style={{
                        breakInside: "avoid",
                        borderRadius: "var(--r-sm)",
                      }}
                    >
                      <img
                        src={src}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        className="block w-full"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                      <span
                        className="absolute bottom-1.5 right-2 bg-black/55 px-1.5 py-px font-mono text-[9.5px] text-white/85 opacity-0 transition-opacity group-hover:opacity-100"
                        style={{ borderRadius: 2 }}
                      >
                        {fmtTime(s.captured_at)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {shots.length > 24 && (
                <button
                  type="button"
                  onClick={() => navigate(`/games/${game.id}?tab=screenshots`)}
                  className="mt-2 font-mono text-[10.5px] text-ink-2 hover:text-ink-0"
                >
                  {t("screenshots.view_all", { count: shots.length })}
                </button>
              )}
            </section>
          ))
        )}
      </div>

      {/* Lightbox */}
      {active && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/85 backdrop-blur-md"
          onClick={() => setActive(null)}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActive(null);
            }}
            aria-label={t("screenshots.close")}
            className="absolute right-5 top-5 grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X size={18} />
          </button>
          <div
            className="overflow-hidden bg-bg-1"
            style={{
              maxWidth: "80vw",
              maxHeight: "78vh",
              borderRadius: "var(--r-md)",
              boxShadow: "var(--shadow-lift)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={active.src}
              alt=""
              className="block max-h-[78vh] max-w-[80vw] object-contain"
            />
          </div>
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 font-mono text-[11px] text-white/65">
            {active.title} · {fmtTime(active.capturedAt)}
          </div>
        </div>
      )}
    </div>
  );
}

// Suppress unused-import warning for FolderOpen / ImageOff imports if not used.
// (Kept here for future "open screenshots dir" + empty-state visuals.)
void FolderOpen;
void ImageOff;
