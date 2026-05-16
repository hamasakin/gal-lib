---
phase: quick-260516-uh6
plan: 01
subsystem: frontend
tags: [detail-page, locale-emulator, exe-detection]
requires: []
provides:
  - "isCnVersionExe 纯函数（Detail.tsx 模块级）"
  - "refreshGame 默认 profile 的 cn-aware 逻辑"
affects:
  - src/routes/Detail.tsx
tech-stack:
  added: []
  patterns:
    - "前后端跨语言常量约定靠注释交叉引用同步（cn_suffixes ↔ exe_score.rs）"
key-files:
  created: []
  modified:
    - src/routes/Detail.tsx
decisions:
  - "复用后端 exe_score.rs 的六个后缀集合，不自创；两处用注释互相标注同步责任"
  - "检测输入用 g.executable_path（Detail 加载时已是 _cn.exe），不引入新字段"
metrics:
  duration: "~6 min"
  completed: "2026-05-16"
  tasks: 1
  files: 1
---

# Quick 260516-uh6: 中文版 EXE 详情页默认中文 LE Summary

中文补丁版 EXE（文件名 stem 以 `_cn`/`_chs`/`_zh`/`-cn`/`-chs`/`-zh` 结尾）的游戏，在未保存过 LE 配置时，详情页的 LE 启动配置默认值改为「简体中文」而非「Japanese」。

## What Was Done

### Task 1: 新增 isCnVersionExe 纯函数并接入 refreshGame 默认 profile 逻辑

- 在 `src/routes/Detail.tsx` 的 `LeProfile` 类型定义之后新增模块级纯函数 `isCnVersionExe(path)`：
  - 空/`null`/`undefined` 路径直接返回 `false`，不报错。
  - 取文件名 stem（兼容 `\` 与 `/` 分隔符，去扩展名，转小写），匹配六个中文补丁后缀。
  - 后缀集合 `["_cn", "_chs", "_zh", "-cn", "-chs", "-zh"]` 与后端 `src-tauri/src/scan/exe_score.rs` 的 `cn_suffixes` 一致，函数注释标注了跨语言同步责任。
- 修改 `refreshGame` 的默认 profile 分支（仅 else 分支）：未保存合法 `le_profile` 时，若 `executable_path` 是中文版 EXE 则默认 `"Simplified Chinese"`，否则 `"Japanese"`。已保存合法 `le_profile` 的分支保持原行为。
- `profile` state 同时驱动 hero 区 `LaunchButton` 弹层与「启动配置」tab 的 LE Profile Select，单处改 state 覆盖两个界面。

**Commit:** `593bf09`

## Verification

- `pnpm run typecheck`（`tsc --noEmit`）通过，无类型错误。
- `isCnVersionExe` 自检清单（无 FE 单测框架，逐项推理验证）：
  - `"C:/games/Fate/Fate_cn.exe"` → stem `fate_cn` → `true` ✓
  - `"C:/games/Fate/Fate_CHS.exe"` → stem `fate_chs`（小写化后）→ `true` ✓
  - `"D:/x/game-zh.exe"` → stem `game-zh` → `true` ✓
  - `"C:/games/Fate/Fate.exe"` → stem `fate` → `false` ✓
  - `"C:/games/cncompany/Fate.exe"` → base `Fate.exe`，stem `fate` → `false` ✓（仅目录含 cn 不误判）
  - `""` / `null` → `!path` 短路 → `false` ✓
- `refreshGame` 行为：已保存合法 le_profile 用保存值；未保存 + cn EXE → `"Simplified Chinese"`；未保存 + 日文 EXE → `"Japanese"`；`executable_path` 为 `null` → `"Japanese"`。

### 需开发者过目（无 FE 单测）

1. 打开一个可执行文件为 `*_cn.exe` 且从未改过 LE 配置的游戏详情页 → hero 启动按钮弹层与「启动配置」tab 的 LE Profile 均默认「简体中文」。
2. 打开一个普通日文版 EXE 的游戏详情页 → LE 默认仍为「Japanese」。
3. 找一个已手动保存过 LE 配置（非简中）的游戏 → 详情页仍显示其保存值，未被 cn 默认覆盖。

## Deviations from Plan

None - plan executed exactly as written.

执行说明：worktree 初始 `node_modules` 缺失，按 `pnpm install --frozen-lockfile` 安装后再跑 typecheck（环境准备步骤，非计划偏离；`pnpm-lock.yaml` 未变更）。

## Self-Check: PASSED

- FOUND: src/routes/Detail.tsx（含 `isCnVersionExe` 函数 + exe_score.rs 交叉引用注释）
- FOUND: commit 593bf09
