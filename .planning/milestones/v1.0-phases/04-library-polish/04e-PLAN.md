---
phase: 04-library-polish
plan: 04e
type: execute
wave: 5
depends_on: [04a, 04c]
files_modified:
  - src/components/library/StarRating.tsx
  - src/components/library/TagPicker.tsx
  - src/routes/Detail.tsx
autonomous: true
requirements: [LIB-05, STAT-01, STAT-02, STAT-03, STAT-04, TAG-02]
must_haves:
  truths:
    - "Detail 页 Tabs: 简介 / 标签 / 笔记 / 会话历史 / 设置"
    - "5-星 rating 组件（含半星 hover）+ Status dropdown + Favorite toggle 在 hero 区"
    - "笔记 textarea autosave debounce 800ms + 状态提示『已保存 X 秒前』/『保存中...』"
    - "标签 picker (combobox via popover + command) 搜索现有 + 创建新 tag"
    - "简介 tab 渲染 game.summary via react-markdown + remark-gfm"
    - "pnpm typecheck + vite build 全绿"
---

# Plan 04e — Full Detail Page

## Tasks

<task name="Task 1: StarRating + TagPicker components">

<read_first>
- D:\project\gal-lib\src/lib/games.ts + src/lib/tags.ts (04c)
- D:\project\gal-lib\.planning\phases\04-library-polish\04-CONTEXT.md (§Detail Page)
</read_first>

<action>

1. **`src/components/library/StarRating.tsx`**:
   - props: `value: number | null` (1-10 scale; null = unrated), `onChange?: (rating: number | null) => void`
   - 5 stars rendering 5 lucide `Star` icons; each star = 2 points (full = 2, half = 1)
   - hover preview shows pending value
   - clear button (× icon) sets rating to null
   - readonly mode without onChange

2. **`src/components/library/TagPicker.tsx`**:
   - shadcn `Popover` + `Command` combo; trigger button shows count of selected tags
   - inside popover: Command Input (search), Command List with checkboxes
   - "创建新标签 '<query>'" item appears when no exact match
   - selected tags shown as inline chips above the trigger
   - on confirm: call `setGameTags(gameId, tagIds)`

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/components/library/StarRating.tsx && \
test -f src/components/library/TagPicker.tsx && \
grep -q "Star" src/components/library/StarRating.tsx && \
grep -q "Popover" src/components/library/TagPicker.tsx && \
grep -q "Command" src/components/library/TagPicker.tsx && \
grep -q "setGameTags" src/components/library/TagPicker.tsx && \
pnpm typecheck
</automated>
</verify>

</task>

<task name="Task 2: Detail.tsx full rewrite (replaces P3 minimal)">

<read_first>
- D:\project\gal-lib\src/routes/Detail.tsx (P3 minimal)
- D:\project\gal-lib\src/components/ui/tabs.tsx (P4 04a)
- D:\project\gal-lib\src/components/ui/textarea.tsx (P4 04a)
</read_first>

<action>

Full rewrite of Detail.tsx. Structure:
- Hero (top): cover (200×267) + name (H2) + status Badge + 总时长 + Star rating + Favorite toggle (heart icon) + Status dropdown + 启动 button (preserved from P3)
- Below hero: shadcn `Tabs` with 5 tab triggers:
  - **简介** — react-markdown render of `game.summary` (with `remarkGfm` plugin); fallback "暂无简介" + brand + release_year + cover image url
  - **标签** — current chip list + `<TagPicker game={game}>` for editing
  - **笔记** — `<Textarea>` value=notes; onChange triggers debounced 800ms save via `updateGameNotes`; show "保存中..." / "已保存 N 秒前" under textarea (state-driven)
  - **会话历史** — preserve P3 sessions list (倒序); add empty state
  - **设置** — preserve P3 启动配置 (LE profile / args / cwd / executable_path) — **but executable_path now includes a "选择 exe..." button that opens dialog with the game's directory tree** (deferred to P5 if too complex; P4 just keep readonly Input + manual edit)

Hero buttons:
- Favorite Heart icon — filled when is_favorite, outline otherwise; click → `updateGameFavorite`
- Status dropdown (shadcn Select w/ 4 options) → `updateGameStatus`
- Star rating — 5-star with onChange → `updateGameRating(value * 2)` (storing 1-10 internally)

pnpm typecheck + vite build green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
grep -q "Tabs" src/routes/Detail.tsx && \
grep -q "react-markdown\|ReactMarkdown" src/routes/Detail.tsx && \
grep -q "StarRating" src/routes/Detail.tsx && \
grep -q "TagPicker" src/routes/Detail.tsx && \
grep -q "updateGameNotes\|updateGameFavorite\|updateGameStatus\|updateGameRating" src/routes/Detail.tsx && \
grep -q "保存中\|已保存" src/routes/Detail.tsx && \
pnpm typecheck && \
pnpm vite build
</automated>
</verify>

</task>

## Commits

- `feat(04-04e): add StarRating + TagPicker components`
- `feat(04-04e): full Detail page (Tabs + Notes autosave + Star rating + Tag picker)`
