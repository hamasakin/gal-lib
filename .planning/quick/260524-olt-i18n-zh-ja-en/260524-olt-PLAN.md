---
quick: 260524-olt-i18n-zh-ja-en
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - src/i18n.ts
  - src/main.tsx
  - src/lib/preferences.ts
  - src/store/preferences.ts
  - src/locales/zh-CN/translation.json
  - src/locales/ja-JP/translation.json
  - src/locales/en-US/translation.json
  - src/components/settings/UIPreferences.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/library/PageHeader.tsx
  - src/components/library/StatusFilterChips.tsx
  - src/components/library/ViewNameDialog.tsx
  - src/components/library/DeleteViewDialog.tsx
  - src/components/settings/AboutSection.tsx
  - src/components/settings/TagManager.tsx
  - src/routes/Library.tsx
  - src/routes/Settings.tsx
  - src/routes/Scan.tsx
  - src/routes/Stats.tsx
  - src/routes/Detail.tsx
  - src/routes/Screenshots.tsx
  - src/routes/Persons.tsx
  - src/lib/toast.ts
  - src/App.tsx
autonomous: true
requirements: [QUICK-260524-OLT]

must_haves:
  truths:
    - "用户能在设置 → UI 偏好里通过下拉切换 中文 / 日本語 / English 三种界面语言"
    - "切换语言无需重启或刷新，所有已抽词组件立刻重渲染为目标语言"
    - "刷新或重启应用后语言偏好保持不变（持久化生效）"
    - "首次启动检测浏览器语言：zh* → zh-CN，ja* → ja-JP，其它 → en-US，再 fallback 到默认 zh-CN"
    - "切到 en-US / ja-JP 时，Sidebar 全部导航行 / Settings 八个区段标题 / Library 三种空态卡 / Stats 顶部 4 个 KPI 标签 / Scan 按钮和 KPI / Detail 启动按钮和 Tabs 全部正确翻译，不混中文"
    - "galgame / Bangumi / VNDB / Locale Emulator / Tauri / LE 等专有名词保留原文，不被强行翻译"
    - "npm run build (tsc -b && vite build) 通过；包大小增量在合理范围（i18next + react-i18next ~30KB gzipped）"
  artifacts:
    - path: "src/i18n.ts"
      provides: "i18next 初始化 + 三语言资源同步 import + lng 检测顺序 + changeLanguage API"
      exports: ["default i18n", "SupportedLng type", "detectInitialLng"]
    - path: "src/locales/zh-CN/translation.json"
      provides: "中文翻译资源（第一批 + 第二批抽词，~120-180 条 key）"
    - path: "src/locales/ja-JP/translation.json"
      provides: "日文翻译资源，与 zh-CN 一一对应"
    - path: "src/locales/en-US/translation.json"
      provides: "英文翻译资源，与 zh-CN 一一对应"
    - path: "src/lib/preferences.ts"
      provides: "Preferences 新增 language: SupportedLng 字段 + isLanguage 校验 + DEFAULT 'zh-CN'"
    - path: "src/store/preferences.ts"
      provides: "setLanguage action，更新时 i18n.changeLanguage(lang) + savePreferences"
    - path: "src/components/settings/UIPreferences.tsx"
      provides: "「界面语言」Select 行（与「默认排序」同款样式），三选项 中文/日本語/English"
  key_links:
    - from: "src/main.tsx"
      to: "src/i18n.ts"
      via: "顶部 import './i18n' 触发 i18next.init"
      pattern: "import.*['\"]\\./i18n['\"]"
    - from: "src/store/preferences.ts"
      to: "src/i18n.ts"
      via: "setLanguage 调用 i18n.changeLanguage"
      pattern: "i18n\\.changeLanguage"
    - from: "src/components/settings/UIPreferences.tsx"
      to: "src/store/preferences.ts"
      via: "useTranslation() + usePreferencesStore((s) => s.language / setLanguage)"
      pattern: "useTranslation|setLanguage"
    - from: "src/components/layout/Sidebar.tsx"
      to: "src/locales/*/translation.json"
      via: "useTranslation() + t('sidebar.xxx')"
      pattern: "useTranslation\\(\\)"
---

<objective>
为 gal-lib 接入 i18n（中文 zh-CN / 日语 ja-JP / 英文 en-US），抽出"高频可见 UI 表面 + 全局 toast/confirm 文案"到资源文件，在设置页加一行可即时切换的「界面语言」下拉，并把语言偏好持久化进现有 `gal-lib:prefs` localStorage。

Purpose: 把硬编码中文从 ~30 个高密度文案文件中拆出来，让产品具备分发给日本/英文圈玩家的能力。框架（react-i18next）、抽词清单、持久化通道一次性落地；剩余低频文案后续 quick 顺手扩。

Output: i18next 框架 + 3 套翻译资源（~120-180 条 key）+ 设置语言下拉 + 跨刷新生效的 language 偏好。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md

# 关键现有代码（执行器对照实现）
@src/store/preferences.ts
@src/lib/preferences.ts
@src/components/settings/UIPreferences.tsx
@src/App.tsx
@src/main.tsx
@src/components/layout/Sidebar.tsx
@src/components/library/PageHeader.tsx
@src/components/library/StatusFilterChips.tsx
@src/components/library/ViewNameDialog.tsx
@src/components/library/DeleteViewDialog.tsx
@src/components/settings/AboutSection.tsx
@src/routes/Settings.tsx
@src/routes/Scan.tsx
@src/lib/toast.ts

<interfaces>
<!-- 既有 Preferences 契约（需在 Task 1 扩展） -->
From src/lib/preferences.ts (现状):
```typescript
export interface Preferences {
  theme: Theme;
  accent: Accent;
  radius: Radius;
  sidebar: SidebarWidth;
  density: Density;
  viewMode: ViewMode;
  autoCheckUpdate: boolean;
}
export const DEFAULT_PREFS: Preferences = { theme: "midnight", accent: "violet", ... };
const STORAGE_KEY = "gal-lib:prefs";
export function loadPreferences(): Preferences;
export function savePreferences(prefs: Preferences): void;
export function applyPreferences(prefs: Preferences): void;
```
Task 1 需新增：`language: SupportedLng`、`SupportedLng = "zh-CN" | "ja-JP" | "en-US"`、`isLanguage()` 校验器、`detectInitialLng()` 浏览器检测函数；DEFAULT_PREFS.language = "zh-CN"；`applyPreferences` 不动 language（i18next 自管）。

From src/store/preferences.ts (现状):
```typescript
interface PreferencesStore extends Preferences {
  setTheme: (v: Theme) => void;
  ...
  setAutoCheckUpdate: (v: boolean) => void;
  reset: () => void;
}
```
Task 1 需新增 `setLanguage: (v: SupportedLng) => void`，update() helper 内对 language 字段写完 prefs 后调用 `i18n.changeLanguage(language)`（动态 import 避免循环依赖，或在文件顶部 import）。

<!-- 框架选型 — 已敲定 react-i18next + i18next -->
方案：`react-i18next@^15` + `i18next@^23`（无 backend / 无 LanguageDetector，资源直接 import；浏览器探测自己实现 6 行代码）。
- bundle 增量：~30KB gzipped（react-i18next + i18next 核心 + JSON 资源）— 在 < 30MB 包大小预算内可忽略。
- 替代品评估（已放弃）：
  - `@lingui/react`：需 babel/swc macro + CLI 抽词流程，增加构建链路复杂度，且现有 Vite 配置零改动收益更高。
  - 自写 minimal Context：~100 行可行，但要自己处理插值、复数、命名空间，得不偿失。
- 不需要 backend（资源同步 import）、不需要 Suspense（init 即同步可用）、不需要 LanguageDetector 包（自写 detectInitialLng 6 行）。

<!-- i18n.ts 期望形状（Task 1 落地） -->
```typescript
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN/translation.json";
import jaJP from "./locales/ja-JP/translation.json";
import enUS from "./locales/en-US/translation.json";
import { loadPreferences } from "./lib/preferences";

export type SupportedLng = "zh-CN" | "ja-JP" | "en-US";
export const SUPPORTED_LNGS: SupportedLng[] = ["zh-CN", "ja-JP", "en-US"];

export function detectInitialLng(): SupportedLng {
  const persisted = loadPreferences().language;  // load 已有 fallback 到 DEFAULT
  if (persisted) return persisted;
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  if (nav.startsWith("zh")) return "zh-CN";
  if (nav.startsWith("ja")) return "ja-JP";
  if (nav.startsWith("en")) return "en-US";
  return "zh-CN";
}

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "ja-JP": { translation: jaJP },
    "en-US": { translation: enUS },
  },
  lng: detectInitialLng(),
  fallbackLng: "zh-CN",
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: i18n 框架接入 + 偏好持久化 + 语言切换 UI</name>
  <files>
    package.json,
    src/i18n.ts,
    src/main.tsx,
    src/lib/preferences.ts,
    src/store/preferences.ts,
    src/components/settings/UIPreferences.tsx,
    src/locales/zh-CN/translation.json,
    src/locales/ja-JP/translation.json,
    src/locales/en-US/translation.json
  </files>
  <action>
全部按下列顺序落地，单一 task 完成"框架可用 + 设置页可切换 + 持久化生效"闭环。

1. **依赖安装** — `npm install i18next@^23 react-i18next@^15`（保持 dependencies 段）。不装 `i18next-browser-languagedetector` / `i18next-http-backend`（不需要）。

2. **`src/i18n.ts` 新建** — 严格按 `<interfaces>` 块中的样板实现：
   - import 三个 JSON（同步、tree-shake 友好；vite 直接 bundle 进主 chunk，~10-15KB 文本，可接受）
   - `SupportedLng` / `SUPPORTED_LNGS` export
   - `detectInitialLng()` 实现优先级：`loadPreferences().language → navigator.language 前缀 → "zh-CN"`
   - `i18n.use(initReactI18next).init({...})`，`fallbackLng: "zh-CN"`（保证缺 key 不显示英文 raw key），`interpolation.escapeValue: false`（React 已转义）
   - export default i18n

3. **`src/locales/{zh-CN,ja-JP,en-US}/translation.json` 新建** — 见 Task 2 的抽词清单，Task 1 阶段先建立**命名空间骨架 + 设置页与 Sidebar 的 ~30 条 key**（够 Task 1 验证切换链路即可），剩下的 Task 2 / Task 3 继续填。命名空间分组（top-level keys）：
   - `common.*` — 通用按钮：取消/确定/保存/删除/关闭/继续/重试/加载中
   - `sidebar.*` — 侧边栏导航与 section 标题
   - `settings.*` — 设置页全部 section 标题/lede/按钮/对话框
   - `library.*` — Library 路由 PageHeader、空态、工具栏、批量选择
   - `chips.*` — StatusFilterChips 全部/游玩中/已通关/未开始/收藏
   - `stats.*` — Stats KPI 标签 / Card 标题 / 单位
   - `scan.*` — Scan 路由 PageHeader、KPI、按钮、toast
   - `detail.*` — Detail 路由 tabs / 启动按钮 / 状态标签
   - `views.*` — ViewNameDialog / DeleteViewDialog
   - `toast.*` — toast.ts 三类卡片 header + sonner 散落 toast 文案
   - `lang.*` — 三种语言的自显示名（zh-CN→"中文"，ja-JP→"日本語"，en-US→"English"）

   **资源文件命名规则**：key 用扁平 dot-path（如 `"sidebar.library_all"` 而不是嵌套对象），便于 grep / IDE 跳转。值用 `{{var}}` 插值，例：`"sidebar.tag_with_hash": "# {{name}}"`、`"library.sub_with_scan": "最近一次扫描 · {{datetime}} · {{count}} 部作品"`。

4. **`src/lib/preferences.ts` 扩展**：
   - 在文件顶部 export type 段加：`export type SupportedLng = "zh-CN" | "ja-JP" | "en-US"`，`export const SUPPORTED_LNGS: SupportedLng[] = ["zh-CN", "ja-JP", "en-US"]`
   - `Preferences` 接口新增 `language: SupportedLng`
   - `DEFAULT_PREFS.language = "zh-CN"`
   - 新增 `const isLanguage = (v: unknown): v is SupportedLng => typeof v === "string" && (SUPPORTED_LNGS as string[]).includes(v)`
   - `loadPreferences()` 返回对象加 `language: isLanguage(parsed.language) ? parsed.language : DEFAULT_PREFS.language`
   - `applyPreferences()` **不要**碰 language（i18next 自管，不写 DOM data-*）
   - 不要让 i18n.ts 反向 import store；preferences.ts 也不要 import i18n.ts（保持单向依赖：preferences → i18n 由 store/preferences 调用）

5. **`src/store/preferences.ts` 扩展**：
   - 顶部 `import i18n from "@/i18n"`（i18n.ts 已通过 main.tsx 提前初始化；store 文件被首次 import 时 i18n 也已 ready）
   - `PreferencesStore` 接口新增 `setLanguage: (v: SupportedLng) => void`
   - update() helper 的 `next: Preferences` 对象加 `language: get().language`
   - 新增 `setLanguage: (language) => update({ language }, set, get)` 在 store creator 里
   - 在 update() 函数末尾、savePreferences 之后，加一行：`void i18n.changeLanguage(next.language)`（如果 next.language 与 i18n.language 已相同，i18next 会 no-op）
   - import `type SupportedLng` 并加到对外 export 的类型列表

6. **`src/main.tsx` 顶部加 `import "./i18n"`**：紧贴 `import "./index.css"` 下面一行。原因：i18n.init() 同步完成，确保后续任何组件 import 链路里第一次 useTranslation() 都能拿到已就绪的 instance。**不要**用 React `<Suspense>` 包裹 `<RouterProvider>` —— 资源是同步 import 的，不需要异步等待。

7. **`src/components/settings/UIPreferences.tsx` 改造**：
   - 顶部 `import { useTranslation } from "react-i18next"`
   - 顶部 `import { usePreferencesStore } from "@/store/preferences"`
   - 顶部 `import { SUPPORTED_LNGS, type SupportedLng } from "@/lib/preferences"`
   - 组件内取 `const { t } = useTranslation()`，`const language = usePreferencesStore((s) => s.language)`，`const setLanguage = usePreferencesStore((s) => s.setLanguage)`
   - 把硬编码 `"UI 偏好"` → `t("settings.ui_section_title")`
   - 把硬编码 `"默认排序"` → `t("settings.default_sort_label")`
   - 把 SORT_OPTIONS 数组的 label 改为 t key（如 `t("settings.sort.last_played")`），保留 value 不变（写库的 SortBy enum 不动）
   - 把 `"主题"` / `"暗色（深浅色切换将在 Phase 5 加入）"` → 删掉（Phase 5 早已落地，此 placeholder row 整段删除；不在抽词范围内，顺手清掉是 STATE.md 里 v1.1 carry "stale Phase 5 hint" 的清理项）
   - **新增一行「界面语言」Select** 在「默认排序」行之后，复用同款 `flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3` 容器：
     ```tsx
     <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
       <span className="text-body text-foreground">{t("settings.language_label")}</span>
       <Select value={language} onValueChange={(v) => setLanguage(v as SupportedLng)}>
         <SelectTrigger className="w-40" aria-label={t("settings.language_label")}>
           <SelectValue />
         </SelectTrigger>
         <SelectContent>
           {SUPPORTED_LNGS.map((lng) => (
             <SelectItem key={lng} value={lng}>{t(`lang.${lng}`)}</SelectItem>
           ))}
         </SelectContent>
       </Select>
     </div>
     ```
   - 三个 lang.* key 值（执行器现场翻译）：
     - zh-CN: `"lang.zh-CN": "中文"`, `"lang.ja-JP": "日本語"`, `"lang.en-US": "English"`
     - ja-JP: 完全同上（用自显示名，不是翻译名）
     - en-US: 完全同上
   - `"settings.language_label"`：zh-CN 翻译为 `"界面语言"`，ja-JP 翻译为 `"表示言語"`，en-US 翻译为 `"Interface Language"`

8. **触发渲染验证**：UIPreferences.tsx 切换语言后，react-i18next 的 `useTranslation()` hook 内部订阅 i18n.changeLanguage 事件，所有已 mount 的组件**自动 re-render**，无需 React Provider 包裹（react-i18next ≥ v11 默认行为）。Task 1 不需要在 App.tsx / main.tsx 装 I18nextProvider。

9. **打包验证**：`npm run build`（即 `tsc -b && vite build`）必须无 TS / Vite 错误。预期 dist 包大小增量 < 100KB（含三套 JSON 未压缩）。

**抽词范围（Task 1 仅做 Sidebar + Settings 八个 section 标题 + UIPreferences 完整）**：用最少的抽词跑通框架链路，剩下的 Task 2 / Task 3 处理。
- Sidebar：图书馆 / 图书馆全景 / 收藏夹 / 扫描复核 / 通关状态 / 游玩中 / 已通关 / 未开始 / 弃坑 / 我的视图 / 自定义标签 / 新建第一个视图 / 游玩统计 / 截图集 / 设置 / 新建视图（按钮 title）/ 视图操作 — {name}（aria-label）/ 重命名 / 删除视图
- Settings 八区段标题：外观 / 扫描根目录 / 添加单个游戏 / Locale Emulator / 标签管理 / 扫描操作 / UI 偏好 / 调试 / 关于（共 9 个 nav 项），不含 lede（lede 留到 Task 2，先验证骨架）
- UIPreferences：UI 偏好 / 默认排序 / 五个 SortBy label / 界面语言 / 三个 lang.* 自显示名（共 ~12 key）
- Sidebar 改造点：把 Sidebar.tsx 里的 STATUS_DISPLAY 数组、SECTION 标签、所有 SidebarRow label、底部固定区三项都替换为 t() 调用；动态拼装的 `\`# ${tag.name}\`` 改为 `t("sidebar.tag_with_hash", { name: tag.name })`；toast 内的 `\`已创建视图「${name}」\`` 等可在 Task 3 处理（Task 1 阶段先保留中文 toast，不影响切换链路验证）
  </action>
  <verify>
    <automated>npm run build</automated>
    手动 smoke（即时）：
    1. `npm run tauri dev` 启动应用
    2. 打开设置 → UI 偏好 → 拉「界面语言」下拉 → 选择 English
       - 期望：Sidebar 立即变成 "Library / Library Overview / Favorites / Scan Review / Status / Playing / Cleared / Unplayed / Dropped / My Views / Tags / Stats / Screenshots / Settings"
       - 期望：Settings 左 nav 八项立即变成 "Appearance / Scan Roots / Add Single Game / Locale Emulator / Tags / Scan Operations / UI / Debug / About"
    3. 切换到 日本語，验证 Sidebar 显示 "ライブラリ / ライブラリ全体 / お気に入り / スキャン確認 / プレイ状況 / プレイ中 / クリア / 未プレイ / 中断" 等
    4. 关闭应用 → 重新 `npm run tauri dev` → 验证语言保持为最后选择的（持久化生效）
    5. 浏览器 / Webview 第一次启动（清掉 localStorage 'gal-lib:prefs' 模拟）→ 默认应为 zh-CN（除非 navigator.language 是 ja-* / en-*）
  </verify>
  <done>
    - npm run build 通过，TS 无报错，dist 体积增量 < 200KB
    - 设置页有「界面语言」下拉，三选项为「中文 / 日本語 / English」
    - 切换语言后 Sidebar 与 Settings nav 立即变更，无需重启
    - 关闭应用重开，语言偏好保持
    - i18n.ts / locales/{zh-CN,ja-JP,en-US}/translation.json 文件存在
    - preferences.ts 的 Preferences 接口含 language 字段，store 有 setLanguage action
    - main.tsx 顶部有 `import "./i18n"`，无 I18nextProvider
  </done>
</task>

<task type="auto">
  <name>Task 2: 第一批抽词 — 高频可见 UI 表面（路由 PageHeader / 空态 / 工具栏 / KPI / Tabs / Dialog）</name>
  <files>
    src/components/library/PageHeader.tsx,
    src/components/library/StatusFilterChips.tsx,
    src/components/library/ViewNameDialog.tsx,
    src/components/library/DeleteViewDialog.tsx,
    src/components/settings/AboutSection.tsx,
    src/components/settings/TagManager.tsx,
    src/routes/Library.tsx,
    src/routes/Settings.tsx,
    src/routes/Scan.tsx,
    src/routes/Stats.tsx,
    src/routes/Detail.tsx,
    src/routes/Screenshots.tsx,
    src/routes/Persons.tsx,
    src/locales/zh-CN/translation.json,
    src/locales/ja-JP/translation.json,
    src/locales/en-US/translation.json
  </files>
  <action>
全面把"高频可见 UI 表面"硬编码中文抽到 translation.json，新增 ~80-110 条 key。每改一个文件，**先在文件顶部加 `import { useTranslation } from "react-i18next";` 并 `const { t } = useTranslation();`**，再逐句替换。

**目标文件 + 抽词清单（执行器逐文件做，保证不漏）：**

### 1. `src/components/library/StatusFilterChips.tsx`
- CHIPS 数组的 5 个 label：`"全部" / "游玩中" / "已通关" / "未开始" / "收藏"` → `t("chips.all")` / `t("chips.playing")` / `t("chips.cleared")` / `t("chips.unplayed")` / `t("chips.favorite")`

### 2. `src/components/library/PageHeader.tsx`
- 无硬编码中文文案（仅样式），跳过

### 3. `src/routes/Library.tsx`
- `crumb="图书馆"` → `t("library.crumb")`
- `badge` 后缀 `"部作品"` → 改为 `t("library.count_works", { count: games.length })`（zh: "{{count}} 部作品"，ja: "{{count}} 作品"，en: "{{count}} works"）
- `badge` advFilter 形式 `"X / Y 部"` → `t("library.count_filtered", { visible: ..., total: ... })`（zh: "{{visible}} / {{total}} 部"，ja: "{{visible}} / {{total}} 件"，en: "{{visible}} / {{total}}"）
- `title` 里 `"本月你的"` / `"箱庭"` → 拆为 `t("library.title_prefix")` + 固定品牌词 `<span className="text-brand italic">{t("library.title_brand")}</span>`（zh: "本月你的" + "箱庭"，ja: "今月のあなたの" + "箱庭"，en: "Your" + "Hakoniwa" — 箱庭 = "Hakoniwa" 保留拉丁化做品牌）
- `subLine`：`"最近一次扫描 · ${...} · ${games.length} 部作品"` → `t("library.sub_with_scan", { datetime: ..., count: games.length })`；`"共 ${games.length} 部作品"` → `t("library.sub_total", { count })`；`"尚未扫描"` → `t("library.sub_no_scan")`
- 注：`toLocaleString("zh-CN")` 改为 `toLocaleString(language === "zh-CN" ? "zh-CN" : language === "ja-JP" ? "ja-JP" : "en-US")` —— 或更简单：`toLocaleString(i18n.language)`（顶部 `import i18n from "@/i18n"` 拿到当前语言）
- 按钮：`"重新扫描"` → `t("library.rescan")`，`"添加根目录"` → `t("library.add_root")`
- 三个 EmptyPanel：
  - noScanYet：title `"你的箱庭还是空的"` → `t("library.empty_no_scan.title")`，sub → `.sub`，actionLabel `"+ 添加根目录"` → `.action`，hint → `.hint`
  - scanFinishedZeroResults：`"扫描完成 · 未识别到游戏"` / sub / `"回到设置调整"` / hint → `t("library.empty_zero.*")`
  - filterFoundNothing：`"没有匹配的游戏"` / sub / `"清除筛选"` / hint（hint 里有插值 `已扫描 ${searchQuery ? "搜索词" : "筛选条件"}：尝试调整后重试` → `t("library.empty_filter.hint", { which: searchQuery ? t("library.which_search") : t("library.which_filter") })`）
- 批量选择浮动条：`"已选 X 部"` → `t("library.batch.selected", { count })`，`"全选当前网格"` → `.select_all`，`"清空"` → `.clear`，`"批量选择"` → `.batch_select`，`"选择中 X"` → `.in_selection`，`"退出选择"` → `.exit_selection`，`"添加到视图"` → `.add_to_view`，`"尚无视图"` → `.no_views`，`"新建视图…"` → `.new_view`，`"取消"` → `common.cancel`
- AlertDialog："拆分会删除原条目" / 描述 / "继续拆分" / "取消" → `t("library.split_confirm.*")`
- AlertDialog："删除该条目？" / 描述 / "删除" / "取消" → `t("library.delete_confirm.*")`
- toast 文案：`"还没有扫描根目录 — 请先到设置页添加"` → `t("toast.no_scan_roots")`，`"已开始扫描"` → `t("toast.scan_started")`，`"扫描失败 — ${e}"` → `t("toast.scan_failed", { err })`，`"已删除条目"` → `t("toast.deleted")`，`"删除失败"` → `.delete_failed`

### 4. `src/routes/Settings.tsx`
- SECTIONS 数组 9 项 label：在 Task 1 已建立 key，确认这里 `t(SECTIONS[i].label)` ——**注意**：把 SECTIONS 数组改成 id + i18nKey 的形式，render 时 `t(s.i18nKey)`，例：`{ id: "appearance", i18nKey: "settings.section.appearance" }`
- header："设置 / Preferences"（mono 副标）保留原样不抽（"Preferences" 已是英文）；`"偏好与配置"` → `t("settings.page_title")`；`"所有数据存储在 portable \`data/\` 目录 · 共 {totalRoots} 个扫描根"` → `t("settings.page_sub", { count: totalRoots })`
- Section lede（9 条）：每个 `<Section ... lede="...">` 的中文 lede → `t("settings.section.{id}_lede")`
- 扫描根目录区：`"还没有根目录 — 点下方按钮添加"` → `t("settings.scan_roots.empty")`；`"第 X 层"` Select 三项 → `t("settings.scan_roots.depth", { n })`（zh: "第 {{n}} 层"，ja: "第 {{n}} 階層"，en: "Level {{n}}"）；`"+ 添加根目录"` → `t("settings.scan_roots.add")`；AlertDialog 三句 → `t("settings.scan_roots.remove_confirm.*")`；`"移除"` aria-label → `common.remove`
- 添加单个游戏：`"跳过扫描，直接选择某个游戏目录加入库"` (lede 已抽)；`"正在添加..." / "选择游戏目录"` → `t("settings.single_add.adding")` / `.pick`
- Locale Emulator：长说明段 `"在游戏卡片右键..."` → `t("settings.le.body")`（**保留 LE / UAC / ntleas / LEx 等专有名词原文，三语都不翻译**）；`"默认使用内置 LE（无需配置）"` → `.default_hint`；`"覆盖：选择启动器 .exe"` → `.override_pick`
- 扫描操作区：lede 已抽；`"扫描"` / `"刷新元数据"` → `t("settings.scan_ops.scan")` / `.refresh_meta`
- 调试区：`"清除所有数据"` × 2（按钮 + AlertDialog title）→ `t("settings.debug.clear")` / `.clear_confirm_title`，描述 / 取消 / 清除 同上
- toast：`"扫描已启动" / "已设置 LE 路径" / "已添加根目录" / "已添加游戏" / "已移除根目录" / "已清除所有数据" / "请先添加至少一个扫描根目录" / "刷新元数据已启动" / "启动失败 — {e}" / "打开文件选择失败 — {e}" / "打开目录选择失败 — {e}" / "设置失败" / "添加失败" / "移除失败" / "修改深度失败" / "清除失败" / "启动扫描失败" / "正在添加 {basename} ..."` → 统一抽到 `toast.*` 命名空间
- nav header `"设置"` mono uppercase → 保留原样（这里是装饰性"标签"，配 "/ Preferences"），或抽为 `t("settings.nav_header")`

### 5. `src/routes/Scan.tsx`
- `crumb="扫描 / SCAN"` → 保留原样（双语已自带）或 `t("scan.crumb")` 翻 zh: "扫描 / SCAN"，ja: "スキャン / SCAN"，en: "Scan / SCAN"
- title 模板 `"X 项等待复核"` → `<><span className="text-brand italic">{reviewPending}</span> {t("scan.title_suffix")}</>` (zh: "项等待复核"，ja: "件のレビュー待ち"，en: "items pending review")
- sub："共 X 部作品 · 已绑定 Y 部（Z%）· 无匹配 N 部" → `t("scan.sub.with_total", { total, bound, pct: boundPct, unmatched })`
- sub fallback：`"尚未扫描 — 先到设置页添加根目录"` → `t("scan.sub.no_scan")`
- 按钮：`"扫描"` → `t("scan.btn.scan")`，`"重新生成待复核队列"` → `.reseed`，`"回灌中…"` → `.reseeding`，`"取消"` → `common.cancel`，按钮 title `"把所有未匹配 / 低置信度的游戏一次性加入复核队列（包含历史老库 unmatched 项）"` → `t("scan.btn.reseed_tooltip")`
- KPI 标签：`"已扫游戏" / "已绑定" / "待复核"` → `t("scan.kpi.scanned")` / `.bound` / `.review_pending`；单位 `"部" / "项"` → `t("scan.unit.works")` / `.unit_items`；delta 文案：`"入库总数" / "{X}% · 含 manual 绑定" / "暂无绑定" / "其中 X 项无匹配 · 需人工确认" / "需要人工确认" / "队列已清空"` → `t("scan.kpi.delta.*")`
- toast：`"还没有扫描根目录 — 请先到设置页添加"` / `"已开始扫描"` / `"已发送取消请求"` / `"扫描失败"` / `"取消失败"` / `"已把 N 部未匹配/低置信度游戏放入复核队列"` / `"没有需要复核的游戏（库里都已绑定）"` / `"回灌失败"` → 抽到 `toast.scan.*` / `toast.reseed.*`

### 6. `src/routes/Stats.tsx`
- `crumb="游玩统计 / Dashboard"` → 保留或 `t("stats.crumb")`
- title 模板 `"已经在书架前坐了 X 个钟头"` → 拆为三段：`t("stats.title_prefix")` + `{Math.round(totalHours)}` + `t("stats.title_suffix")`（zh: "已经在书架前坐了" + "个钟头"，ja: "本棚の前で" + "時間過ごしました"，en: "Spent" + "hours in front of your shelf"）
- sub："数据自 {date} 起 · 跨 X 部作品 · Y 次会话" → `t("stats.sub", { start_date, works, sessions })`；`toLocaleDateString("zh-CN")` → `toLocaleDateString(i18n.language)`
- KPI 4 个 label：`"总游玩时长" / "本月新增" / "通关率" / "当前连击"` → `t("stats.kpi.total_hours")` / `.month_added` / `.completion_rate` / `.streak`
- KPI delta：`"累计" / "↑ X 部，扫描发现" / "本月无新增" / "X / Y 部" / "最长 Z 天"` → `t("stats.kpi.delta.*")`
- 单位：`"小时" / "部" / "%" / "天"` → `t("stats.unit.*")`
- Card 标题与 hint：`"游玩日历 · 最近 6 个月" / "每方块 = 一天 · 颜色越深，时长越长" / "时长趋势 · 近 30 天/12 周/12 个月" / "日 / 周 / 月" / "通关进度" / "通关定义：到达任意 ED · 可在设置改为「全 routes」" / "累计时长 Top 8" / "— X 项" / "还没有游戏 — 请到设置页扫描游戏库" / "按品牌时长分布" / "暂无品牌数据" / "按发行年份" / "暂无年份数据" / "其他"` → 抽到 `stats.card.*` 与 `stats.breakdown.*`
- `formatHours()` 里的 `"X 分"` → `t("stats.unit.minutes", { n })`；其它 hours 数值保留不动
- Timeline 空态 `"还没有游玩记录 — 启动游戏开始记录"` → `t("stats.timeline.empty")`
- 热力图 legend `"少" / "多"` → `t("stats.heatmap.less")` / `.more`
- RingRow 4 个 label `"已通关" / "游玩中" / "未开始" / "弃坑"` → 复用 `chips.*` 不重复
- TopRow statusLabel object 复用 `chips.*` 即可

### 7. `src/routes/Detail.tsx`（密度最高，~195 中文行；本次抽词聚焦：tabs / 启动按钮 / 状态选项 / 顶部 nav；正文长说明 / 部分 toast 推迟到下批）
- STATUS_OPTIONS / STATUS_LABELS 4 项：`"未游玩" / "游玩中" / "已通关" / "已弃"` → `t("detail.status.unplayed")` / `.playing` / `.cleared` / `.dropped`（注：detail 的"未游玩 / 已弃"与 chips 的"未开始 / 弃坑"措辞不同，按 detail 这里独立 key 命名）
- LAUNCH_METHOD_LABEL：`"日区 LE 启动" / "直接启动"` → `t("detail.launch.le_jp")` / `.direct`
- STAFF_ROLE_LABELS 4 项：`"剧本 / 编剧" / "原画 / 画师" / "声优" / "音乐"` → `t("detail.role.scenario")` / `.artist` / `.voice` / `.music`
- SCREENSHOT_INTERVAL_OPTIONS：`"60 秒" / "5 分钟" / "10 分钟" / "30 分钟" / "关闭"` → `t("detail.screenshot.interval.{60|300|600|1800|0}")`
- statusBadgeText 5 项：`"已完成" / "进行中" / "启动中" / "已取消" / "启动失败"` → `t("detail.session_status.*")`
- formatDuration / formatSessionDuration 中 `"X 时 Y 分" / "X 分" / "X 秒"` → `t("detail.duration.h_m", { h, m })` / `.m` / `.s`
- Tabs（搜索 `<TabsTrigger value="..."` 找全 6 个）：`"总览" / "笔记" / "会话历史" / "截图" / "存档" / "启动配置"` → `t("detail.tab.overview")` / `.notes` / `.sessions` / `.screenshots` / `.saves` / `.launch_config`
- 顶部 crumb：`"← 图书馆"` 之类的回退按钮 → `t("detail.back_to_library")`
- 右侧 sidebar `"条目信息" / "标签" / "路径"` 标题 → `t("detail.sidebar.info")` / `.tags` / `.path`
- 启动按钮文案、外部链接按钮、Bangumi / VNDB 等的标签
- toast 文案：`"启动失败" / "结束失败" / "已结束游戏会话" / "已收藏" / "已取消收藏" / "状态更新失败" / "打开目录失败" / "加载制作团队失败"` 等
- **正文长内容**（标签介绍文字、`"暂无简介"` 类、Bangumi 评分行长文）若工作量过大可推后；但凡 user 切英文/日文能看到的 chrome 都必须抽完

### 8. `src/routes/Screenshots.tsx`
- 全部中文（仅 13 行密度）：crumb、PageHeader title / sub、空态文案、`"打开截图目录"` 按钮 → `t("screenshots.*")`
- 类似手法 useTranslation + 替换

### 9. `src/routes/Persons.tsx`
- 全部中文（20 行密度）抽到 `t("persons.*")` 命名空间

### 10. `src/components/settings/AboutSection.tsx`
- `"当前版本" / "检查更新" / "立即重启" / "检查中…" / "立即检查更新" / "启动时自动检查" / "启动后 5 秒静默检查 GitHub Releases，发现新版本后台下载" / "已开启" / "已关闭" / "启动时自动检查更新" (aria-label) / "已是最新版本" / "下载中 v{v}" / "v{v} 已就绪 — 重启后生效" / "检查失败：{msg}" / "元数据来源：Bangumi · VNDB · 转区启动：Locale Emulator"`
- 全抽到 `t("about.*")`；专有名词 Bangumi / VNDB / Locale Emulator / GitHub Releases 保留原文不翻译。

### 11. `src/components/settings/TagManager.tsx`
- 标签管理对话框文案 → `t("tag_manager.*")`

### 12. `src/components/library/ViewNameDialog.tsx`
- 标题 `"重命名视图" / "新建视图"` → `t("views.dialog.rename_title")` / `.create_title`
- 副标 `"Rename collection" / "Custom collection"` → 保留原样（已是英文）或仍抽
- 描述两条 → `t("views.dialog.rename_desc")` / `.create_desc`
- label `"视图名称"` → `t("views.dialog.name_label")`
- placeholder 两条 → `t("views.dialog.rename_placeholder")` / `.create_placeholder`
- 提示文案 `"已超出 X 字" / "回车提交 · Esc 取消"` → `t("views.dialog.too_long", { n })` / `.hint`
- 按钮 `"取消" / "保存" / "创建视图"` → `common.cancel` / `t("views.dialog.save")` / `.create`

### 13. `src/components/library/DeleteViewDialog.tsx`
- `"删除视图？" / "Delete collection" (保留) / "将删除以下视图：" / "X 部作品" / "视图本身被删除，但视图里的游戏不会被删除，仍保留在图书馆里。此操作无法撤销。" / "取消" / "删除中…" / "删除视图"` → `t("views.delete.*")`

### 14. `src/locales/{zh-CN,ja-JP,en-US}/translation.json` 同步扩展
- 每抽出一个 key，三套资源都立即填上对应翻译。**禁止 TODO 占位**——本任务的硬要求。
- 翻译风格：
  - 简洁自然，符合产品 UI 语境（不要直译堆字数）
  - 专有名词保留原文：galgame / Bangumi / VNDB / Locale Emulator / Tauri / LE / Hakoniwa / Shift-JIS / ntleas / LEx / portable
  - 日文优先使用自然 UI 习惯：「キャンセル」「保存」「削除」「設定」「ライブラリ」「お気に入り」「スキャン」「クリア」（通关）「未プレイ」「中断」（弃坑，或「ドロップ」）「プレイ中」
  - 英文采用 sentence case 而非 Title Case（与 lucide / shadcn 风格一致）：`"Cancel" / "Save" / "Delete" / "Library" / "Favorites" / "Scan" / "Cleared" / "Unplayed" / "Dropped" / "Playing"`
  - 数量 / 比例插值使用 `{{count}}` `{{n}}` `{{pct}}` 等，不依赖 i18next 复数规则（保持 JSON 简洁；中日不需复数变形，英文 "1 work / 2 works" 用同一模板 `"{{count}} works"` 即可，1 的情况罕见且不影响理解）

### 15. 其它注意事项
- **不抽** aria-label / title 属性（推到下批）—— **例外**：UIPreferences、Settings 移除目录 / 取消等明显展示给用户的可视 aria 字符串，本批先一起抽。
- **不抽** 长 console.error / console.warn 日志（开发者面向）
- **不抽** README / docs / src-tauri Rust 端任何字符串
- 任何动态拼装的 `${X} 部` `${X} 项` 都改为 t() with insertion
- 任何 `toast.success("X")` `toast.error("X")` `toast.info("X")` 见到中文统一抽（覆盖 Sidebar / Library / Settings / Scan / Detail / GameCard / GameGrid / ActiveSessionBar / ScanProgressBar / ReviewQueue / SavesTab / ScreenshotsTab / RemovedDirs / BackfillProgressBar / MetadataPicker 范围内的所有 toast 文案，约 60-80 条）
- `src/lib/toast.ts` 三个 toast helper（toastLaunchSuccess / toastSessionRecorded / toastScanFinished）：函数顶部用 `import i18n from "@/i18n"`（不能用 hook 因为是非组件），`i18n.t("...")` 拿翻译；专有 header 文案 `"启动成功" / "本次会话已记" / "扫描完成"` / `"立即复核 →"` / `"累计 X h"` / `"LE 转区 · profile"` / `"PID X"` / `"计时已开始"` / `"新增 X 部 · 自动入库 Y · 待复核 Z"` / `"新增 X 部 · 全部自动入库"` / `"扫描完成 · X 项待复核"` → 全部抽到 `toast.shell.*`
  </action>
  <verify>
    <automated>npm run build</automated>
    手动 smoke（在 ja-JP 与 en-US 下完整跑一圈）：
    1. 进入 Library 主页 → PageHeader / 三种空态卡（通过临时清空过滤模拟）/ 工具栏「批量选择」/「重新扫描」/「添加根目录」按钮 全部为目标语言
    2. 进入 Settings → 9 个 nav 项 + 9 个区段标题 + 全部按钮 + 调试区 AlertDialog 全部翻译
    3. 进入 Scan → 顶部 PageHeader + 3 个 KPI 标签 + 3 个按钮 + 空态 sub 全部翻译
    4. 进入 Stats → 顶部 title + 4 KPI 标签 + 卡片标题与图例「少 / 多」全部翻译
    5. 进入 Detail (随便点一张卡)→ 6 个 tab 名 + 启动按钮 + 状态下拉 4 项 + 制作团队 4 个角色名 全部翻译
    6. 打开 ViewNameDialog / DeleteViewDialog 验证翻译
    7. 触发一次 toast（如「重新扫描」按钮）确认 toast 文案翻译
    8. 切回 zh-CN，全部恢复中文，无英文/日文残留
  </verify>
  <done>
    - npm run build 通过
    - 三套 translation.json 文件含 ~120-180 条 key，三语完全对齐（无任何 key 缺失或为空字符串）
    - 高频 chrome 表面（PageHeader / Sidebar 已 Task1 / Tab / Dialog / KPI / 空态 / 按钮 / 全局 toast）在 en-US / ja-JP 下全部正确翻译
    - 专有名词（galgame / Bangumi / VNDB / Locale Emulator / Tauri / LE / Shift-JIS / ntleas / LEx）保留原文
    - src/lib/toast.ts 三个 helper 已 i18n 化，使用 i18n.t() 而非硬编码
    - 项目内未抽完的硬编码中文限于：长说明段落（如 LE / 关于页底部 / Detail 部分长文 / Settings 各区段 lede 的部分较长项 / 罕见 toast error 详情 / aria-label / console.error / 注释 / Hakoniwa 品牌词 / 双语 crumb 如 "扫描 / SCAN"） 这些在 OUT OF SCOPE 列表里
  </done>
</task>

</tasks>

<out_of_scope>
**明确推迟到后续 quick（不在本 PLAN 范围内）：**

1. **Detail 长正文** — Bangumi 简介渲染、"暂无简介"以外的占位说明、声优页 hover detail；评论 / 评分 / 长 metadata description 段
2. **AboutSection 底部致谢长文** — `"元数据来源：Bangumi · VNDB · 转区启动：Locale Emulator"` 本批已抽，但更细的版权 / 鸣谢 / 项目说明若后续添加，归下批
3. **aria-label / title 属性** 中带描述性长文的（按钮简单 aria-label 已抽；如 `"把所有未匹配..."` 长 tooltip 本批未抽完的部分）
4. **MetadataPicker / ReviewQueue / SavesTab / ScreenshotsTab / BackfillProgressBar / SubdirSplitDialog / FilterPanel / SearchBar / TagPicker / GameCard 右键菜单 / TweaksPanel** 内部状态/操作的中文 — 这些是组件内部低频弹层，下批专门一个 quick 集中抽
5. **console.error / console.warn / 注释** — 永久不抽（开发者面向）
6. **Rust 端字符串** — src-tauri/ 任何位置都不动
7. **README / docs** — 用户已手动准备三语版本，与本任务解耦
8. **复数规则 / 日期相对时间格式化** （如"3 天前"）—— 本批保持现状，i18next plural rules 不开启，下批如有需求再加
9. **i18next-browser-languagedetector** / **i18next-http-backend** — 不需要（自写 6 行 detect 足够；三语资源直接 import 无需懒加载）
10. **Tauri webview localStorage 跨平台兼容性测试** — 当前 v1.3 已 ship 验证 localStorage 工作正常，不再额外验证
</out_of_scope>

<verification>
- `npm run build` 通过（tsc 无报错 + vite 出包成功）
- bundle 增量在合理区间（i18next + react-i18next + 三套 JSON ≤ 200KB 未压缩，~35-50KB gzipped）
- 切换语言不需重启，所有已抽组件 reactive 更新
- 关闭并重启应用，语言偏好持久化生效
- 首次启动 (清掉 localStorage) 时 navigator.language 检测正确（手动通过浏览器开发者工具改 navigator.language 模拟）
- 三套 translation.json 一一对应，无缺 key、无空字符串值
</verification>

<success_criteria>
- 设置页有「界面语言」下拉，三选项立即生效
- Sidebar / Settings / Library 主页 / Scan / Stats / Detail Tabs / 空态 / 全局 toast / View Dialog 在 en-US / ja-JP 下全部翻译为目标语言
- 中文专有名词（Bangumi / VNDB / LE / Tauri / galgame / Hakoniwa）保留原文
- 关闭重开语言保持
- npm run build 全绿
</success_criteria>

<output>
完成后创建 `.planning/quick/260524-olt-i18n-zh-ja-en/260524-olt-SUMMARY.md`，记录：
- 实际新增依赖版本（i18next / react-i18next）
- 三套资源文件最终 key 数量
- 抽词覆盖到的文件清单
- bundle size before / after（vite build 输出）
- OUT OF SCOPE 列表（确认哪些条目仍未抽）
- 已知遗留（如某个按钮 title 太长本批未抽 / 某个动态字符串未拆分等）
</output>
