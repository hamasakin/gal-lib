---
quick_id: 260514-upd
slug: tauri-auto-update
date: 2026-05-14
status: in-progress
must_haves:
  truths:
    - Tauri 自动更新通过 tauri-plugin-updater (v2) 实现，endpoint 指向 GitHub Releases latest.json
    - 更新检查 + 下载在 App 启动后 5 秒静默触发；下载完成后 sonner toast 提示用户重启
    - Settings 页"关于"区块暴露当前版本 + 「立即检查更新」按钮 + 「启动时自动检查」开关
    - 自动检查开关持久化到 localStorage (prefs:autoCheckUpdate, 默认 true)
    - 发布通过 `git push --tags` (tag 形如 v*) 自动触发 GitHub Actions
    - GitHub Actions workflow 用 Tauri Action 完成 build + sign + release artifact 上传 + latest.json 生成
    - 签名密钥用户本地生成 (`pnpm tauri signer generate`)，私钥放 GitHub Secrets，公钥写进 tauri.conf.json
  artifacts:
    - src-tauri/Cargo.toml (tauri-plugin-updater 依赖 + version 0.2.0)
    - src-tauri/tauri.conf.json (plugins.updater 配置 + version 0.2.0 + pubkey 字段)
    - src-tauri/capabilities/default.json (updater 权限)
    - src-tauri/src/lib.rs (注册 updater plugin)
    - package.json (version 0.2.0 + 两个新 plugin 依赖)
    - src/lib/updater.ts (新建：check/download/relaunch 封装 + 状态机)
    - src/lib/preferences.ts (新增 autoCheckUpdate axis)
    - src/App.tsx (启动 hook：5s 后 silent check 受 prefs 控制)
    - src/routes/Settings.tsx (新增"关于"区块)
    - .github/workflows/release.yml (CI 发布流程)
    - docs/release.md (发版操作手册)
  key_links:
    - Tauri Updater plugin v2 docs: https://v2.tauri.app/plugin/updater/
    - tauri-action: https://github.com/tauri-apps/tauri-action
---

# Quick 260514-upd: Tauri 自动更新功能 (GitHub Releases 分发)

## 目标

让 hakoniwa 启动时静默检查 + 下载 GitHub Releases 上的新版本，下载完成后右下角 toast 提示
"v X.Y.Z 已就绪 · [立即重启] [稍后]"。用户主动入口走 Settings 页"关于"区块。
发布走 `git tag v* && git push --tags` 触发 GitHub Actions 自动 build + sign + release。

## 关键决策（已确认）

- **更新行为**：静默下载 + 用户决定重启时机（不强制）
- **触发方式**：tag push 自动；CI 用 tauri-apps/tauri-action
- **UI 入口**：启动自动 check (5s delay) + Settings 手动按钮 + 自动检查开关
- **分发**：GitHub Releases (public repo)；不做镜像
- **签名**：Tauri 标准 ed25519；密钥用户本地一次性生成
- **首发版本**：0.2.0（作为第一个能被升级的基线）

## Tasks

### Task 1: Backend — updater plugin + version 0.2.0

**Files:**
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/lib.rs`

**Action:**
1. Cargo.toml：`[dependencies]` 加 `tauri-plugin-updater = "2"`；package.version `0.1.0` → `0.2.0`
2. tauri.conf.json：top-level `version` → `"0.2.0"`；新增 `plugins.updater` 对象，含 `endpoints`、`pubkey`（placeholder 空串，待用户填）、Windows `installMode: "passive"`
3. capabilities/default.json：`permissions` 加 `"updater:default"`
4. lib.rs：在其他 plugin 链上加 `.plugin(tauri_plugin_updater::Builder::new().build())`

**Verify:**
- `cargo check --manifest-path src-tauri/Cargo.toml` 通过（容许 unused 警告）

**Done:**
- 三处版本号一致为 0.2.0；Rust 注册了 updater plugin；capability 加入对应权限

### Task 2: Frontend — updater.ts + App boot hook + Settings UI

**Files:**
- `package.json`
- `src/lib/updater.ts` (新)
- `src/lib/preferences.ts`
- `src/App.tsx`
- `src/routes/Settings.tsx`

**Action:**
1. package.json：bump 0.1.0 → 0.2.0；deps 加 `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process` (均 ^2)
2. `src/lib/updater.ts`：导出 `checkForUpdates(opts: { silent: boolean })` 返回 `{state, version?, error?}`；导出 `relaunchApp()`；状态机：`idle | checking | downloading | ready | up-to-date | error`
3. preferences.ts：`Preferences` 加 `autoCheckUpdate: boolean`；DEFAULT_PREFS 设 `true`；isAutoCheckUpdate 校验；序列化 + read 兼容旧 localStorage
4. App.tsx：useEffect 启动后 `setTimeout(() => silent check, 5000)`；prefs.autoCheckUpdate === false 跳过；ready 状态触发 toast：标题 "更新已就绪 v X.Y.Z" + action "立即重启" 调 relaunchApp，dismiss "稍后"
5. Settings.tsx：新增"关于"section（最后一个），含 4 行：当前版本（从 `getVersion` API）、Bangumi/VNDB 致谢、「立即检查更新」按钮（带状态：检查中 → 下载中 → 已就绪 → 已是最新 → 出错）、「启动时自动检查」开关

**Verify:**
- `pnpm tsc --noEmit` 全绿
- `pnpm build` 全绿

**Done:**
- updater.ts 行为状态完整；Settings 关于区块 UI 完整；自动检查开关持久化

### Task 3: CI — release.yml + docs/release.md

**Files:**
- `.github/workflows/release.yml` (新)
- `docs/release.md` (新)

**Action:**
1. release.yml：
   - `on.push.tags: ['v*']`
   - `jobs.publish-tauri`：windows-latest，权限 `contents: write`
   - steps：checkout → setup-node 20 + pnpm → setup-rust stable → `pnpm install` → `tauri-apps/tauri-action@v0` with releaseName `hakoniwa v__VERSION__`、releaseDraft false、prerelease false、`includeUpdaterJson: true`
   - env：`GITHUB_TOKEN`、`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
2. docs/release.md：
   - 第一次发版准备：`pnpm tauri signer generate -w ~/.tauri/hakoniwa.key`、把公钥粘进 tauri.conf.json、把私钥+密码塞进 GitHub Secrets
   - 每次发版步骤：bump version（三处）→ commit → `git tag v0.x.y` → `git push --tags`
   - 故障排查：updater check 静默失败的原因（无网/无 release/pubkey 不匹配/签名不匹配）

**Verify:**
- workflow.yml 通过 `yamllint`（如可用）或 GitHub 语法解析
- docs/release.md 可执行

**Done:**
- CI 文件就位；发版手册可独立操作

### Task 4: Build & gates

**Action:**
1. `pnpm install`（拉新 updater + process 包）
2. `pnpm tsc --noEmit` 必须全绿
3. `pnpm build` 必须全绿
4. `cargo check --manifest-path src-tauri/Cargo.toml`（容许 pre-existing warnings）

**Done:**
- 三道闸全过

### Task 5: SUMMARY + STATE + commit

**Action:**
1. 写 `260514-upd-SUMMARY.md`（status: complete）
2. `.planning/STATE.md` "Quick Tasks Completed" 追加一行
3. commit：所有代码改动一个 commit `quick(260514-upd): tauri auto-update + GH release workflow`；docs 一个 commit `docs(quick-260514-upd): PLAN + SUMMARY + STATE`

**Done:**
- 两个 atomic commits 落地

## 不做

- 不做增量更新
- 不做国内 CDN 镜像
- 不做强制更新
- 不在本任务跑 cargo build (release)；首次完整 release 走 CI

## 部署阶段（后续）

代码完成后再走：
1. `gh repo create koitori77/gal-lib --public --source=. --remote=origin --push`
2. 用户本地 `pnpm tauri signer generate` (交互输入密码)
3. 用户填 pubkey 到 tauri.conf.json + GitHub Secrets
4. commit pubkey + `git tag v0.2.0 && git push --tags`
