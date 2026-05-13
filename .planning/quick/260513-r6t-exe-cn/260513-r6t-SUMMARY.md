---
id: 260513-r6t
slug: exe-cn
description: 修复详情页日区启动 + exe 优先 _cn + 手动改 exe 路径
date: 2026-05-13
status: complete
commits:
  - ba10926
  - f9e98cc
---

# Quick Task 260513-r6t — SUMMARY

## 改了什么

### 1) 详情页「启动」按钮终于走 LE

**File:** `src/routes/Detail.tsx` (`onLaunchClick`, ~line 675)

`launchGame(gameId, false)` → `launchGame(gameId, true)`。详情页那颗 LaunchButton 的 popover 只暴露 4 个 LE profile（Japanese / 简中 / 繁中 / Custom），按设计就该永远走 Locale Emulator，硬编码 `false` 是个直白的 bug——profile 名虽然写进了 DB，但 `use_le=false` 时 orchestrator 根本不会解析 LE 路径。

**怎么验：** 详情页点启动 → toast 显示 profile 名 → 任务管理器看到 `LEProc.exe`。

### 2) exe 自动匹配：`_cn` / `_chs` / `_zh` 后缀 +15

**File:** `src-tauri/src/scan/exe_score.rs` (`score_exe`)

加了 6 个后缀（`_cn`, `_chs`, `_zh`, `-cn`, `-chs`, `-zh`）+15 分的偏好。+15 量级精心挑选：

- 足够压过 `prefix(+5)+size(+2)+namelen(+1)=+8` 的 vanilla sibling；
- 撑不起 `-10` 的 bad-name token（setup/uninst/launcher 等），所以 `uninstall_cn.exe` 仍是负分不会被错选。

模块顶 doc-comment 同步列了这条新规则——契约即注释。

**新增 3 个单测：**
- `prefers_cn_suffix_over_plain`：同目录 `Fate.exe` vs `Fate_cn.exe`，后者严格胜出且 delta ≥ 10；
- `cn_suffix_variants_all_match`：6 个后缀变体均生效；
- `cn_suffix_cannot_rescue_bad_name`：`uninstall_cn.exe` 保持净负分。

`cargo test --lib scan::exe_score`：**7 passed, 0 failed**。

### 3) Detail 页 exe 路径增加「浏览…」按钮

**File:** `src/routes/Detail.tsx`

之前「已识别可执行文件」只有一个文本框，要靠手敲全路径。现在右侧加了一个 `FolderOpen` + 「浏览…」小按钮，调 `@tauri-apps/plugin-dialog` 的 `open()`：

```ts
openDialog({
  multiple: false,
  directory: false,
  title: "选择可执行文件",
  defaultPath: exePath.length > 0 ? exePath : game.path,
  filters: [{ name: "Executable", extensions: ["exe"] }],
})
```

`defaultPath` 优先用当前 exePath 让用户能就近修改；否则落到游戏目录根。新增 `onPickExePath` 函数贴在 `onSaveLaunchConfig` 旁边。`@tauri-apps/plugin-dialog` 在 Settings/SavesTab/ScreenshotsTab 都用过，无须新装依赖。

`pnpm tsc --noEmit`：通过。

## 提交

```
ba10926 quick(260513-r6t): backend — exe 评分对 _cn/_chs/_zh 后缀加 +15
f9e98cc quick(260513-r6t): frontend — 详情页启动按钮走 LE + exe 路径浏览按钮
```

## 未做

- 没动 GameCard.tsx 的主界面菜单（本来就正常）；
- 没动 LaunchButton popover 的 profile 列表；
- 「浏览…」按钮选完路径只是 setState；想生效仍需点「保存配置」（与现有 args/cwd 字段一致，不破坏交互模型）。
