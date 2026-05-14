# Release Guide

hakoniwa (gal-lib) 发布流程 — `git tag v* && git push --tags` 触发 GitHub Actions
自动 build + sign + upload。

## 一次性准备（仅首次发布前做一次）

### 1. 生成签名密钥对

Tauri updater 用 ed25519 签名验证下载的安装包，密钥用户本地生成、**永远不入仓库**：

```powershell
# 项目根目录运行
pnpm tauri signer generate -w "$env:USERPROFILE\.tauri\hakoniwa.key"
```

按提示输入密码（**记住这个密码**，CI 需要它来解密私钥）。命令输出：

- `~/.tauri/hakoniwa.key` — 私钥文件（**绝对不要 commit**）
- `~/.tauri/hakoniwa.key.pub` — 公钥（要粘进项目）

### 2. 把公钥写进 `src-tauri/tauri.conf.json`

打开 `~/.tauri/hakoniwa.key.pub`，复制**整个文件内容**（一串 base64），
粘到 `plugins.updater.pubkey`：

```json
"plugins": {
  "updater": {
    "endpoints": [
      "https://github.com/koitori77/gal-lib/releases/latest/download/latest.json"
    ],
    "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1Ymxp...粘这里...",
    "windows": { "installMode": "passive" }
  }
}
```

Commit 这个改动（公钥**可以**入仓库，私钥**绝对不可以**）。

### 3. 在 GitHub Secrets 配置私钥

仓库 → Settings → Secrets and variables → Actions → New repository secret，
分别添加两条：

| Name | Value |
|------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | `~/.tauri/hakoniwa.key` **整个文件的内容**（连同 `untrusted comment:` 头一起复制） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 第 1 步设的密码 |

## 每次发版

### 4. Bump 版本号（三处必须一致）

| 文件 | 字段 |
|------|------|
| `src-tauri/Cargo.toml` | `[package].version` |
| `src-tauri/tauri.conf.json` | top-level `version` |
| `package.json` | `version` |

提交 bump 自己：

```bash
git add src-tauri/Cargo.toml src-tauri/tauri.conf.json package.json
git commit -m "chore: bump version to v0.3.0"
```

### 5. 打 tag 并推送

```bash
git tag v0.3.0
git push origin master
git push origin v0.3.0
```

Tag 推上去后 GitHub Actions 会自动跑（约 20–40 分钟），完成后：

- GitHub 新建 release `hakoniwa v0.3.0`
- Release 资产包含：
  - `hakoniwa_0.3.0_x64-setup.exe` — Windows NSIS 安装包
  - `hakoniwa_0.3.0_x64-setup.exe.sig` — 签名
  - `latest.json` — updater 用的元数据
- 老版本用户启动 App 5 秒后会静默检查到新版本并下载

### 6. 验证

下载新发布的 `.exe` 装一台干净机器；或在已装旧版的机器启动 App，等 5 秒后
应该看到右下角 toast "更新已就绪 v0.3.0"。

## 故障排查

| 现象 | 原因 |
|------|------|
| Action 失败：`Could not parse signing key` | Secret 内容不全或换行被破坏 — 重新复制 `.key` 文件**整个内容**到 Secret |
| Action 失败：`bad password` | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 填错 |
| 客户端 check 静默失败（devtools console 报 `signature verification failed`）| `tauri.conf.json` 里的 `pubkey` 跟 CI 用的私钥不匹配 — 用 `pnpm tauri signer sign --help` 检查公钥 |
| 客户端 check 返回 404 | `latest.json` 不在 release 资产里 — 检查 workflow `includeUpdaterJson: true` 是否生效；或 release 还在 `draft` 状态 |
| 客户端 check 静默无反应 | 自动检查可能被用户关了：Settings → 关于 → 「启动时自动检查」 |

## 安全注意事项

- **私钥 (`.key` 文件) 绝对不要 commit 到仓库** — 加进 `.gitignore` 或放在
  仓库外（推荐 `~/.tauri/` 目录）。
- 公钥 (`.pub`) **可以**入仓库（嵌入 `tauri.conf.json` 是设计如此）。
- 如果私钥泄露：
  1. 重新生成一对密钥
  2. 更新 GitHub Secrets
  3. 把新公钥写入 `tauri.conf.json` 并 release 新版本
  4. **老用户必须手动下载安装** —— 因为他们装的版本验证用的是泄露的旧公钥

## 参考链接

- Tauri Updater 文档 — https://v2.tauri.app/plugin/updater/
- tauri-action — https://github.com/tauri-apps/tauri-action
- 更新流程内部实现 — `src/lib/updater.ts` + `src/App.tsx` 启动 hook +
  `src/components/settings/AboutSection.tsx` (Settings 关于区块)
