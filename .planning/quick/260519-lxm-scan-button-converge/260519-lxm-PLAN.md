---
phase: quick-260519-lxm
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/routes/Scan.tsx
  - src/routes/Settings.tsx
autonomous: true
requirements: [lxm-scan-button-converge]

must_haves:
  truths:
    - "/scan 页扫描操作区只有一个扫描按钮（外加重新生成待复核队列 / 取消）"
    - "/scan 页的扫描按钮文案为「扫描」"
    - "/settings「扫描操作」区块的扫描按钮文案为「扫描」"
    - "点击任一扫描按钮的运行时行为与改动前完全一致（后端固定收到 mode=\"full\"）"
    - "npx tsc --noEmit 通过，无未使用变量 / 无缺失引用报错"
  artifacts:
    - path: "src/routes/Scan.tsx"
      provides: "单一「扫描」按钮的 /scan 页"
      contains: "已开始扫描"
    - path: "src/routes/Settings.tsx"
      provides: "「扫描操作」区块单一「扫描」按钮"
  key_links:
    - from: "src/routes/Scan.tsx"
      to: "startScan"
      via: "onScan 回调固定调用 startScan(\"full\")"
      pattern: "startScan\\(\"full\"\\)"
    - from: "src/routes/Settings.tsx"
      to: "startScan"
      via: "onScan 回调固定调用 startScan(\"full\")"
      pattern: "startScan\\(\"full\"\\)"
---

<objective>
纯前端的按钮/文案收敛：把 /scan 页和 /settings 页里完全等价的「增量扫描 / 全量扫描」冗余 UI 收敛为单一「扫描」按钮。

背景：后端 `start_scan(mode)` 自 20260516 起把 `full` 与 `incremental` 统一为同一行为，`mode` 参数只做校验、不再影响行为。因此前端两个扫描按钮本就完全等价，是冗余 UI。

Purpose: 消除会让用户困惑的冗余按钮（「增量」与「全量」实际无差别），让扫描入口清晰单一。
Output: Scan.tsx 与 Settings.tsx 两处扫描入口各收敛为一个「扫描」按钮，运行时行为零变化。

**范围边界（不要改）：**
- 后端 `src-tauri/` 任何文件
- `src/lib/scan.ts` 的 `startScan(mode)` 签名 —— 继续保留 `mode` 参数，前端固定传 `"full"`
- 「重新生成待复核队列」按钮、取消按钮、KPI、ScanFeed、ReviewQueue、「刷新元数据」按钮及其余一切
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@src/routes/Scan.tsx
@src/routes/Settings.tsx

<interfaces>
<!-- startScan 签名保持不变；前端固定传 "full"。仅供参考，不改 scan.ts。 -->
From src/lib/scan.ts:
```typescript
export function startScan(mode: "incremental" | "full"): Promise<void>;
```

已确认事实（grep 验证）：
- Scan.tsx 中 `RefreshCw` 仅在第 169 行「增量扫描」按钮图标处使用一次 —— 删按钮后必须从第 25 行 import 移除。
- Scan.tsx 中 `Search` 仍被「全量重扫」按钮（改名后的「扫描」）使用 —— 保留。
- Scan.tsx 第 25 行当前 import：`import { ListRestart, RefreshCw, Search, X } from "lucide-react";`
  `ListRestart`（重新生成队列按钮）、`X`（取消按钮）继续使用，保留。
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Scan.tsx — 删「增量扫描」按钮、「全量重扫」改名「扫描」、收敛 onScan、清 import</name>
  <files>src/routes/Scan.tsx</files>
  <action>
对 src/routes/Scan.tsx 做以下纯前端收敛改动（行号为参考值，以实际文件为准）：

1. 删除「增量扫描」按钮：移除约 162-171 行整个 `<button>` 块 ——
   即 `onClick={() => void onScan("incremental")}` 且内含 `<RefreshCw .../>` + `<span>增量扫描</span>` 的那个按钮。

2. 「全量重扫」按钮改名为「扫描」：在约 172-181 行剩下的那个按钮里，把
   `<span>全量重扫</span>` 改为 `<span>扫描</span>`。`Search` 图标保留（视觉上中性，符合「扫描」语义），按钮其余属性（onClick、disabled、className、style）不动。

3. 收敛 `onScan` 回调（约 85-101 行）：当前签名为 `async (mode: "incremental" | "full") => {...}`，
   删按钮后只剩一处调用且固定 `"full"`。简化为无参函数：
   - 去掉 `mode` 形参，函数体内把 `startScan(mode)` 改为 `startScan("full")`；
   - toast 文案 `toast.info(mode === "full" ? "已开始全量重扫" : "已开始增量扫描")` 简化为 `toast.info("已开始扫描")`；
   - 其余逻辑（listScanRoots 空目录守卫 + navigate("/settings")、catch 报错 toast）保持不变；
   - useCallback 依赖数组保持 `[navigate]`。
   相应地，剩下那个「扫描」按钮的 onClick 从 `() => void onScan("full")` 改为 `() => void onScan()`。

4. 更新文件头注释：约第 7 行 `actions: 增量扫描 / 全量扫描 / 取消（active 时）`
   改为 `actions: 扫描 / 重新生成待复核队列 / 取消（active 时）`
   （注释要如实反映改后的实际按钮集合）。

5. 清理 import：第 25 行 `import { ListRestart, RefreshCw, Search, X } from "lucide-react";`
   移除 `RefreshCw`（grep 已确认它仅被刚删的按钮使用），改为
   `import { ListRestart, Search, X } from "lucide-react";`。
   `ListRestart`、`Search`、`X` 三者都仍在使用，必须保留。

不要改动：「重新生成待复核队列」按钮、取消按钮、ScanProgressBar、PageHeader 其它 props、KpiCard、ScanFeed、ReviewQueue、所有 effect / refreshKpis / onReseed / onCancel 逻辑。
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>
Scan.tsx 中「增量扫描」按钮已删除；剩余扫描按钮文案为「扫描」；`onScan` 为无参函数且内部 `startScan("full")`；toast 文案为「已开始扫描」；文件头注释第 7 行已更新；第 25 行 import 不含 `RefreshCw`；`npx tsc --noEmit` 通过且无未使用变量 / 缺失引用报错。
  </done>
</task>

<task type="auto">
  <name>Task 2: Settings.tsx — 「全量扫描」按钮改名「扫描」、同步 lede 文案与头注释、收敛 onScan</name>
  <files>src/routes/Settings.tsx</files>
  <action>
对 src/routes/Settings.tsx「扫描操作」区块（scan-ops）做以下纯前端收敛改动（行号为参考值，以实际文件为准）：

1. 「全量扫描」按钮改名：约 498-500 行 `<SettingButton primary onClick={...}>全量扫描</SettingButton>`，
   把按钮文案 `全量扫描` 改为 `扫描`。按钮的 `primary`、onClick 等属性不动（onClick 见第 3 点）。

2. 同步该区块 lede 说明文案：约 494 行
   `lede="全量扫描发现并匹配新游戏；刷新元数据对已收录游戏重抓元数据（已绑定的按 ID 直拉、未绑定的走模糊匹配）"`
   开头的『全量扫描』改为『扫描』，即改为
   `lede="扫描发现并匹配新游戏；刷新元数据对已收录游戏重抓元数据（已绑定的按 ID 直拉、未绑定的走模糊匹配）"`。

3. 收敛 `onScan` 回调（约 246-258 行）：当前签名为 `async (mode: "full" | "incremental") => {...}`，
   实际只被「扫描」按钮以 `"full"` 调用一处。简化为无参函数：
   - 去掉 `mode` 形参，函数体内 `startScan(mode)` 改为 `startScan("full")`；
   - 其余逻辑（scanRoots 空守卫报错 toast、`toast.info("扫描已启动")`、`navigate("/")`、catch 报错）保持不变；
   - 相应地把按钮 onClick 从 `() => void onScan("full")` 改为 `() => void onScan()`。

4. 更新文件头注释：约第 11 行 `6. 扫描操作                   — full/incremental scan`
   改为 `6. 扫描操作                   — scan`（保持该行原有的对齐空格风格，仅替换 `full/incremental scan` 为 `scan`）。

不要改动：「刷新元数据」按钮及 `onRefreshMetadata`、其它任何 Section（外观/扫描根目录/添加单个游戏/LE/标签管理/UI 偏好/调试/关于）、SettingButton 组件、scroll-spy 逻辑、`startScan` 的 import（仍需保留，它在收敛后的 onScan 内部继续被调用）。
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>
Settings.tsx「扫描操作」区块按钮文案为「扫描」；该区块 lede 开头为『扫描发现并匹配新游戏…』；`onScan` 为无参函数且内部 `startScan("full")`，按钮 onClick 为 `() => void onScan()`；文件头注释第 11 行 scan-ops 行已更新为 `scan`；`npx tsc --noEmit` 通过且无未使用变量报错。
  </done>
</task>

</tasks>

<verification>
- `npx tsc --noEmit` 整项目类型检查通过（重点确认：Scan.tsx 删 `RefreshCw` 后无「未使用 import」或「找不到名称」报错；两处 `onScan` 收敛为无参后所有调用点签名匹配）。
- 人工/grep 确认运行时行为零变化：两处 `onScan` 内部均固定 `startScan("full")`，后端收到的 mode 与改动前（原本就只有 "full" 路径会到达后端的等价行为）一致。
- grep 确认 Scan.tsx 与 Settings.tsx 中已无字符串「增量扫描」「全量重扫」「全量扫描」残留。
</verification>

<success_criteria>
- /scan 页扫描操作区仅剩一个「扫描」按钮（加重新生成待复核队列 / 取消）。
- /settings「扫描操作」区块仅剩一个「扫描」按钮（加刷新元数据）。
- 两处文件头注释与 Settings lede 文案均与改后按钮集合一致。
- 不再使用的 `RefreshCw` import 已清除。
- 后端 `src-tauri/` 与 `src/lib/scan.ts` 零改动。
- `npx tsc --noEmit` 通过。
</success_criteria>

<output>
After completion, create `.planning/quick/260519-lxm-scan-button-converge/260519-lxm-SUMMARY.md`
</output>
