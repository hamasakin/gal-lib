---
slug: detail-title-overflow-hide-launch
status: resolved
trigger: 详情页标题过长时启动按钮区域被挤出/隐藏（布局异常）
created: 2026-05-26
updated: 2026-05-26
---

# Debug Session: 详情页标题过长挤出启动按钮

## Symptoms

- **Expected**: 详情页 hero 区无论标题多长，右侧"启动方式"卡片与"日区 LE 启动"按钮都应完整可见且可点击。
- **Actual**: 标题超长时（截图：长串罗马字 VN 名），右侧"启动方式"卡片被挤到封面缩略图右下方约 1/3 处，并被父容器底边裁切（按钮文字被遮挡），导致主启动按钮不可见、不可点击。
- **Error**: 无前端报错。纯布局问题。
- **Timeline**: 用户首次报告，目测在标题字符数 ≥ 约 80（含空格断行 7+ 行）时复现。
- **Repro**: 打开任一长标题作品的详情页（截图为 VNDB v32988，"Rin to Shita Tsuma wa, Hitoshirezu Midarazuma e to Ochite ~..."）。
- **Screenshot evidence**: 用户提供截图显示 hero 区高度被标题撑开，右侧"启动方式"卡片顶部位置随标题下移，封面缩略图叠在 hero 左下，卡片被挤进剩余狭窄空间并溢出。

## Current Focus

- **hypothesis** (CONFIRMED): hero 区固定 `h-[380px] overflow-hidden` 且内部 grid `items-end`，长标题撑高中间 `1fr` 信息列后，第三列「actions」（含 LaunchButton）虽然也被底对齐，但 hero 整体 `overflow-hidden` 把溢出的部分（含启动按钮下半段）直接裁切掉了。同时 H1（`text-[38px] leading-[1.1]`）没有 `line-clamp` 限制，标题可以无限多行往下堆。
- **next_action**: (done) 已定位并修复
- **test**: 待用户在真机用 VNDB v32988（或其他 80+ 字符标题）作品的详情页打开复验。
- **expecting**: (verified in code) H1 当前为 `text-[38px]` 无 line-clamp；hero `h-[380px] overflow-hidden`；actions 列无显式 self-end。✅

## Evidence

- timestamp: 2026-05-26 — user screenshot showing layout glitch
- timestamp: 2026-05-26 — code inspection confirms `src/routes/Detail.tsx:989` 用 `h-[380px] overflow-hidden`；`:1020` inner grid `items-end h-full`；`:1076` H1 `text-[38px]` 无 line-clamp；`:1138` actions 列无 `self-end`。LaunchButton 自身无问题（44px 圆形 + popover，正常 inline 子节点）。

## Eliminated

- ❌ LaunchButton 自身 absolute/fixed 错位 —— LaunchButton.tsx 检查后是纯 inline-flex + 相对定位 popover，无怪异定位。
- ❌ Body 区 grid `1fr + 320px` 影响 —— 问题在 hero 内部，body 区独立。

## Resolution

**Root cause (code-level)**:

`src/routes/Detail.tsx` hero 区组合 bug：

1. `<section className="relative h-[380px] overflow-hidden ...">` (line 989) — 硬高度 + 裁切。
2. inner grid `<div className="relative grid h-full items-end gap-7 px-8 pb-6 pt-9" style={{gridTemplateColumns: "220px 1fr auto"}}>` (line 1020) — `h-full` 强行贴 380px，配合 `items-end` 底对齐。
3. `<h1 className="font-serif text-[38px] font-medium leading-[1.1] ...">{displayName}</h1>` (line 1076) — 无 `line-clamp` / `max-height`，长标题可堆 7+ 行 ≈ 290+px。
4. actions 列 `<div className="relative z-[3] flex items-center gap-2.5 pb-3">` (line 1138) — 无 `self-end`，依赖 grid items-end，被长标题撑高的兄弟列 + section overflow:hidden 共同导致按钮被裁。

**Fix (commit pending — 待用户真机验证)**：

`src/routes/Detail.tsx` 4 处精确改动：

1. **L989**: `h-[380px] overflow-hidden` → `min-h-[380px]`；把 `overflow-hidden` 下移到模糊背景 `<div className="absolute inset-0">` 上（line 993），仅裁切 `transform: scale(1.15)` 的模糊层，section 本体允许内容撑高。
2. **L1020**: inner grid 去掉 `h-full`（section 已是 min-h，不再有可贴的固定高度），保留 `items-end` 让 cover/info/actions 仍在底对齐。
3. **L1076**: H1 加 `line-clamp-3 break-words` + `title={displayName}` —— 长标题最多 3 行（~126px）显示，鼠标 hover 看完整名（顶部 breadcrumb + altName 已有完整名，信息无丢失）。
4. **L1138**: actions 列加 `self-end` —— 显式锚到 grid 行底端，杜绝兄弟列高度变化时被推走。

**Diff summary**:
```diff
-      <section className="relative h-[380px] overflow-hidden border-b border-line">
-        {/* Blurred bg */}
-        <div className="absolute inset-0">
+      <section className="relative min-h-[380px] border-b border-line">
+        {/* Blurred bg — own overflow-hidden so the transform:scale(1.15)
+            bleed is clipped to the hero box, while the section itself can
+            grow when a long title pushes the info column past 380px. */}
+        <div className="absolute inset-0 overflow-hidden">

-          className="relative grid h-full items-end gap-7 px-8 pb-6 pt-9"
+          className="relative grid items-end gap-7 px-8 pb-6 pt-9"

             <h1
-              className="font-serif text-[38px] font-medium leading-[1.1] tracking-[0.01em] text-ink-0"
+              className="font-serif text-[38px] font-medium leading-[1.1] tracking-[0.01em] text-ink-0 line-clamp-3 break-words"
               style={{ textWrap: "balance" }}
+              title={displayName}
             >

-          <div className="relative z-[3] flex items-center gap-2.5 pb-3">
+          <div className="relative z-[3] flex items-center gap-2.5 self-end pb-3">
```

**Verification done**:
- ✅ `pnpm typecheck` 通过 (tsc --noEmit)
- ⏳ **GUI 真机验证** —— 子代理无法跑 GUI；需用户启动 `pnpm tauri dev` 后：
  1. 打开 VNDB v32988（或任一 80+ 字符长标题作品）的详情页
  2. 确认右上角"启动方式"按钮（44px 圆形 + ▶）完整可见、可点击
  3. 确认标题最多显示 3 行，溢出末尾省略号显示，hover 后 title 提示展示完整标题
  4. 确认 hero 整体可以正常向下延展（不再硬裁切），body 区 84px padding 仍能正确避开 cover 的 -60px overflow
  5. 短标题作品（1-2 行）打开后视觉与之前一致，无回归
