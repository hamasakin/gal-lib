---
phase: 02-library-ingest
plan: 02e
type: execute
wave: 5
depends_on: [02a, 02d]
files_modified:
  - src/lib/scan.ts
  - src/lib/metadata.ts
  - src/store/library.ts
  - src/routes/Settings.tsx
autonomous: true
requirements: [SCAN-01, SCAN-02]
must_haves:
  truths:
    - "src/lib/scan.ts 暴露 addScanRoot / removeScanRoot / listScanRoots / startScan / cancelScan / markSkipDir helpers"
    - "src/lib/metadata.ts 暴露 searchMetadata / bindMetadata / refreshMetadata helpers"
    - "src/store/library.ts Zustand：scanRoots / scanProgress / cancelScan action"
    - "Settings 页完整覆写：root list 表格 + Depth select + 添加/移除按钮 + 全量/增量扫描按钮"
    - "pnpm typecheck 退出 0，dev 启动后能在 Settings 页 add root + 触发 scan + 进度通过事件订阅写入 store"
  artifacts:
    - path: src/lib/scan.ts
      contains: "export async function startScan"
    - path: src/lib/metadata.ts
      contains: "export async function searchMetadata"
    - path: src/store/library.ts
      contains: "scanRoots"
    - path: src/routes/Settings.tsx
      contains: "扫描根目录"
---

# Plan 02e — Frontend Invoke Layer + Settings Page

## Objective

frontend 的 Tauri command 包装层 + Zustand library store + Settings 页实装（替换 Phase 1 占位），让用户能：添加根目录、配置深度、移除、触发扫描。

## Tasks

<task name="Task 1: src/lib/scan.ts + src/lib/metadata.ts (invoke wrappers + event subscription)">

<read_first>
- D:\project\gal-lib\src-tauri\src\commands.rs (源 - 9 命令签名)
- D:\project\gal-lib\.planning\phases\02-library-ingest\02-CONTEXT.md (frontend invoke 风格约定)
</read_first>

<action>

1. **`src/lib/scan.ts`** — Tauri invoke wrappers + scan-progress event subscription:
```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ScanRoot { id: number; path: string; depth: 1 | 2 | 3; created_at: string; }
export interface ScanProgress {
  current_dir: string;
  completed: number;
  total: number;
  status: "running" | "completed" | "cancelled" | "failed";
}

export async function addScanRoot(path: string, depth: 1 | 2 | 3): Promise<number> {
  return invoke<number>("add_scan_root", { path, depth });
}
export async function removeScanRoot(id: number): Promise<void> {
  await invoke("remove_scan_root", { id });
}
export async function listScanRoots(): Promise<ScanRoot[]> {
  return invoke<ScanRoot[]>("list_scan_roots");
}
export async function startScan(mode: "full" | "incremental"): Promise<void> {
  await invoke("start_scan", { mode });
}
export async function cancelScan(): Promise<void> {
  await invoke("cancel_scan");
}
export async function markSkipDir(path: string): Promise<void> {
  await invoke("mark_skip_dir", { path });
}

export async function onScanProgress(cb: (p: ScanProgress) => void): Promise<UnlistenFn> {
  return listen<ScanProgress>("scan-progress", (e) => cb(e.payload));
}
```

2. **`src/lib/metadata.ts`**:
```ts
import { invoke } from "@tauri-apps/api/core";

export type MetadataSource = "bangumi" | "vndb" | "manual" | "none";

export interface Candidate {
  source: MetadataSource;
  source_id: string;
  title: string;
  alias: string[];
  cover_url: string | null;
  release_date: string | null;
  summary: string | null;
  confidence: number;
}

export async function searchMetadata(query: string, source: "bangumi" | "vndb"): Promise<Candidate[]> {
  return invoke<Candidate[]>("search_metadata", { query, source });
}
export async function bindMetadata(gameId: number, source: "bangumi" | "vndb", sourceId: string): Promise<void> {
  await invoke("bind_metadata", { gameId, source, sourceId });
}
export async function refreshMetadata(gameId: number): Promise<void> {
  await invoke("refresh_metadata", { gameId });
}
```

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/lib/scan.ts && \
test -f src/lib/metadata.ts && \
grep -q "export async function addScanRoot" src/lib/scan.ts && \
grep -q "export async function startScan" src/lib/scan.ts && \
grep -q "export async function searchMetadata" src/lib/metadata.ts && \
pnpm typecheck
</automated>
</verify>

</task>

<task name="Task 2: src/store/library.ts (Zustand) + Settings.tsx (full replacement)">

<read_first>
- D:\project\gal-lib\src/store/app.ts (existing pattern — single create() store)
- D:\project\gal-lib\src/routes/Settings.tsx (current placeholder)
- D:\project\gal-lib\.planning\phases\02-library-ingest\02-UI-SPEC.md (§Settings Page strict layout)
- D:\project\gal-lib\src/lib/scan.ts (Task 1)
</read_first>

<action>

1. **`src/store/library.ts`**:
```ts
import { create } from "zustand";
import type { ScanProgress, ScanRoot } from "@/lib/scan";

interface LibraryState {
  scanRoots: ScanRoot[];
  scanProgress: ScanProgress | null;
  setScanRoots: (rs: ScanRoot[]) => void;
  setScanProgress: (p: ScanProgress | null) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  scanRoots: [],
  scanProgress: null,
  setScanRoots: (rs) => set({ scanRoots: rs }),
  setScanProgress: (p) => set({ scanProgress: p }),
}));
```

2. **`src/routes/Settings.tsx`** — full replacement (replaces P1 `设置 — 即将上线` placeholder):
```tsx
import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { addScanRoot, listScanRoots, removeScanRoot, startScan, type ScanRoot } from "@/lib/scan";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
import { useLibraryStore } from "@/store/library";
import { useNavigate } from "react-router-dom";

export default function Settings() {
  const { scanRoots, setScanRoots } = useLibraryStore();
  const navigate = useNavigate();

  useEffect(() => { listScanRoots().then(setScanRoots).catch(console.error); }, [setScanRoots]);

  async function onAdd() {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    try {
      await addScanRoot(picked, 1);
      const rs = await listScanRoots();
      setScanRoots(rs);
      toast.success("已添加根目录");
    } catch (e: unknown) {
      toast.error(`添加失败 — ${String(e)}`);
    }
  }

  async function onRemove(id: number) {
    await removeScanRoot(id);
    const rs = await listScanRoots();
    setScanRoots(rs);
    toast.success("已移除根目录");
  }

  async function onChangeDepth(id: number, depth: 1 | 2 | 3) {
    await removeScanRoot(id);
    const target = scanRoots.find(r => r.id === id);
    if (!target) return;
    await addScanRoot(target.path, depth);
    setScanRoots(await listScanRoots());
  }

  async function onScan(mode: "full" | "incremental") {
    if (scanRoots.length === 0) {
      toast.error("请先添加至少一个扫描根目录");
      return;
    }
    await startScan(mode);
    toast.info("扫描已启动");
    navigate("/");
  }

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-[720px] p-6 space-y-8">
        <h1 className="text-h2 font-semibold">设置</h1>

        <section className="space-y-4">
          <div>
            <h2 className="text-h3 font-semibold">扫描根目录</h2>
            <p className="text-body text-muted-foreground">gal-lib 会扫描这些目录下的游戏</p>
          </div>
          <ul className="space-y-2">
            {scanRoots.map(r => (
              <li key={r.id} className="flex items-center gap-3 rounded-md border border-border p-3">
                <span className="flex-1 truncate text-body" title={r.path}>{r.path}</span>
                <Select value={String(r.depth)} onValueChange={v => onChangeDepth(r.id, Number(v) as 1|2|3)}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">第 1 层</SelectItem>
                    <SelectItem value="2">第 2 层</SelectItem>
                    <SelectItem value="3">第 3 层</SelectItem>
                  </SelectContent>
                </Select>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="hover:text-destructive">
                      <Trash2 className="size-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>确定移除该根目录？</AlertDialogTitle>
                      <AlertDialogDescription>已扫描的游戏不会被删除</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onRemove(r.id)}>移除</AlertDialogAction>
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
          <Button onClick={onAdd}>添加根目录</Button>
        </section>

        <section className="space-y-4">
          <h2 className="text-h3 font-semibold">扫描操作</h2>
          <div className="flex gap-3">
            <Button onClick={() => onScan("full")}>全量扫描</Button>
            <Button variant="secondary" onClick={() => onScan("incremental")}>增量扫描</Button>
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
```

3. pnpm typecheck 退出 0；smoke：dev 启动 → 进 /settings → 添加 root → 列表显示 → 移除 → toast 出现。

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/store/library.ts && \
grep -q "useLibraryStore" src/store/library.ts && \
grep -q "scanRoots" src/store/library.ts && \
grep -q "扫描根目录" src/routes/Settings.tsx && \
grep -q "全量扫描" src/routes/Settings.tsx && \
grep -q "增量扫描" src/routes/Settings.tsx && \
grep -q "openDialog" src/routes/Settings.tsx && \
grep -q "useLibraryStore" src/routes/Settings.tsx && \
pnpm typecheck
</automated>
</verify>

</task>

## Commit Protocol

2 atomic commits:
- `feat(02-02e): add frontend invoke wrappers (scan + metadata helpers + library store)`
- `feat(02-02e): replace settings placeholder with scan_roots CRUD + scan trigger`

## Success

✅ frontend 已具备 add/remove root + depth 切换 + 全量/增量扫描触发；toast 系统就位（add/remove 反馈）；typecheck 全绿。
