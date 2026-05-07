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

import { useEffect } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  addScanRoot,
  listScanRoots,
  removeScanRoot,
  startScan,
} from "@/lib/scan";
import { Button } from "@/components/ui/button";
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

export function Settings() {
  const scanRoots = useLibraryStore((s) => s.scanRoots);
  const setScanRoots = useLibraryStore((s) => s.setScanRoots);
  const navigate = useNavigate();

  // Initial load — refresh on mount so Settings always shows DB truth (e.g.
  // user opens Settings the first time, or after a hot-reload).
  useEffect(() => {
    listScanRoots()
      .then(setScanRoots)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error("[Settings] listScanRoots failed:", e);
      });
  }, [setScanRoots]);

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
      </div>
    </ScrollArea>
  );
}
