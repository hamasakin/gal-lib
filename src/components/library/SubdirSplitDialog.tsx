/**
 * SubdirSplitDialog — Quick 260516-q3y「整理子目录」对话框.
 *
 * 把一个被误识别成单款游戏的「品牌名父目录」条目，拆分成 N 个独立游戏条目。
 * 入口由 GameCard 右键菜单 / Detail「更多」菜单复用同一个对话框。
 *
 * 行为：
 *   - `game` 非 null 时打开；初始浏览 `game.path` 下的直接子目录。
 *   - 每行 = 复选框 + 目录名 + clean_title 预览名 + 检测到的 exe。
 *   - 检测到 exe 的子目录默认勾选，无 exe 的默认不勾。
 *   - 点目录名区域可下钻进入更深层，「返回上一层」回退。
 *   - 「手动浏览…」可从系统文件夹对话框追加任意路径到候选并勾选。
 *   - 确认 → `splitGameIntoSubdirs(game.id, [...selected])` → 成功 toast +
 *     `onSplit?.()` + 关闭；失败 toast 保持对话框打开。
 *
 * 注意：本组件不判断用户数据 —— 带用户数据的删除确认由父组件在打开本对话框
 * 之前处理（见 Library.tsx / Detail.tsx 的 AlertDialog 流程）。
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  listSubdirs,
  splitGameIntoSubdirs,
  type SubdirEntry,
} from "@/lib/scan";
import { type Game } from "@/lib/games";

interface SubdirSplitDialogProps {
  /** When non-null the dialog is open; null closes. */
  game: Game | null;
  onClose: () => void;
  /** Called after a successful split (父组件用于刷新列表 / 导航). */
  onSplit?: () => void;
}

/** 取路径 basename — 兼容 Windows `\` 与 POSIX `/` 分隔符. */
function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter((s) => s.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

/**
 * 「带用户数据」判定 —— 父组件在打开本对话框前调用，决定是否先弹删除确认。
 * 标签 / 会话记录无法从 Game 行直接读到；playtime>0 已覆盖「有会话」的等价
 * 情形，本次以 Game 行字段为准。
 */
export function gameHasUserData(g: Game): boolean {
  return (
    g.total_playtime_sec > 0 ||
    (g.notes != null && g.notes.trim() !== "") ||
    g.is_favorite === true ||
    g.status !== "unplayed"
  );
}

export function SubdirSplitDialog({
  game,
  onClose,
  onSplit,
}: SubdirSplitDialogProps) {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [pathStack, setPathStack] = useState<string[]>([]);
  const [entries, setEntries] = useState<SubdirEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [splitting, setSplitting] = useState(false);

  // 对话框为新 game 打开时重置全部状态。
  useEffect(() => {
    if (game) {
      setCurrentPath(game.path);
      setPathStack([]);
      setEntries([]);
      setSelected(new Set());
      setLoading(false);
      setSplitting(false);
    }
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 加载当前目录的子目录；加载完成后对「有 exe 且尚未在 selected 中」的条目
  // 做默认勾选（不覆盖用户已有的取消勾选）。
  useEffect(() => {
    if (!game || currentPath === "") return;
    let cancelled = false;
    setLoading(true);
    listSubdirs(currentPath)
      .then((list) => {
        if (cancelled) return;
        setEntries(list);
        setSelected((prev) => {
          // CR-06 defence-in-depth: re-check `cancelled` inside the
          // functional updater. React 18+ batches state updates and may
          // invoke the updater on a later microtask, by which time
          // another `drillInto` could have flipped the effect's cleanup
          // flag. Without this guard the default-prefill of exe paths
          // from the just-aborted directory would be merged into the
          // new directory's selected set.
          if (cancelled) return prev;
          const next = new Set(prev);
          for (const e of list) {
            if (e.exe != null && !next.has(e.path)) {
              next.add(e.path);
            }
          }
          return next;
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        toast.error(`读取子目录失败 — ${String(e)}`);
        setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentPath, game]);

  function toggleSelect(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function drillInto(entry: SubdirEntry) {
    setPathStack((stack) => [...stack, currentPath]);
    setCurrentPath(entry.path);
  }

  function goBack() {
    setPathStack((stack) => {
      if (stack.length === 0) return stack;
      const next = [...stack];
      const prev = next.pop()!;
      setCurrentPath(prev);
      return next;
    });
  }

  async function onManualBrowse() {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== "string" || picked.length === 0) return;
      // 勾选该路径。
      setSelected((prev) => {
        const next = new Set(prev);
        next.add(picked);
        return next;
      });
      // 若已在 entries 中则只勾选不重复追加；否则追加一个展示用条目。
      setEntries((prev) => {
        if (prev.some((e) => e.path === picked)) return prev;
        return [
          ...prev,
          {
            name: basename(picked),
            path: picked,
            clean_title: "",
            exe: null,
          },
        ];
      });
    } catch (e: unknown) {
      toast.error(`选择目录失败 — ${String(e)}`);
    }
  }

  async function onConfirm() {
    if (!game || selected.size === 0) return;
    setSplitting(true);
    try {
      await splitGameIntoSubdirs(game.id, [...selected]);
      toast.success(`已拆分为 ${selected.size} 个游戏`);
      onSplit?.();
      onClose();
    } catch (e: unknown) {
      toast.error(`拆分失败 — ${String(e)}`);
    } finally {
      setSplitting(false);
    }
  }

  const isOpen = !!game;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(o) => {
        if (!o && !splitting) onClose();
      }}
    >
      <DialogContent className="grid-cols-1 sm:max-w-2xl overflow-hidden">
        <DialogHeader className="min-w-0">
          <DialogTitle className="block min-w-0 max-w-full truncate pr-8">
            整理子目录
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          {/* 顶部：当前路径 + 返回上一层 */}
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="min-w-0 flex-1 truncate text-label text-muted-foreground"
              title={currentPath}
            >
              {currentPath}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={goBack}
              disabled={pathStack.length === 0 || splitting}
              className="flex-shrink-0"
            >
              返回上一层
            </Button>
          </div>

          {/* 子目录列表 */}
          <ScrollArea className="max-h-[400px] min-w-0">
            <ul className="flex min-w-0 flex-col gap-2">
              {loading && (
                <li className="rounded-md border border-dashed border-border p-4 text-center text-body text-muted-foreground">
                  读取中…
                </li>
              )}
              {!loading && entries.length === 0 && (
                <li className="rounded-md border border-dashed border-border p-4 text-center text-body text-muted-foreground">
                  该目录下没有子目录
                </li>
              )}
              {!loading &&
                entries.map((entry) => {
                  const checked = selected.has(entry.path);
                  return (
                    <li key={entry.path}>
                      <div
                        className={`flex w-full max-w-full items-center gap-3 overflow-hidden border p-3 text-left transition ${
                          checked
                            ? "border-brand bg-brand-soft border-l-[3px]"
                            : "border-line hover:border-line-strong hover:bg-bg-2"
                        }`}
                        style={{ borderRadius: "var(--r-md)" }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSelect(entry.path)}
                          className="h-4 w-4 flex-shrink-0 cursor-pointer accent-[var(--brand,#e0506a)]"
                        />
                        <button
                          type="button"
                          onClick={() => drillInto(entry)}
                          className="flex min-w-0 flex-1 flex-col gap-1 text-left"
                          title={`下钻进入 ${entry.name}`}
                        >
                          <span
                            className="truncate text-body font-medium text-foreground"
                            title={entry.name}
                          >
                            {entry.name}
                          </span>
                          {entry.clean_title !== "" &&
                            entry.clean_title !== entry.name && (
                              <span
                                className="truncate text-label text-muted-foreground"
                                title={entry.clean_title}
                              >
                                预览名：{entry.clean_title}
                              </span>
                            )}
                          <span
                            className={`truncate text-label ${
                              entry.exe
                                ? "text-muted-foreground"
                                : "text-muted-foreground/60"
                            }`}
                          >
                            {entry.exe
                              ? `exe：${basename(entry.exe)}`
                              : "无 exe"}
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })}
            </ul>
          </ScrollArea>

          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onManualBrowse()}
              disabled={splitting}
            >
              手动浏览…
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={splitting}>
            取消
          </Button>
          <Button
            onClick={() => void onConfirm()}
            disabled={selected.size === 0 || splitting}
          >
            {splitting
              ? "拆分中…"
              : `拆分为 ${selected.size} 个游戏`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

SubdirSplitDialog.displayName = "SubdirSplitDialog";
