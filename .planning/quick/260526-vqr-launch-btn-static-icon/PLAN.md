---
quick_id: 260526-vqr
slug: launch-btn-static-icon
type: quick
mode: execute
created: 2026-05-26
---

# Quick 260526-vqr — Detail 页启动按钮改成常态固定图标

## 用户原话

> 详情页启动按钮 HOVER 的时候不用展开按钮，一直用一个常态的图标按钮就可以，避免 HOVER 影响标题等其它元素的布局。

## 背景

当前 `LaunchButton` (`src/components/library/LaunchButton.tsx`)：
- 44×44 圆形，hover 时 `width: 44 → 240` 动画展开，露出 "PLAY · {label} ↑"。
- hover 时同时弹一个 260px 启动方式 popover（绝对定位在按钮上方）。
- 用户截图证据：hover 时 popover 出现就已经是视觉布局变化；展开的宽度变化也会挤到 hero 区其他兄弟元素。

启动方式切换的 UI 入口**已经在「启动配置」tab**（`Detail.tsx` 行 1410-1430，`Select` 绑同一个 `launchMethod` state），所以**直接删 LaunchButton 的 popover 不会丢功能**。

## 验证依据（已确认）

- `Detail.tsx:1410-1430`：「启动配置」tab `Select` 已经能改 LE/direct，并通过 `onSaveLaunchConfig`（行 824）写回 `le_profile`。**LaunchButton 上的 popover 是冗余入口**。
- `LaunchButton.tsx:25` 导出的 `export type LaunchMethod` — Grep 全仓 src/，**只有 LaunchButton.tsx 自己引用**；`Detail.tsx:167` 自己声明了同名 `type LaunchMethod = "le-jp" | "direct"`，两边目前是独立 type alias，不影响。
- `Detail.tsx` 内部仍有 5 处用到 `launchMethod` state（445 declare、506 init、767 log、780 launchGame 用 LE 与否、774/828 save le_profile、1415 Select.value、1416 Select.onValueChange）—— **state 必须保留**，只是不再由 LaunchButton 间接触发 setter。

## 目标

1. `LaunchButton` 永远 44×44 固定尺寸，hover 不改尺寸、不弹 popover、不改位置。
2. 完全删掉 hover 展开动画 + 启动方式 popover + `LAUNCH_METHODS` 表 + `LaunchMethod` 类型导出 + `onProfileChange`/`profile` props。
3. 保留：`onClick`（点一下启动）、`isActive`（运行中→红色 Square）、`disabled` + `disabledTitle`。
4. `Detail.tsx` 调用处删 `profile` / `onProfileChange` 传参；其余 `launchMethod` state 使用点全部保留不动。

## 非目标

- 不改 Rust 后端、不改 DB、不改 i18n（`detail.launch.tooltip` 等 key 继续用）。
- 不顺手修 hero 标题溢出（Bug 1 已在前面 debug session 修过待验证）。
- 不重构「启动配置」tab、不动 `methodToLeProfile` / `leProfileToMethod`。
- 不删 i18n 里的 `detail.launch.le_jp_note` / `direct_note`（popover 用过的 key，留着即可，不在本次清理范围）。
- 不动当前未 commit 的 3 个 BUG 修改（commands.rs / games.ts / Detail.tsx hero）。

## 任务

### Task 1 — 改写 LaunchButton 为常态固定图标按钮

**Files:** `src/components/library/LaunchButton.tsx`

**Action:**

1. 删掉 `useState` / `useRef` / `useEffect` / `ChevronUp` imports（不再需要）。保留 `Play` / `Square` / `cn` / `useTranslation`。
2. 删掉 `LAUNCH_METHODS` 数组、`export type LaunchMethod`、所有 hover/popover 相关 state (`hover`, `closeTimer`)、`open()` / `scheduleClose()` 函数、`expanded` / `activeProfile` / `activeProfileLabel` 局部变量。
3. `LaunchButtonProps` 收敛为：
   ```ts
   interface LaunchButtonProps {
     onClick: () => void;
     isActive?: boolean;
     disabled?: boolean;
     disabledTitle?: string;
   }
   ```
   完全去掉 `profile` 和 `onProfileChange`。
4. 组件主体替换为单个固定尺寸 button（不要包 `<div className="relative">` wrapper、不要 popover JSX）：
   - `isActive` 分支保持现在的红色 Square 实现（行 92-112）原样不动。
   - 默认分支：返回**单个** `<button>` —— `h-11 w-11`（44px）固定、`rounded-full`、`grid place-items-center`、`background: var(--accent)`、`color: var(--accent-on)`、`boxShadow: "0 8px 24px -8px var(--accent), 0 0 0 0 var(--accent-soft)"`、`disabled` 时 `cursor-not-allowed opacity-50`。
   - 按钮里只放一个 `<Play size={16} fill="currentColor" strokeWidth={1} style={{ transform: "translateX(1.5px)" }} />`（保留视觉重心微调）。
   - `title` / `aria-label`：`disabled ? disabledTitle : t("detail.launch.tooltip", { label: "" })` —— 因为没有当前 profile label 可读，把 label 占位为空串；或者更干脆，直接用一个不带 label 插值的新调用 `t("detail.launch.action")`（"启动"）。**取后者**：`title={disabled ? disabledTitle : t("detail.launch.action")}`，`aria-label` 同。
   - 保留 `transition-shadow hover:scale-105` 这种**不改尺寸、不改位置**的 hover 微反馈（和 isActive 分支一致），但**不改宽度、不改 transform-origin、不弹任何浮层**。
5. 删掉文件头 5-9 行的旧注释（"两种启动方式取代旧 4 个 LE profile"、"label / note 在组件内 t() 解析"）—— 它们描述的是被删掉的 popover 行为。在新组件 doc-comment 里写一行：`// Quick 260526-vqr — 固定 44px 圆形图标按钮，hover 不改尺寸/不弹浮层，避免影响 hero 区布局。启动方式切换在「启动配置」tab。`

**Verify:**

```xml
<verify>
  <automated>pnpm typecheck</automated>
</verify>
```

**Done:**
- `LaunchButton.tsx` 不再 import `useState` / `useRef` / `useEffect` / `ChevronUp`。
- `LaunchButton.tsx` 文件搜不到 `LAUNCH_METHODS` / `expanded` / `hover` / `popover` / `onProfileChange` / `profile` 字样。
- `pnpm typecheck` 通过（Detail.tsx 因为还在传 `profile` / `onProfileChange` 会报错，本 Task 不修 —— 留给 Task 2，但 Task 1 单独不能落 commit，跟 Task 2 一起 commit）。
- **注意**：Task 1 + Task 2 是一对原子改动，必须一次 commit；不要在 Task 1 之后单独 `git commit`。

### Task 2 — 清理 Detail.tsx 调用处

**Files:** `src/routes/Detail.tsx`

**Action:**

1. 行 1243-1256 LaunchButton 调用：删掉 `profile={launchMethod}` 和 `onProfileChange={setLaunchMethod}` 两行；其余 `onClick` / `isActive` / `disabled` / `disabledTitle` 保留不动。
2. **不要**删 `launchMethod` state（行 445）、`setLaunchMethod` 调用（行 506 init、1416 Select.onValueChange）—— 启动配置 tab + onLaunchClick 还在用。
3. **不要**删 `type LaunchMethod` (行 167) / `LAUNCH_METHOD_LABEL_KEY` (行 172) / `leProfileToMethod` (行 184) / `methodToLeProfile` (行 190) —— 全部还在用。
4. 不动文件其他任何地方（特别是 hero 区 / 启动配置 tab / onLaunchClick / onSaveLaunchConfig）。

**Verify:**

```xml
<verify>
  <automated>pnpm typecheck</automated>
</verify>
```

子代理无法跑 GUI，**人眼真机验证由用户在 `pnpm tauri dev` 里做**，验收点：
- 详情页启动按钮固定 44×44，hover 没有宽度变化、没有 popover 出现、hero 标题/操作按钮位置稳定。
- 点一次按钮直接启动（按当前 `launchMethod` state，默认 le-jp）。
- 「启动配置」tab 切换 LE/direct → 保存 → 重新点按钮 → 按新方式启动。
- 游戏运行中按钮变红色 Square、点一下强停。

**Done:**
- `Detail.tsx` 中 `<LaunchButton ...>` 调用只剩 4 个 props（`onClick` / `isActive` / `disabled` / `disabledTitle`）。
- `Grep launchMethod src/routes/Detail.tsx` 输出条目数和改动前相同（state 没动）。
- `pnpm typecheck` 通过。

### Task 3 — 真机验证 + commit（用户主导）

**Files:** —

**Action:**

由用户在 `pnpm tauri dev` 真机验证 Task 2 列出的 4 个验收点。验证通过后，把本次 LaunchButton 改动**单独 commit**（不要混入当前未提交的 3 个 BUG 修，按用户偏好"一个改动一次 commit"）：

```
git add src/components/library/LaunchButton.tsx src/routes/Detail.tsx
git commit -m "fix(quick-260526-vqr): 详情页启动按钮改成常态固定图标，移除 hover 展开 + popover"
```

**Verify:**

```xml
<verify>
  <automated>git log -1 --name-only | grep -E '(LaunchButton.tsx|Detail.tsx)'</automated>
</verify>
```

**Done:**
- 真机验证 4 个验收点全部通过。
- commit 只含 `LaunchButton.tsx` + `Detail.tsx` 两个文件，不裹带 3 个 BUG 修的未提交改动。

## Success Criteria

- [ ] `LaunchButton.tsx` 改写完毕，固定 44×44，hover 不改尺寸不弹浮层。
- [ ] `Detail.tsx` 调用处清理完，无 `profile` / `onProfileChange` 传参。
- [ ] `pnpm typecheck` 全绿。
- [ ] 真机验证：hover 不影响 hero 布局、点一下能启动、启动配置 tab 仍能切方式、运行中变红色 Square。
- [ ] 本次改动单独成一个 commit。

## Risk Notes

- **唯一风险点**：万一以后想要"在主按钮上直接快切启动方式"，需要重新加 popover 入口。但本次用户明确要求"避免 hover 影响布局"，且启动配置 tab 已经能切，不构成功能丢失。
- 不动 Rust / DB / i18n key 表，回滚成本 = revert 一个 commit。
