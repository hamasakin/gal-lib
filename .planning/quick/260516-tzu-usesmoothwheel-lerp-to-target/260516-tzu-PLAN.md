---
phase: quick-260516-tzu
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/hooks/useSmoothWheel.ts
autonomous: true
requirements: [QUICK-260516-tzu]

must_haves:
  truths:
    - "网格视图滚轮滚动起步有 ease-in（不再速度瞬间到峰值），收尾自然减速到停"
    - "连续快速滚动时滚动距离自然叠加，target 持续往前推"
    - "ctrlKey+wheel（pinch zoom）和横向滚轮仍不被拦截"
    - "react-virtual 行虚拟化正常工作（virtualItems 跟随 scrollTop 更新）"
    - "滚到顶/底边界后 RAF 停止，不空转顶墙"
  artifacts:
    - path: "src/hooks/useSmoothWheel.ts"
      provides: "lerp-to-target 平滑滚动 hook"
      contains: "targetScrollTop"
  key_links:
    - from: "src/hooks/useSmoothWheel.ts"
      to: "native el.scrollTop"
      via: "RAF tick 每帧写入"
      pattern: "el\\.scrollTop\\s*="
---

<objective>
把 `useSmoothWheel` hook 从「速度+摩擦衰减」惯性模型改写成 **lerp-to-target（缓动到目标）** 平滑滚动模型。

Purpose: 现有惯性模型起步突兀（滚轮 tick 瞬间把 velocity 灌到峰值，无 ease-in）。lerp-to-target 模型起步收尾都顺，手感接近键盘配 CSS `scroll-behavior: smooth`，更「丝滑」。

Output: 改写后的 `src/hooks/useSmoothWheel.ts`，对外行为兼容（仍写 native scrollTop，react-virtual 无需改动），调用点 `Library.tsx:213` 无需改动。
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

<interfaces>
当前 src/hooks/useSmoothWheel.ts 对外签名（改写后必须保持调用兼容）：

```typescript
export function useSmoothWheel(
  ref: RefObject<HTMLElement | null>,
  options?: Options,
): void;
```

调用点 src/routes/Library.tsx:213 — 无参调用，必须保持可用：
```typescript
useSmoothWheel(scrollContainerRef);
```

ctrlKey + wheel（pinch zoom）跳过、横向滚轮（|deltaX| > |deltaY|）跳过 —— 这两条不拦截行为必须保留。
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: 改写 Options 接口与 doc comment 为 lerp-to-target 模型</name>
  <files>src/hooks/useSmoothWheel.ts</files>
  <action>
    重写 hook 顶部的中文 doc comment（第 1-23 行）和 `Options` 接口（第 27-46 行）。

    doc comment 改成描述 lerp-to-target 模型，伪代码示意：
    ```
    on wheel(deltaY):
      target += deltaY * step
      target = clamp(target, 0, scrollHeight - clientHeight)

    每帧 RAF tick:
      scrollTop += (target - scrollTop) * lerpFactor   // 指数趋近，ease-out
      |target - scrollTop| < 0.5 时 snap 到 target 并 stop
    ```
    保留「与 react-virtual 兼容：仍然写 native scrollTop」和「不拦截 ctrlKey+wheel / horizontal wheel」两段说明。

    `Options` 接口去掉 `friction` / `impulse` / `maxVelocity`，改为 lerp 模型参数：
    - `lerpFactor?: number` — 每帧向 target 趋近的 ease 系数（0..1）。越大收尾越快越「硬」，越小越「软」越拖。带中文注释给档位示意（如 0.12 偏软、0.18 默认、0.25 偏直接）。
    - `step?: number` — 每次 wheel tick 的 deltaY 位移倍数（100px wheel tick × step = 累加进 target 的量）。带中文注释给档位示意（如 0.8 约一屏几行、1.0 约等同原生位移量、1.5 一次滚更多行）。

    注释风格、命名、JSDoc 格式与原文件保持一致（每个字段一段 `/** ... */` 中文说明 + 档位示意）。
  </action>
  <verify>
    <automated>npx tsc --noEmit -p D:/project/gal-lib/tsconfig.json</automated>
  </verify>
  <done>doc comment 描述 lerp-to-target 模型；Options 接口含 `lerpFactor`、`step` 两个可选字段且各带中文 JSDoc；不再出现 friction/impulse/maxVelocity；tsc 无报错。</done>
</task>

<task type="auto">
  <name>Task 2: 改写 hook 实现为 lerp-to-target RAF 循环</name>
  <files>src/hooks/useSmoothWheel.ts</files>
  <action>
    重写 `useSmoothWheel` 函数体（第 48-114 行），用 lerp-to-target 模型替换 velocity+friction 模型。

    1. 解构默认值：`const lerpFactor = options.lerpFactor ?? 0.18;`、`const step = options.step ?? 1.0;`（默认值需保证 Library.tsx 无参调用手感合理 —— ease-out 平滑、一次滚轮约滑几行卡片）。

    2. `useEffect` 内部状态：
       - `let target = el.scrollTop;` — 维护目标滚动位置，初始化为当前 scrollTop。
       - `let raf: number | null = null;`

    3. `tick()` RAF 帧函数：
       - 每帧 clamp target 一次：`const max = el.scrollHeight - el.clientHeight; target = Math.max(0, Math.min(max, target));`（scrollHeight 在虚拟列表下会变化，每帧重夹更稳）。
       - `const diff = target - el.scrollTop;`
       - 若 `Math.abs(diff) < 0.5`：`el.scrollTop = target;` 然后 `raf = null; return;`（snap 并停止 RAF）。
       - 否则 `el.scrollTop = el.scrollTop + diff * lerpFactor;` 然后 `raf = requestAnimationFrame(tick);`。
       - 注意：边界已在 target clamp 时处理 —— target 不会超界，diff 自然收敛到 0 后停 RAF，不空转顶墙。

    4. `onWheel(e: WheelEvent)`：
       - 保留 `if (e.ctrlKey) return;`（pinch zoom 不拦截）。
       - 保留 `if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;`（横向滚轮不拦截）。
       - `e.preventDefault();`
       - 关键：若此刻 RAF 已停（`raf == null`），把 `target` 重新对齐到当前真实 `el.scrollTop` 再累加 —— 避免空闲期间用户用滚动条/键盘改了位置导致 target 失同步：
         ```
         if (raf == null) target = el.scrollTop;
         target += e.deltaY * step;
         const max = el.scrollHeight - el.clientHeight;
         target = Math.max(0, Math.min(max, target));
         ```
       - 连续快速滚动时 raf 未停，target 持续叠加 deltaY，多 tick 自然累加。
       - `if (raf == null) raf = requestAnimationFrame(tick);`

    5. cleanup：`removeEventListener("wheel", onWheel)` + `if (raf != null) cancelAnimationFrame(raf);`（与原实现一致）。

    6. `useEffect` 依赖数组改为 `[ref, lerpFactor, step]`。

    `addEventListener("wheel", onWheel, { passive: false })` 保持不变（preventDefault 需要 passive:false）。不要碰 GameGrid.tsx，不要改 Library.tsx 调用点。
  </action>
  <verify>
    <automated>npx tsc --noEmit -p D:/project/gal-lib/tsconfig.json && npx eslint D:/project/gal-lib/src/hooks/useSmoothWheel.ts</automated>
  </verify>
  <done>hook 用 lerp-to-target RAF 循环实现；维护 target、每帧 `scrollTop += diff*lerpFactor`、diff<0.5 snap 停 RAF；onWheel 在 raf==null 时重对齐 target；ctrlKey/横向滚轮仍跳过；passive:false 保留；tsc + eslint 全绿。</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>useSmoothWheel 已改写为 lerp-to-target 平滑滚动模型，Library.tsx 调用点未改动。</what-built>
  <how-to-verify>
    1. 启动应用（`pnpm tauri dev` 或现有开发命令），进入 Library 网格视图。
    2. 单次滚一下鼠标滚轮 — 应观察到起步顺滑（有 ease-in 感，不再瞬间窜出）、收尾自然减速到停。
    3. 连续快速滚多下 — 滚动距离应自然叠加，画面顺畅跟进，不卡顿。
    4. 滚到列表最顶 / 最底 — 应平滑贴边停住，无抖动、无空转。
    5. 滚动过程中卡片网格内容正常加载（react-virtual 行虚拟化生效，无白屏行）。
    6. 按住 Ctrl + 滚轮 — 应触发浏览器缩放（未被 hook 拦截）。
    7. 若手感太软/太硬，可在 Library.tsx:213 传 `{ lerpFactor, step }` 微调（可选，非必须）。
  </how-to-verify>
  <resume-signal>输入 "approved"，或描述手感问题（如太软/太硬/起步仍突兀）</resume-signal>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` 无类型错误
- `npx eslint src/hooks/useSmoothWheel.ts` 无 lint 错误
- 改动仅限 `src/hooks/useSmoothWheel.ts`（GameGrid.tsx、Library.tsx 未改）
- hook 对外签名兼容，Library.tsx:213 无参调用仍工作
</verification>

<success_criteria>
- `useSmoothWheel` 使用 lerp-to-target 模型：维护 targetScrollTop，每帧指数趋近，ease-out 收尾
- 起步顺滑（ease-in）、收尾自然减速到停 — 手感「丝滑」
- 连续快速滚动 target 自然叠加
- ctrlKey+wheel / 横向滚轮不拦截行为保留
- react-virtual 行虚拟化兼容（仍写 native scrollTop）
- 边界 clamp 后 RAF 停止，不空转
- doc comment 与 Options 接口已更新为 lerp-to-target 描述
</success_criteria>

<output>
After completion, create `.planning/quick/260516-tzu-usesmoothwheel-lerp-to-target/260516-tzu-SUMMARY.md`
</output>
