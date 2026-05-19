---
phase: quick-260519-pi1
plan: 01
subsystem: build-tooling
tags: [release, automation, npm-script]
requires: []
provides: ["npm run release 发版命令"]
affects: [scripts/release.mjs, package.json]
tech-stack:
  added: []
  patterns: ["纯 Node 标准库 ESM 脚本（无新依赖）"]
key-files:
  created: [scripts/release.mjs]
  modified: [package.json]
decisions:
  - "Cargo.lock bump 用锚定 name = \"gal-lib\" 的正则精确替换，杜绝误改依赖条目"
  - "bump 用字符串/正则替换而非 JSON.parse/stringify，保持 diff 最小、不重排格式"
  - "tag 消息走草稿临时文件 + 编辑器定稿，去注释/空白后为空则中止，不发空 notes tag"
  - "commit 成功后任一步失败均打印明确中文手动收尾指引"
metrics:
  duration: ~6min
  completed: 2026-05-19
---

# Quick 260519-pi1: npm run release 发版命令 Summary

为 gal-lib 新增 `npm run release` 发版命令，把手工的「bump 四处版本字段 → commit → 打 annotated tag → push」流程收成一条纯 Node 标准库脚本。

## 完成内容

### Task 1 — scripts/release.mjs 发版脚本

新建 `scripts/release.mjs`（Node ESM，纯 `node:fs` / `node:child_process` / `node:os` / `node:path` / `node:process`，零新依赖），9 条行为规格全部覆盖：

1. **参数解析** —— `process.argv.slice(2)` 取 0/1 个参数；从 `package.json` 文本正则提取当前 version；无参/`patch` → patch bump，`minor`/`major` → 对应语义 bump（minor 归零 patch、major 归零 minor+patch），`^\d+\.\d+\.\d+$` → 显式版本号；非法参数或目标版本与当前相同 → 中文报错 `exit(1)`。
2. **三项前置检查**（任何文件写入前）—— `git status --porcelain` 工作区干净、`git rev-parse --abbrev-ref HEAD` 为 master、目标 tag `vX.Y.Z` 本地（`git tag --list`）与远端（`git ls-remote --tags origin`）均不存在。
3. **四处精确替换 bump** —— `package.json` / `tauri.conf.json` 的 `"version": "..."`、`Cargo.toml` `[package]` 段内 `version = "..."`（锚定 `[package]` 段防误伤其它段）、`Cargo.lock` **仅** `name = "gal-lib"` 紧随的 `version` 行（`/(name = "gal-lib"\r?\nversion = ")[^"]+(")/`）。每处校验命中数恰为 1，否则中止并提示 `git checkout --` 回滚；读写不强制转 LF，保留 CRLF。
4. **提交** —— `git add` 四文件 + `git commit -m "chore: bump version to NEW"`，记录 committed 状态。
5. **tag 草稿 + 编辑器定稿** —— `git describe --tags --abbrev=0 --match "v*" HEAD` 求上个可达 tag（无 tag 不中止，退化为全历史 log）；草稿写 `os.tmpdir()`，含 `Release vNEW` + 空行 + `git log <prev>..HEAD --pretty=format:"- %s"`；编辑器优先级 `git config core.editor` → `GIT_EDITOR` → `EDITOR` → `VISUAL` → `notepad`，`spawnSync` `stdio: 'inherit'` 同步等待，core.editor 含参数按空格拆分。
6. **打 tag** —— 读回草稿，去 `#` 注释行与首尾空白后为空 → 中止不发空 tag；非空 → `git tag -a vNEW -F <临时文件>`；临时文件成功/失败均 `rmSync` 清理。
7. **推送** —— `git push origin master` → `git push origin vNEW`（触发 GitHub release.yml）。
8. **失败处理** —— 前置检查失败直接退；bump/commit 失败给 `git checkout --` 回滚指引；commit 成功后 tag/push 失败由 `dieAfterCommit` 打印「停在哪一步 + 仓库状态 + 如何手动收尾」（涵盖 tag push 失败、master push 失败等场景）。
9. **输出** —— 全程关键步骤中文进度提示（✓ 前置检查通过 / ✓ 已 bump / ✓ 已提交 / ✓ 已打 tag / ✓ 已推送）；路径用 `node:path` 拼接，cwd 固定仓库根（脚本目录上一级）。

### Task 2 — package.json 注册 release 脚本

`scripts` 对象在 `build:exe` 之后新增 `"release": "node scripts/release.mjs"`，仅此一行，未动其它脚本与依赖字段。

## 验证

- `node --check scripts/release.mjs` —— 通过（语法无误）。
- `node -e "process.exit(require('./package.json').scripts.release==='node scripts/release.mjs'?0:1)"` —— 通过（脚本已注册）。
- 人工走查：Cargo.lock 替换正则锚定 `name = "gal-lib"`；三项前置检查均在 `bumpFile` 调用之前；空 tag 消息触发 `dieAfterCommit` 中止；commit 后 tag/push 失败有明确中文收尾提示。
- 按计划约束未实际执行 `npm run release`（执行会真打 tag/push 触发 release.yml），发版动作留用户后续手动验证。

## Deviations from Plan

None - plan executed exactly as written.

## Commits

- `aca2470` chore(quick-260519-pi1): add npm run release script

## Self-Check: PASSED

- FOUND: scripts/release.mjs
- FOUND: package.json (scripts.release 已注册)
- FOUND: commit aca2470
