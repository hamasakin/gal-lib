---
phase: 260524-fullreview
reviewed: 2026-05-24T00:00:00Z
depth: standard
scope: 前端业务逻辑层 (src/lib, src/store, src/hooks)
files_reviewed: 23
files_reviewed_list:
  - src/lib/advancedFilter.ts
  - src/lib/customViews.ts
  - src/lib/db.ts
  - src/lib/display.ts
  - src/lib/games.ts
  - src/lib/launch.ts
  - src/lib/metadata.ts
  - src/lib/persons.ts
  - src/lib/preferences.ts
  - src/lib/saves.ts
  - src/lib/scan.ts
  - src/lib/scanReview.ts
  - src/lib/screenshots.ts
  - src/lib/search.ts
  - src/lib/stats.ts
  - src/lib/tags.ts
  - src/lib/toast.ts
  - src/lib/updater.ts
  - src/lib/utils.ts
  - src/store/app.ts
  - src/store/library.ts
  - src/store/preferences.ts
  - src/hooks/useSmoothWheel.ts
findings:
  critical: 0
  warning: 6
  info: 7
  total: 13
status: issues_found
---

# 前端 lib 层代码审查报告（gal-lib quick/260524-fullreview）

**审查时间：** 2026-05-24
**深度：** standard（逐文件 + 跨文件调用点交叉验证）
**范围：** 23 个 TS 文件，覆盖 invoke 包装层、Zustand store、单一自定义 hook

## 摘要

23 个文件多数是薄薄一层 `invoke()` 包装 + 类型定义，整体类型纪律良好（snake_case ↔ camelCase 边界处理一致；`Game` 等核心类型与 Rust 结构 1:1 映射）。审查未发现 Critical 级安全漏洞或会立即崩溃的 bug。

主要问题集中在三类：
1. **状态层 race condition**：`Library.tsx` 的 `refetchGrid()` 多源并发触发但无 stale-guard，sortBy/filter/search 高频切换下可能"后请求被前请求覆盖"。
2. **错误边界缺口**：`db.ts` 的 `dbPromise` 缓存了失败的 promise；`loadPreferences` 静默吞 parse 错误；`useSmoothWheel` 未 normalize `WheelEvent.deltaMode`。
3. **死代码 / 类型过松**：`toastSessionRecorded` 整函数无调用方；`MetadataSource` 类型对 `Candidate` 过宽；`scan.ts` 的 `clearAllData` 在生产代码里裸露。

---

## Warning

### WR-01: refetchGrid 缺 stale-guard，高频触发可能渲染旧数据

**File:** `src/routes/Library.tsx:288-315`（消费方）+ `src/lib/search.ts:143-149`（接口）
**Issue:**
`refetchGrid` 是 async 函数，每次 `searchQuery / sortBy / filter / advFilter` 变化时通过 `useEffect` 触发，**同时** `games-changed` event 的 throttle 也会触发它（`Library.tsx:368`）。最后到达的 `setGames(rows)` 覆盖之前的结果——但 Promise 并不保证按发起顺序 resolve（不同 SQL 复杂度、tokio 调度都可能导致后发先至）。

具体复现路径：用户在搜索框快速打字 → 字符 A 触发一次 `searchGames("a")`，字符 AB 又触发 `searchGames("ab")`；如果 "ab" 走的是命中较少的索引提前返回，"a" 比 "ab" 后到，grid 最终渲染的是 "a" 的结果但搜索框显示 "ab"。

`setGames` 也没去重检查（`store/library.ts:301`），每次都全量替换数组引用。

**Fix:**
在 `refetchGrid` 里加 token / abort 机制：
```ts
const refetchToken = useRef(0);
const refetchGrid = useCallback(async () => {
  const myToken = ++refetchToken.current;
  // ...build queryArg, filterArg...
  const rows = await searchGames(queryArg, sortBy, filterArg);
  if (myToken !== refetchToken.current) return; // stale, drop
  setGames(rows);
}, [...]);
```

---

### WR-02: db.ts dbPromise 缓存 rejection，永久不可恢复

**File:** `src/lib/db.ts:22-31`
**Issue:**
```ts
let dbPromise: Promise<Database> | null = null;
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => { ... return Database.load(url); })();
  }
  return dbPromise;
}
```
若首次 `Database.load(url)` 抛错（migration 失败、磁盘满、文件锁定），`dbPromise` 被设为一个 **rejected promise** 并永久缓存——之后所有 `getDb()` 调用都立刻拿到这个 rejected promise，应用必须重启才能重试。

当前唯一调用方是 `main.tsx:26` 的 `void getDb().catch(...)`（fire-and-forget），影响有限。但一旦未来有路由 `await getDb()`，这条死路就会暴露。

**Fix:**
失败时清空缓存：
```ts
if (!dbPromise) {
  dbPromise = (async () => {
    const dataDir = await getDataDir();
    const url = `sqlite:${dataDir.replace(/\\/g, "/")}/app.db`;
    return Database.load(url);
  })().catch((e) => {
    dbPromise = null; // allow retry on next call
    throw e;
  });
}
```

---

### WR-03: useSmoothWheel 未 normalize WheelEvent.deltaMode

**File:** `src/hooks/useSmoothWheel.ts:113-132`
**Issue:**
`onWheel` 直接使用 `e.deltaY * step`，但 `WheelEvent.deltaY` 的单位由 `deltaMode` 决定：
- `0` (DOM_DELTA_PIXEL)：像素值（典型 Windows 鼠标滚轮 ~100/tick）
- `1` (DOM_DELTA_LINE)：行数（典型 ~3/tick，部分 Linux/虚拟机/Firefox 设置触发）
- `2` (DOM_DELTA_PAGE)：页数（极少见）

当 deltaMode=1 时 `target += 3 * 1.0 = 3`，相对于像素期望的 `100` 整整少了 30 倍，结果是滚轮"几乎不动"。

虽然 CLAUDE.md 注明 Windows-only，但 Windows 上 Firefox 用户的"按行滚动"系统设置同样会触发 deltaMode=1（WebView2 跟随系统设置）。

**Fix:**
```ts
const LINE_HEIGHT = 40; // 约一行高度
const PAGE_HEIGHT = el.clientHeight;
let dy = e.deltaY;
if (e.deltaMode === 1) dy *= LINE_HEIGHT;
else if (e.deltaMode === 2) dy *= PAGE_HEIGHT;
target += dy * step;
```

同样的处理也要应用到第 117 行的水平判断 `Math.abs(e.deltaY) < Math.abs(e.deltaX)`，否则单位不同会让横纵比较失真。

---

### WR-04: loadPreferences 静默吞错，用户损坏的 localStorage 无任何反馈

**File:** `src/lib/preferences.ts:68-94`
**Issue:**
```ts
} catch {
  return DEFAULT_PREFS;
}
```
任何 `JSON.parse` 异常都被 swallow，用户 prefs 被悄悄重置为默认。后果：
1. 用户手动改 prefs 失误后，下次启动主题/视图模式全部还原，没有任何提示。
2. 真正的回归 bug（比如未来给 prefs 加新枚举值时旧版数据未通过验证）也被吞掉，开发难调。

另：第 73 行 `parsed as Partial<Record<keyof Preferences, unknown>>` 没验证 `parsed` 是否是对象——若 localStorage 写入 `"null"` 字符串，`parsed.theme` 会在 null 上抛 TypeError，被 catch 捕获回 DEFAULT_PREFS。实际可工作，但靠 catch 兜底而非显式 typeof 检查不是好风格。

**Fix:**
最低限度加 `console.warn`：
```ts
} catch (e) {
  console.warn("[prefs] failed to load, falling back to defaults:", e);
  return DEFAULT_PREFS;
}
```
更稳：先 `if (typeof parsed !== "object" || parsed === null) return DEFAULT_PREFS;`。

`savePreferences` 的 catch（第 100-102 行）同样 silent，至少在 quota exceeded 时应该弹 toast 告知用户"偏好未能持久化"，否则用户每次启动都被打回默认还摸不着头脑。

---

### WR-05: clearFetchingMetaIds 比较条件遗漏，可能在已清空时仍生成新 state

**File:** `src/store/library.ts:346-358`
**Issue:**
```ts
clearFetchingMetaIds: () =>
  set((st) =>
    Object.keys(st.fetchingMetaIds).length === 0 &&
    Object.keys(st.metaTouchedIds).length === 0 &&
    !st.metaRefreshActive
      ? st
      : { fetchingMetaIds: {}, metaTouchedIds: {}, metaRefreshActive: false },
  ),
```
逻辑本身正确，但 `Object.keys(...).length === 0` 每次执行都 O(n) 遍历 keys 数组生成临时数组。规模小可以接受，但**真正的问题在前置上**：terminal `scan-progress` 在 `running → completed` 边界**必然伴随** `clearFetchingMetaIds`，此时大概率非空，所以等价检查总走 else 分支，等价检查反而成本更高。

更微妙的：`removeFetchingMetaId`（第 337-345 行）在删除最后一个 id 后**不会**清空 `metaTouchedIds` 或 `metaRefreshActive`，所以即使 `fetchingMetaIds` 自然清零，`metaTouchedIds` 仍残留——下次 scan 启动时 `addFetchingMetaId` 的 `alreadyTouched` 短路会让旧 id 在新 scan 里被认为"已 touched"，可能影响 `GameCard` 的 pending/loading 视觉判断。

**Fix:**
两选一：
1. 在 `removeFetchingMetaId` 删除最后一个 id 时一并清空 `metaTouchedIds`、`metaRefreshActive`（"自然完成"路径）。
2. 在每次新 scan 启动前显式调一次 `clearFetchingMetaIds`（依赖路由层纪律，更脆弱）。

推荐方案 1：让"集合空"成为完整 reset 的语义触发器。

---

### WR-06: addGamesToView 失败不会清理已创建的 customView

**File:** `src/lib/customViews.ts:31-49` + `src/routes/Library.tsx:200-213`
**Issue:**
`handleCreateViewSubmit`：
```ts
const newId = await createCustomView(name);
const inserted = await addGamesToView(newId, ids);
```
若 `createCustomView` 成功但 `addGamesToView` 失败（DB 锁定、并发删除等），用户看到 `toast.error("创建视图失败 ...")`，但 Bangumi 侧栏会留下一个**空的、用户没意识到已经创建的视图**。下次刷新侧栏会看到它（`count: 0`），用户不知道哪来的。

**Fix:**
catch 分支补偿删除：
```ts
try {
  const newId = await createCustomView(name);
  try {
    const inserted = await addGamesToView(newId, ids);
    // ...
  } catch (e) {
    await deleteCustomView(newId); // rollback
    throw e;
  }
} catch (e: unknown) {
  toast.error(`创建视图失败 — ${String(e)}`);
}
```

---

## Info

### IN-01: toastSessionRecorded 全函数死代码

**File:** `src/lib/toast.ts:115-169`
**Issue:**
`grep -r toastSessionRecorded src/` 仅匹配到定义本身，没有任何调用方。函数所有渲染逻辑（h/m 格式化、累计 toFixed、Fragment 嵌套等）都是已死代码。

确认 `toastLaunchSuccess`（Detail.tsx:747）和 `toastScanFinished`（Library.tsx:416）有真实调用方，只有 `toastSessionRecorded` 孤立。

**Fix:** 删除整段，或者补 Detail.tsx 里 session 结束监听把它接回来——根据 quick/260514-upd 之前的设计本应在 `endActiveSession` 后弹这个 toast，看起来是漏接了。

---

### IN-02: toastSessionRecorded 累计时长无 max(0) 保护

**File:** `src/lib/toast.ts:120-124`
**Issue:**
```ts
const totalMin = Math.max(0, Math.floor(durationSec / 60));
// ...
const totalHours = (totalSec / 3600).toFixed(1);
```
`durationSec` 被 clamp 到 ≥0，但 `totalSec` 没保护。若上游传入负值（不应发生但 ts 类型允许），渲染会出现 "-0.0 h" 这种字符串。和 IN-01 一起，反正这函数没人调，但若复活时记得对称处理。

**Fix:** `const totalHours = Math.max(0, totalSec / 3600).toFixed(1);`

---

### IN-03: MetadataSource 类型对 Candidate 过宽

**File:** `src/lib/metadata.ts:21,24`
**Issue:**
```ts
export type MetadataSource = "bangumi" | "vndb" | "manual" | "none";
export interface Candidate {
  source: MetadataSource;
  ...
}
```
`Candidate` 是 `search_metadata` 命令的返回 candidate，实际 Rust 侧只可能产出 `"bangumi"` 或 `"vndb"`——`"manual"` 和 `"none"` 是 `games.metadata_source` 列才会出现的值。把 `MetadataSource` 同时用作两处导致 TS 上无法区分。

**Fix:** 拆类型：
```ts
export type CandidateSource = "bangumi" | "vndb";
export type GameMetadataSource = "bangumi" | "vndb" | "manual" | "none";
export interface Candidate { source: CandidateSource; ... }
```
然后 `games.ts:49` 用 `GameMetadataSource | null`。

---

### IN-04: scan.ts clearAllData 在 lib 层裸露，无 dev-only 守卫

**File:** `src/lib/scan.ts:110-116`
**Issue:**
```ts
/** Debug-only: wipe all games, ... */
export async function clearAllData(): Promise<void> {
  await invoke("clear_all_data");
}
```
注释自标"debug-only"，但实际是 production bundle 中可达的导出。任何 UI 路径不小心连上它都能炸库。

**Fix:**
要么用 `import.meta.env.DEV` 守卫：
```ts
export async function clearAllData(): Promise<void> {
  if (!import.meta.env.DEV) {
    throw new Error("clearAllData is dev-only");
  }
  await invoke("clear_all_data");
}
```
要么 backend 加 dev-build flag（更稳）。当前 Rust 侧 `clear_all_data` 注册在生产 build 也是裸的，相当于一个生产暗门。

---

### IN-05: durationMatches "none" 桶仅匹配严格 0，浮点边界存疑

**File:** `src/lib/advancedFilter.ts:99-100`
**Issue:**
```ts
if (buckets.has("none") && seconds === 0) return true;
if (buckets.has("lt1h") && seconds > 0 && hours < 1) return true;
```
backend 写入 `games.total_playtime_sec` 是 INTEGER（SQLite），所以 0 严格等于 0 没问题。但 schema 改动或将来引入浮点累加（session 部分秒）时这个 `=== 0` 比较会失效。"none" 语义应该是"从未玩过"，更稳的判断是 `last_played_at == null`，而不是依赖 INTEGER 列。

**Fix:** 不紧迫，记录在案。如果真要改用 last_played_at，签名需要从 `seconds: number` 改成 `game: Pick<Game, "total_playtime_sec" | "last_played_at">`。

---

### IN-06: SearchFilter / SearchBar 单值 vs 多值字段并存，可能 confuse caller

**File:** `src/lib/search.ts:59-71`
**Issue:**
`SearchFilter` 同时有 `brand?: string`（legacy 单选，侧栏点品牌触发）和 `brands?: string[]`（Phase 11 多选 facet）。注释解释了二者是 AND 关系，但接口上没有任何机制阻止 caller 同时设置两个相互矛盾的值——比如 `{ brand: "ABC", brands: ["XYZ"] }` 会让 backend 同时 require brand="ABC" 且 brand IN ("XYZ")，永远返回空。

`tag_id` vs Phase 11 的 `official_tags` 也是类似情况。

**Fix:** 不影响正确性（只是 UX trap），但建议加 runtime 校验或者用 union 类型：
```ts
type BrandFilter = { brand: string; brands?: never } | { brand?: never; brands: string[] };
```
当前优先级低，标记。

---

### IN-07: displayGameName 注释与实现的 fallback 顺序略有出入

**File:** `src/lib/display.ts:31-51`
**Issue:**
注释（line 32-38）描述：
> - `name_cn` wins
> - `name` is used when metadata is bound
> - Otherwise → directory basename

实现：
```ts
if (game.name_cn && game.name_cn.length > 0) return game.name_cn;
const bound = ...;
if (bound && game.name && game.name.length > 0) return game.name;
const base = basenameFromPath(game.path);
if (base.length > 0) return base;
return game.name && game.name.length > 0 ? game.name : "(未命名)";
```
最后一个 fallback `game.name && game.name.length > 0 ? game.name : "(未命名)"` 说明：当 `bound=false` 且 `base=""` 时仍会用 `game.name`。这是一条注释里没提到的额外 fallback 路径（用于路径异常但 name 有值的情形）。不算 bug，但注释里值得补一句"path 为空时退化用 name"。

**Fix:** 注释补一行；或者把第 50 行的 fallback 提到 base 检查之前（先 name 后 "(未命名)"），按业务上的"用户可识别程度"重排。

---

## 整体观察

1. **类型纪律良好**：所有 invoke wrapper 都标了显式返回类型 `Promise<T>`，没看到 `any` 滥用，`as` 断言仅在 `loadPreferences` 一处用于 unknown JSON narrow（合理）。

2. **错误传播模式不统一**：
   - `Library.tsx` 用 `try { ... } catch (e: unknown) { console.error(...) }` 但**不上抛**，调用方拿到 void Promise。
   - `Detail.tsx`（通过 `Delete` 流程）用 `toast.error(\`xxx — ${String(e)}\`)`。
   - `lib/preferences.ts` 静默吞错。
   - `lib/updater.ts` 通过 `silent` flag 显式区分吞 vs 抛。

   只有 updater 把"错误是否对用户可见"做成了一等参数，其它 wrapper 都靠调用方自己决定。建议把这一约定抽到一个共享的小工具（`invokeQuiet` / `invokeLoud`），现在的散落 try/catch 又长又容易漏。

3. **Zustand store 模式一致**：源头一致（"backend 是 source of truth，frontend cache 通过 invoke 重读重建"），没看到 optimistic update 偷跑。但 `library.ts` 的 `fetchingMetaIds` / `metaTouchedIds` / `metaRefreshActive` 这一组三态机已经变得复杂，每个 setter 都有"判断空操作 → return st"的样板。Phase 11 之后这个 store 已超过 380 行单文件，建议下一次 reorg 时把"meta-fetch state machine"拆成独立 slice 或者用 immer middleware 简化。

4. **跨文件命名一致**：snake_case 是 invoke 边界外字段（来自 Rust），camelCase 是 invoke 参数名（Tauri 自动转换），TS 类型字段全部 snake_case 保持和 wire 一致——这套约定 23 个文件里**没有任何例外**，是个亮点。

5. **死代码 / 半成品**：除了 IN-01 的 `toastSessionRecorded`，`persons.ts:167-169` 的 `cancelBackfill` 注释里也明说"当前没有 IPC 消费这个 flag……保留作为向前兼容点"——这种"为兼容保留"的 wrapper 应该有显式 `@deprecated` jsdoc 提醒未来 cleanup 时不要误用。

6. **localStorage 单点失败**：`preferences.ts`、`main.tsx` 的 close-to-tray 提示位等多处直接读 localStorage 没有抽象层。一旦未来要切换持久化（比如换 Tauri Store plugin）这些散落点要逐个改。当前规模不痛。

7. **没有任何文件存在 hardcoded secrets / eval / XSS 风险**。`openExternal` 用 `noopener,noreferrer` 修饰 window.open，正确。`bangumi*Url` / `vndb*Url` 全部 encodeURIComponent，正确。`Detail.tsx:1602` 直接传 `game.cover_url` 给 openExternal 没二次校验，但 cover_url 由 backend 写入且全部来自可信元数据源（Bangumi/VNDB API），可接受。

---

_Reviewed: 2026-05-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
