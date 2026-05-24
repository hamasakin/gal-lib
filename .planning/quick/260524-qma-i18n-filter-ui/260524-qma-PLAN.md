---
quick: 260524-qma-i18n-filter-ui
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/library/FilterPanel.tsx
  - src/components/library/SearchBar.tsx
  - src/components/library/FilterChip.tsx
  - src/locales/zh-CN/translation.json
  - src/locales/ja-JP/translation.json
  - src/locales/en-US/translation.json
autonomous: true
requirements: [QUICK-260524-QMA]

must_haves:
  truths:
    - "FilterPanel 触发按钮、popover header / footer、所有 Section 标题、所有 facet 搜索 placeholder、所有 chip tooltip、重置 / 应用按钮、状态 / 时长选项、空态 (加载中… / 无匹配) 全部走 t()，en-US 与 ja-JP 不见任何中文"
    - "SearchBar 5 种类型 (游戏名/品牌/画师/声优/标签) label + placeholder + aria-label + title、候选下拉空态 (加载候选中… / 无匹配候选)、候选行 X 部 后缀、底部 已选 X 项 / ·已应用 / ·未应用、取消 / 确定按钮、清空搜索 / Ctrl+K 提示 全部走 t()"
    - "FilterChip STATUS_LABELS 4 项复用 detail.status.*；chip label 模板 标签 · {{name}} / 状态 · {{label}} / 品牌 · {{name}} / 年代 · {{decade}}s 走 t() 插值；aria-label 清除筛选 — {{label}} 走 t()"
    - "三套 translation.json key 数完全等齐，无空字符串"
    - "复用既有 chips.* 与 detail.status.* key，不重复造同义 key"
    - "npm/pnpm run build 通过"
  artifacts:
    - path: "src/components/library/FilterPanel.tsx"
      provides: "popover 内全部中文走 useTranslation"
    - path: "src/components/library/SearchBar.tsx"
      provides: "5 类型搜索栏全部中文走 useTranslation"
    - path: "src/components/library/FilterChip.tsx"
      provides: "活跃筛选 chip 全部中文走 useTranslation"
  key_links:
    - from: "src/components/library/FilterPanel.tsx"
      to: "src/locales/*/translation.json"
      via: "useTranslation() + t('filter_panel.*')"
      pattern: "useTranslation\\(\\)"
    - from: "src/components/library/SearchBar.tsx"
      to: "src/locales/*/translation.json"
      via: "useTranslation() + t('search_bar.*')"
      pattern: "useTranslation\\(\\)"
---

<objective>
补 quick 260524-olt 的 OUT OF SCOPE：FilterPanel / SearchBar / FilterChip 三个筛选组件的中文文案全部走 i18next，三语对齐翻译，复用既有命名空间 (`chips.*`, `detail.status.*`, `common.*`)。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md

# 上次 quick 已建立的约定
- flat dot-path key（`"a.b.c"`），i18next init 里 `nsSeparator: false, keySeparator: false`
- 非组件文件用 `import i18n from "@/i18n"` + `i18n.t(...)`；组件用 `useTranslation()`
- 专有名词保留原文：galgame / Bangumi / VNDB / Locale Emulator / LE / Tauri / Hakoniwa / Shift-JIS / portable
- 复用已有 key：
  - `chips.playing` `chips.cleared` `chips.unplayed` `chips.favorite` `chips.all`
  - `detail.status.unplayed` `detail.status.playing` `detail.status.cleared` `detail.status.dropped`
  - `common.cancel` `common.confirm` `common.close` `common.loading` `common.retry`
- 翻译风格：
  - zh: 简洁口语
  - ja: UI 习惯（「キャンセル」「保存」「ライブラリ」「ブランド」「シナリオ」「原画」「声優」「タグ」「クリア」「未プレイ」「ドロップ」「プレイ中」「適用」「リセット」「件」「作品」）
  - en: sentence case（"Cancel" "Apply" "Reset" "Brand" "Scenario" "Artist" "Voice" "Tag" "Cleared" "Unplayed" "Dropped" "Playing" "works"）
</context>

<tasks>

<task type="auto">
  <name>Task 1: FilterPanel / SearchBar / FilterChip 抽词 + 三语翻译</name>
  <files>
    src/components/library/FilterPanel.tsx,
    src/components/library/SearchBar.tsx,
    src/components/library/FilterChip.tsx,
    src/locales/zh-CN/translation.json,
    src/locales/ja-JP/translation.json,
    src/locales/en-US/translation.json
  </files>
  <action>

### A. `src/components/library/FilterPanel.tsx`

顶部加 `import { useTranslation } from "react-i18next";`，组件内 `const { t } = useTranslation();`。

**module-level 常量改 i18nKey 配对**（避免初始化时 i18n 未 ready）：
- `STATUS_OPTIONS`：value 不变，label 字段改为 `i18nKey: "chips.playing" / "chips.cleared" / "chips.unplayed" / "chips.dropped"` —— 注意：sidebar/chips 当前没有 dropped key 单独的（chips.* 只有 5 个：all/playing/cleared/unplayed/favorite）。新增 `chips.dropped` key（zh: "弃坑"，ja: "ドロップ"，en: "Dropped"）—— 后续 sidebar 若有同名也可复用。
- `DURATION_OPTIONS`：5 项 label 改 i18nKey：
  - `none → "filter_panel.duration.none"` (zh:"未游玩" ja:"未プレイ" en:"Unplayed")
  - `lt1h → "filter_panel.duration.lt1h"` (zh/ja/en 都用 `"< 1 h"`，纯符号无需翻译)
  - `h1to10 → "filter_panel.duration.h1to10"` (`"1–10 h"`)
  - `h10to50 → "filter_panel.duration.h10to50"` (`"10–50 h"`)
  - `h50plus → "filter_panel.duration.h50plus"` (`"50 h+"`)
- 渲染时 `t(opt.i18nKey)`

**逐句替换**：

触发器：
- `aria-label="高级筛选"` `title="高级筛选"` → `t("filter_panel.trigger_label")` (zh:"高级筛选" ja:"高度なフィルター" en:"Advanced filter")
- `<span>筛选</span>` → `<span>{t("filter_panel.trigger")}</span>` (zh:"筛选" ja:"フィルター" en:"Filter")
- `aria-label="清除全部筛选"` `title="清除全部筛选"` → `t("filter_panel.quick_clear")` (zh:"清除全部筛选" ja:"すべてのフィルターを解除" en:"Clear all filters")

Popover header：
- `<div className="font-serif text-[14px] text-ink-0">筛选</div>` → `{t("filter_panel.title")}` 复用上面 trigger 同义可，或新 key `filter_panel.title` —— 用 **同一个** `filter_panel.title` (zh:"筛选" ja:"フィルター" en:"Filter")，trigger 短按钮也可复用此 key，节省一条。建议：trigger 与 title 都用 `filter_panel.title`。
- `客户端二次过滤 · {games.length} 部` → `t("filter_panel.subtitle", { count: games.length })`
  - zh: `"客户端二次过滤 · {{count}} 部"`
  - ja: `"クライアント側で再フィルタ · {{count}} 件"`
  - en: `"Client-side refine · {{count}} works"`
- `aria-label="关闭"` → `t("common.close")` 已存在

Sections（labels）：
- `"状态"` → `t("filter_panel.section.status")` — 也可与 detail/sidebar 已有 status 标题对照；新建独立 key 更不耦合
  - zh:"状态" ja:"ステータス" en:"Status"
- `"评分范围"` → `t("filter_panel.section.rating")` — zh:"评分范围" ja:"評価範囲" en:"Rating range"
- `"发行年份"` → `t("filter_panel.section.year")` — zh:"发行年份" ja:"発売年" en:"Release year"
- `"累计时长"` → `t("filter_panel.section.duration")` — zh:"累计时长" ja:"累計プレイ時間" en:"Total playtime"
- `"更多筛选"` → `t("filter_panel.section.more")` — zh:"更多筛选" ja:"その他のフィルター" en:"More filters"
- `"品牌"` → `t("filter_panel.section.brand")` — zh:"品牌" ja:"ブランド" en:"Brand"
- `"编剧"` → `t("filter_panel.section.scenario")` — zh:"编剧" ja:"シナリオ" en:"Scenario"
- `"画师"` → `t("filter_panel.section.artist")` — zh:"画师" ja:"原画" en:"Artist"
- `"声优"` → `t("filter_panel.section.voice")` — zh:"声优" ja:"声優" en:"Voice"
- `"官方标签"` → `t("filter_panel.section.official_tags")` — zh:"官方标签" ja:"公式タグ" en:"Official tags"

特殊行：
- `label="只看待复核"` → `t("filter_panel.review_only")` — zh:"只看待复核" ja:"レビュー待ちのみ" en:"Only show pending review"
- `加载中…` → `t("common.loading")` 已有
- `无匹配` (BrandChipList / PersonChipList / TagChipList 各一处) → `t("filter_panel.no_match")` — zh:"无匹配" ja:"該当なし" en:"No match"

FacetSearchInput placeholder（5 处）：
- `"搜索品牌…"` → `t("filter_panel.search.brand")` — zh:"搜索品牌…" ja:"ブランドを検索…" en:"Search brands…"
- `"搜索编剧…"` → `t("filter_panel.search.scenario")` — zh:"搜索编剧…" ja:"シナリオを検索…" en:"Search scenarios…"
- `"搜索画师…"` → `t("filter_panel.search.artist")` — zh:"搜索画师…" ja:"原画を検索…" en:"Search artists…"
- `"搜索声优…"` → `t("filter_panel.search.voice")` — zh:"搜索声优…" ja:"声優を検索…" en:"Search voices…"
- `"搜索标签…"` → `t("filter_panel.search.tag")` — zh:"搜索标签…" ja:"タグを検索…" en:"Search tags…"

Chip tooltip（title 属性）：
- BrandChipList / TagChipList: `title={`${it.name} — ${it.count} 部作品`}` → `title={t("filter_panel.tooltip.works", { name: it.name, count: it.count })}`
  - zh: `"{{name}} — {{count}} 部作品"`
  - ja: `"{{name}} — {{count}} 作品"`
  - en: `"{{name}} — {{count}} works"`
- PersonChipList: 两条 tooltip 拆为：
  - 有 name_cn 时：`title={t("filter_panel.tooltip.person_cn", { cn: it.name_cn, name: it.name, count: it.count })}`
    - zh: `"{{cn}}（{{name}}）— {{count}} 部"`
    - ja: `"{{cn}}（{{name}}）— {{count}} 件"`
    - en: `"{{cn}} ({{name}}) — {{count}} works"`
  - 无 name_cn 时：`title={t("filter_panel.tooltip.person", { name: it.name, count: it.count })}`
    - zh: `"{{name}} — {{count}} 部"`
    - ja: `"{{name}} — {{count}} 件"`
    - en: `"{{name}} — {{count}} works"`

MoreChip：
- `"收起"` → `t("filter_panel.collapse")` — zh:"收起" ja:"折りたたむ" en:"Collapse"
- `` `更多 ${hidden} >` `` → `t("filter_panel.more", { count: hidden })`
  - zh: `"更多 {{count}} >"`
  - ja: `"その他 {{count}} >"`
  - en: `"More {{count}} >"`

Footer：
- `"重置"` → `t("filter_panel.reset")` — zh:"重置" ja:"リセット" en:"Reset"
- `"应用筛选"` → `t("filter_panel.apply")` — zh:"应用筛选" ja:"適用" en:"Apply"

### B. `src/components/library/SearchBar.tsx`

顶部加 `import { useTranslation } from "react-i18next";`，组件内 `const { t } = useTranslation();`。

**module-level 常量改 i18nKey 配对**：
- `KIND_OPTIONS`：5 项，label → i18nKey:
  - `name → "search_bar.kind.name"` (zh:"游戏名" ja:"作品名" en:"Title")
  - `brand → "search_bar.kind.brand"` (zh:"品牌" ja:"ブランド" en:"Brand")
  - `artist → "search_bar.kind.artist"` (zh:"画师" ja:"原画" en:"Artist")
  - `voice → "search_bar.kind.voice"` (zh:"声优" ja:"声優" en:"Voice")
  - `tag → "search_bar.kind.tag"` (zh:"标签" ja:"タグ" en:"Tag")
- `KIND_LABEL_MAP`：删除（渲染时直接 `t(\`search_bar.kind.\${kind}\`)`）—— 或保留为 `Record<SearchKind, string>` 的 i18nKey 字符串（更类型安全），渲染时 `t(KIND_LABEL_MAP[kind])`。任选其一即可。
- `KIND_PLACEHOLDER`：同样转 i18nKey，渲染时 `placeholder={t(KIND_PLACEHOLDER[kind])}`：
  - `name → "search_bar.placeholder.name"` (zh:"搜索游戏 / 标签 / 品牌…" ja:"作品 / タグ / ブランドを検索…" en:"Search title / tags / brand…")
  - `brand → "search_bar.placeholder.brand"` (zh:"输入品牌关键字…" ja:"ブランドのキーワード…" en:"Type brand keyword…")
  - `artist → "search_bar.placeholder.artist"` (zh:"输入画师关键字…" ja:"原画のキーワード…" en:"Type artist keyword…")
  - `voice → "search_bar.placeholder.voice"` (zh:"输入声优关键字…" ja:"声優のキーワード…" en:"Type voice actor keyword…")
  - `tag → "search_bar.placeholder.tag"` (zh:"输入标签关键字…" ja:"タグのキーワード…" en:"Type tag keyword…")

**逐句替换**：

类型下拉 button：
- `title="搜索类型"` → `t("search_bar.kind_select")` — zh:"搜索类型" ja:"検索タイプ" en:"Search type"
- `aria-label={\`搜索类型：\${KIND_LABEL_MAP[kind]}\`}` → `t("search_bar.kind_select_aria", { kind: t(KIND_LABEL_MAP[kind]) })`
  - zh: `"搜索类型：{{kind}}"` ja: `"検索タイプ：{{kind}}"` en: `"Search type: {{kind}}"`

输入框：
- `aria-label={\`按\${KIND_LABEL_MAP[kind]}搜索\`}` → `t("search_bar.input_aria", { kind: t(KIND_LABEL_MAP[kind]) })`
  - zh: `"按{{kind}}搜索"` ja: `"{{kind}}で検索"` en: `"Search by {{kind}}"`

清空按钮：
- `aria-label="清空搜索"` → `t("search_bar.clear_aria")` — zh:"清空搜索" ja:"検索をクリア" en:"Clear search"
- `title="清空"` → `t("search_bar.clear")` — zh:"清空" ja:"クリア" en:"Clear"

⌘K 提示：
- `title="Ctrl+K 聚焦搜索框"` → `t("search_bar.shortcut_hint")` — zh:"Ctrl+K 聚焦搜索框" ja:"Ctrl+K で検索欄にフォーカス" en:"Ctrl+K to focus search"
- `"Ctrl+K"` 显示文本 → 保留原字符串（快捷键标识不翻译）

候选下拉空态：
- `"加载候选中…"` → `t("search_bar.candidates_loading")` — zh:"加载候选中…" ja:"候補を読み込み中…" en:"Loading candidates…"
- `"无匹配候选"` → `t("search_bar.no_candidates")` — zh:"无匹配候选" ja:"該当する候補なし" en:"No matching candidates"

候选行后缀：
- `{c.count} 部` → `{t("search_bar.candidate_count", { count: c.count })}`
  - zh: `"{{count}} 部"` ja: `"{{count}} 件"` en: `"{{count}}"`（英文不带单位，简洁）

底部状态：
- 把整段 `已选 X 项 ·已应用 / ·未应用` 三段拆开：
  - `已选 X 项` → `t("search_bar.selected", { count: draftSize })` — zh:"已选 {{count}} 项" ja:"選択 {{count}} 件" en:"{{count}} selected"
  - `·已应用` → `t("search_bar.applied")` — zh:"·已应用" ja:"·適用済み" en:"·applied"
  - `·未应用` → `t("search_bar.pending")` — zh:"·未应用" ja:"·未適用" en:"·pending"
- `"取消"` → `t("common.cancel")` 已有
- `"确定"` → `t("common.confirm")` 已有

候选 tooltip helper `candidateTooltip`：
- 这个函数是 module-level（非组件），改为接收 `t` 参数：`candidateTooltip(c, t)`。**或者**改为组件内 inline 计算（更简单）：把 `title={candidateTooltip(c)}` 改成 `title={c.kind === "voice" || c.kind === "artist" ? (c.nameCn && c.nameCn !== c.name ? t("filter_panel.tooltip.person_cn", { cn: c.nameCn, name: c.name, count: c.count }) : t("filter_panel.tooltip.person", { name: c.nameCn ?? c.name, count: c.count })) : t("filter_panel.tooltip.works", { name: c.name, count: c.count })}` —— 直接复用 FilterPanel 的 3 个 tooltip key，无需 SearchBar 单独建。
- 删除 `function candidateTooltip(...)` 函数。

### C. `src/components/library/FilterChip.tsx`

顶部加 `import { useTranslation } from "react-i18next";`，组件内 `const { t } = useTranslation();`。

`STATUS_LABELS` 改 i18nKey 配对，复用 `detail.status.*`：
```ts
const STATUS_LABEL_KEY: Record<"unplayed" | "playing" | "cleared" | "dropped", string> = {
  unplayed: "detail.status.unplayed",
  playing: "detail.status.playing",
  cleared: "detail.status.cleared",
  dropped: "detail.status.dropped",
};
```
渲染处改 `t(STATUS_LABEL_KEY[filter.status])`。

`chips` 数组拼装在组件内（已经在），把模板字符串改为 t() 插值：
- `\`标签 · \${tag?.name ?? \`#\${filter.tag_id}\`}\`` → `t("filter_chip.tag", { name: tag?.name ?? `#${filter.tag_id}` })`
  - zh: `"标签 · {{name}}"` ja: `"タグ · {{name}}"` en: `"Tag · {{name}}"`
- `\`状态 · \${STATUS_LABELS[filter.status]}\`` → `t("filter_chip.status", { label: t(STATUS_LABEL_KEY[filter.status]) })`
  - zh: `"状态 · {{label}}"` ja: `"ステータス · {{label}}"` en: `"Status · {{label}}"`
- `\`品牌 · \${filter.brand}\`` → `t("filter_chip.brand", { name: filter.brand })`
  - zh: `"品牌 · {{name}}"` ja: `"ブランド · {{name}}"` en: `"Brand · {{name}}"`
- `\`年代 · \${filter.year_decade}s\`` → `t("filter_chip.decade", { decade: filter.year_decade })`
  - zh: `"年代 · {{decade}}s"` ja: `"年代 · {{decade}}s"` en: `"Era · {{decade}}s"`

aria-label：
- `\`清除筛选 — \${chip.label}\`` → `t("filter_chip.clear_aria", { label: chip.label })`
  - zh: `"清除筛选 — {{label}}"` ja: `"フィルターを解除 — {{label}}"` en: `"Clear filter — {{label}}"`

### D. 三套 translation.json 同步扩展

每个新 key 在三个文件里同时填值，**禁止 TODO / 空字符串**。完成后跑 `node -e` 校验 key 数等齐。

预计新增 ~45-55 条 key（FilterPanel ~25 + SearchBar ~18 + FilterChip ~5）。

  </action>
  <verify>
    <automated>pnpm run build</automated>
    JSON 等齐校验：
    ```bash
    node -e "const z=require('./src/locales/zh-CN/translation.json'),j=require('./src/locales/ja-JP/translation.json'),e=require('./src/locales/en-US/translation.json');const k=Object.keys(z).sort();console.log('zh',k.length,'ja',Object.keys(j).length,'en',Object.keys(e).length);console.log('parity:',JSON.stringify(k)===JSON.stringify(Object.keys(j).sort())&&JSON.stringify(k)===JSON.stringify(Object.keys(e).sort()));const empty=[];for(const x of k){if(!z[x])empty.push('zh:'+x);if(!j[x])empty.push('ja:'+x);if(!e[x])empty.push('en:'+x);}console.log('empty:',empty.length);"
    ```
    Grep 残留中文：
    ```bash
    # 应该返回 0 行（注释和受控保留除外）
    grep -nE "[一-鿿]" src/components/library/FilterPanel.tsx src/components/library/SearchBar.tsx src/components/library/FilterChip.tsx | grep -vE "^\s*[*/]|//|^[^:]+:\s*//"
    ```
    （注释里残留中文 OK，只要 JSX 文本 / 字符串字面值不再有 CJK）
  </verify>
  <done>
    - pnpm run build 通过
    - 三套 translation.json key 数完全等齐，无空值
    - FilterPanel / SearchBar / FilterChip 的 JSX 文本与字符串字面值不再含 CJK（注释与 import path 除外）
    - 复用 chips.dropped (本批新增) / detail.status.* / common.* 而非重复造
  </done>
</task>

</tasks>

<out_of_scope>
- 仍 OUT: MetadataPicker / ReviewQueue / SavesTab / ScreenshotsTab / SubdirSplitDialog / TagPicker / BackfillProgressBar / RemovedDirs / GameCard 右键菜单 / GameGrid / ActiveSessionBar / ScanProgressBar / ScanFeed
- 不动 src-tauri/、README、注释、console.log
</out_of_scope>

<verification>
- pnpm run build 通过
- 三语 JSON key parity 校验通过
- 三个组件文件 grep CJK 在 JSX/字符串字面值范围内为 0
</verification>

<success_criteria>
- 切换语言到 en/ja 后：点开筛选 popover 全部翻译、5 种搜索类型下拉与 placeholder 翻译、活跃筛选 chip label 翻译
- 复用 chips/detail.status/common，不冗余
- npm/pnpm run build 全绿
</success_criteria>

<output>
完成后创建 `.planning/quick/260524-qma-i18n-filter-ui/260524-qma-SUMMARY.md`，记录：
- 新增 / 修改文件清单
- 三语 key 数（前/后）
- 是否新增了 `chips.dropped` key
- 验证结果
- pre-existing 未提交工作（README/Cargo.toml）确认未触碰
</output>
