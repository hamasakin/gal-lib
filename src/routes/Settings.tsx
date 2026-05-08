/**
 * Settings route ("/settings") — Phase 2 implementation.
 *
 * Replaces the Phase 1 placeholder ("设置 — 即将上线"). Provides the
 * "scan_roots" CRUD UI and the "全量扫描 / 增量扫描" trigger buttons,
 * matching `02-UI-SPEC.md §Settings Page` verbatim:
 *   - max-width 720px, single-column, p-6
 *   - section "扫描根目录" — list + Depth select + Remove (with confirm) + Add
 *   - section "扫描操作" — full + incremental scan buttons
 *
 * Locked copy (UI-SPEC §Copywriting Contract — DO NOT edit):
 *   设置 / 扫描根目录 / gal-lib 会扫描这些目录下的游戏 /
 *   第 1 层 / 第 2 层 / 第 3 层 / 添加根目录 /
 *   全量扫描 / 增量扫描 /
 *   确定移除该根目录？ / 已扫描的游戏不会被删除
 *
 * Routing-export note: `router.tsx` imports `{ Settings }` (NAMED export),
 * so this file MUST `export function Settings`. Do NOT switch to default
 * export — would silently break the route to render `undefined`.
 *
 * State-flow note: after add/remove/depth-change we always re-fetch the full
 * `listScanRoots()` rather than mutating store optimistically — keeps the
 * frontend cache aligned with SQLite truth (no stale rowid problems).
 */

import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  addGame,
  addScanRoot,
  clearAllData,
  listScanRoots,
  removeScanRoot,
  startScan,
} from "@/lib/scan";
import { getSidebarCategories, searchGames } from "@/lib/search";
// 03f: LE path config — alias setLePath to applyLePath to avoid clashing
// with the local React state setter `setLePath` (same name).
import { getLePath, setLePath as applyLePath } from "@/lib/launch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
import { useLibraryStore } from "@/store/library";
import { useNavigate } from "react-router-dom";
// 04f: Settings page polish — Tag CRUD + UI preferences sections appended
// to the existing P2/P3 sections (扫描根目录 / Locale Emulator / 扫描操作).
import { TagManager } from "@/components/settings/TagManager";
import { UIPreferences } from "@/components/settings/UIPreferences";

export function Settings() {
  const scanRoots = useLibraryStore((s) => s.scanRoots);
  const setScanRoots = useLibraryStore((s) => s.setScanRoots);
  const navigate = useNavigate();
  // 03f: LE path display state. `null` = backend has no persisted path
  // (or persisted path is stale and was filtered out — see 03d's
  // `get_le_path` stale-fallback). UI renders the locked copy "未检测到"
  // in that case.
  const [lePath, setLePath] = useState<string | null>(null);
  const [isAddingGame, setIsAddingGame] = useState(false);

  // Initial load — refresh on mount so Settings always shows DB truth (e.g.
  // user opens Settings the first time, or after a hot-reload).
  useEffect(() => {
    listScanRoots()
      .then(setScanRoots)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Settings] listScanRoots failed:", e);
      });
    getLePath()
      .then(setLePath)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Settings] getLePath failed:", e);
      });
  }, [setScanRoots]);

  /**
   * Manual LE path override. Opens a file-picker filtered to .exe, sends
   * the picked path to `set_le_path` (which validates `exists()` and
   * persists to data/config.json::le_path). On success the input updates
   * and a confirmation toast renders.
   */
  async function onPickLePath() {
    let picked: string | string[] | null;
    try {
      picked = await openDialog({
        filters: [{ name: "LEProc", extensions: ["exe"] }],
        multiple: false,
      });
    } catch (e: unknown) {
      toast.error(`打开文件选择失败 — ${String(e)}`);
      return;
    }
    if (typeof picked !== "string") return; // user cancelled
    try {
      await applyLePath(picked);
      setLePath(picked);
      toast.success("已设置 LE 路径");
    } catch (e: unknown) {
      toast.error(`设置失败 — ${String(e)}`);
    }
  }

  async function onAdd() {
    let picked: string | string[] | null;
    try {
      picked = await openDialog({ directory: true, multiple: false });
    } catch (e: unknown) {
      toast.error(`打开目录选择失败 — ${String(e)}`);
      return;
    }
    // Tauri's plugin-dialog returns: string (single path) | string[] (multi)
    // | null (cancel). With multiple:false, we expect string|null.
    if (typeof picked !== "string") return; // user cancelled

    try {
      await addScanRoot(picked, 1); // default depth = 1 (UI-SPEC default)
      const rs = await listScanRoots();
      setScanRoots(rs);
      toast.success("已添加根目录");
    } catch (e: unknown) {
      toast.error(`添加失败 — ${String(e)}`);
    }
  }

  async function onAddSingleGame() {
    let picked: string | string[] | null;
    try {
      picked = await openDialog({ directory: true, multiple: false });
    } catch (e: unknown) {
      toast.error(`打开目录选择失败 — ${String(e)}`);
      return;
    }
    if (typeof picked !== "string") return;
    // Display the dir basename in the loading toast so the user knows which
    // game is being added (the metadata fetch can take 5-30s on a fresh app
    // due to Bangumi's 1 req/s rate limit).
    const basename = picked.split(/[\\/]/).pop() || picked;
    setIsAddingGame(true);
    const job = (async () => {
      await addGame(picked as string);
      const [games, sidebar] = await Promise.all([
        searchGames(null, "last_played", null),
        getSidebarCategories(),
      ]);
      useLibraryStore.getState().setGames(games);
      useLibraryStore.getState().setSidebar(sidebar);
    })();
    toast.promise(job, {
      loading: `正在添加 ${basename} ...`,
      success: "已添加游戏",
      error: (e) => `添加失败 — ${String(e)}`,
    });
    try {
      await job;
    } catch {
      // Error already surfaced via toast.promise; swallow so the catch
      // doesn't bubble to React's unhandled-rejection handler.
    } finally {
      setIsAddingGame(false);
    }
  }

  async function onRemove(id: number) {
    try {
      await removeScanRoot(id);
      const rs = await listScanRoots();
      setScanRoots(rs);
      toast.success("已移除根目录");
    } catch (e: unknown) {
      toast.error(`移除失败 — ${String(e)}`);
    }
  }

  // Backend doesn't expose an UPDATE command for scan_roots (path is the
  // UNIQUE index; depth is the only mutable column). Phase 2 implements
  // depth change as remove + re-add — semantically equivalent for users
  // (no scanned games get deleted by removing a root, per CONTEXT.md
  // "scanned games are NOT auto-deleted on root removal").
  async function onChangeDepth(id: number, depth: 1 | 2 | 3) {
    const target = scanRoots.find((r) => r.id === id);
    if (!target) return;
    try {
      await removeScanRoot(id);
      await addScanRoot(target.path, depth);
      const rs = await listScanRoots();
      setScanRoots(rs);
    } catch (e: unknown) {
      toast.error(`修改深度失败 — ${String(e)}`);
    }
  }

  async function onClearAllData() {
    try {
      await clearAllData();
      const [games, sidebar, roots] = await Promise.all([
        searchGames(null, "last_played", null),
        getSidebarCategories(),
        listScanRoots(),
      ]);
      useLibraryStore.getState().setGames(games);
      useLibraryStore.getState().setSidebar(sidebar);
      setScanRoots(roots);
      toast.success("已清除所有数据");
    } catch (e: unknown) {
      toast.error(`清除失败 — ${String(e)}`);
    }
  }

  async function onScan(mode: "full" | "incremental") {
    if (scanRoots.length === 0) {
      toast.error("请先添加至少一个扫描根目录");
      return;
    }
    try {
      await startScan(mode);
      toast.info("扫描已启动");
      navigate("/");
    } catch (e: unknown) {
      toast.error(`启动扫描失败 — ${String(e)}`);
    }
  }

  return (
    <ScrollArea className="h-full w-full">
      <div className="mx-auto max-w-[720px] space-y-8 p-6">
        <h1 className="text-h2 font-semibold text-foreground">设置</h1>

        {/* ─── 扫描根目录 section ─────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">
              扫描根目录
            </h2>
            <p className="text-body text-muted-foreground">
              gal-lib 会扫描这些目录下的游戏
            </p>
          </div>

          <ul className="space-y-2">
            {scanRoots.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
              >
                <span
                  className="flex-1 truncate text-body text-foreground"
                  title={r.path}
                >
                  {r.path}
                </span>
                <Select
                  value={String(r.depth)}
                  onValueChange={(v) =>
                    void onChangeDepth(r.id, Number(v) as 1 | 2 | 3)
                  }
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">第 1 层</SelectItem>
                    <SelectItem value="2">第 2 层</SelectItem>
                    <SelectItem value="3">第 3 层</SelectItem>
                  </SelectContent>
                </Select>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hover:text-destructive"
                      aria-label="移除"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确定移除该根目录？</AlertDialogTitle>
                      <AlertDialogDescription>
                        已扫描的游戏不会被删除
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void onRemove(r.id)}>
                        移除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
            {scanRoots.length === 0 && (
              <li className="rounded-md border border-dashed border-border p-6 text-center text-body text-muted-foreground">
                还没有根目录 — 点下方按钮添加
              </li>
            )}
          </ul>

          <Button onClick={() => void onAdd()}>添加根目录</Button>
        </section>

        {/* ─── 添加单个游戏 section ───────────────────────────────────── */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">
              添加单个游戏
            </h2>
            <p className="text-body text-muted-foreground">
              跳过扫描，直接选择某个游戏目录加入库
            </p>
          </div>
          <Button
            onClick={() => void onAddSingleGame()}
            disabled={isAddingGame}
          >
            {isAddingGame ? "正在添加..." : "选择游戏目录"}
          </Button>
        </section>

        {/* ─── 日区启动器 section ──────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">
              日区启动器
            </h2>
            <p className="text-body text-muted-foreground">
              已内置 Locale Emulator —— 在游戏卡片右键选「用日区启动器」即可启动老 galgame（Shift-JIS 编码）。
              首次启动会弹一次 UAC 同意框（LE 自身需要管理员权限）。
              想换成 ntleas / LEx / 自己的批处理脚本？在下面填入它的 exe 路径作为覆盖。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Input
              readOnly
              value={lePath ?? "默认使用内置 LE（无需配置）"}
              className="flex-1"
              title={lePath ?? undefined}
            />
            <Button variant="secondary" onClick={() => void onPickLePath()}>
              覆盖：选择启动器 .exe
            </Button>
          </div>
        </section>

        {/* ─── 扫描操作 section ──────────────────────────────────────── */}
        <section className="space-y-4">
          <h2 className="text-base font-semibold text-foreground">扫描操作</h2>
          <div className="flex gap-3">
            <Button onClick={() => void onScan("full")}>全量扫描</Button>
            <Button
              variant="secondary"
              onClick={() => void onScan("incremental")}
            >
              增量扫描
            </Button>
          </div>
        </section>

        {/* ─── 04f: 标签管理 section ─────────────────────────────────── */}
        <TagManager />

        {/* ─── 04f: UI 偏好 section ──────────────────────────────────── */}
        <UIPreferences />

        {/* ─── 调试 section ─────────────────────────────────────────── */}
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">调试</h2>
            <p className="text-body text-muted-foreground">
              清除所有游戏、扫描根、会话与封面/截图/存档备份文件（保留标签与 LE 路径）
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">清除所有数据</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>确定清除所有数据？</AlertDialogTitle>
                <AlertDialogDescription>
                  此操作不可撤销，将删除全部游戏、扫描根、会话历史与缓存文件
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => void onClearAllData()}>
                  清除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>
      </div>
    </ScrollArea>
  );
}
