---
quick: 260524-qma-i18n-filter-ui
plan: 01
status: complete
type: execute
wave: 1
requirements: [QUICK-260524-QMA]
completed_at: 2026-05-24
build: pass
key_counts:
  before: { zh: 461, ja: 461, en: 461 }
  after:  { zh: 522, ja: 522, en: 522 }
  added: 61
  parity: true
  empty: 0
commits:
  - 70c75bb feat(quick-260524-qma): i18n FilterPanel / SearchBar / FilterChip 三语对齐
files_modified:
  - src/components/library/FilterPanel.tsx
  - src/components/library/SearchBar.tsx
  - src/components/library/FilterChip.tsx
  - src/locales/zh-CN/translation.json
  - src/locales/ja-JP/translation.json
  - src/locales/en-US/translation.json
files_untouched:
  - README.md (pre-existing M)
  - README.en.md (pre-existing ??)
  - README.ja.md (pre-existing ??)
  - src-tauri/Cargo.toml (pre-existing M)
---

# Quick 260524-qma: FilterPanel / SearchBar / FilterChip i18n 三语对齐 — Summary

## One-liner

补 olt 的 OUT OF SCOPE：把 FilterPanel / SearchBar / FilterChip 三个筛选组件的中文文案全部抽到 `t()`，三套 translation.json 同步扩展 61 条 key 完全等齐，复用 `chips.*` / `detail.status.*` / `common.*` namespace，新增唯一一个 chips.* 同语义 key `chips.dropped`。

## What changed

### A. `src/components/library/FilterPanel.tsx`
- 顶部 `useTranslation()` 接入。
- module-level `STATUS_OPTIONS` / `DURATION_OPTIONS` 把 `label` 字段改为 `i18nKey`，render 时通过 `t(opt.i18nKey)` 解析 —— 避免 i18n 未 ready 时被冻成中文。
- 触发按钮：`aria-label` / `title` → `t("filter_panel.trigger_label")`，`<span>` 内容 → `t("filter_panel.title")`，快捷清除按钮 → `t("filter_panel.quick_clear")`。
- Popover header：标题、副标题（带 `{{count}}`）、关闭按钮（复用 `common.close`）。
- 全部 Section label（status / rating / year / duration / more / brand / scenario / artist / voice / official_tags）。
- 「只看待复核」、「加载中…」（复用 `common.loading`）。
- 5 个 FacetSearchInput placeholder（`filter_panel.search.*`）。
- 3 类 chip tooltip：`tooltip.works` / `tooltip.person` / `tooltip.person_cn`（带 `{{name}}` / `{{cn}}` / `{{count}}`）。
- BrandChipList / PersonChipList / TagChipList 各 `useTranslation()` 接入，「无匹配」走 `filter_panel.no_match`。
- MoreChip：「收起」/「更多 N >」走 `filter_panel.collapse` / `filter_panel.more`。
- Footer：「重置」/「应用筛选」。

### B. `src/components/library/SearchBar.tsx`
- 顶部 `useTranslation()` 接入。
- module-level `KIND_OPTIONS`、`KIND_LABEL_KEY`、`KIND_PLACEHOLDER_KEY` 全部转 i18nKey 配对，render 时 `t(KIND_LABEL_KEY[kind])` / `t(KIND_PLACEHOLDER_KEY[kind])`。
- 类型前缀 button：title / aria-label / 显示文本。
- 输入框：placeholder / aria-label。
- 清空按钮 / Ctrl+K 提示。
- 候选下拉空态：`search_bar.candidates_loading` / `search_bar.no_candidates`。
- 候选行后缀 `X 部` → `search_bar.candidate_count`（en 不带单位）。
- 底部状态条 `已选 X 项 ·已应用/·未应用` 拆为 `selected` / `applied` / `pending` 三段。
- 取消 / 确定按钮复用 `common.cancel` / `common.confirm`。
- 候选 tooltip：原 module-level `candidateTooltip(c)` helper **删除**，inline 改为按 kind 三分支调用 FilterPanel 已定义的 `filter_panel.tooltip.{works,person,person_cn}`，避免跨组件重复 key。

### C. `src/components/library/FilterChip.tsx`
- 顶部 `useTranslation()` 接入。
- `STATUS_LABELS` 改名为 `STATUS_LABEL_KEY`，值改为 `detail.status.*` 现有 key（复用）。
- chip label 模板（`标签 · {name}` / `状态 · {label}` / `品牌 · {name}` / `年代 · {decade}s`）改 `filter_chip.*` key + `{{}}` 插值。
- aria-label `清除筛选 — {label}` → `filter_chip.clear_aria`。
- 内部 `tags.find` 回调变量从 `t` 重命名为 `tt`，避免与 i18next 的 `t` 同名遮蔽。

### D. `src/locales/*/translation.json`
新增 61 个 key（三套同步、完全等齐、无空值）：

| Namespace            | 数量 | 说明                                          |
| -------------------- | ---- | --------------------------------------------- |
| `chips.dropped`      | 1    | 新增（zh:弃坑 / ja:ドロップ / en:Dropped）    |
| `filter_panel.*`     | 33   | trigger / title / subtitle / quick_clear / review_only / no_match / collapse / more / reset / apply + 10 个 section + 5 个 duration + 5 个 search + 3 个 tooltip |
| `search_bar.*`       | 22   | 5 个 kind + 5 个 placeholder + kind_select / kind_select_aria / input_aria / clear_aria / clear / shortcut_hint + candidates_loading / no_candidates / candidate_count + selected / applied / pending |
| `filter_chip.*`      | 5    | tag / status / brand / decade / clear_aria   |

(实际加成 = 1 + 33 + 22 + 5 = 61，与 461→522 的差额一致)

## Verification

- **JSON parity**:
  ```
  zh 522 ja 522 en 522
  parity: true
  empty: 0
  ```
- **CJK grep（3 个组件）**：所有残留均在注释/JSDoc/JSX 注释里（`/**`、`//`、`{/* */}`），无 JSX 文本和字符串字面值。
- **pnpm run build**: PASS (`vite v7.3.3 ✓ built in 3.41s`)。
- **Pre-existing 未提交工作**：
  ```
   M README.md
   M src-tauri/Cargo.toml
  ?? README.en.md
  ?? README.ja.md
  ```
  这 4 项 commit 前后完全一致，未被触碰。

## Deviations from Plan

无显著偏离。两处轻度调整：
1. PLAN 估「FilterPanel ~25 + SearchBar ~18 + FilterChip ~5 ≈ 45-55」，实际 33 + 22 + 5 + 1(`chips.dropped`) = **61** —— PLAN 列得相当完整，按列表逐条对齐时 filter_panel 实际有 33 个独立 key（包含 10 个 section）。
2. FilterChip 内部把回调参数 `(t) =>` 重命名为 `(tt) =>`（`tags.find` 用），避免与 `useTranslation()` 解构出的 `t` 同名遮蔽 —— 非语义性改动，Rule 3。

## Key reuse confirmation

- 复用 `chips.playing` / `chips.cleared` / `chips.unplayed`（FilterPanel STATUS_OPTIONS）。
- 复用 `detail.status.{unplayed,playing,cleared,dropped}`（FilterChip STATUS_LABEL_KEY）。
- 复用 `common.cancel` / `common.confirm` / `common.close` / `common.loading`（SearchBar 底部、FilterPanel 关闭、加载占位）。
- 复用 `filter_panel.tooltip.{works,person,person_cn}`（SearchBar 候选 tooltip 跨组件共用）。
- 新增唯一一个 chips.* 同语义 key `chips.dropped`（zh:弃坑 / ja:ドロップ / en:Dropped），与 sidebar 「弃坑」文案一致；与 `detail.status.dropped`（zh:已弃）刻意区分。

## Out-of-scope (unchanged)

MetadataPicker / ReviewQueue / SavesTab / ScreenshotsTab / SubdirSplitDialog / TagPicker / BackfillProgressBar / RemovedDirs / GameCard 右键菜单 / GameGrid / ActiveSessionBar / ScanProgressBar / ScanFeed 仍未抽 i18n —— 留待后续 quick。

## Self-Check

- [x] `src/components/library/FilterPanel.tsx` — FOUND，新增 t() 调用 ~40 处
- [x] `src/components/library/SearchBar.tsx` — FOUND，新增 t() 调用 ~16 处
- [x] `src/components/library/FilterChip.tsx` — FOUND，新增 t() 调用 ~6 处
- [x] `src/locales/zh-CN/translation.json` — 522 keys
- [x] `src/locales/ja-JP/translation.json` — 522 keys
- [x] `src/locales/en-US/translation.json` — 522 keys
- [x] `pnpm run build` — PASS
- [x] Commit `70c75bb` — FOUND in git log
- [x] Pre-existing M/?? 文件未变 — VERIFIED

## Self-Check: PASSED
