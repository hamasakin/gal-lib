/**
 * SavesTab — Phase 5 / 05e Detail page tab.
 *
 * Manages a game's save-backup lifecycle: configure source dir → create
 * timestamped backups → list / restore / delete past backups.
 *
 * Layout:
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ 存档目录: [ /abs/path/saves          ] [ 选择... ]               │
 *   │ [ 备份当前存档 ]                                                 │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │ 时间          文件数  大小      操作                              │
 *   │ 2026-05-08 …    12     4.3 MB   [恢复] [删除]                    │
 *   │ ...                                                               │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Data flow:
 *   1. Mount → `getSavePath(gameId)` (hydrates Input) and
 *      `listSaveBackups(gameId)` (hydrates table). Both populate local
 *      state via the global library store (`saveBackupsByGame[gameId]`).
 *   2. 选择 → tauri-plugin-dialog `open({ directory: true })` →
 *      `setSavePath(gameId, picked)` → re-hydrate the Input.
 *   3. 备份当前存档 → AlertDialog confirm → `createSaveBackup(gameId, null)` →
 *      refetch list. Shows backend error verbatim on failure (e.g.
 *      "save path not configured" if user clicks before configuring).
 *   4. 恢复 / 删除 → AlertDialog confirm → `restoreSaveBackup(id)` /
 *      `deleteSaveBackup(id)` → refetch list (delete only; restore doesn't
 *      change the rowset).
 *
 * Locked Chinese copy (UI-SPEC contract — do not edit without re-locking):
 *   存档目录 / 选择... / 备份当前存档 /
 *   确定备份？将复制存档目录到 data/saves/{game_id}/{timestamp}/ /
 *   确定恢复此备份？将覆盖当前存档目录 / 已恢复存档 /
 *   确定删除此备份？此操作不可恢复 /
 *   还没有存档备份 — 配置存档目录后点上方按钮开始备份 /
 *   已设置存档目录 / 时间 / 文件数 / 大小 / 操作 / 恢复 / 删除 / 取消 / 确定
 *
 * Note: `dataDir` is currently unused for path resolution (the table
 * shows backend-derived metadata, not on-disk paths) but is accepted as
 * a prop to mirror the ScreenshotsTab signature and leave room for a
 * future "open in explorer" affordance.
 */

import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  createSaveBackup,
  deleteSaveBackup,
  getSavePath,
  listSaveBackups,
  restoreSaveBackup,
  setSavePath,
  type SaveBackup,
} from "@/lib/saves";
import { useLibraryStore } from "@/store/library";
import type { Game } from "@/lib/games";

interface SavesTabProps {
  game: Game;
  /** Absolute path to the portable `data/` dir; null until App boot resolves. */
  dataDir: string | null;
}

/**
 * Format a bytes count as a human-readable size (KB / MB / GB).
 * Mirrors the backend `total_size_bytes` semantics: integer bytes; the UI
 * picks the largest unit ≥ 1.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function SavesTab({ game, dataDir: _dataDir }: SavesTabProps) {
  const gameId = game.id;
  const saveBackupsByGame = useLibraryStore((s) => s.saveBackupsByGame);
  const setSaveBackupsForGame = useLibraryStore(
    (s) => s.setSaveBackupsForGame,
  );
  const backups: SaveBackup[] = saveBackupsByGame[gameId] ?? [];

  const [savePath, setSavePathLocal] = useState<string>("");
  const [pendingBackup, setPendingBackup] = useState(false);
  const [pendingRestoreId, setPendingRestoreId] = useState<number | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  async function refetchBackups() {
    try {
      const rows = await listSaveBackups(gameId);
      setSaveBackupsForGame(gameId, rows);
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error("[SavesTab] listSaveBackups failed:", err);
      toast.error(`加载存档列表失败 — ${String(err)}`);
    }
  }

  async function refetchSavePath() {
    try {
      const p = await getSavePath(gameId);
      setSavePathLocal(p ?? "");
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error("[SavesTab] getSavePath failed:", err);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(gameId)) return;
    void refetchSavePath();
    void refetchBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  async function onPickSavePath() {
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: savePath || undefined,
      });
      if (picked == null) return; // user cancelled
      const next = Array.isArray(picked) ? picked[0] : picked;
      if (!next) return;
      await setSavePath(gameId, next);
      setSavePathLocal(next);
      toast.success("已设置存档目录");
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error("[SavesTab] setSavePath failed:", err);
      toast.error(`设置存档目录失败 — ${String(err)}`);
    }
  }

  async function onBackupConfirmed() {
    try {
      await createSaveBackup(gameId, null);
      toast.success("已备份存档");
      await refetchBackups();
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error("[SavesTab] createSaveBackup failed:", err);
      toast.error(`备份失败 — ${String(err)}`);
    } finally {
      setPendingBackup(false);
    }
  }

  async function onRestoreConfirmed() {
    if (pendingRestoreId == null) return;
    const id = pendingRestoreId;
    try {
      await restoreSaveBackup(id);
      toast.success("已恢复存档");
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error("[SavesTab] restoreSaveBackup failed:", err);
      toast.error(`恢复失败 — ${String(err)}`);
    } finally {
      setPendingRestoreId(null);
    }
  }

  async function onDeleteConfirmed() {
    if (pendingDeleteId == null) return;
    const id = pendingDeleteId;
    try {
      await deleteSaveBackup(id);
      toast.success("已删除备份");
      await refetchBackups();
    } catch (err: unknown) {
      // eslint-disable-next-line no-console
      console.error("[SavesTab] deleteSaveBackup failed:", err);
      toast.error(`删除失败 — ${String(err)}`);
    } finally {
      setPendingDeleteId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Save path config row ─────────────────────────────────────── */}
      <div className="space-y-2">
        <span className="text-label text-muted-foreground">存档目录</span>
        <div className="flex gap-2">
          <Input
            value={savePath}
            readOnly
            placeholder="未配置 — 点右侧按钮选择目录"
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onPickSavePath()}
          >
            选择...
          </Button>
        </div>
      </div>

      {/* ── Backup-now button ────────────────────────────────────────── */}
      <div>
        <Button
          type="button"
          onClick={() => setPendingBackup(true)}
          disabled={!savePath}
        >
          备份当前存档
        </Button>
      </div>

      {/* ── Backup list ──────────────────────────────────────────────── */}
      {backups.length === 0 ? (
        <p className="text-body text-muted-foreground">
          还没有存档备份 — 配置存档目录后点上方按钮开始备份
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-body">
            <thead className="bg-secondary text-label text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">时间</th>
                <th className="px-3 py-2 text-right">文件数</th>
                <th className="px-3 py-2 text-right">大小</th>
                <th className="px-3 py-2 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr
                  key={b.id}
                  className="border-t border-border text-foreground"
                >
                  <td className="px-3 py-2">
                    {new Date(b.created_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-3 py-2 text-right">{b.file_count}</td>
                  <td className="px-3 py-2 text-right">
                    {formatBytes(b.total_size_bytes)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setPendingRestoreId(b.id)}
                      >
                        恢复
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-rose-400 hover:text-rose-400"
                        onClick={() => setPendingDeleteId(b.id)}
                      >
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Backup confirm AlertDialog ───────────────────────────────── */}
      <AlertDialog
        open={pendingBackup}
        onOpenChange={(open) => {
          if (!open) setPendingBackup(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定备份？</AlertDialogTitle>
            <AlertDialogDescription>
              {`将复制存档目录到 data/saves/${gameId}/{timestamp}/`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" size="sm">
                取消
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button size="sm" onClick={() => void onBackupConfirmed()}>
                确定
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Restore confirm AlertDialog ──────────────────────────────── */}
      <AlertDialog
        open={pendingRestoreId != null}
        onOpenChange={(open) => {
          if (!open) setPendingRestoreId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定恢复此备份？</AlertDialogTitle>
            <AlertDialogDescription>
              将覆盖当前存档目录
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" size="sm">
                取消
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button size="sm" onClick={() => void onRestoreConfirmed()}>
                确定
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete confirm AlertDialog ───────────────────────────────── */}
      <AlertDialog
        open={pendingDeleteId != null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确定删除此备份？</AlertDialogTitle>
            <AlertDialogDescription>此操作不可恢复</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" size="sm">
                取消
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void onDeleteConfirmed()}
              >
                确定
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
