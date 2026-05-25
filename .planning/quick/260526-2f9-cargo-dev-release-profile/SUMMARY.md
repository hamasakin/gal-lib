---
id: 260526-2f9
slug: cargo-dev-release-profile
type: quick
status: complete
date: 2026-05-26
---

# Quick 260526-2f9 — Cargo dev-release profile（本地快编）

## What changed

`src-tauri/Cargo.toml` 追加 `[profile.dev-release]`，继承 release 但放开并行 codegen / thin LTO / 增量编译，给本地手动验证用。**未触碰 `[profile.release]`，发版行为 100% 不变。**

```toml
[profile.dev-release]
inherits = "release"
codegen-units = 16
lto = "thin"
incremental = true
opt-level = 2
```

## How to use

```bash
pnpm tauri build --no-bundle -- --profile dev-release
```

⚠ Tauri 2 CLI 不直接吃 `--profile`，要用 `--` 把它转给 cargo（详见验证段落里失败的第一次尝试）。

产出：`src-tauri/target/dev-release/gal-lib.exe`。

## Verification

| 指标 | dev-release | release（上次发版 5/7）|
|------|-------------|------------------------|
| 总耗时（壁钟） | **108 秒** | 用户感知 ~10 分钟 |
| cargo 自报 | `1m 39s` | — |
| 产出 exe 大小 | 15.2 MB | 8.0 MB |
| 退出码 | 0 | — |

**注意公平性**：本次 dev-release 构建是「该 profile 首次跑」，但 `target/` 已有 release profile 的 fingerprint，cargo 在依赖 unit 上可能有部分缓存命中；下次完全冷构建（如 `cargo clean` 后）仍预期比 release 显著快，但绝对值可能比 108s 长。

警告：6 个 pre-existing 死代码 warning（`OrchError::AlreadyActive`、`MetadataError::RateLimited`、`ScanOutcome::removed_dirs` 等），与本次改动无关。

## Out of scope（已记录，未做）

- 没改 `[profile.release]` — 发版仍走压缩优先，单次 ~10 分钟（用户后续追问是否也要优化，待主对话决策）
- 没加 npm script alias（`pnpm dev-build` 之类），现阶段命令短到可以直接敲
- 没在 README/docs 加用法说明（小动作，等用户用顺手了再补）
