---
phase: 260524-fullreview / routes & app entry
reviewed: 2026-05-24T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/App.tsx
  - src/main.tsx
  - src/router.tsx
  - src/routes/Detail.tsx
  - src/routes/Library.tsx
  - src/routes/Persons.tsx
  - src/routes/Scan.tsx
  - src/routes/Screenshots.tsx
  - src/routes/Settings.tsx
  - src/routes/Stats.tsx
findings:
  blocker: 4
  warning: 14
  info: 8
  total: 26
status: issues_found
---

# 路由层与应用入口 — 代码审查

**深度**：standard
**范围**：App / main / router + 7 个路由页

## 总览

整体路由结构尚可：`createHashRouter` + `<App>` 布局 + 各路由懒挂载到 `<Outlet/>`，HashRouter 的选择有 CONTEXT.md 背书。但本批文件最大的两个系统性问题是：

1. **全局副作用全部塞在 `main.tsx` 模块顶层**（4 套 listener + DB 预热 + 主动会话 hydration），没有错误熔断也没有热重载防护，且模块级 `__xxx_Unsub` 守卫**逻辑错误，永远走不到 false 分支**——HMR 一旦把模块换掉，老 listener 永远关不掉（dev 体验 bug，prod 不暴露）。
2. **没有用 react-router 的 loader/action**。所有路由（Detail / Persons / Stats / Screenshots / Settings / Scan / Library）都把数据拉取写在 `useEffect` 里，触发链路深、首屏阻塞明显，且大量使用「`listGames()` 全表 + `.find` 客户端筛 id」这种 N=全库的方式做单条数据获取（Detail.tsx:494、Persons.tsx:170 嵌套）。

代码体量也偏失控：**Detail.tsx 1700+ 行**（包含 6 个 tab 全部内联 + 至少 7 个内部组件 + 多个 hooks），这种规模在没有拆分 hooks 和 sub-components 之前，每次改动一个 tab 都得改这一个文件。Library.tsx 已经 960 行，临界。

下面按等级列出具体问题。

---

## BLOCKER

### BL-01 模块级 listener 守卫永远进真分支，HMR 后老 listener 不解绑、重复事件

**File:** `src/main.tsx:43-44, 93-94, 137-138, 175-176`

**Issue:** 4 个 listener 都用「`let __xxxUnsub: (() => void) | undefined; if (!__xxxUnsub) { ...; .then(fn => { __xxxUnsub = fn }) }`」的模式做幂等守卫。**这个守卫永远是 truthy 分支**：模块顶层执行时 `__xxxUnsub` 必然是 `undefined`，所以 `!undefined === true`，进入 if；然后异步 `.then` 才回填，但每次模块求值时这个变量都是新声明的、`undefined`。

后果：
- 生产环境恰好没事（模块只 import 一次）。
- 但 Vite HMR 一旦命中 `main.tsx`（修改文件、import 这里的 store/types），模块会被重新求值，**4 个 `listen` 全部重新挂一份**，老的 unsub 函数本来就是局部变量、新模块求值后丢失引用，**永远关不掉**。dev 会看到 scan-progress / meta-fetch-progress 一次事件触发 N 次 store mutate（重复 setState、重复 toast）。
- 注释自己也写了「**If we ever adopt strict-mode double-mount in dev or move this into a component, we must add a module-scope guard**」——但这个守卫**根本没生效**，作者把变量声明 + 检查写在同一模块作用域，HMR 是清掉作用域的，不是查询它。

**Fix:** 用真正的模块单例（不会被 HMR 清掉），或者改用 `import.meta.hot` 在 dispose 时主动 unsub：
```ts
// main.tsx
declare global { interface Window { __galLibListeners?: { scan?: UnlistenFn; meta?: UnlistenFn; sess?: UnlistenFn; tray?: UnlistenFn; } } }
const reg = (window.__galLibListeners ??= {});

if (!reg.scan) {
  onScanProgress(/* ... */).then(fn => { reg.scan = fn; });
}
// repeat for meta / sess / tray

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    reg.scan?.(); reg.meta?.(); reg.sess?.(); reg.tray?.();
    reg.scan = reg.meta = reg.sess = reg.tray = undefined;
  });
}
```

---

### BL-02 Detail.tsx 用 `listGames()` 全表拉取来获取单条游戏

**File:** `src/routes/Detail.tsx:492-508`

**Issue:** `refreshGame` 调用 `listGames()` 拿到**整库所有游戏**，再 `all.find(x => x.id === gameId)`。结合本文件其他地方（行 683、693、703、794、805、821、582、594）的 7 处 `await refreshGame()` 调用，**每次用户做任何 mutation（收藏 / 评分 / 状态 / 笔记 saved 后 metadata refresh / activeSession ended / closePicker），全库被拉一次**。当库到 500+ 条目时，单条 mutate 走 IPC + SQL + JSON 序列化 N=500 个 row 来更新单 1 个游戏。

属于数据正确性问题（mutate 与刷新不同步）+ 性能问题，但更严重的是它**和 Library 共用 `useLibraryStore.games`**：注意 Detail.tsx 这个 `refreshGame` **只 setGame(local)、并没有写回 store**，所以 Library 跳过来时显示的 games 数组并没有被 Detail 的刷新更新——Detail 里看到的 `game` 和 Library 里看到的 `games.find(g => g.id === gameId)` 可能**不同源**，对 prev/next 导航（行 623-628）和「位置 idx / total」计数也带来 stale 风险。

**Fix:** 引入 `getGame(id)` IPC 单条查询；或者 mutate 后只更新 store 内对应那一行：
```ts
const refreshGame = useCallback(async () => {
  if (!Number.isFinite(gameId)) return;
  const g = await getGameById(gameId);   // 新 IPC
  setGame(g);
  if (g) useLibraryStore.getState().upsertGame(g);  // 同步回主 store
  // ...
}, [gameId]);
```

---

### BL-03 Persons.tsx 对 voice 列表做 N+1 嵌套全表查询

**File:** `src/routes/Persons.tsx:166-196`

**Issue:** 在 voice 角色加载后，对**每一个 voice 关联游戏**都额外调用 `listPersonsForGame(g.id)`，再在结果里 `find` 出当前 personId 的 voice 行拿 `character_name`。如果一个声优参与 50 部游戏：50 次 IPC + 50 次 SQL JOIN + 50 次返回完整人物列表（每部游戏可能 20-50 人）——只为提取 50 个字符串。

更糟糕的是这个循环没节流，没失败聚合（`try/catch` 在每个 await 里独立 swallow，整体观感是声优页打开 1-2 秒卡死）。

**Fix:** 提供一个 `listCharactersForPerson(personId)` IPC，后端一句 SQL：`SELECT game_id, character_name FROM game_persons WHERE person_id=? AND role='voice'`。前端一次拿全部映射。

---

### BL-04 Detail.tsx 全局 keydown `Esc → navigate(-1)` 在 Library 子组件打开 Dialog 期间不可靠

**File:** `src/routes/Detail.tsx:600-608`

**Issue:** 注释说「Radix Dialog primitives trap focus and call stopPropagation on their own Esc handlers, so this only fires when no dialog is open」。这个假设在**冒泡阶段**成立，**捕获阶段不成立**。Radix Dialog 在 capture / bubble 阶段的行为依赖 `onEscapeKeyDown` 调用方有没有 `e.preventDefault()`——而本 listener 用的是 `window.addEventListener("keydown", onKey)`（默认冒泡 + Bubble 阶段也会触发），但很多 Radix overlay primitives 实际是在`KeyboardEvent.target === document.body` 时也会上浮。

具体可复现路径：用户在 Detail 页打开 MetadataPicker → 在 picker 里点了一个候选项 → picker 关闭后焦点暂时回落到 `<body>` → 用户按 Esc 想关掉一个**已经关掉的弹窗** → window listener 触发 `navigate(-1)` → 用户被踢回 Library。

而且这个 listener 与 LaunchButton 的状态变更耦合（注释 `re-pull staff + official tags to stay in sync`），用户在游戏运行期间在 Detail 按 Esc → 直接退出 Detail 页，是预期行为吗？不见得。

**Fix:** 用 `useHotkeys` 或检查 `e.target` 是不是处于 Dialog/Tooltip 内（看 `[data-state="open"]` 祖先）；至少加 `if (document.activeElement?.closest('[role="dialog"]')) return`：
```ts
function onKey(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (document.querySelector('[role="dialog"][data-state="open"]')) return;
  navigate(-1);
}
```

---

## WARNING

### WR-01 Scan.tsx 的 listener 是 raw `listen()`，与 main.tsx 的全局订阅平行存在

**File:** `src/routes/Scan.tsx:67-84`

**Issue:** main.tsx 已经全局订阅了 `scan-progress` 并写入 store。Scan.tsx 又单独 `listen<ScanProgress>("scan-progress", ...)`，只为在终态时调一次 `refreshKpis()`。这导致**同一事件被前端解析两次**（Tauri event listener 是 fan-out 的，每个 listener 独立反序列化 payload）。

更好的写法是订阅 store 里的 `scanProgress` 选择 status，用 useEffect 监测 status 边沿：
```ts
const status = useLibraryStore(s => s.scanProgress?.status);
useEffect(() => {
  if (status === "completed" || status === "cancelled" || status === "failed") {
    void refreshKpis();
  }
}, [status, refreshKpis]);
```

附带的 bug：`listen(...).then(fn => unlisten = fn)` 里**没有 `.catch`**——如果 Tauri 还没就绪（罕见但有），promise 静默 reject，effect 的 cleanup `unlisten?.()` 永远是 noop，但 listener 实际有可能被附加上了——这是另一个潜在的内存泄漏路径。

---

### WR-02 Settings IntersectionObserver 在 Scroll-spy 时机错位，DOM 还没挂

**File:** `src/routes/Settings.tsx:103-121`

**Issue:** observer 在 `useEffect` 第一次跑时遍历 `sectionRefs.current[sec.id]`。但是这些 ref 是在 JSX 里通过 `<section ref={el => sectionRefs.current[id] = el}>` 设置的（Section 组件行 573-587）。React 18+ 严格模式下首次 effect 跑的时机晚于 ref 提交，但**对 `useRef` + callback ref 的写入顺序，9 个 section 里如果有任何一个还没渲染完毕（比如 lazy import 的 TagManager / UIPreferences / AboutSection 还没 ready），它们的 ref 此刻是 null**，observer 就漏观察了。

由于 effect 依赖是 `[]`，**漏掉的 section 永远观察不到**，scroll-spy 在那个 section 不工作。

**Fix:** 把依赖改为 `[]` + 用 MutationObserver 监听新挂载，或者直接在 `Section` 组件的 `ref` callback 里把 element 直接 `observer.observe(el)` 注册（让 observer 持有在 ref 里）。

---

### WR-03 Settings.tsx 添加单个游戏：`toast.promise(job, ...)` 与 `await job` 双 await

**File:** `src/routes/Settings.tsx:181-202`

**Issue:** `toast.promise(job, ...)` 已经会消费 promise 的 resolve/reject。下面又 `try { await job } catch { /* swallow */ } finally { setIsAddingGame(false) }`。job 是同一个 promise——这没有正确性问题（promise 可被多次 await），但有两个副作用：
1. 如果 job reject，`toast.promise` 触发 error toast，**同时**外层 catch 吃掉异常——但 `toast.promise` 内部是把 reject 重新 throw 的（取决于版本，sonner 1.x 通常是 swallow，但其实行为依版本而异），可能造成「成功 toast 显示 + 实际失败」或 `unhandledrejection` 警告。
2. `setIsAddingGame(false)` 应该用 promise 链上的 `.finally`，而不是再次 await 整个 promise，更直白。

**Fix:**
```ts
setIsAddingGame(true);
const job = (async () => { /* ... */ })();
toast.promise(job, { /* ... */ });
job.finally(() => setIsAddingGame(false));
```

---

### WR-04 Settings 的 `onChangeDepth` 用「先 remove 再 add」改深度，存在删除成功 + 添加失败的中间态

**File:** `src/routes/Settings.tsx:216-227`

**Issue:** `removeScanRoot(id)` 成功后立刻 `addScanRoot(target.path, depth)`。如果中间任意一步失败（磁盘满 / 数据库锁 / 路径已经被并发 add），**用户的原配置丢失**：root 被删但未重新加回。catch 块只 toast 报错，**没有任何回滚**。

更隐蔽的问题：这个操作不是事务化的，可能导致 `scanRoots` 表中关联的 ingest 队列、扫描历史等被 cascading delete（取决于后端 schema）。

**Fix:** 后端提供 `updateScanRootDepth(id, depth)` IPC（一句 UPDATE）；前端不应该用 delete+insert 模拟 update。

---

### WR-05 Library.tsx 的「scan completed」边沿检测 effect 依赖列表会重复触发

**File:** `src/routes/Library.tsx:399-425`

**Issue:** 依赖列表是 `[scanProgress?.status, scanProgress?.total, refetchGrid, refreshSidebar, refreshFilterOptions]`。当 scan completed 时：
1. `refetchGrid` 触发 setGames → games 变化 → `refetchGrid` 的依赖 `[searchQuery, sortBy, filter, advFilter, setGames]` 不变，identity 稳定。OK。
2. 但是 effect 主体里 `await refetchGrid(); await refreshSidebar(); await refreshFilterOptions();`，**这三个 IPC 串行 await**，期间如果用户改了筛选 → `refetchGrid` identity 变 → **当前正在跑的 async block 会用旧 refetchGrid 跑完，但 effect 又被新 refetchGrid identity 触发**——这时 `prevScanStatus.current` 已经被设为 `completed`，再次 effect 进入时 `prev === "completed" && next === "completed"`，所以不会重复触发 toastScanFinished，**安全**。

但是 `prevScanStatus.current = next` 这一句**写在 if 检查之前**（行 403），意味着 effect 触发后 ref 立刻设置为 completed，下一次 effect 即使依赖变化也不再 re-fire。这个 ref 设置不放在 cleanup 里也行——但「ref 写在 effect 第一行」是个反模式，React 严格模式下 effect 会双跑：第一次跑设置 ref → 第二次（cleanup-mount cycle）跑时 `prev === next === "completed"`，**toast 不触发**。在严格模式开发环境会观察到「扫描完成 toast 完全不出现」的偶发现象（看 React 严格模式打开与否）。

**Fix:** 把 ref 更新逻辑放到边沿命中之后：
```ts
useEffect(() => {
  const prev = prevScanStatus.current;
  const next = scanProgress?.status ?? null;
  if (prev !== "completed" && next === "completed") {
    prevScanStatus.current = next;   // ← 只在边沿命中后更新
    /* ... */
  } else {
    prevScanStatus.current = next;
  }
}, [...]);
```
或者更简单：用 `useSyncExternalStore` / zustand 订阅器外部触发，而非 useEffect。

---

### WR-06 Library.tsx 的 scroll restore 依赖列表 `[]`，但 setLibraryScrollTop 是 zustand selector 返回值

**File:** `src/routes/Library.tsx:271-286`

**Issue:** 注释解释为何用 `useEffect` + `requestAnimationFrame` 链。但 effect 依赖是空数组 `[]`，react-hooks/exhaustive-deps lint 会想要 `[setLibraryScrollTop]`（虽然 effect 体里没用 setter，只用了 `useLibraryStore.getState().libraryScrollTop`）。这里没用 setter 是对的——但**该 effect 体里读 store 是 imperative 的**，意味着如果用户在 Library 卸载前快速来回切换，store 里的 saved 值可能不是最新的——比如 `[saved=5000]` 是上一次的位置，但当前没滚过，effect 就把页面拉到 5000，造成「视觉跳一下」。

更严重：第二个 useLayoutEffect（行 243-248）在 unmount 时写入 store，但**没有同步触发 React 渲染**——如果 useEffect (行 271) 的 cleanup 已经触发，再次 mount 时仍然会读到上次的 5000。这本身是预期行为；但**结合 BLOCKER 路径 `navigate(-1)` 等场景**，用户从 Detail 用浏览器后退回 Library 时滚动恢复 OK；但从 Library → Library（比如 `/?` query change，目前不会，但未来会用）时，组件可能不卸载，restore 不会跑。

**Fix:** 加注释 + 加 eslint-disable，并显式列出意图：
```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```
长期看：把 scroll restore 抽成一个 `useScrollRestore(key)` hook，并通过 react-router 6 的 `<ScrollRestoration />` 标准 API 取代手写实现。

---

### WR-07 Screenshots.tsx 对所有游戏并行 `getScreenshots`，N 部游戏 N 次 IPC

**File:** `src/routes/Screenshots.tsx:67-99`

**Issue:** 每次 `games` 数组变化都会触发 `Promise.all(games.map(g => getScreenshots(g.id)))`——库里有 500 部游戏就 500 次 IPC。结合 Library scan-progress 节流（main.tsx）触发 games 变更，Screenshots 页打开期间扫描进行中会持续地反复全量拉截图列表。

而且这里**没有 abort/cancel 机制**：用户离开 Screenshots 页时，那 500 个并行请求还在跑（Tauri IPC 不可取消），并且仍然会 `setGroupedByGame`——`cancelled` flag 只是丢弃结果，IPC 仍然占用后端线程池。

**Fix:** 后端提供 `listGamesWithScreenshots()` 一句 SQL：`SELECT game_id FROM screenshots GROUP BY game_id`，前端拿这个 id 集再 join games[]，并按需懒加载每组的具体截图（IntersectionObserver 触发）。

---

### WR-08 Stats.tsx `computeStreak` 用 ISO 字符串字典序 + `new Date(k)` 拼日期，跨时区有 off-by-one

**File:** `src/routes/Stats.tsx:108-127`

**Issue:** `const cur = new Date(k)`，其中 `k` 是 `YYYY-MM-DD`。`new Date("2024-01-15")` 在 UTC 解析（00:00 UTC），而 `isoDay(d)` 用 `d.getFullYear() / getMonth() / getDate()` 是**本地时区**。

后果：
- 用户在 UTC+8 北京时区，09:00 玩了游戏 → 后端写入「2024-01-15」（本地）→ 前端 `isoDay(localDate)` 得到 "2024-01-15"。**这里 OK**（写入时也是本地）。
- 但 `computeStreak` 内 `new Date("2024-01-15")` → JS 解析为 UTC 2024-01-15 00:00 → 即北京时间 2024-01-15 **08:00**。
- 然后 `(cur.getTime() - prev.getTime()) / 86400000` 算两个 UTC 时间戳的差，理论上还是 1 天的整数倍——**这部分没问题**。
- 但 `cur` 的 `getDate()` 用 prev.getDate() 比较时，在 UTC-x 时区（如美国）会把同一字符串解析为前一天。

`Math.abs(diff - 1) < 0.001` 是浮点等于 1 的判定，对当前用 UTC 偏移整数倍的时区都行；DST 切换日（一年两次）会出现 23/25 小时偏差，判定为 not consecutive，**那一天 longest streak 会断**。

**Fix:** 解析时 manual parse：
```ts
const [y, m, d] = k.split("-").map(Number);
const cur = new Date(y, m - 1, d);   // 本地时区
```

---

### WR-09 Stats.tsx 的 sub 标签 `new Date(games[games.length - 1]?.created_at)` 假设按 created_at desc

**File:** `src/routes/Stats.tsx:290`

**Issue:** `games[games.length - 1]?.created_at` 这里假设 games 数组**末尾是最早入库**的一条。但 Stats 用 `searchGames(null, "playtime", null)` 拉数据（行 175）——按 playtime DESC 排，**末尾是 playtime 最少的，不一定是 created_at 最早**。即使 playtime 都为 0，secondary order 也未定义。

后果：「数据自 2025-08-12 起」可能瞎写一个根本不是最早入库的日期。

**Fix:**
```ts
const earliest = games.reduce<string | null>((acc, g) =>
  !acc || g.created_at < acc ? g.created_at : acc, null);
```

---

### WR-10 main.tsx 顶层 `void getDb().catch(...)`，错误只 console.error，UI 无任何反馈

**File:** `src/main.tsx:26-29`

**Issue:** DB 初始化失败是致命错误（迁移失败 / 磁盘只读 / 数据库损坏）。但代码 swallow + console 后**继续渲染应用**——所有后续 IPC 都会失败、ScanProgressBar 不动、Library 显示「尚未扫描」，用户完全不知道发生了什么。

App.tsx 行 41-47 对 `getDataDir` 也是同样模式，但那个是「running outside Tauri」的兜底，可以容忍；DB 初始化不行。

**Fix:** DB 失败时挂一个全屏 Error Boundary 或 fatal toast：
```ts
void getDb().catch((e) => {
  toast.error("数据库初始化失败 — 应用无法工作。请检查 data/ 目录权限或重新安装。", { duration: Infinity });
});
```

---

### WR-11 Detail.tsx `notesHydratedRef` 互锁竞态

**File:** `src/routes/Detail.tsx:480, 505-506, 543-561`

**Issue:** 第一次 mount → refreshGame → `notesHydratedRef.current = true` + `setNotes(g.notes ?? "")` → useEffect (笔记 autosave) 触发，发现 `notesHydratedRef.current === true` → 翻回 false → return，跳过 save。

但是注意 effect 依赖是 `[notes, gameId]`。当 `gameId` 变化（用户点击 prev/next 跳转）时：
1. `refreshGame()` 被触发（依赖了 gameId） → `notesHydratedRef.current = true; setNotes(g.notes)`
2. autosave effect 也被触发（gameId 变 + notes 即将变）
3. **顺序未保证**：refreshGame 是 async，setNotes 调用在 setTimeout 队列里；autosave effect 可能先跑 `setTimeout(..., 800)` 用**旧** notes 值 → 跳过保存 → 直到 setNotes 跑完 → effect 再触发 → 看到 hydrated=true → 翻 false → 跳过保存。**但下一次用户编辑时 hydrated 已经 false 了，正常保存**。

实际不会脏写，但有一个边界 case：用户在跳转过程中**正好把笔记编辑了一下**（焦点还在 textarea），切换游戏会**把旧游戏的未保存笔记写入新游戏**（因为 notes state 还没被 setNotes 覆盖，autosave effect 触发，gameId 已经是新值）。

**Fix:** autosave effect 里 capture gameId 闭包变量，并在 IPC 调用前比较：
```ts
const savingForId = gameId;
setTimeout(() => {
  if (savingForId !== gameIdRef.current) return;
  updateGameNotes(savingForId, notes).then(...);
}, 800);
```
或者更稳的：把 notes/textarea 整体抽出来作为子组件，靠 key={gameId} 强制重挂。

---

### WR-12 Detail.tsx 路径拼接没规范化反斜杠 → Tauri convertFileSrc 在 Windows 偶发解析问题

**File:** `src/routes/Detail.tsx:674`, `Persons.tsx:253, 289`, `Screenshots.tsx:108, 162`, `Stats.tsx:699`

**Issue:** 多处 `${dataDir.replace(/\\/g, "/")}/${game.cover_path}` 把 dataDir 反斜杠换成正斜杠然后拼接 `cover_path`。但 `cover_path` 从后端来时是什么分隔符没保证——`covers\bangumi\xxx.jpg` 还是 `covers/bangumi/xxx.jpg`？如果是反斜杠，结果是 `D:/data/covers\bangumi\xxx.jpg` 这种混合分隔符——浏览器和 `convertFileSrc` 通常能容错，但 Tauri 在某些 webview 版本下会 URL-encode 反斜杠 → 解析失败 → 图片 404 → onError 隐藏。

**Fix:** 抽一个 `joinDataPath(dataDir, rel)` 工具，**两边都规范化**：
```ts
function joinDataPath(base: string, rel: string): string {
  const b = base.replace(/\\/g, "/").replace(/\/$/, "");
  const r = rel.replace(/\\/g, "/").replace(/^\//, "");
  return `${b}/${r}`;
}
```

---

### WR-13 Detail.tsx 的 `onCreateAndAddView()` 仍然用 `window.prompt`

**File:** `src/routes/Detail.tsx:427-439`

**Issue:** Library.tsx 在 quick 20260512f 把 `window.prompt` 改成正经 ViewNameDialog，但 Detail.tsx 还是 `window.prompt("新视图名称")`。`window.prompt` 在 Tauri webview 里有几个问题：
- 表现因平台而异（部分 webview 不支持，直接 throw 或返回 null）
- 无法做输入校验 / 长度限制
- 与 Tauri title bar 冲突，弹出 prompt 时窗口可能失焦

**Fix:** 用 ViewNameDialog（已经存在）：
```ts
const [createViewMode, setCreateViewMode] = useState<ViewNameDialogMode | null>(null);
// onCreateAndAddView: setCreateViewMode({ kind: "create" })
// 把 handleCreateViewSubmit 写一份带 game.id 上下文的版本
```

---

### WR-14 router.tsx 没用 lazy import，所有路由模块一次 bundle 进首屏

**File:** `src/router.tsx:1-9`

**Issue:** 7 个路由模块全部静态 import。首屏 `/` 实际只需要 App + Library，但 Detail（1700 行 + recharts 等？）、Persons、Stats、Screenshots、Scan、Settings 全部进首屏 bundle。Tauri 起步加载 webview + JS bundle 越大启动越慢。

**Fix:** 改成 `React.lazy` + 路由 `lazy` 元数据：
```ts
children: [
  { index: true, Component: lazy(() => import("./routes/Library").then(m => ({ default: m.Library }))) },
  { path: "settings", Component: lazy(() => import("./routes/Settings").then(m => ({ default: m.Settings }))) },
  { path: "games/:id", Component: lazy(() => import("./routes/Detail")) },
  // ...
]
```
配合 `<Suspense fallback={<RouteSkeleton />}>` 在 App 的 Outlet 周围。

---

## INFO

### IN-01 App.tsx 第二个 useEffect 没有 toast 取消时机控制

**File:** `src/App.tsx:56-81`

更新流：5 秒后 `checkForUpdates({silent:true})` → ready → toast 持续 Infinity。如果用户在 toast 显示后**导航离开 Library 多次 / 重启检查 / 偏好关闭**——toast 永远在那里，无法主动关掉（注释提到 `duration: Infinity`）。建议加一个 toastId，autoCheckUpdate 变 false 时主动 dismiss。

---

### IN-02 App.tsx `autoCheckUpdate` 改变会重新跑 effect → 重复 setTimeout

**File:** `src/App.tsx:56-81`

如果 `autoCheckUpdate` 在 5 秒内被偏好面板切换（true → false → true），effect cleanup → 新 effect 启动新 setTimeout → 5 秒重新计时。多次切换可能积累 N 个待执行 setTimeout，但每次 cleanup 清 timeout 是 OK 的。**实际无 bug**，但行为不直观——建议把 5 秒延迟挪到 store 初始化时跑一次，不依赖 effect。

---

### IN-03 Persons.tsx 行 431 `void (null as unknown as GameStaffRow)`

**File:** `src/routes/Persons.tsx:431`

这是手动抑制「declared but never used」的 hack。如果 GameStaffRow 是 type-only import，可以改成 `import type { GameStaffRow }` 然后不会被报警；或者真的不用就别 import。

---

### IN-04 Screenshots.tsx 行 292-294 `void FolderOpen; void ImageOff;` 同类抑制

**File:** `src/routes/Screenshots.tsx:292-294`

`FolderOpen` 实际在 161 行有用到。`ImageOff` 真的没用。直接删 `ImageOff` 的 import。

---

### IN-05 Library.tsx 的 advFilter 应用是双层过滤

**File:** `src/routes/Library.tsx:297-315, 467`

server 端已经按 brands / staff_ids / official_tags 过滤，但 `applyAdvancedFilter` 又跑一遍客户端过滤（行 467）。注释 line 464 说「client-side post-filter」——但你已经把 brands/staff/tags 送 server 了，advFilter 里的「其他字段」（如果还有的话）会被客户端过滤。需要看 `applyAdvancedFilter` 实现确认是否冗余。如果完全冗余，建议删客户端那次过滤；如果有非 server 字段，至少加注释说明哪些字段走哪边。

---

### IN-06 Stats.tsx Card.span 用 `gridColumn: span N / span N` 内联 style，与 Tailwind 的 grid-cols-12 双系统并存

**File:** `src/routes/Stats.tsx:542-565, 261-264`

`Card` 组件用 inline style 设 gridColumn，但 KpiCard 用 `<Card span={3}>`、Heatmap 用 `<Card span={12}>`——这套 span 系统跟 `grid-cols-12` 配合，没问题。但 Scan.tsx KpiCard 完全独立、行 264 写死 `gridColumn: "span 4 / span 4"` 而不接受 span prop，**两个 KpiCard 内部不同**，重复代码 + 不一致。建议把 KpiCard 抽到 `src/components/library/KpiCard.tsx`，统一接受 span。

---

### IN-07 Detail.tsx 多个 useState + setX 模式，建议合并到 reducer 或 zustand local store

**File:** `src/routes/Detail.tsx:441-468`

13 个 useState：game / launchMethod / args / cwd / exePath / dataDir / notes / savingNotes / lastSavedAt / nowTick / allTags / gameTags / screenshotIntervalState / pickerOpen / splitOpen / splitConfirmOpen / refreshingCover。这种规模的本地 state 应该用 `useReducer` 或拆分到子组件 hooks 里——单文件 1700 行的可读性已经爆炸。

---

### IN-08 Library.tsx 的 EmptyPanel 行 909-959 是路由内部组件，可独立到 components/

**File:** `src/routes/Library.tsx:909-959`

EmptyPanel 是个通用 UI，已经被三种状态共用（noScanYet / scanFinishedZeroResults / filterFoundNothing）。其他路由（Screenshots 行 137-143、Stats）也有类似空态结构但都是临时手写。抽出去能省一坨重复代码。

---

## 整体观察

1. **路由层缺少标准化的数据获取入口**：react-router 6.4 的 loader/action 概念这里完全没用上。每个路由都重复实现「mount 拉数据 / 错误 console.error / loading state / hydrate 时机」。建议在 v2 引入 loader（至少 Detail / Persons / Stats 这三个最依赖路由参数的页面）。

2. **`useLibraryStore.games` 被四个路由共用**（Library / Detail prev-next / Persons hydrate / Screenshots / Stats），但**没有一个明确的 owner**。Detail 改了某条数据后没回写 store，下次 Library 用旧数据；Persons / Screenshots 在 games.length === 0 时各自 hydrate。建议引入一个 `useGamesQuery()` hook 做唯一入口，所有路由统一调用。

3. **modal/dialog 状态散落在各路由的 useState 里**（MetadataPicker / SubdirSplitDialog / AlertDialog 各种 candidate state）。在 Library 和 Detail 里都重复了「带 user data 时 splitCandidate / 不带时直接 setSplitGame」的逻辑——明显该抽 hook。

4. **错误处理一律是 `toast.error(\`xxx 失败 — ${String(e)}\`)`**——String(e) 在 Tauri IPC reject 时返回 `[object Object]` 是常见 case（取决于错误是什么类型）。建议引入 `formatTauriError(e)` 工具，分别处理 string / Error / { message: string } / unknown。

5. **没有任何 Error Boundary**：路由内组件抛错直接白屏。Library 760 行、Detail 1700 行——任何一处运行时错误（比如 `game.brand.split(...)` 而 brand 是 null）都会让整个 App 白屏。建议至少在 `<App>` 的 `<Outlet>` 外包一层 `<ErrorBoundary>`，每个路由独立 fallback。

6. **测试覆盖率不可见**：没看到任何 `*.test.tsx`/`*.spec.tsx`。这种规模的路由组件改一次 bug 就回归一片。

---

_Reviewed: 2026-05-24_
_Reviewer: gsd-code-reviewer (standard depth)_
