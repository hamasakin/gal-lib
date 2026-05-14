---
quick_id: 260514-upd
slug: tauri-auto-update
date: 2026-05-14
status: complete
must_haves_satisfied: true
---

# Quick 260514-upd: Tauri 自动更新功能 — SUMMARY

## 交付清单

### 后端（Rust / Tauri）

- `src-tauri/Cargo.toml`
  - 版本 `0.1.0` → `0.2.0`
  - 新增 `tauri-plugin-updater = "2"` 和 `tauri-plugin-process = "2"`（后者用于
    `relaunch()`）
- `src-tauri/tauri.conf.json`
  - 顶层 `version` → `"0.2.0"`
  - `bundle.createUpdaterArtifacts: true`（CI 打包时产出 `.sig` + `latest.json`）
  - 新增 `plugins.updater`：endpoint 指向 `https://github.com/koitori77/gal-lib/releases/latest/download/latest.json`、
    `pubkey: ""` placeholder（**部署前用户填**）、Windows `installMode: "passive"`
- `src-tauri/capabilities/default.json`
  - 加 `updater:default`、`process:default`、`process:allow-restart`
- `src-tauri/src/lib.rs`
  - Builder 链加 `tauri_plugin_updater::Builder::new().build()` 和
    `tauri_plugin_process::init()`

### 前端（React / TypeScript）

- `package.json`
  - 版本 `0.1.0` → `0.2.0`
  - deps 加 `@tauri-apps/plugin-updater@^2` + `@tauri-apps/plugin-process@^2`
- `src/lib/updater.ts` **（新建）**
  - 导出 `checkForUpdates({silent, onProgress})` — 返回状态机
    `idle | checking | downloading | up-to-date | ready | error`
  - silent 模式吞错，console.warn；非 silent 返回 `error` state 携带 message
  - `downloadAndInstall()` 内部分发 progress 事件，调用方通过 `onProgress`
    订阅 chunk 进度
  - 导出 `relaunchApp()` 包装 plugin-process 的 `relaunch`
  - 导出 `getCurrentVersion()` 包装 `@tauri-apps/api/app#getVersion`
- `src/lib/preferences.ts`
  - 新增 `autoCheckUpdate: boolean` axis（默认 `true`）
  - `loadPreferences()` 兼容旧 localStorage（缺字段 → DEFAULT）
- `src/store/preferences.ts`
  - 新增 `setAutoCheckUpdate(v: boolean)` action；持久化经
    `applyPreferences` + `savePreferences`
- `src/App.tsx`
  - 新增 useEffect：启动后 `setTimeout(check, 5000)`，受 prefs 控制
  - check ready 触发 sonner toast：标题"更新已就绪 vX.Y.Z" + action「立即重启」
    调 `relaunchApp()`；duration `Infinity` 直到用户处理
- `src/routes/Settings.tsx`
  - SECTIONS 末尾追加 `about` 入口；render 一个 `<AboutSection />`
- `src/components/settings/AboutSection.tsx` **（新建）**
  - 三行：当前版本 / 检查更新按钮（带状态文本） / 自动检查 toggle
  - 检查中：disabled + "检查中…"；下载中：百分比；ready：按钮变"立即重启"
  - 错误显示在 state label，不弹 toast（避免与启动 toast 双重打扰）

### CI / 发版

- `.github/workflows/release.yml` **（新建）**
  - trigger: `on.push.tags: ['v*']`
  - runner: `windows-latest`，权限 `contents: write`
  - steps: checkout → pnpm 9 → Node 20 → Rust stable + Swatinem rust-cache →
    `pnpm install --frozen-lockfile` → `tauri-apps/tauri-action@v0` 含
    `includeUpdaterJson: true`
  - env: `GITHUB_TOKEN`、`TAURI_SIGNING_PRIVATE_KEY`、
    `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `docs/release.md` **（新建）**
  - 一次性准备：密钥生成、公钥写入、GitHub Secrets
  - 每次发版：bump 三处 version、tag push
  - 故障排查表
  - 安全注意（私钥不入仓库 / 密钥轮换的代价）

## 验证

| Gate | 命令 | 结果 |
|------|------|------|
| TypeScript | `pnpm tsc --noEmit` | ✅ 全绿（exit 0） |
| Vite build | `pnpm build` | ✅ 全绿（1960 modules, 2.83s） |
| Rust check | `cargo check` (in src-tauri) | ✅ 全绿（5 个 pre-existing warnings 无新增） |

## Must-haves 状态

- [x] tauri-plugin-updater v2 接通；endpoint 指 GH Releases latest.json
- [x] 启动 5s silent check；ready → toast + 用户决定重启
- [x] Settings 关于区块：版本 / 立即检查 / 启动自动检查 开关
- [x] `autoCheckUpdate` 持久化到 localStorage
- [x] tag push 触发 CI → tauri-action 全自动 build/sign/release
- [x] 公钥配置位 + 私钥放 GitHub Secrets 流程在 docs/release.md
- [x] 三处版本同步至 0.2.0（Cargo.toml / tauri.conf.json / package.json）

## 部署前置（用户必须自己做）

1. 创建 GitHub repo：`gh repo create koitori77/gal-lib --public --source=. --remote=origin --push`
2. 本地生成签名密钥：`pnpm tauri signer generate -w "$env:USERPROFILE\.tauri\hakoniwa.key"`
   （需要交互输入密码 — 必须用户亲自输）
3. 把公钥粘进 `src-tauri/tauri.conf.json` `plugins.updater.pubkey`
4. GitHub Settings → Secrets → 添加 `TAURI_SIGNING_PRIVATE_KEY` 和
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
5. commit pubkey 改动；`git tag v0.2.0 && git push origin master --tags`
6. 等 GitHub Actions 跑完（约 20–40 分钟），release 自动出现

## 局限 / 后续

- v0.2.0 是第一个"能被升级"的基线；用户必须先装 v0.2.0 才能受益于自动更新
  （v0.1.0 的老用户需要手动下 v0.2.0 装一次）
- 没做：增量更新、国内 CDN 镜像、强制更新策略
- 私钥泄露后果重 — 老用户无法自动迁移到新 pubkey，必须手动重装
- 当前 endpoint 写死 `https://github.com/koitori77/gal-lib/...`；如果以后改名
  /换组织，需要 release 一个 hotfix 版本指向新 endpoint，再发预定 release
