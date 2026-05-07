---
phase: 04-library-polish
plan: 04f
type: execute
wave: 6
depends_on: [04a, 04c]
files_modified:
  - src/routes/Settings.tsx
  - src/components/settings/TagManager.tsx
  - src/components/settings/UIPreferences.tsx
autonomous: true
requirements: [LIB-07, TAG-01]
must_haves:
  truths:
    - "Settings 页新增 2 sections: 标签管理 + UI 偏好"
    - "标签管理：list 现有 tags + 新增/编辑/删除 + 颜色 select (8 预设)"
    - "UI 偏好：默认排序 select (持久化到 config.json) + 深浅色切换占位 (disabled, 提示 Phase 5)"
    - "pnpm typecheck + vite build 全绿"
---

# Plan 04f — Settings page polish (TagManager + UIPreferences)

## Tasks

<task name="Task 1: TagManager + UIPreferences components">

<read_first>
- D:\project\gal-lib\src/lib/tags.ts (04c)
- D:\project\gal-lib\src/routes/Settings.tsx (P2/P3 — extend with 2 new sections)
</read_first>

<action>

1. **`src/components/settings/TagManager.tsx`**:
   - 列出现有 tags (call `listTags()`); 每行 Tag chip + name input + color select (8 预设：slate / blue / emerald / amber / rose / violet / orange / pink) + Save button + Delete button (with confirm AlertDialog)
   - 顶部 "添加标签" button: opens inline-row with empty name + color picker; on confirm: `createTag(name, color)`
   - delete confirm: `确定删除标签『{name}』？已打的游戏会保留，但失去此标签关联`
   - Locked copy: `标签管理` heading + `给游戏添加自定义标签便于筛选` description + `添加标签` button + `保存` / `删除` actions

2. **`src/components/settings/UIPreferences.tsx`**:
   - Section heading `UI 偏好`
   - Row 1: "默认排序" Select (5 options matching SortBy enum; reads/writes config.json `default_sort` field via Tauri commands — add `get_default_sort` / `set_default_sort` if needed; OR just use localStorage for P4 simplicity → P5 promote to backend)
   - Row 2: "主题" — disabled Switch + 文字 "暗色（深浅色切换将在 Phase 5 加入）"
   - Locked copy: `默认排序` / `主题`

3. **`src/routes/Settings.tsx`** — append `<TagManager />` and `<UIPreferences />` after the existing 扫描根目录 + Locale Emulator + 扫描操作 sections

pnpm typecheck + vite build green.

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src/components/settings/TagManager.tsx && \
test -f src/components/settings/UIPreferences.tsx && \
grep -q "标签管理" src/components/settings/TagManager.tsx && \
grep -q "createTag\|updateTag\|deleteTag" src/components/settings/TagManager.tsx && \
grep -q "UI 偏好" src/components/settings/UIPreferences.tsx && \
grep -q "默认排序" src/components/settings/UIPreferences.tsx && \
grep -q "TagManager\|UIPreferences" src/routes/Settings.tsx && \
pnpm typecheck && \
pnpm vite build
</automated>
</verify>

</task>

## Commit

`feat(04-04f): settings polish — TagManager + UIPreferences sections`
