/**
 * GameGroupGrid — quick 260710-709 品牌分组视图。
 *
 * 把游戏卡片按 brand（开发商）一组一组分组展示，每组一个品牌名标题，
 * 组内仍是密度自适应的卡片网格。与 GameGrid 不同：本组件非虚拟化，
 * 直接渲染进 Library 的滚动容器，用原生 CSS grid `repeat(auto-fill,
 * minmax(var(--card-w), 1fr))` 响应密度变量（无需手测列数）。
 *
 * brand 为 null / 空串的游戏归入「未知品牌」组，该组恒定排在最后。
 * 组内游戏保持传入顺序（已是 server 排序 + 高级过滤后的结果），
 * 组间按品牌名 localeCompare("zh") 升序。
 *
 * UI 文案硬编码中文（与 ViewToggle 硬编码风格一致，不引 i18n）。
 */

import { useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { GameCard } from "./GameCard";
import { refreshMetadata } from "@/lib/metadata";
import type { Game } from "@/lib/games";

interface GameGroupGridProps {
  games: Game[];
  onPickMetadata: (game: Game) => void;
  onSplitSubdirs: (game: Game) => void;
  onRequestDelete: (game: Game) => void;
  onChildMutation?: () => void;
}

// 未知品牌组的稳定 key（不会与任何真实品牌名冲突）与显示名。
const UNKNOWN = " __unknown_brand__";
const UNKNOWN_LABEL = "未知品牌";

// 与 GameGrid 的列间距保持视觉一致。
const COLUMN_GAP = 22;
const ROW_GAP = 28;

interface BrandGroup {
  key: string;
  label: string;
  games: Game[];
}

export function GameGroupGrid({
  games,
  onPickMetadata,
  onSplitSubdirs,
  onRequestDelete,
  onChildMutation,
}: GameGroupGridProps) {
  // 复刻 GameGrid 的自包含封面解析：一次性拉取 dataDir + resolveCover 闭包。
  const [dataDir, setDataDir] = useState<string | null>(null);
  useEffect(() => {
    invoke<string>("get_data_dir")
      .then(setDataDir)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[GameGroupGrid] get_data_dir failed:", e);
      });
  }, []);

  const resolveCover = useMemo(() => {
    return (game: Game): string | null => {
      if (game.cover_path && dataDir) {
        const abs = `${dataDir.replace(/\\/g, "/")}/${game.cover_path}`;
        return (
          convertFileSrc(abs) +
          `?v=${encodeURIComponent(game.last_scanned_at ?? "")}`
        );
      }
      return game.cover_url ?? null;
    };
  }, [dataDir]);

  // 按 brand 归组 → 组间排序（未知品牌恒定最后）。
  const groups = useMemo<BrandGroup[]>(() => {
    const byKey = new Map<string, BrandGroup>();
    for (const g of games) {
      const trimmed = g.brand?.trim() ?? "";
      const key = trimmed === "" ? UNKNOWN : trimmed;
      const label = trimmed === "" ? UNKNOWN_LABEL : trimmed;
      let group = byKey.get(key);
      if (!group) {
        group = { key, label, games: [] };
        byKey.set(key, group);
      }
      group.games.push(g);
    }
    return Array.from(byKey.values()).sort((a, b) => {
      if (a.key === UNKNOWN) return 1;
      if (b.key === UNKNOWN) return -1;
      return a.label.localeCompare(b.label, "zh");
    });
  }, [games]);

  // GameCard 需要 onRefreshCover / onMutated 回调 —— 均归约到 onChildMutation。
  const onRefreshCover = async (game: Game) => {
    try {
      await refreshMetadata(game.id);
      onChildMutation?.();
      toast.success("已刷新封面");
    } catch (e: unknown) {
      toast.error(`刷新封面失败 — ${String(e)}`);
    }
  };

  return (
    <div className="px-8 pb-20 pt-7 space-y-10">
      {groups.map((group) => (
        <section key={group.key}>
          <div className="mb-4 flex items-baseline gap-2 border-b border-line pb-2 font-serif text-[15px] text-ink-0">
            <span>{group.label}</span>
            <span className="font-mono text-[11px] text-ink-3">
              {group.games.length}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fill, minmax(var(--card-w), 1fr))",
              columnGap: `${COLUMN_GAP}px`,
              rowGap: `${ROW_GAP}px`,
              alignItems: "start",
            }}
          >
            {group.games.map((g) => (
              <GameCard
                key={g.id}
                game={g}
                coverDataUrl={resolveCover(g)}
                onPickMetadata={onPickMetadata}
                onRefreshCover={onRefreshCover}
                onSplitSubdirs={onSplitSubdirs}
                onRequestDelete={onRequestDelete}
                onMutated={onChildMutation}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
