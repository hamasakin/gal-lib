---
phase: quick-260516-tzu
plan: 01
subsystem: ui-scroll
tags: [scroll, hooks, ux, library-grid]
requires:
  - "src/hooks/useSmoothWheel.ts (旧 velocity+friction 实现)"
provides:
  - "src/hooks/useSmoothWheel.ts (lerp-to-target 平滑滚动 hook)"
affects:
  - "src/routes/Library.tsx (调用点，未改动，行为兼容)"
tech-stack:
  added: []
  patterns:
    - "lerp-to-target 缓动滚动：维护 target，每帧 scrollTop += diff*lerpFactor 指数趋近"
key-files:
  created: []
  modified:
    - "src/hooks/useSmoothWheel.ts"
decisions:
  - "滚轮平滑模型从 velocity+friction 惯性切换到 lerp-to-target 缓动（起步收尾都顺，无突兀 ease-in）"
  - "默认参数 lerpFactor=0.18、step=1.0，保证 Library.tsx 无参调用即获合理手感"
metrics:
  duration: "~25min"
  completed: "2026-05-16T13:44:24Z"
  tasks: 3
  files: 1
---

# Quick 260516-tzu: useSmoothWheel lerp-to-target 平滑滚动 Summary

把 `useSmoothWheel` hook 从「速度+摩擦衰减」惯性模型改写为 **lerp-to-target（缓动到目标）** 平滑滚动模型，起步带 ease-in、收尾 ease-out 自然减速到停，手感更丝滑；对外签名兼容，调用点 `Library.tsx:213` 无需改动。

## What Changed

`src/hooks/useSmoothWheel.ts` 全文改写（44 insertions / 47 deletions）：

- **doc comment**：从「速度+衰减」模型说明改为 lerp-to-target 模型说明，含伪代码示意（`target += deltaY*step` / 每帧 `scrollTop += diff*lerpFactor`），并解释指数趋近天然带 ease-in + ease-out。保留「与 react-virtual 兼容：仍写 native scrollTop」和「不拦截 ctrlKey+wheel / 横向滚轮」两段。
- **Options 接口**：移除 `friction` / `impulse` / `maxVelocity`，新增两个可选字段，各带中文 JSDoc + 档位示意：
  - `lerpFactor?: number` — 每帧向 target 趋近的 ease 系数（0.12 偏软 / 0.18 默认 / 0.25 偏直接）。
  - `step?: number` — 每次 wheel tick 的 deltaY 位移倍数（0.8 几行 / 1.0 默认约等同原生 / 1.5 更多行）。
- **hook 实现**：
  - 解构默认值 `lerpFactor ?? 0.18`、`step ?? 1.0`。
  - `useEffect` 内维护 `let target = el.scrollTop;` 与 `let raf`。
  - `tick()`：每帧重夹 `target` 到 `[0, scrollHeight-clientHeight]`（虚拟列表下 scrollHeight 会变，每帧 clamp 更稳）；`diff = target - scrollTop`；`|diff| < 0.5` 时 snap 到 target 并停 RAF；否则 `scrollTop += diff*lerpFactor` 并续帧。边界由 target clamp 处理，diff 自然收敛到 0，不空转顶墙。
  - `onWheel()`：保留 `ctrlKey` 跳过（pinch zoom）、横向滚轮跳过（`|deltaY| < |deltaX|`）；`raf==null` 时把 `target` 重对齐到真实 `scrollTop` 再累加 `deltaY*step`（避免空闲期间滚动条/键盘改位导致 target 失同步），RAF 未停时持续叠加多 tick 自然累加；clamp 后按需启动 RAF。
  - `passive: false` 保留（preventDefault 需要）；cleanup 移除监听 + cancelAnimationFrame；依赖数组改为 `[ref, lerpFactor, step]`。

## Verification

- `tsc --noEmit`（worktree tsconfig + 项目 typecheck script）：通过，无类型错误。
- `npm run build`（`tsc -b && vite build`）：通过，1961 modules transformed，built OK（chunk-size 警告为既有项，与本改动无关）。
- 改动仅限 `src/hooks/useSmoothWheel.ts`；`GameGrid.tsx`、`Library.tsx` 未改。
- 对外签名兼容：`useSmoothWheel(ref)` 无参调用仍可用，`Library.tsx:213` 无需改动。

### ESLint 说明

Plan 的 Task 2 verify 步骤含 `npx eslint src/hooks/useSmoothWheel.ts`，但本项目**未配置 ESLint**——无 `eslint.config.*`、无 `.eslintrc*`、`package.json` 无任何 eslint 依赖，`package.json` 的质量门是 `typecheck`/`build`（均走 `tsc`）。`npx eslint` 会拉一个裸 v10 并因找不到配置而报错。这是项目既有状态，非本改动引入；按 deviation 规则 scope boundary，不为此新增 eslint 配置。实际生效的类型检查（tsc）+ 完整生产构建均已通过。

## Task 3 — Human-verify Checkpoint（待人工手感验证）

Task 3 是 `checkpoint:human-verify`，滚动手感无法自动验证。所有可自动化的检查（tsc、build）已完成且全绿；按项目约定（autonomous run 不打断），此项不阻塞，留待 milestone audit 人工确认。

**人工验证步骤**（在真机启动 `pnpm tauri dev` 进入 Library 网格视图后）：

1. 单次滚一下滚轮 — 应起步顺滑（有 ease-in 感，不再瞬间窜出）、收尾自然减速到停。
2. 连续快速滚多下 — 滚动距离自然叠加，画面顺畅跟进，不卡顿。
3. 滚到列表最顶 / 最底 — 平滑贴边停住，无抖动、无空转。
4. 滚动中卡片网格正常加载（react-virtual 行虚拟化生效，无白屏行）。
5. 按住 Ctrl + 滚轮 — 触发浏览器缩放（未被 hook 拦截）。
6. 若手感太软/太硬，可在 `Library.tsx:213` 传 `{ lerpFactor, step }` 微调（可选）。

## Deviations from Plan

### 执行过程异常（已处理，非代码缺陷）

执行环境存在两个工作目录（主仓 `D:\project\gal-lib` 与本 worktree）。Bash 工具的 `cd D:/project/gal-lib` 一度解析到主仓（`master` 分支），首次 Write/build/`git add` 误落在主仓。Pre-commit HEAD 安全断言**正确拦截**了在 `master` 上的提交（未产生任何错误提交）。已用 `git restore --staged` + `git checkout -- <单文件>` 把主仓该文件还原干净，随后在 worktree 内重新应用同一改动并提交。未触发任何破坏性 git 操作（无 `git clean` / 无 `git reset --hard` / 无 protected ref 改写）。

### 代码层面

无 —— hook 逻辑严格按 plan 的 Task 1 / Task 2 描述实现。Task 1 与 Task 2 因同处一个文件、接口与实现交织，作为单次原子改写在一个 `feat` commit 中落地。

## Commits

- `5e1305a` feat(quick-260516-tzu): 把 useSmoothWheel 改写为 lerp-to-target 平滑滚动模型

## Self-Check: PASSED

- FOUND: src/hooks/useSmoothWheel.ts（含 lerp-to-target 实现，`target`/`lerpFactor`/`step` 均存在，无 friction/impulse/maxVelocity）
- FOUND: commit 5e1305a
