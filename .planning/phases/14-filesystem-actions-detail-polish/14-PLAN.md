# Phase 14: Filesystem Actions & Detail Polish — Plan

**Phase:** 14
**Goal:** 落地 6 个 carry-over：tauri-plugin-opener 集成 + GameCard/Screenshots「打开目录」+ Detail `?tab=` deeplink + 真实会话数 KPI + LIB-02 决策记录。
**Depends on:** v1.0 (data/screenshots) + v1.1 (Stats KPI cards + LIB-02 spec)
**Requirements covered:** FS-01, FS-02, FS-03, POL-01, POL-02, POL-04

## Plans (6)

执行顺序：14a → 14b → 14c → 14d → 14e → 14f。14a 是底层 (opener)；14b/c 是消费方；14d/e 是 Detail/Stats polish；14f 是 docs only。

---

### 14a — FS-01 tauri-plugin-opener 集成 + open_path IPC

**Files:**
- `src-tauri/Cargo.toml` — 新 dep `tauri-plugin-opener = "2"`
- `src-tauri/src/lib.rs` — `.plugin(tauri_plugin_opener::init())` + 注册 `open_path` handler
- `src-tauri/src/commands.rs` — 新 `open_path` IPC（path 存在性 check + opener.open_path）；`open_in_explorer` impl 改 delegate；`open_external_url` impl 改 opener.open_url（保留 http(s) 白名单）
- `src-tauri/capabilities/default.json` — 增 `opener:allow-open-path` + `opener:allow-open-url`
- `src/lib/games.ts` — 新 `openPath(path)` wrapper（与 `openGameDir` 别名）

**Acceptance:** `cargo build --lib` 绿；`pnpm tsc --noEmit` 绿

---

### 14b — FS-02 GameCard ContextMenu 「打开目录」

**Files:**
- `src/components/library/GameCard.tsx` — 在「重新匹配元数据」上方增 `ContextMenuItem`「打开目录」+ `ContextMenuSeparator`；onClick → `openGameDir(game.path)`；error 用 toast

**Acceptance:** `pnpm tsc --noEmit` 绿

---

### 14c — FS-03 Screenshots 「打开截图目录」

**Files:**
- `src/routes/Screenshots.tsx` — 每组 header 「查看游戏 →」按钮左侧增「打开目录」mono 按钮 + FolderOpen 图标；onClick → `openGameDir(\`${dataDir}/screenshots/${game.id}\`)`；error toast

**Acceptance:** `pnpm tsc --noEmit` 绿；空 dataDir 时按钮 disabled

---

### 14d — POL-01 Detail `?tab=` deeplink (controlled Tabs)

**Files:**
- `src/routes/Detail.tsx` — `useSearchParams` 读 `tab` query；`Tabs value={tab} onValueChange={(v) => setSearchParams({tab:v}, {replace:true})}`；valid 集 `{overview, notes, sessions, screenshots, saves, config}`；非法 fallback overview

**Acceptance:** `pnpm tsc --noEmit` 绿；URL `?tab=saves` 进入直接落到 saves tab；切换 tab URL 实时更新

---

### 14e — POL-02 real session count IPC + Stats 集成

**Files:**
- `src-tauri/src/commands.rs` — 新 `get_session_count() -> i64` IPC（`SELECT COUNT(*) FROM sessions WHERE end_at IS NOT NULL`）
- `src-tauri/src/lib.rs` — 注册
- `src/lib/stats.ts` — 增 `getSessionCount()` wrapper
- `src/routes/Stats.tsx` — useEffect 拉 session count；存在替换 `sessions = games.length` 的 proxy；sub 文案改「N 次会话」

**Acceptance:** `cargo build --lib` 绿；`pnpm tsc --noEmit` 绿；空 sessions 表时返回 0

---

### 14f — POL-04 LIB-02 Key Decision 记录

**Files:**
- `.planning/PROJECT.md` — 增 / 补「Key Decisions」节，写 LIB-02 废止条目（含原因 + 最终采用方案）

**Acceptance:** PROJECT.md 文件存在新节点 + 内容符合 ROADMAP success criterion 5

---

## Out of Scope (this phase)

- Detail tab 写回 URL 用 pushState 形成 history 栈（用 replace）
- npm `@tauri-apps/plugin-opener` 前端引入
- Stats 会话相关 KPI 增量分组（v1.4 如需）
- LIB-02 复活实验

## Risks

- `tauri-plugin-opener` 在 Tauri 2.0 早期文档里仍叫 `tauri-plugin-shell::open` —— 版本固定 2 后 API 稳定，但若 `OpenerExt` trait 在 Cargo crate 中变了名字，14a 需调整
- Capabilities permission 名称 typo 会 silent fail 到运行时 (`runtime error: permission denied`)；先 cargo build 通过，运行时 smoke 推到 Phase 15
- `useSearchParams` 在 strict-mode 下双 render；`replace:true` 已确保 history 不爆，无副作用

## Verification

- Backend: `cargo test --lib` + `cargo build --lib`
- Frontend: `pnpm tsc --noEmit` + `pnpm build`
- 真机 smoke (FS-02 右键 / FS-03 截图目录 / POL-01 deeplink / POL-02 KPI 真实值) 推迟到 Phase 15
