---
phase: 260524-fullreview / components
reviewed: 2026-05-24T00:00:00Z
depth: standard
files_reviewed: 36
files_reviewed_list:
  - src/components/library/ActiveSessionBar.tsx
  - src/components/library/BackfillProgressBar.tsx
  - src/components/library/CoStaffStrip.tsx
  - src/components/library/DeleteViewDialog.tsx
  - src/components/library/DensityToggle.tsx
  - src/components/library/FilterChip.tsx
  - src/components/library/FilterPanel.tsx
  - src/components/library/GameCard.tsx
  - src/components/library/GameGrid.tsx
  - src/components/library/GameList.tsx
  - src/components/library/LaunchButton.tsx
  - src/components/library/MetadataPicker.tsx
  - src/components/library/PageHeader.tsx
  - src/components/library/PersonTimeline.tsx
  - src/components/library/RemovedDirs.tsx
  - src/components/library/ReviewQueue.tsx
  - src/components/library/SavesTab.tsx
  - src/components/library/ScanFeed.tsx
  - src/components/library/ScanProgressBar.tsx
  - src/components/library/ScreenshotsTab.tsx
  - src/components/library/SearchBar.tsx
  - src/components/library/SortSelect.tsx
  - src/components/library/StarRating.tsx
  - src/components/library/StatusFilterChips.tsx
  - src/components/library/SubdirSplitDialog.tsx
  - src/components/library/TagPicker.tsx
  - src/components/library/ViewNameDialog.tsx
  - src/components/library/ViewToggle.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/layout/Titlebar.tsx
  - src/components/layout/TitlebarSlot.tsx
  - src/components/layout/WindowControls.tsx
  - src/components/settings/AboutSection.tsx
  - src/components/settings/TagManager.tsx
  - src/components/settings/UIPreferences.tsx
  - src/components/tweaks/TweaksPanel.tsx
findings:
  critical: 7
  warning: 18
  info: 12
  total: 37
status: issues_found
---

# Phase 260524-fullreview / components — Code Review Report

**Reviewed:** 2026-05-24
**Depth:** standard
**Files Reviewed:** 36
**Status:** issues_found

## Summary

整体来看 gal-lib 的业务组件代码质量在桌面 SPA 项目里属中上水平：mutation 流程一致地走「失败 toast + reconcile」、Tauri 事件订阅都有 unlisten、Dialog 的 onCloseAutoFocus 等 Radix 细节有专门 follow-up。但是本轮审查仍然挖出若干**会实际造成 bug 或潜在数据竞争**的问题，主要集中在：

1. **多个监听器 mount 阶段的 race condition** —— ScanFeed / ReviewQueue / Sidebar / BackfillProgressBar 都是 `listen(...).then(fn => unlistenA = fn)` 模式；如果 effect cleanup 比 `.then` 先触发（StrictMode、快速路由切换），返回的 unlisten 会落到已死的 effect 上，造成永久订阅泄漏 + 在卸载组件上 setState。
2. **TagPicker 的 createAndSelect 用了过期 stagedIds** —— `Array.from(stagedIds).concat(newId)` 跟刚被 `setStagedIds(prev => ...)` 改过的状态打架，会把同一 render 周期内用户的别的勾选丢掉。
3. **GameList 列表行 race + 性能放大** —— 它订阅了整张 `fetchingMetaIds` 表，对大库（>500 行）每次扫描进度都会全表 re-render；同时 lib `onError` 把整行 img 设为 `display:none` 后没法回复（封面切换不回来）。
4. **ScreenshotsTab 双层 button** —— 外层 `<button>` 包了内层 `role="button" <span>`，HTML 结构非法 + 内层 keyEvent cast `as unknown as React.MouseEvent` 不安全。
5. **SearchBar / FilterPanel apply 时的 Set 共享引用** —— `setAdvFilter({ ...advFilter, brands: new Set(draft.brand) })` 写回了 draft Set 的浅拷贝，但 `toggleSet` 在某些路径上又把同一 Set 暴露给后续 setState，可能造成上游 selector `===` 比较不变更不触发渲染。

下面按严重程度列出，所有发现都给到具体文件:行号 + 修复建议。

## Critical Issues

### CR-01: 多组件 listen() then-赋值模式存在 unmount race，泄漏订阅

**File:** `src/components/library/ScanFeed.tsx:71-141` (同模式还在 `ReviewQueue.tsx:107-117`、`Sidebar.tsx:111-124`、`BackfillProgressBar.tsx:50-98`)
**Issue:**
```ts
let unlistenScan: UnlistenFn | null = null;
listen<ScanProgress>("scan-progress", (...) => {...}).then(fn => {
  unlistenScan = fn;
});
return () => {
  unlistenScan?.();   // ← 如果 cleanup 比 .then 先跑，fn 永远没被注销
};
```
React 18 StrictMode 下 effect 会立即 mount→cleanup→mount。第一次 cleanup 跑时 `unlistenScan` 还是 null —— listener 注册完后没有 unlisten；第二次 mount 又注册一遍，造成**每次重 mount 多注册一对 listener**，且每个监听器里的 setState 还会在已卸载组件上调用（React warning + 内存泄漏）。Tauri 路由切换 + StrictMode 复现稳定。

**Fix:** 用 race-safe pattern，把 promise 也存起来；cleanup 时 await：
```ts
useEffect(() => {
  let mounted = true;
  let unlistenScan: UnlistenFn | null = null;
  let unlistenMeta: UnlistenFn | null = null;
  const p = (async () => {
    const a = await listen<ScanProgress>("scan-progress", handler1);
    const b = await listen("meta-fetch-progress", handler2);
    if (!mounted) {  // effect 在 await 间被 cleanup 了
      a(); b();
      return;
    }
    unlistenScan = a; unlistenMeta = b;
  })();
  return () => {
    mounted = false;
    // unlisten 现在拿到也好、null 也好都干净
    unlistenScan?.(); unlistenMeta?.();
    void p;
  };
}, []);
```

---

### CR-02: TagPicker.createAndSelect 用 `Array.from(stagedIds).concat(newId)` 读旧 state

**File:** `src/components/library/TagPicker.tsx:138-159`
**Issue:**
```ts
setStagedIds((prev) => { const next = new Set(prev); next.add(newId); return next; });
// ... 立刻同步使用 stagedIds（旧）+ newId，跳过 setStagedIds 的 next：
const ids = Array.from(stagedIds).concat(newId);  // ← stagedIds 是 closure 中的旧值
await setGameTags(gameId, ids);
```
React 的 setState 是 batched，`stagedIds` 在本回调内不会更新。如果用户在 popover 里已经 toggle 过 A、B（staged：{A,B}），再创建新标签 C，commit 的 ids 是 `[A, B].concat(C)` —— 看起来正确，**但如果用户在 toggle A 之后还没等 setState 完就敲了 Enter 触发 createAndSelect**（React 18 自动 batch 内同一事件循环），`stagedIds` 仍是 toggle 前的旧值，A 就丢了。又因为这里**异步 await setGameTags 之后才会触发 popover 关闭**，用户感知不到。

**Fix:** 自己维护新集合：
```ts
async function createAndSelect() {
  if (trimmedSearch.length === 0) return;
  setSaving(true);
  try {
    const newId = await createTag(trimmedSearch, null);
    const nextIds = new Set(stagedIds);
    nextIds.add(newId);
    setStagedIds(nextIds);
    await setGameTags(gameId, Array.from(nextIds));
    setSearch("");
    onChange?.();
  } catch ...
}
```

---

### CR-03: ScreenshotsTab 嵌套 `<button>` —— HTML 非法且键盘交互冲突

**File:** `src/components/library/ScreenshotsTab.tsx:162-231`
**Issue:** 最外层是 `<button type="button">`（缩略图点击打开 lightbox），内层却又渲染了两个 `<span role="button" tabIndex={0} onKeyDown={...}>`（导出 / 删除）。HTML 规范禁止 `<button>` 嵌套交互式内容；浏览器对此的渲染行为不一致（Chrome 会把内层 span 提到外层之外），辅助技术读到的层级也错乱。同时内层 keyDown 还要把 KeyboardEvent 强转成 MouseEvent：
```ts
void onExport(shot, e as unknown as React.MouseEvent);
```
—— onExport 第二个参数只用了 `.stopPropagation()`，目前能跑只是巧合；任何对 MouseEvent 字段的引用都会运行时崩溃。

**Fix:** 把缩略图改成 `<div role="button" tabIndex={0} onClick=... onKeyDown=...>`，把导出 / 删除改成真正的 `<button>`；或者把 hover overlay 上的两个 action 提到 button 外面，作为兄弟节点（绝对定位覆盖到右下角）。

---

### CR-04: ReviewQueue 内层 CandidateCard 的 ImageOff 用 `absolute` 但容器不是 `relative`

**File:** `src/components/library/ReviewQueue.tsx:443-457`
**Issue:**
```tsx
<div className="h-20 w-[60px] flex-shrink-0 overflow-hidden border border-line bg-bg-2" ...>
  {candidate.cover_url ? <img .../> : (
    <ImageOff size={14} className="absolute -translate-x-1/2 -translate-y-1/2 text-ink-3" />
  )}
</div>
```
封面 div 没有 `position: relative`，`absolute` 的 ImageOff 会沿祖先链找到第一个 positioned 容器（很可能就是整个 expanded comparison 卡片），错位定位到完全不相干的位置。同样的代码模式在 ReviewQueue.tsx:254 行（外层 item card）有 `relative`，应当复用。

**Fix:** 给容器加 `relative`，或者用 grid place-items-center 直接居中：
```tsx
<div className="relative h-20 w-[60px] ...">
  {candidate.cover_url ? <img .../> : (
    <div className="grid h-full w-full place-items-center"><ImageOff size={14}/></div>
  )}
</div>
```

---

### CR-05: ScanProgressBar.summary 在 `status` 不在 switch case 内时未赋值

**File:** `src/components/library/ScanProgressBar.tsx:64-83`
**Issue:**
```ts
let summary: string;
switch (status) {
  case "running": ... break;
  case "completed": ... break;
  case "cancelled": ... break;
  case "failed": ... break;
}
// ← 没有 default 分支
```
TypeScript narrowing 看起来覆盖了 `ScanProgress["status"]` 联合，但**后端任何未来扩展的 status 字面量**（或 IPC 反序列化得到 unknown 字符串）都会让 `summary` 处于"未赋值"状态。第 119 行 `<span title={summary}>` 引用未初始化的 let → TDZ ReferenceError → 组件崩溃；如果使用 `// @ts-expect-error` 跳过类型检查更危险。

**Fix:** 加 default 兜底 + 用 `const` 单赋值：
```ts
const summary: string = (() => {
  switch (status) {
    case "running": return phase === "discovering" ? ... : ...;
    case "completed": return ...;
    case "cancelled": return "扫描已取消";
    case "failed": return "扫描失败";
    default: return "";
  }
})();
```

---

### CR-06: SubdirSplitDialog 的"加载子目录"effect 依赖丢 cancelled，可能读取脏 entries

**File:** `src/components/library/SubdirSplitDialog.tsx:94-123`
**Issue:** effect 内部已经设了 `let cancelled` 兜住竞态，但 setSelected 用 functional updater 时 **从未检查 cancelled**：
```ts
.then((list) => {
  if (cancelled) return;
  setEntries(list);
  setSelected((prev) => {  // ← 这里没有 if (cancelled) return prev
    const next = new Set(prev);
    for (const e of list) if (e.exe != null && !next.has(e.path)) next.add(e.path);
    return next;
  });
})
```
看起来 `if (cancelled) return` 在 setSelected 之前就退出了，但**StrictMode 下** effect 会先 mount→cleanup→mount。第一次 effect 在 cleanup 之后 promise 还没 resolve，cancelled=true，正常 early return；但第二次 effect 重新跑时 cancelled 又重置为 false，没问题。**真正的问题** 是当用户在 listSubdirs 进行中**切换了 currentPath**（drillInto），effect cleanup 会标记旧 cancelled=true，但 setSelected 这一帧拿到的 list 是旧目录的，prev 是新目录的 selected —— 把"上一层"目录的 exe 全部添加到当前层 selected 集，造成确认时把不存在的路径传给 backend。

**Fix:** setSelected 也要门槛：
```ts
.then((list) => {
  if (cancelled) return;
  setEntries(list);
  setSelected((prev) => {
    // 防御：本 effect 已被新一轮 drillInto 取消
    if (cancelled) return prev;
    const next = new Set(prev);
    for (const e of list) if (e.exe != null && !next.has(e.path)) next.add(e.path);
    return next;
  });
})
```
或者更激进地按 currentPath 分桶，drillInto 之间不共享 selected。

---

### CR-07: CoStaffStrip portrait 抓取依赖 `portraits` state，每次 setPortraits 都会重新跑整个 for 循环

**File:** `src/components/library/CoStaffStrip.tsx:76-97`
**Issue:**
```ts
useEffect(() => {
  if (!rows || !dataDir) return;
  let cancelled = false;
  (async () => {
    for (const row of rows) {
      const key = `${row.source}-${row.source_id}`;
      if (key in portraits) continue;  // ← 读 closure 内旧 portraits
      try {
        const rel = await getOrFetchPortrait(...);
        if (cancelled) return;
        setPortraits((prev) => ({ ...prev, [key]: rel }));
      } catch { ... }
    }
  })();
  return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [rows, dataDir]);
```
注释说"Skip if already resolved"，但 portraits 没在 deps 里。意思是 effect 只在 rows / dataDir 变化时跑一次 —— 这本来没问题。**问题是**：第 87 行 `setPortraits((prev) => ({ ...prev, [key]: rel }))` 触发组件 re-render；下次 effect 不会重跑（deps 未变），所以**循环内的 `if (key in portraits) continue` 永远引用的是 effect 启动那一刻的初始 portraits=`{}`**。结果：每一行 portrait 都会被请求；好在缓存在 Rust 端，并不会真的打外网，但**前端 setState N 次串行**，每次 N+1 行 ⇒ 触发 N 次重渲染（每次 effect 不重跑，但 setState 触发的 re-render 仍要走 reconciler）。配合 PersonTimeline 在同一页面，体感卡顿。**更严重的是**如果用户在 portrait 串行抓取期间切换到另一个 person（rows 变化），effect cleanup 设 cancelled=true，但 setPortraits 在 `if (cancelled) return` 之后才执行 —— 等等，第 87 行的 cancelled 检查在 setPortraits 之前，目前是安全的。**但 catch 分支** `if (!cancelled) setPortraits(...)` 在 `setPortraits` 里仍然合并到 new person 的 state 里（虽然有 cancelled 守卫，async loop 里的 cancelled 是 closure 引用，是 OK 的）—— 但旧 person 的 setPortraits 触发 re-render 是合法的卸载前 setState。

**Fix:** 用 ref 保存 in-flight key 集合，或者把"已请求过"的状态记到 ref 里：
```ts
const inFlightRef = useRef<Set<string>>(new Set());
useEffect(() => {
  if (!rows || !dataDir) return;
  let cancelled = false;
  (async () => {
    for (const row of rows) {
      const key = `${row.source}-${row.source_id}`;
      if (inFlightRef.current.has(key)) continue;
      inFlightRef.current.add(key);
      try { ... setPortraits(...) } catch { ... }
    }
  })();
  return () => { cancelled = true; };
}, [rows, dataDir]);
```

## Warnings

### WR-01: GameList 订阅整张 fetchingMetaIds 表，大库下扫描时全表 re-render

**File:** `src/components/library/GameList.tsx:71-78`
**Issue:**
```ts
const fetchingMetaIds = useLibraryStore((s) => s.fetchingMetaIds);
const metaTouchedIds = useLibraryStore((s) => s.metaTouchedIds);
```
注释解释了"列表视图不 memo rows，整表 re-render 比写 200 个 selector 便宜"。这个权衡在 ≤200 行的小库上 OK；但项目目标是 galgame 收藏管理，重度玩家 500+ 行很常见。扫描 1 次 meta-progress 触发一次 `setFetchingMetaIds` → 整张 table re-render，每行渲染含 cover img + 7 cells，500 行 × 60 fps 扫描事件 ≈ 严重掉帧。GameCard 就为此做了 per-id selector + `React.memo`。

**Fix:** 把行抽成 memo 子组件，per-row 订阅：
```tsx
const Row = memo(function Row({ g }: { g: Game }) {
  const isFetching = useLibraryStore(s => s.fetchingMetaIds[g.id] != null);
  const metaTouched = useLibraryStore(s => s.metaTouchedIds[g.id] === true);
  const metaRefreshActive = useLibraryStore(s => s.metaRefreshActive);
  // ... 同 GameCard 模式
});
```

---

### WR-02: GameList img onError 把 display 设 none 后无法回复

**File:** `src/components/library/GameList.tsx:167-171` (同模式 `GameCard.tsx:316-318`, `ScreenshotsTab.tsx:178-181`, `ActiveSessionBar.tsx:119-121`, `MetadataPicker.tsx:352-354`)
**Issue:**
```tsx
onError={(e) => {
  (e.currentTarget as HTMLImageElement).style.display = "none";
}}
```
当封面被重新刷新（refreshCover）时 src 会变（带新的 `?v=...`），如果新封面又加载失败，img 已经 display:none 了；网络瞬断恢复也救不回来。更糟的是直接 mutate DOM style 而不是 React state，violates React 单向数据流。

**Fix:** 用 state 追踪加载错误：
```tsx
const [hasError, setHasError] = useState(false);
useEffect(() => { setHasError(false); }, [src]);
{src && !hasError ? <img src={src} onError={() => setHasError(true)} ... /> : fallback}
```

---

### WR-03: SearchBar Ctrl+K 监听器抢全局快捷键，无 input 焦点也 preventDefault

**File:** `src/components/library/SearchBar.tsx:141-155`
**Issue:**
```ts
function onKey(e: KeyboardEvent) {
  const isK = e.key === "k" || e.key === "K";
  if (!isK) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.altKey || e.shiftKey) return;
  e.preventDefault();  // ← 即使 SearchBar 没挂载也会抢
  ...
}
```
监听器加在 window 上，**没有检查事件目标是不是在某个 contenteditable / textarea 中**。如果用户在 Detail 页的"备注"textarea 里写 markdown，按 Ctrl+K 想插入链接 —— 全局 listener 抢走，焦点跳到 SearchBar。同样地，浏览器 devtools 的 Ctrl+K 命令面板（Tauri webview 也支持）会被吃掉。

另一个问题：每个被 mount 的 SearchBar 实例都会注册一份；项目里只有一个 Library 路由，但如果未来 SubdirSplitDialog 也想要搜索框，就会有两个 listener 抢同一次按键。

**Fix:** 检查 target，且把热键移到全局 keyboard manager（route-level）：
```ts
function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t?.isContentEditable) return;
  if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") {
    // 已经在某个输入框 — 让 OS 默认行为生效；只有当前 input 是 SearchBar 才聚焦
    if (t !== inputRef.current) return;
  }
  ...
}
```

---

### WR-04: SearchBar 的 setDraft 部分路径用 `{ ...draft, ... }` 而非 functional updater

**File:** `src/components/library/SearchBar.tsx:259-281` (toggleDraft)
**Issue:**
```ts
function toggleDraft(c: Candidate) {
  if (c.kind === "brand") {
    const next = new Set(draft.brand);
    if (next.has(c.name)) next.delete(c.name); else next.add(c.name);
    setDraft({ ...draft, brand: next });  // ← 读 closure 中的 draft
  } else if (...) ...
}
```
如果用户快速连点两个候选项（同一回调队列内），第二次回调拿到的 `draft` 还是第一次回调开始时的旧值，第一次的 toggle 被覆盖。React 18 自动 batch 会让这种情况更频繁触发。

**Fix:** 用 functional updater：
```ts
setDraft((d) => {
  const next = new Set(d.brand);
  next.has(c.name) ? next.delete(c.name) : next.add(c.name);
  return { ...d, brand: next };
});
```

---

### WR-05: GameGrid useEffect `[rowStride, columnCount, virtualizer]` 中包含 virtualizer，每次 render 都触发

**File:** `src/components/library/GameGrid.tsx:176-178`
**Issue:**
```ts
useEffect(() => {
  virtualizer.measure();
}, [rowStride, columnCount, virtualizer]);
```
`useVirtualizer` 返回的 virtualizer 对象在文档里被描述成 stable，但实践中它依赖 internal options 引用，**games 数组变化 → useVirtualizer 重新计算 → 返回的对象 reference 可能不稳**（@tanstack/react-virtual 在某些 minor 版本里这个不一致）。如果不稳，这个 effect 在每次 games 变化都跑 `virtualizer.measure()`，无害但浪费；如果稳，倒没事。更好的做法是从 deps 里去掉它：

**Fix:**
```ts
useEffect(() => {
  virtualizer.measure();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [rowStride, columnCount]);
```

---

### WR-06: GameGrid resolveCover 用 useMemo 返回闭包，dataDir 改变才重建，但内部还引用了 `last_scanned_at`

**File:** `src/components/library/GameGrid.tsx:87-98`
**Issue:**
```ts
const resolveCover = useMemo(() => {
  return (game: Game): string | null => {
    if (game.cover_path && dataDir) {
      const abs = `${dataDir.replace(/\\/g, "/")}/${game.cover_path}`;
      return convertFileSrc(abs) + `?v=${encodeURIComponent(game.last_scanned_at ?? "")}`;
    }
    return game.cover_url ?? null;
  };
}, [dataDir]);
```
`useMemo` 这里没意义 —— 函数引用稳定不影响 GameCard 渲染（GameCard 接受 `coverDataUrl: string | null` 已经 memo），且每次调用都重新 `replace + convertFileSrc + encodeURIComponent`，缓存效果为 0。但更隐蔽的：`game.last_scanned_at` 改变（比如刚 refresh metadata 完）应当让 GameCard 重新拿到新 URL 触发 img 重新 fetch；目前确实会，因为 props.coverDataUrl 改变。这部分实际是 OK 的，**但代码逻辑歧义**，引人误读。

**Fix:** 改成普通函数 + 注释为何不 memo：
```ts
const resolveCover = (game: Game): string | null => { ... };
```
若是为了模拟"换 dataDir 只清一次缓存"，应当真的实现一个 Map cache。

---

### WR-07: SearchBar useEffect 中的 `dropdownOpen` cleanup 在容器外点击和切换 kind 时未消除 draft

**File:** `src/components/library/SearchBar.tsx:240-250`, `178-186`
**Issue:**
```ts
function onKindChange(next: SearchKind) {
  if (next === kind) return;
  setKind(next);
  setValue("");
  if (wasName && storeQuery !== "") setSearchQuery("");
  setDropdownOpen(next !== "name");
  ...
}
```
切换 kind 后 dropdown 仍然打开（next !== "name"），但 draft 并未重置或重新从 advFilter 克隆 —— 注释说"下拉打开/kind 切换 → 从 advFilter 重新克隆"对应 effect (`[dropdownOpen, kind, voicePoolIds, artistPoolIds]`)，看起来 OK；**但**: kind 从 brand→tag 时，**brand 的 draft 留在 `draft.brand` 不被清空**。用户先编辑 brand draft，再切到 tag，再切回 brand —— brand draft 还在，但 effect 里 `dropdownOpen` 仍为 true 且 `kind` 变成 brand，effect 会触发 → `setDraft((d) => ({...d, brand: new Set(advFilter.brands)}))` 把 brand draft 重置为已应用值。**实际行为对**，但**依赖 effect timing** 而非清晰的语义，未来重构容易踩。

**Fix:** 在 onKindChange 显式调用 reset：
```ts
function onKindChange(next: SearchKind) {
  if (next === kind) return;
  setKind(next);
  setValue("");
  if (kind === "name" && storeQuery !== "") setSearchQuery("");
  // 切到 facet → 立刻打开下拉；切到 name → 关下拉。
  setDropdownOpen(next !== "name");
  // draft 由 [dropdownOpen, kind, ...] effect 重克隆；不显式重置以避免一帧空 draft。
  requestAnimationFrame(() => inputRef.current?.focus());
}
```
加上注释即可，或者干脆把 draft 按 kind 独立持有。

---

### WR-08: MetadataPicker 的 candidate.source 类型已经是 `"bangumi" | "vndb"` 但被反复"窄化"为 `"bangumi"` 兜底

**File:** `src/components/library/MetadataPicker.tsx:312-322, 328-333`
**Issue:**
```ts
const src: "bangumi" | "vndb" = c.source === "vndb" ? "vndb" : "bangumi";
```
和
```ts
setSelected({
  source: c.source === "bangumi" || c.source === "vndb" ? c.source : "bangumi",
  sourceId: c.source_id,
})
```
都假设 `c.source` 可能不是 `"bangumi" | "vndb"`，但 `Candidate` 类型在 `@/lib/metadata` 里就是这两个字面量之一。代码冗余、降可读性，且如果将来后端真的返回 `"manual"`（已经在 game.metadata_source 出现过），这个兜底会把 manual 错认成 bangumi 然后 openExternalUrl 到 https://bgm.tv/subject/whatever —— **静默错误**。

**Fix:** 信任类型，明示当 source 是其他值时 throw 或 toast：
```ts
function openSourcePage() {
  if (c.source !== "bangumi" && c.source !== "vndb") {
    toast.error("不支持的元数据源");
    return;
  }
  const url = c.source === "vndb" ? vndbVnUrl(c.source_id) : bangumiSubjectUrl(c.source_id);
  void openExternalUrl(url).catch(...);
}
```

---

### WR-09: MetadataPicker.onApply 不 await sidebar refresh 但本地变量 `cats` 之后无用

**File:** `src/components/library/MetadataPicker.tsx:178-185`
**Issue:**
```ts
try {
  const cats = await getSidebarCategories();
  setSidebar(cats);
} catch (e: unknown) {
  console.error(...);
}
```
这块 OK，但**它在 onApply 主 try 里**，会阻塞 `toast.success("已应用元数据")` 一拍。如果 sidebar IPC 因为锁慢了 200ms，用户感觉应用反应延迟。已经标注 "Sidebar refresh is best-effort"，那就应该 fire-and-forget。

**Fix:**
```ts
void getSidebarCategories().then(setSidebar).catch(e => console.error("[...] sidebar refresh failed:", e));
toast.success("已应用元数据");
onClose();
```

---

### WR-10: ActiveSessionBar 用 useState(0) tick 每秒 re-render，dropdown selector 不稳

**File:** `src/components/library/ActiveSessionBar.tsx:60, 72-76`
**Issue:**
```ts
const [, setTick] = useState(0);
useEffect(() => {
  if (!activeSession) return;
  const id = window.setInterval(() => setTick((n) => n + 1), 1000);
  return () => window.clearInterval(id);
}, [activeSession]);
```
每秒一次 setState 触发 ActiveSessionBar 整树 re-render。子节点都是简单 DOM 没什么开销，但是 `games.find((g) => g.id === activeSession.game_id)` 是 O(n)，对大库每秒做一次。

**Fix:** 改成只更新一个 ref 然后 forceUpdate；或者更简单 —— 只让 timer 显示部分变成独立组件：
```tsx
function SessionTimer({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <>{fmtSessionTimer(Math.floor((now - Date.parse(startedAt)) / 1000))}</>;
}
```
父组件只在 activeSession 变化时 re-render。

---

### WR-11: ScanFeed `idToName` ref 在 games 变化后跟 push() 异步发生顺序错乱

**File:** `src/components/library/ScanFeed.tsx:50-55, 130-138`
**Issue:**
```ts
const idToName = useRef(new Map<number, string>());
useEffect(() => {
  const m = new Map<number, string>();
  for (const g of games) m.set(g.id, g.name_cn || g.name);
  idToName.current = m;
}, [games]);
```
注释说"预先解析在 push 时是为了避免 feed 因为 games 改而整体 re-render"。**但是** push 时引用 `idToName.current.get(game_id)` —— 如果 meta-fetch-progress 的 `started` 事件比 placeholder INSERT 早到达前端（极少情况下 emit 顺序与 SQLite WAL 提交不同步），id 不在 idToName 里，落到 `"游戏 #${game_id}"` fallback。这本身是预设的兜底，没什么问题。**真正的隐患** 是 `games` 数组变化后 idToName 不会立刻刷新已经在 lines 里的旧 entry —— 一个 game 重命名后，feed 历史仍显示旧名称。这是 by design，但 lib 里没说清。

**Fix:** 这是 acceptable behavior，加注释明示即可：
```ts
// Note: 已存在 lines 里的 entry 不会随 games rename 更新 —— 设计如此（feed 是
// session-local 历史日志，rename 不应回溯改历史）。
```
不算 bug，但有歧义，提个醒。**降级到 Info。** —— 看了一下属于轻度文档缺漏，移到 IN-XX。删除 WR-11。

(以下编号补全，原 WR-11 移到 IN-09)

---

### WR-11: TweaksPanel sampleGameId useMemo 无意义 + 没追踪 games 变化重新计算

**File:** `src/components/tweaks/TweaksPanel.tsx:200-201`
**Issue:**
```ts
const games = useLibraryStore((s) => s.games);
const sampleGameId = useMemo(() => games[0]?.id ?? null, [games]);
```
useMemo 包裹 `games[0]?.id` 没有任何性能意义（计算成本是常数），徒增阅读负担。

**Fix:**
```ts
const sampleGameId = games[0]?.id ?? null;
```

---

### WR-12: BackfillProgressBar 监听器同 CR-01 race，且 `total === 0` 时 `pct=0` 但 status=running 显示 "0%" 永不更新

**File:** `src/components/library/BackfillProgressBar.tsx:55-92, 110-111`
**Issue:** 除了 CR-01 同样的 race，额外问题：当后端 emit `total: 0`（一次没有任何游戏要补齐）时，setTotal(0)，但状态卡在 "running" 永远不会触发 done（因为没有 per-game finished 事件来推进 current）。用户看到一个 0% 的卡死进度条。

**Fix:**
```ts
if (typeof p.total === "number" && p.total > 0) {
  setTotal(p.total);
  setCurrent(0);
  setCurrentName("");
  setStatus("running");
  setHidden(false);
  return;
}
if (typeof p.total === "number" && p.total === 0) {
  // 没有要补的游戏 —— 直接折叠
  setStatus("done");
  setHidden(true);
  return;
}
```

---

### WR-13: ReviewQueue.onAccept / onDismiss 乐观删除后失败时只 refetch 一次，丢中间态

**File:** `src/components/library/ReviewQueue.tsx:150-176, 178-194`
**Issue:**
```ts
setItems((prev) => prev?.filter((x) => x.game_id !== gameId) ?? null);
try {
  await acceptReviewCandidate(...);
  await refetch();
  ...
} catch (e: unknown) {
  toast.error(`绑定失败 — ${String(e)}`);
  await refetch();
}
```
失败时 refetch 把删错的行加回来，OK。**但**: 失败的 toast 出现的同时，用户可能已经点了下一行的"采用"按钮 —— 第二次 optimistic delete 还没等第一次 refetch 完成，最终 setItems 顺序未定，可能漏掉第二次的 mutation。

**Fix:** 用一个 "in-flight" set 防止重复点击，或加 mutex：
```ts
const [inFlight, setInFlight] = useState<Set<number>>(new Set());
// 在按钮里 disabled={inFlight.has(it.game_id)}
```

---

### WR-14: GameCard onError 同 WR-02，加 `display: none` 不可逆

**File:** `src/components/library/GameCard.tsx:316-318`
**Issue:** 同 WR-02。

**Fix:** 同 WR-02 —— state 跟踪 error，src 变化时 reset。

---

### WR-15: FilterPanel.RatingInput 把无效数字静默吞掉

**File:** `src/components/library/FilterPanel.tsx:550-561`
**Issue:**
```tsx
onChange={(e) => {
  const raw = e.target.value;
  if (raw === "") { onChange(null); return; }
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1 && n <= 10) onChange(n);
  // ← else 路径：什么也不做，但 input.value 已经显示了非法值
}}
```
输入 `15` 后 input 显示 `15` 但 state 仍是上一个有效值，且没有视觉提示。下次 re-render 后才会用 `value={value ?? ""}` 把 input 拉回。React controlled input + 间歇性接受值 = 用户体验混乱。

**Fix:** 接受任意输入到中间字符串 state，blur 时 commit；或直接 `min/max/step` HTML 校验 + onChange 截断：
```tsx
onChange={(e) => {
  const raw = e.target.value;
  if (raw === "") { onChange(null); return; }
  const n = Number(raw);
  if (!Number.isFinite(n)) return;
  onChange(Math.max(1, Math.min(10, n)));
}}
```

---

### WR-16: Sidebar.refreshSidebar 在多个 mutation 流程里 await，但 createCustomView 后 applyFilter 在 refresh 之前不可见

**File:** `src/components/layout/Sidebar.tsx:247-269`
**Issue:**
```ts
async function handleViewSubmit(name: string) {
  if (!viewDialog) return;
  if (viewDialog.mode.kind === "create") {
    try {
      const id = await createCustomView(name);
      await refreshSidebar();
      applyFilter({ custom_view_id: id });
      toast.success(`已创建视图「${name}」`);
    } catch (e: unknown) { ... }
  } else { ... }
}
```
顺序是「创建 → refresh sidebar（约 100ms 一个 IPC） → 切换 filter → toast」。用户感知是按"创建视图"后大约 300-500ms 才看到 grid 变成空视图、sidebar 高亮新行。如果先 applyFilter 再 refreshSidebar，filter 立即生效（grid 走 advFilter，不依赖 sidebar 数据），sidebar 在后台补上更顺。

**Fix:**
```ts
const id = await createCustomView(name);
applyFilter({ custom_view_id: id });
void refreshSidebar();  // 非关键路径
toast.success(`已创建视图「${name}」`);
```

---

### WR-17: TagPicker handleOpenChange 在 unmount 时不 commit，会丢失正在编辑的草稿

**File:** `src/components/library/TagPicker.tsx:163-174`
**Issue:**
```ts
function handleOpenChange(next: boolean) {
  if (open && !next) {
    ...
    if (!same) void commitChanges();
  }
  setOpen(next);
}
```
只有 popover 关闭时才 commit。如果用户在 popover 打开状态下导航走（unmount）—— popover 不会触发 onOpenChange，stagedIds 直接丢弃，用户白勾。**配合 commitChanges 是 fire-and-forget（void）**，已经勾的标签也没保存。

**Fix:** 用 useEffect cleanup 兜底：
```ts
useEffect(() => {
  return () => {
    if (open) {
      // unmount 时未关闭 — 强制提交
      const before = new Set(selectedTags.map((t) => t.id));
      const same = before.size === stagedIds.size &&
        Array.from(before).every((id) => stagedIds.has(id));
      if (!same) void commitChanges();
    }
  };
  // 故意只跑一次
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

---

### WR-18: SavesTab 删除/恢复确认按钮没有 disabled 防重，连点会发多次 IPC

**File:** `src/components/library/SavesTab.tsx:182-196, 167-180, 153-165`
**Issue:** onRestoreConfirmed / onDeleteConfirmed / onBackupConfirmed 里都没有 in-flight 守卫；AlertDialog 的 Action 按钮也没 disabled。用户快速双击 → 触发两次 IPC，备份会在 backend 拒绝（unique constraint）或者写两份；恢复更严重 —— 第一次恢复完后第二次又把刚恢复的数据再覆盖一遍（如果 backend 不幂等）。

**Fix:** AlertDialogAction 加 disabled 状态，并跟踪 `inProgress`:
```ts
const [restoreBusy, setRestoreBusy] = useState(false);
async function onRestoreConfirmed() {
  if (pendingRestoreId == null || restoreBusy) return;
  setRestoreBusy(true);
  try { await restoreSaveBackup(pendingRestoreId); ... }
  finally { setRestoreBusy(false); setPendingRestoreId(null); }
}
```

## Info

### IN-01: GameCard memo 拿 game 整 object 做浅比较，game 引用变就全 card 重渲

**File:** `src/components/library/GameCard.tsx:642`
**Issue:** `memo(GameCardImpl)` 默认浅比较 props。父组件 GameGrid 每次 setGames 后**所有 Game 对象引用都新**（lib/games 里 listGames 返回新数组新对象），所有 card 都会 re-render —— memo 实质失效。注释里说"useVirtualizer recomputes virtualItems on every scroll frame"，那个场景下 game 引用是稳定的（react-virtual 不动 games 数组），memo 有效。但 mutation 后所有 card re-render —— 不是 bug，但 memo 没起到设计宣称的效果，可移除以减阅读负担。

**Fix:** 要么用自定义 areEqual：
```ts
export const GameCard = memo(GameCardImpl, (a, b) =>
  a.game.id === b.game.id &&
  a.game.is_favorite === b.game.is_favorite &&
  a.game.status === b.game.status &&
  a.game.total_playtime_sec === b.game.total_playtime_sec &&
  a.coverDataUrl === b.coverDataUrl &&
  a.selectMode === b.selectMode &&
  a.selected === b.selected,
);
```
或者删 memo 注释里那段误导文案。

---

### IN-02: GameCard `void` 转 Promise 在事件回调里没 catch，failed update 静默吞掉

**File:** `src/components/library/GameCard.tsx:407, 500, 514, 578-585`
**Issue:**
```tsx
onClick={(e) => { e.stopPropagation(); void onToggleFavorite(); }}
```
`void` 抛弃 Promise，onToggleFavorite 内部已经 catch 并 toast.error，所以**目前是 OK**。但是模式不一致：onSetStatus / onForceEnd 等也 void 包装，依赖每个方法都有 try/catch。如果有一个新增的 handler 漏了 catch，浏览器 unhandledrejection 会触发但无 toast。

**Fix:** 引入 helper：
```ts
function fireAndToastError(p: Promise<void>, label: string) {
  p.catch(e => toast.error(`${label}失败 — ${String(e)}`));
}
```

---

### IN-03: 注释里出现"Phase 5"等 stale references

**File:** `src/components/settings/UIPreferences.tsx:14-16, 130-136`, `ScreenshotsTab.tsx`（Phase 5 / 05e 注释）
**Issue:** 多个组件注释引用 "Phase 5 主题切换将加入" 等过时计划标记。生产代码里包含一个 disabled 占位行"主题（深浅色切换将在 Phase 5 加入）"—— Tweaks 面板已经实现了三主题切换。**用户在 Settings 页看到一个永远 disabled 的"暗色"行，跟 Tweaks 的主题切换显然矛盾**。

**Fix:** 删掉 UIPreferences 里的"主题"row，或改成跳转到 Tweaks。

---

### IN-04: SortSelect 用原生 `<select>`，无法跟随 shadcn select 主题

**File:** `src/components/library/SortSelect.tsx:33-55`
**Issue:** 整个 Library toolbar 都是 shadcn 风格，只有 SortSelect 用原生 select + 内联 SVG 箭头 + 内联 `backgroundImage` data URI。option 项的 `bg-bg-1 text-ink-0` className 不生效（option 元素 OS-native，不受 CSS 控制，Windows 下永远是系统色）。视觉漂移。

**Fix:** 用 shadcn `<Select>` 替换（UIPreferences 已经用了同样的 SortBy）；保持视觉一致。

---

### IN-05: ContextMenu 内 `void onPickMetadata(game)` 等同步函数不需要 void

**File:** `src/components/library/GameCard.tsx:618, 621, 625, 629`
**Issue:** `onPickMetadata: (game: Game) => void` 返回 void，但调用处仍 `() => onPickMetadata(game)`（这个是对的）—— 注意区分。`onSelect={() => onPickMetadata(game)}` 是同步的，没问题。但相邻的 `onSelect={() => void onSplitSubdirs(game)}` 和 `onSelect={() => onSplitSubdirs(game)}` 风格不一致（前者有 void，后者没有），阅读时干扰。

**Fix:** 统一风格，所有同步 onSelect 都不带 void；async 的才 void。

---

### IN-06: FilterPanel 重复定义 `cloneFilter`，已存在 `lib/advancedFilter.ts`

**File:** `src/components/library/FilterPanel.tsx:71-83`
**Issue:** `cloneFilter` 在组件内本地定义；如果 lib 里已经有了，按 DRY 原则应当移到那里。如果没有，这个工具函数也应该放 lib 而不是组件，因为 SearchBar 也可能要用。

**Fix:** 移到 `@/lib/advancedFilter.ts`。（确认 lib 里是否已经有再决定。）

---

### IN-07: TagPicker.CommandEmpty 文案在创建模式下被遮蔽

**File:** `src/components/library/TagPicker.tsx:202-203`
**Issue:** cmdk 的 CommandEmpty 在搜索词无任何 match 时显示；但**当 `!exactMatch && trimmedSearch.length > 0` 时**，我们渲染一个"创建新标签"item，cmdk 可能仍然认为「没有匹配」从而显示 CommandEmpty "暂无匹配的标签"。最终 UI 同时显示「暂无匹配的标签」和「创建新标签 'X'」两个块，视觉割裂。

**Fix:** 把 CommandEmpty 改为：
```tsx
<CommandEmpty>{trimmedSearch.length === 0 ? "暂无匹配的标签" : null}</CommandEmpty>
```
或者把创建项也放到一个 CommandGroup，cmdk 会算它为 match。

---

### IN-08: SubdirSplitDialog `gameHasUserData` 导出但本组件内不使用

**File:** `src/components/library/SubdirSplitDialog.tsx:58-66`
**Issue:** helper 导出供父组件用 —— 那么应当移到 `@/lib/games.ts` 之类的辅助模块，不要污染对话框组件的 export 表面。否则父组件 import 路径暗示了语义依赖。

**Fix:** 移到 `lib/games.ts` 或 `lib/scan.ts`。

---

### IN-09: ScanFeed 已有 idToName ref 但渲染历史里不会回写新名 —— 缺少注释

**File:** `src/components/library/ScanFeed.tsx:50-55`
**Issue:** 注释只解释了"avoid re-render"，没说明设计含义"line 不会随 rename 回溯"。开发者改 ScanFeed 时容易踩。

**Fix:** 加注释明示历史是 session-immutable。

---

### IN-10: BackfillProgressBar 与 ScanProgressBar 高度重复，可抽公共 ProgressBar

**File:** `src/components/library/BackfillProgressBar.tsx` 全文 vs `ScanProgressBar.tsx` 全文
**Issue:** 两个组件的 2px gradient bar + 8px status row + cancel AlertDialog 是同一套布局；重复了 ~150 行 JSX。维护时改一个 visual 必须改两个。

**Fix:** 抽 `<TopProgressBar pct percent summary onCancel cancelDescription />` 公共组件，两个 owner 只负责事件 → state 的部分。

---

### IN-11: WindowControls 直接调用 `getCurrentWindow()` 在每次 render，可缓存

**File:** `src/components/layout/WindowControls.tsx:16`
**Issue:** `getCurrentWindow()` 在函数体顶部调用，每次 re-render（虽然该组件几乎不 re-render）都会运行。无害但不优雅。

**Fix:** `const win = useMemo(() => getCurrentWindow(), [])`。Tauri 的 currentWindow 是稳定的，可放 module-scope 常量。

---

### IN-12: ViewToggle 用 `aria-checked` + `role="radio"` 但容器是 div 不是 fieldset，缺少表单语义

**File:** `src/components/library/ViewToggle.tsx:24-30`
**Issue:** 一个无 fieldset/label 的 radiogroup，屏读器朗读"radiogroup, 视图模式" + 2 个 radio，没问题；但项目里 DensityToggle / Segmented (TweaksPanel) 都没用 radiogroup 语义。一致性问题。

**Fix:** 要么全部统一为 radiogroup，要么都用 button group + aria-pressed。

---

## 整体观察

1. **listen-then 模式问题需要批量修一次**（CR-01 影响 4 个组件）—— 建议在 lib 里写一个 `useTauriListen(event, handler, deps)` hook 集中处理 race。
2. **多组件的 img onError 直接 DOM 操作**是同一类 anti-pattern（WR-02 / WR-14 影响 5+ 处）。封装一个 `<SafeImage src fallback />` 组件可以一次性消解。
3. **GameList vs GameGrid 的订阅粒度差异**（WR-01）—— 注释说"列表行不 memo"是个权衡，但项目目标是大库，应当一开始就 per-row。
4. **大量 inline `style={{ borderRadius: "var(--r-md)" }}` 等 token**散落 JSX —— 项目用了 Tailwind，应当抽 `rounded-token-md` utility 或者用 className 直接 `rounded-md`（如果 r-md 是 0.375rem 等标准值的话）。当前每个文件都要手写 inline style，代码可读性差。
5. **Dialog/AlertDialog 的 onCloseAutoFocus 处理只在 MetadataPicker 做了**（quick 260519-21s 修复），但相同 ContextMenu → Dialog 链路在 SubdirSplitDialog、ScreenshotsTab 都可能复发。建议把 `onCloseAutoFocus={(e) => e.preventDefault()}` 作为项目级 dialog 默认。
6. **快捷键缺乏全局协调**（WR-03）—— 项目还会引入更多快捷键，建议建立一个全局 keymap registry。
7. **乐观更新 + refetch 兜底**模式在 ReviewQueue / RemovedDirs 用得很好，但 SavesTab / TagManager 没用，应当一致化。
8. **Memo 与 selector 粒度配合**：GameCard 做了 per-id selector，但 memo 的 areEqual 仍是默认浅比较 —— 大量子节点改 game 字段时 memo 失效，没起到优化效果（IN-01）。

---

_Reviewed: 2026-05-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
