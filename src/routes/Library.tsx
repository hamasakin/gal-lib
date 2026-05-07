/**
 * Library route ("/") — Phase 2 implementation.
 *
 * Replaces the Phase 1 empty-state placeholder. Renders:
 *   1. <ScanProgressBar /> sticky at top (auto-hides when idle/finished+5s)
 *   2. Conditional main pane:
 *      - 0 games + no scan ever → "还没有游戏" + "请到设置页添加扫描根目录" + "打开设置" (P1 reuse)
 *      - 0 games + scan completed → "未识别到游戏" + "请检查根目录扫描深度配置" + "回到设置" (P2 new)
 *      - games > 0 → <GameGrid /> virtualized grid
 *   3. <MetadataPicker /> dialog (controlled by `pickerGame` state — non-null = open)
 *
 * Routing-export note: `router.tsx` uses `import { Library }` — keep NAMED
 * export. Plan's draft code-block had `export default function Library()`
 * which would silently break the route. Same constraint as Settings.tsx.
 *
 * Refetch triggers:
 *   - On mount → initial `listGames()` to populate the store
 *   - On scan completion (`scanProgress.status === "completed"`) → refetch
 *     so the grid reflects newly ingested rows
 *   - GameGrid + MetadataPicker also refetch internally after
 *     bindMetadata / refreshMetadata mutations
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useLibraryStore } from "@/store/library";
import { listGames, type Game } from "@/lib/games";
import { GameGrid } from "@/components/library/GameGrid";
import { ScanProgressBar } from "@/components/library/ScanProgressBar";
import { ActiveSessionBar } from "@/components/library/ActiveSessionBar";
import { MetadataPicker } from "@/components/library/MetadataPicker";

export function Library() {
  const games = useLibraryStore((s) => s.games);
  const setGames = useLibraryStore((s) => s.setGames);
  const scanProgress = useLibraryStore((s) => s.scanProgress);
  const [pickerGame, setPickerGame] = useState<Game | null>(null);
  const navigate = useNavigate();

  // Initial load — populate the games slice from DB on mount.
  useEffect(() => {
    listGames()
      .then(setGames)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Library] listGames failed:", e);
      });
  }, [setGames]);

  // Refetch when a scan finishes — newly ingested rows surface in the grid.
  useEffect(() => {
    if (scanProgress?.status === "completed") {
      listGames()
        .then(setGames)
        .catch((e: unknown) => {
          // eslint-disable-next-line no-console
          console.error("[Library] post-scan listGames failed:", e);
        });
    }
  }, [scanProgress?.status, setGames]);

  const isEmpty = games.length === 0;
  const scanCompleted = scanProgress?.status === "completed";
  const noScanYet = isEmpty && !scanProgress;
  const scanFinishedZeroResults = isEmpty && scanCompleted;

  return (
    <div className="flex h-full w-full flex-col">
      <ScanProgressBar />
      {/* 03f: ActiveSessionBar renders below ScanProgressBar; both are
          sticky top-0 inside the same flex column, so when both are visible
          simultaneously (rare) ScanProgressBar wins the top slot and
          ActiveSessionBar stacks below it. ActiveSessionBar self-hides
          when activeSession is null. */}
      <ActiveSessionBar />
      <div className="flex-1 overflow-hidden">
        {noScanYet && (
          <ScrollArea className="h-full w-full">
            <div className="flex h-full min-h-full w-full items-center justify-center px-8 py-12">
              <div className="flex flex-col items-center gap-6 text-center">
                <h2 className="text-h2 text-foreground">还没有游戏</h2>
                <p className="text-body text-muted-foreground">
                  请到设置页添加扫描根目录
                </p>
                <Button variant="ghost" onClick={() => navigate("/settings")}>
                  打开设置
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}

        {scanFinishedZeroResults && (
          <ScrollArea className="h-full w-full">
            <div className="flex h-full min-h-full w-full items-center justify-center px-8 py-12">
              <div className="flex flex-col items-center gap-6 text-center">
                <h2 className="text-h2 text-foreground">未识别到游戏</h2>
                <p className="text-body text-muted-foreground">
                  请检查根目录扫描深度配置
                </p>
                <Button variant="ghost" onClick={() => navigate("/settings")}>
                  回到设置
                </Button>
              </div>
            </div>
          </ScrollArea>
        )}

        {!isEmpty && <GameGrid games={games} onPickMetadata={setPickerGame} />}
      </div>

      <MetadataPicker game={pickerGame} onClose={() => setPickerGame(null)} />
    </div>
  );
}
