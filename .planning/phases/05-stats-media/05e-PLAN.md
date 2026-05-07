---
phase: 05-stats-media
plan: 05e
type: execute
wave: 5
depends_on: [05a, 05c]
files_modified:
  - src/components/library/ScreenshotsTab.tsx
  - src/components/library/SavesTab.tsx
  - src/routes/Detail.tsx
autonomous: true
requirements: [SHOT-02, SAVE-01, SAVE-03]
must_haves:
  truths:
    - "Detail.tsx 增 2 个 Tab：截图 + 存档；保留既有 简介/标签/笔记/会话历史/设置 (合计 7 tabs)"
    - "ScreenshotsTab：缩略图网格 + click → 大图 Dialog + 导出 button + 删除 button"
    - "SavesTab：save_path config Input + 备份按钮 + 备份列表（time/files/size + 恢复/删除 + confirm dialogs）"
    - "Detail 设置 Tab 增 截图间隔 select (60/300/600/1800/0=禁用)"
    - "pnpm typecheck + vite build 全绿"
---

# Plan 05e — Detail page extensions (Screenshots + Saves Tabs)

## Tasks

<task name="Task 1: ScreenshotsTab + SavesTab + Detail extension">

<read_first>
- D:\project\gal-lib\src/lib/screenshots.ts + src/lib/saves.ts (05c)
- D:\project\gal-lib\src/routes/Detail.tsx (P4 — 5 tabs; extend to 7 tabs)
- D:\project\gal-lib\.planning\phases\05-stats-media\05-CONTEXT.md (§Screenshot / §Save Backup UX)
</read_first>

<action>

1. **`src/components/library/ScreenshotsTab.tsx`**:
   - props: `gameId: number, dataDir: string | null`
   - mount: call `getScreenshots(gameId)` → store.setScreenshotsForGame
   - layout: CSS Grid 3-cols `gap-3`, each tile 150×150 cover-fit; image src via `convertFileSrc(dataDir + "/" + s.path)`
   - hover: show small overlay with delete (×) and export (download icon) buttons
   - click image (not buttons): open shadcn `Dialog` lightbox (full image)
   - empty state: "还没有截图 — 启动游戏后将自动捕获"
   - export: open native dialog (`open({ directory: false, save: true })` — actually use `save` from `@tauri-apps/plugin-dialog`); on confirm call `exportScreenshot(id, target)` + toast
   - delete: AlertDialog confirm `确定删除这张截图？` → `deleteScreenshot(id)` + refetch + toast

2. **`src/components/library/SavesTab.tsx`**:
   - props: `game: Game, dataDir: string | null`
   - top: "存档目录" Input (readonly) + "选择..." Button → tauri-plugin-dialog `open({ directory: true })` → `setSavePath(gameId, picked)`
   - "备份当前存档" Button → confirm AlertDialog `确定备份？将复制存档目录到 data/saves/{game_id}/{timestamp}/` → `createSaveBackup(gameId, null)` + refetch
   - List below: `listSaveBackups(gameId)` → table 4 cols (时间 / 文件数 / 大小 / 操作)
     - 操作列：恢复 button + 删除 button
     - 恢复 confirm: `确定恢复此备份？将覆盖当前存档目录` → `restoreSaveBackup(id)` + toast `已恢复存档`
     - 删除 confirm: `确定删除此备份？此操作不可恢复` → `deleteSaveBackup(id)`
   - empty state: "还没有存档备份 — 配置存档目录后点上方按钮开始备份"

3. **`src/routes/Detail.tsx`** — modifications:
   - Add 2 new TabsTrigger: 截图 / 存档
   - Add 2 new TabsContent rendering `<ScreenshotsTab gameId={gameId} dataDir={dataDir} />` + `<SavesTab game={game} dataDir={dataDir} />`
   - In the existing 设置 tab (LE config etc.), add a new row "截图间隔" with Select (60s / 5min / 10min / 30min / 关闭=0); calls `setScreenshotInterval(gameId, value)` on change
   - Read dataDir from `useAppStore.dataDir` (Zustand store from P1)

4. pnpm typecheck + vite build green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/components/library/ScreenshotsTab.tsx && \
test -f src/components/library/SavesTab.tsx && \
grep -q "getScreenshots" src/components/library/ScreenshotsTab.tsx && \
grep -q "deleteScreenshot" src/components/library/ScreenshotsTab.tsx && \
grep -q "exportScreenshot" src/components/library/ScreenshotsTab.tsx && \
grep -q "setSavePath" src/components/library/SavesTab.tsx && \
grep -q "createSaveBackup" src/components/library/SavesTab.tsx && \
grep -q "restoreSaveBackup" src/components/library/SavesTab.tsx && \
grep -q "ScreenshotsTab\|SavesTab" src/routes/Detail.tsx && \
grep -q "截图\|存档" src/routes/Detail.tsx && \
grep -q "setScreenshotInterval" src/routes/Detail.tsx && \
pnpm typecheck && \
pnpm vite build
</automated>
</verify>

</task>

## Commit

`feat(05-05e): detail page screenshots + saves tabs (interval config + lightbox + backup/restore)`
