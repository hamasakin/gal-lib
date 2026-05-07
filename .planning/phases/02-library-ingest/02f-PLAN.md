---
phase: 02-library-ingest
plan: 02f
type: execute
wave: 6
depends_on: [02a, 02d, 02e]
files_modified:
  - src/lib/games.ts
  - src/store/library.ts
  - src/routes/Library.tsx
  - src/components/library/GameCard.tsx
  - src/components/library/GameGrid.tsx
  - src/components/library/ScanProgressBar.tsx
  - src/components/library/MetadataPicker.tsx
  - src/main.tsx
  - tailwind.config.ts
autonomous: true
requirements: [LIB-02, LIB-06, SCAN-03, SCAN-07, META-05, META-06]
must_haves:
  truths:
    - "Library 路由完整覆写：scan 进度顶 sticky 进度条 + 主区 GameGrid 虚拟化卡片网格 + 空状态智能区分（未扫描 vs 扫描后零结果）"
    - "GameCard 3:4 cover + 双行标题截断 + 状态徽章 + hover scale + 右键菜单（重新匹配/重新抓取）"
    - "GameGrid 用 @tanstack/react-virtual useVirtualizer with lanes=columnCount，1000+ 卡片流畅滚动"
    - "ScanProgressBar sticky top + 4px Progress + 文字 + Cancel 按钮（带 AlertDialog 确认）"
    - "MetadataPicker Dialog：搜索框 + Bangumi/VNDB ToggleGroup + 直接 ID + 候选列表（缩略图 + 标题 + Confidence Badge）+ 应用/取消"
    - "tailwind.config.ts 追加 aspect-cover (3/4) + text-h3 (16px/600/1.4)"
    - "main.tsx 在 RouterProvider mount 后订阅 scan-progress event 写入 Zustand"
    - "pnpm typecheck 退出 0"
  artifacts:
    - path: src/routes/Library.tsx
      contains: "GameGrid"
    - path: src/components/library/GameCard.tsx
      contains: "aspect-cover"
    - path: src/components/library/GameGrid.tsx
      contains: "useVirtualizer"
    - path: src/components/library/ScanProgressBar.tsx
      contains: "Progress"
    - path: src/components/library/MetadataPicker.tsx
      contains: "ToggleGroup"
    - path: tailwind.config.ts
      contains: "aspect-cover"
---

# Plan 02f — Library Page (Grid + Card + ScanProgressBar + MetadataPicker)

## Objective

完成 Phase 2 frontend：把空的 Library route 替换为完整的扫描进度 + 虚拟化卡片网格 + 元数据选择 modal。

## Tasks

<task name="Task 1: tailwind tokens + games store helper">

<read_first>
- D:\project\gal-lib\tailwind.config.ts (Phase 1)
- D:\project\gal-lib\src/store/library.ts (Phase 02e)
</read_first>

<action>

1. **`tailwind.config.ts`** — 在 `theme.extend` 段追加：
```ts
aspectRatio: { cover: "3 / 4" },
fontSize: {
  // ... existing P1 tokens preserved (body / label / h2 / display)
  h3: ["16px", { lineHeight: "1.4", fontWeight: "600" }],
}
```

2. **`src/lib/games.ts`** (NEW) — frontend invoke for game listing:
```ts
import { invoke } from "@tauri-apps/api/core";

export interface Game {
  id: number;
  path: string;
  name: string;
  name_cn: string | null;
  executable_path: string | null;
  cover_path: string | null;
  cover_url: string | null;
  bangumi_id: string | null;
  vndb_id: string | null;
  total_playtime_sec: number;
  last_played_at: string | null;
  status: "unplayed" | "playing" | "cleared" | "dropped";
  rating: number | null;
  notes: string | null;
  metadata_source: "bangumi" | "vndb" | "manual" | "none" | null;
  match_confidence: number | null;
  last_scanned_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listGames(): Promise<Game[]> {
  return invoke<Game[]>("list_games");
}
```

> **Backend addendum:** add a 10th Tauri command `list_games(state: State<AppPaths>) -> Result<Vec<Game>, String>` to `src-tauri/src/commands.rs` doing `SELECT * FROM games ORDER BY created_at DESC` via sqlx. Register in `lib.rs::generate_handler!`.

3. **`src/store/library.ts`** — extend with `games: Game[]; setGames`:
```ts
import type { Game } from "@/lib/games";
// add to interface and create() body
games: Game[];
setGames: (gs: Game[]) => void;
// in create initialState
games: [],
setGames: (gs) => set({ games: gs }),
```

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
grep -q "aspect-cover\|aspect-ratio.*cover\|cover.*\"3 / 4\"" tailwind.config.ts && \
grep -q "h3:" tailwind.config.ts && \
test -f src/lib/games.ts && \
grep -q "export interface Game" src/lib/games.ts && \
grep -q "listGames" src/lib/games.ts && \
grep -q "list_games" src-tauri/src/lib.rs && \
grep -q "games:" src/store/library.ts && \
pnpm typecheck && \
cargo check --manifest-path src-tauri/Cargo.toml
</automated>
</verify>

</task>

<task name="Task 2: GameCard + GameGrid (virtualization) + ScanProgressBar + MetadataPicker">

<read_first>
- D:\project\gal-lib\.planning\phases\02-library-ingest\02-UI-SPEC.md (§Game Card, §Cover Grid, §Scan Progress Bar, §Metadata Picker Modal)
- D:\project\gal-lib\src/lib/games.ts (Task 1)
- D:\project\gal-lib\src/lib/scan.ts (P 02e)
- D:\project\gal-lib\src/lib/metadata.ts (P 02e)
</read_first>

<action>

Implement the 4 components per UI-SPEC contracts. Critical points:

1. **`src/components/library/GameCard.tsx`**:
   - Props: `game: Game`, `onContextMenu`, `coverDataUrl: string | null` (resolved from `data:` or convertFileSrc)
   - Layout: `<div className="group flex flex-col gap-2 cursor-pointer">` + `<div className="aspect-cover rounded-md overflow-hidden bg-secondary">` containing img or placeholder ImageOff icon + status badge (4×4 dot + text using semantic palette extension)
   - Status colors via Tailwind: `text-muted-foreground` (unplayed) / `text-blue-400` (playing) / `text-emerald-400` (cleared) / `text-red-400` (dropped)
   - Hover: `transition-transform group-hover:scale-[1.02]` on cover img + `group-hover:ring-1 group-hover:ring-border`
   - DropdownMenu wraps the card for right-click menu (`重新匹配元数据` / `重新抓取封面`)
   - Title: `<h3 className="text-body line-clamp-2 font-medium">{game.name_cn ?? game.name}</h3>`
   - "metadata-pending" badge if `match_confidence == null && metadata_source == "none"`: shadcn `Badge variant="outline"` text `元数据获取中` + 点击触发 MetadataPicker
   - "no exe" badge if `executable_path == null`: Badge text `未识别可执行文件`
   - Click on card body (not menu): toast.info("详情页 — 即将上线")

2. **`src/components/library/GameGrid.tsx`**:
   - Use `@tanstack/react-virtual::useVirtualizer` with 2D mode (count = total rows, lanes = columnCount)
   - columnCount derived from container width / 220 (card min-width)
   - Container: `<ScrollArea ref={scrollRef}>` + inner `<div style={{ height: virtualizer.getTotalSize() }}>` + `getVirtualItems().map(...)` rendering positioned `<GameCard>` at `transform: translateY(${vrow.start}px)` and `gridColumnStart` lane
   - Empty state branches: `if (scanProgress?.status === undefined && games.length === 0) → 还没有游戏 (P1 copy reuse)`; `if (scanProgress?.status === "completed" && games.length === 0) → 未识别到游戏 (P2 new copy + 回到设置 CTA)`
   - For coverDataUrl: use `convertFileSrc` from `@tauri-apps/api/core` to convert `data/covers/{id}.jpg` (relative) into a webview-safe URL (combining with `dataDir` from store)

3. **`src/components/library/ScanProgressBar.tsx`**:
   - Read `scanProgress` from `useLibraryStore`. If null or `status === "completed" / "cancelled" / "failed"` for > 5s → return null (use a `useState` + `useEffect` timeout)
   - Layout: `sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border h-14`
   - Inside: `Progress` shadcn block (value = completed/total * 100)
   - Below progress bar: `<span className="text-body">扫描中 ({scanProgress.current_dir}) — 已完成 {completed} / 共 {total}</span>`
   - Right side: `Button variant="ghost"` with text `取消` → opens AlertDialog `确定取消扫描？已扫描的游戏会保留` → on confirm: `cancelScan()` + toast.info("扫描已取消")

4. **`src/components/library/MetadataPicker.tsx`**:
   - Props: `game: Game | null` (open when non-null), `onClose`
   - Wrap in `<Dialog open={!!game} onOpenChange={onClose}>` + `<DialogContent className="max-w-2xl">`
   - Inside: 
     - Title `重新匹配元数据 — {game.name}`
     - `<Input placeholder="搜索 Bangumi 或 VNDB" />` + state `query`, debounce 400ms
     - `<ToggleGroup>` 2 options bangumi/vndb; default bangumi
     - Collapsible `直接绑定 ID` section: 2 inputs `bgm_id` (number) + `vndb_id` (e.g., `v1234`)
     - Candidates: `<ScrollArea max-h-[400px]>` mapping `Candidate[]` to rows: 60×80 cover + title + alias + confidence Badge (with color: ≥80 success / 70-79 warning / <70 destructive)
     - Footer Buttons: `应用` (calls `bindMetadata` then refetches `listGames`, closes modal, toast `已应用元数据`) + `取消`
   - Search trigger: on input change + onToggle change → call `searchMetadata(query, source)` and set local state

5. cargo check + cargo test --lib + pnpm typecheck 全绿。

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/components/library/GameCard.tsx && \
test -f src/components/library/GameGrid.tsx && \
test -f src/components/library/ScanProgressBar.tsx && \
test -f src/components/library/MetadataPicker.tsx && \
grep -q "aspect-cover" src/components/library/GameCard.tsx && \
grep -q "DropdownMenu" src/components/library/GameCard.tsx && \
grep -q "useVirtualizer" src/components/library/GameGrid.tsx && \
grep -q "Progress" src/components/library/ScanProgressBar.tsx && \
grep -q "AlertDialog" src/components/library/ScanProgressBar.tsx && \
grep -q "ToggleGroup" src/components/library/MetadataPicker.tsx && \
grep -q "searchMetadata" src/components/library/MetadataPicker.tsx && \
grep -q "bindMetadata" src/components/library/MetadataPicker.tsx && \
pnpm typecheck
</automated>
</verify>

</task>

<task name="Task 3: Library route (full replace) + main.tsx scan-progress subscription">

<read_first>
- D:\project\gal-lib\src/routes/Library.tsx (P1 placeholder)
- D:\project\gal-lib\src/main.tsx (P1 + 02a Toaster mount)
- D:\project\gal-lib\src/components/library/* (Task 2)
</read_first>

<action>

1. **`src/routes/Library.tsx`** — full overwrite:
```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useLibraryStore } from "@/store/library";
import { listGames, type Game } from "@/lib/games";
import { GameGrid } from "@/components/library/GameGrid";
import { ScanProgressBar } from "@/components/library/ScanProgressBar";
import { MetadataPicker } from "@/components/library/MetadataPicker";

export default function Library() {
  const { games, setGames, scanProgress } = useLibraryStore();
  const [pickerGame, setPickerGame] = useState<Game | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    listGames().then(setGames).catch(console.error);
  }, [setGames]);

  // Refetch games when scan completes
  useEffect(() => {
    if (scanProgress?.status === "completed") {
      listGames().then(setGames).catch(console.error);
    }
  }, [scanProgress?.status, setGames]);

  const isEmpty = games.length === 0;
  const scanFinishedZeroResults = isEmpty && scanProgress?.status === "completed";
  const noScanYet = isEmpty && !scanProgress;

  return (
    <div className="flex h-full flex-col">
      <ScanProgressBar />
      <div className="flex-1 overflow-hidden">
        {noScanYet && (
          <ScrollArea className="h-full">
            <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
              <h2 className="text-h2 font-semibold">还没有游戏</h2>
              <p className="text-body text-muted-foreground">请到设置页添加扫描根目录</p>
              <Button variant="ghost" onClick={() => navigate("/settings")}>打开设置</Button>
            </div>
          </ScrollArea>
        )}
        {scanFinishedZeroResults && (
          <ScrollArea className="h-full">
            <div className="flex h-full flex-col items-center justify-center gap-6 p-6">
              <h2 className="text-h2 font-semibold">未识别到游戏</h2>
              <p className="text-body text-muted-foreground">请检查根目录扫描深度配置</p>
              <Button variant="ghost" onClick={() => navigate("/settings")}>回到设置</Button>
            </div>
          </ScrollArea>
        )}
        {!isEmpty && (
          <GameGrid games={games} onPickMetadata={setPickerGame} />
        )}
      </div>
      <MetadataPicker game={pickerGame} onClose={() => setPickerGame(null)} />
    </div>
  );
}
```

2. **`src/main.tsx`** — append scan-progress subscription:
```tsx
import { onScanProgress } from "@/lib/scan";
import { useLibraryStore } from "@/store/library";

// after <Toaster> mount, set up event listener (idempotent — only attach once)
let scanProgressUnsub: (() => void) | undefined;
if (!scanProgressUnsub) {
  void onScanProgress((p) => {
    useLibraryStore.getState().setScanProgress(p);
  }).then((unsub) => { scanProgressUnsub = unsub; });
}
```

3. pnpm typecheck 退出 0；smoke：dev 启动 → 跑扫描（Settings 页触发） → 看到 ScanProgressBar 进度更新 → 扫完后 GameGrid 显示卡片。

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
grep -q "GameGrid" src/routes/Library.tsx && \
grep -q "ScanProgressBar" src/routes/Library.tsx && \
grep -q "MetadataPicker" src/routes/Library.tsx && \
grep -q "未识别到游戏" src/routes/Library.tsx && \
grep -q "还没有游戏" src/routes/Library.tsx && \
grep -q "onScanProgress" src/main.tsx && \
pnpm typecheck
</automated>
</verify>

</task>

## Commit Protocol

3 atomic commits:
- `chore(02-02f): add tailwind aspect-cover + text-h3 + games invoke helper + list_games tauri command`
- `feat(02-02f): library components — GameCard + GameGrid + ScanProgressBar + MetadataPicker`
- `feat(02-02f): library route + main.tsx scan-progress subscription`

## Success

✅ Phase 2 frontend 完整：扫描可触发 → 进度可见 → 卡片网格虚拟化呈现 → 右键菜单可重新匹配/抓取封面 → MetadataPicker 可查询 + 候选列表 + 直接 ID 绑定。pnpm typecheck + cargo check 全绿。
