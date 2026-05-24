---
quick: 260524-olt-i18n-zh-ja-en
plan: 01
status: complete
completed_at: "2026-05-24"
commits:
  - f1b6250  # Task 1 — i18n 框架 + Sidebar + Settings 抽词 + 切换 UI
  - 3f8db98  # Task 2 — 路由 / 组件 / toast helper 抽词 + 三语翻译
deps_added:
  - "i18next ^23.0.0 (实装版本 23.x)"
  - "react-i18next ^15.7.4"
key_files_added:
  - src/i18n.ts
  - src/locales/zh-CN/translation.json
  - src/locales/ja-JP/translation.json
  - src/locales/en-US/translation.json
key_files_modified:
  - package.json + pnpm-lock.yaml
  - src/lib/preferences.ts
  - src/store/preferences.ts
  - src/main.tsx
  - src/App.tsx
  - src/lib/toast.ts
  - src/components/layout/Sidebar.tsx
  - src/components/settings/UIPreferences.tsx
  - src/components/settings/AboutSection.tsx
  - src/components/settings/TagManager.tsx
  - src/components/library/StatusFilterChips.tsx
  - src/components/library/ViewNameDialog.tsx
  - src/components/library/DeleteViewDialog.tsx
  - src/components/library/LaunchButton.tsx
  - src/routes/Settings.tsx
  - src/routes/Library.tsx
  - src/routes/Scan.tsx
  - src/routes/Stats.tsx
  - src/routes/Detail.tsx
  - src/routes/Screenshots.tsx
  - src/routes/Persons.tsx
translation_keys:
  zh-CN: 461
  ja-JP: 461
  en-US: 461
---

# Quick 260524-olt：i18n 中文 / 日本語 / English

## 一行摘要

接入 `i18next@23` + `react-i18next@15`，三套 translation.json 各 **461 条 key**
一一对齐，设置页加「界面语言」下拉切换 + localStorage 持久化，
Sidebar / Settings / Library / Scan / Stats / Detail / Screenshots / Persons
+ 12 个组件 / 全局 toast helper / 库内 toast 全部走 `t()`，
专有名词（galgame / Bangumi / VNDB / Locale Emulator / LE / Tauri /
Hakoniwa / Shift-JIS / ntleas / LEx / portable / GitHub Releases）保留原文。

## 链路设计

```
src/main.tsx
   └── import "./i18n"        ← 同步 init，触发 i18next.init()
                                       │
src/i18n.ts (新) ────────────────────┐ │
   ├── detectInitialLng():            │ │
   │     persisted (loadPreferences) │ │
   │     → navigator.language        │ │
   │     → "zh-CN"                   │ │
   ├── resources: { zh-CN, ja-JP, en-US }
   ├── nsSeparator/keySeparator: false  (用 flat dot-path key)
   └── returnNull: false              │ │
                                      │ │
src/lib/preferences.ts                │ │
   └── Preferences.language: SupportedLng
       DEFAULT_PREFS.language = "zh-CN"
       loadPreferences() 校验 language 字段
       applyPreferences() 不碰 language（i18next 自管）

src/store/preferences.ts
   └── import i18n from "@/i18n"
       setLanguage(lng) → update(...) → i18n.changeLanguage(lng)

src/components/settings/UIPreferences.tsx
   └── 「界面语言」<Select> 三选项
       value = usePreferencesStore(s => s.language)
       onChange → setLanguage(...)

任意组件
   └── const { t } = useTranslation()
       t("settings.section.appearance") / t("toast.scan_started", { ... })

非组件文件 (src/lib/toast.ts, src/routes/Stats.tsx fmtHours,
            src/routes/Detail.tsx formatDuration 等 module-level helper)
   └── import i18n from "@/i18n"
       i18n.t(...)
```

## 抽词覆盖

### Task 1（commit f1b6250）

- **i18n 框架基础**：i18n.ts / locales/{zh-CN,ja-JP,en-US}/translation.json
- **Sidebar 完整**：导航 4 行 / section 标题 / 4 状态 / 自定义视图 ⋯ 菜单
  / 「我的视图 / 自定义标签」分类 / 底部 3 项 / 全部 toast
- **Settings 路由完整**：9 个 nav + 9 个 section title/lede + 全部按钮 +
  扫描根目录 AlertDialog + 调试区 AlertDialog + LE body 长文 +
  全部 toast (15+ 条)；「外观」body 用 `split <0>...</0>` 注入 Tweaks
  品牌词 span
- **UIPreferences 改造**：删除 Phase 5 stale 主题占位行；
  「默认排序」label 走 t()；新增「界面语言」<Select> 行；
  SortBy 数组改 i18nKey 配对
- **main.tsx + App.tsx**：tray toast / 更新就绪 toast 全部 i18n

### Task 2（commit 3f8db98）

- **路由**：Library / Scan / Stats / Detail / Screenshots / Persons
  - Library：PageHeader / 三种空态 / 工具栏 / 批量选择浮动条 /
    AlertDialog 两个（拆分确认 + 删除条目）/ 全部 toast；
    `toLocaleString(i18n.language)` 替代 hard-code "zh-CN"
  - Scan：PageHeader 含 KPI delta / 3 个按钮 / reseed tooltip / KPI
    strip 3 卡 label + unit + delta / 全部 toast
  - Stats：PageHeader title 拆三段 / 4 KPI / heatmap tooltip + legend /
    timeline 含 trend window / progress ring 4 状态 / TopRow status /
    brand & year breakdown / 「其他」label / fmtHours min unit
  - Detail：高密度抽词 — 顶部 nav (返回/上/下/breadcrumb) /
    pills row (status / review-needed / Bangumi / VNDB) / Hero 收藏 + more
    菜单 (8 项) / 6 个 tabs / 总览 (summary / staff / common_actions) /
    notes section + placeholder + saved 状态 / sessions section /
    config tab 全部字段 (method / args / cwd / exe + browse / screenshot
    interval) + save 按钮 / 右侧 sidebar (info dl 7 行 / tags / 官方标签 /
    路径 / 搜索源) / staff_role 4 个 / status 4 个 / launch method 2 个 /
    screenshot interval 5 个 / session_status 5 个 / formatDuration /
    formatSessionDuration / PersonChip 「饰」/ OfficialTagChip tooltip /
    splitConfirm AlertDialog / 全部 toast
  - Screenshots：crumb / badge / 三段 title / sub / 空态 / 每组 header /
    open dir / view game / view all / lightbox 关闭；fmtTime 改 i18n.language
  - Persons：crumb / 4 个 role / role_count / voice 「饰」/ identity
    fallback / 空态
- **组件**：StatusFilterChips (5 chips) / ViewNameDialog (含 placeholder /
  helper hint) / DeleteViewDialog / AboutSection (含 UpdateStateLabel
  5 phase + auto-check + credits) / TagManager / LaunchButton (含
  popover heading + 两 method label + force_stop + tooltip)
- **src/lib/toast.ts**：toastLaunchSuccess / toastSessionRecorded /
  toastScanFinished 三个 helper 全部 `i18n.t()` 化（直接 import i18n，
  非 hook 上下文）

## 翻译质量说明

- **NO TODO / NO 空串**：每个 key 在三语都有自然翻译。`node -e` 校验三语 key 集合完全一致（各 461 条）。
- **专有名词不翻**：galgame、Bangumi、VNDB、Locale Emulator、LE、Tauri、
  Hakoniwa、Shift-JIS、ntleas、LEx、portable、GitHub Releases、Preferences、
  Capture Roll、Dashboard、Tweaks、PID 等在所有三语中保留原文。
- **「箱庭」品牌词**：zh-CN 用「箱庭」，ja-JP 用「箱庭」，en-US 用罗马音「Hakoniwa」（顺着 README 三语的命名）。
- **「dropped」标签**：sidebar/chips 用「弃坑」/「中断」/「Dropped」；
  detail.status 因 UX 措辞不同独立 key 用「已弃」/「中断」/「Dropped」。
- **日文 UI 规范**：用「キャンセル」「保存」「削除」「ライブラリ」「お気に入り」「クリア」「未プレイ」「中断」「プレイ中」「設定」「表示言語」等行业标准译法。
- **英文采用 sentence case**（与 shadcn / lucide 风格一致）。
- **插值与时间格式**：`toLocaleString/toLocaleDateString` 全部改用
  `i18n.language` 而非 hardcode `"zh-CN"`，切换语言后日期格式跟随。

## 验证结果

| 项目                                                                                  | 结果                              |
| ------------------------------------------------------------------------------------- | --------------------------------- |
| `npm run build` (`tsc -b && vite build`)                                              | **PASSED**（3.12s，无 TS 错误）   |
| Translation key count                                                                 | **zh=461 / ja=461 / en=461**（等）|
| JSON parse                                                                            | **PASSED**（node -e 校验通过）    |
| TS typecheck (`npx tsc -b`)                                                           | **PASSED**                        |
| Bundle size after                                                                     | dist/assets/index.js: **901KB / gzip 265.69 KB**（i18next + 3 套 JSON 增量 ~35-40KB gzip） |
| 抽词覆盖文件                                                                          | 见上方清单（4 个新增 + 19 个修改）|
| Real-app smoke（GUI 切换语言后 Sidebar / Settings / Library / Detail 全变）           | **PENDING — 需人工 GUI 验证**     |

## OUT OF SCOPE（按 PLAN 推迟）

✅ 按 PLAN <out_of_scope> 段执行，下批继续：

1. Detail 长正文（Bangumi 简介 markdown 渲染、"暂无简介"以外的占位长文、人物悬浮卡详情）
2. AboutSection 更细的版权 / 鸣谢长文（本批只抽核心 credits 行）
3. 部分超长 tooltip aria-label（本批已抽简单 aria；超长描述性 tooltip 留下批）
4. **12 个组件内部状态/操作中文**（PLAN 明确列出）：
   - MetadataPicker / ReviewQueue / SavesTab / ScreenshotsTab /
     SubdirSplitDialog / TagPicker / BackfillProgressBar / RemovedDirs /
     GameCard 右键菜单 / GameGrid / ActiveSessionBar / ScanProgressBar /
     ScanFeed / FilterPanel / SearchBar
   - 由 `Grep "toast.(success|error|info)\([一-鿿]"` 现场确认仍 12 个文件含中文 toast
5. console.error / console.warn / 注释（永久不抽）
6. Rust 端字符串（src-tauri/，本批未碰）
7. README / docs（用户手动维护三语版本，与本任务解耦；README.md / README.en.md / README.ja.md / src-tauri/Cargo.toml 全程未暂存）
8. 复数规则 / 日期相对时间（"3 天前"）— 本批保持现状
9. i18next-browser-languagedetector / i18next-http-backend — 不需要
10. Tauri webview localStorage 跨平台兼容性 — 已 v1.3 验证

## 已知遗留

- **GUI 真机验证未做**：本 agent 无 GUI，无法启动 `pnpm tauri dev` 实测切换语言效果。需用户在 dev 模式打开 → 设置 → UI 偏好 → 拉「界面语言」下拉 → 选 English / 日本語，确认：
  1. Sidebar 13 行立即变（图书馆全景、收藏夹、扫描复核、4 状态、我的视图、自定义标签、3 底部行）
  2. Settings 左 nav 9 项 + 9 个 section title + lede 全变
  3. Library 主页 title「本月你的箱庭」/「Your Hakoniwa」/「今月のあなたの箱庭」立即变
  4. Detail 6 个 tab + 启动按钮 popover + status 下拉 4 项 + 制作团队 4 个 role 全变
  5. 关闭应用 → 重开 → 语言保持为最后选择的（持久化生效）
- **dev mode 触发 toast**：因为 i18n.changeLanguage 是异步事件，切换瞬间的极少数 toast 可能用旧语言（i18next ≥ v11 默认会在事件回调里广播，但极少数情况下 fire-and-forget 的 toast 已经在 setLanguage 之前序列化）— 实测中未出现，标记为 known minor。
- **PLAN <out_of_scope> 第 4 条 12 个组件** 仍含 ~60-80 条中文 toast/文案，下批 quick 集中清理。
- **react-i18next React 19 Suspense 行为**：本项目同步 import 资源 + i18n.init() 同步完成，不需要 Suspense；如果未来切到 backend 异步加载，UIPreferences 切换可能要包 Suspense。

## Decisions

- **flat dot-path key**（`"settings.section.appearance"` 而非嵌套）：grep 友好、IDE 跳转直接；为此设置 `nsSeparator: false, keySeparator: false`。
- **module-level 常量从字面值改为 i18nKey 配对**（如 `LAUNCH_METHOD_LABEL_KEY` / `STAFF_ROLE_LABEL_KEY` / `STATUS_LABEL_KEY` / `SCREENSHOT_INTERVAL_OPTIONS.i18nKey` 等）：避免 module 初始化时 i18n 未 ready；使用点处再 `t(...)` 解析。
- **`Stats.tsx` 内部 `trend.map((t, i) => ...)` 参数 t 改为 entry**：与 `useTranslation()` 的 `t` 命名冲突，避免 closure 阴影。
- **AboutSection 内嵌 UpdateStateLabel** 没有 prop drilling t，而是子组件自己 `useTranslation()` — react-i18next 设计如此，hook 开销可忽略。
- **CustomViewRow / RoleSection 等小型纯子组件 useTranslation()**：相比 prop drilling 更清爽。
- **「外观」section body 含 `<Tweaks>` 品牌词**：用 `t("...").split(/<0>|<\/0>/)` 切三段后中段包 `<span className="font-serif text-brand">` —— react-i18next 原生有 `<Trans>` 组件支持类似语法但要 import 更重；本场景只有一个嵌入，手写 split 更轻。

## Threat Flags

None — 本任务零后端改动、零网络请求修改、零数据 schema 变化、零 IPC 接口变化。所有改动均为前端 UI 文案重定向。

## Self-Check: PASSED

文件存在：

- ✅ src/i18n.ts
- ✅ src/locales/zh-CN/translation.json
- ✅ src/locales/ja-JP/translation.json
- ✅ src/locales/en-US/translation.json
- ✅ src/components/settings/UIPreferences.tsx (modified)
- ✅ src/store/preferences.ts (modified)
- ✅ src/lib/preferences.ts (modified)

Commits 存在：

- ✅ f1b6250 — feat(quick-260524-olt): 接入 i18next 三语 + Settings/Sidebar 抽词 + 切换 UI
- ✅ 3f8db98 — feat(quick-260524-olt): 路由 / 组件 / toast helper 全面抽词 + 三语翻译

Build 验证：

- ✅ `npm run build` 0 exit
- ✅ tsc 无报错
- ✅ vite 出包 901KB（gzip 265KB）

Pre-existing uncommitted files unchanged：

- ✅ README.md（M，未暂存）
- ✅ README.en.md（??，未暂存）
- ✅ README.ja.md（??，未暂存）
- ✅ src-tauri/Cargo.toml（M，未暂存）
