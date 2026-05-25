---
id: 260526-2f9
slug: cargo-dev-release-profile
type: quick
created: 2026-05-26
---

# Quick: Cargo dev-release profile（本地快编）

## Why

当前 `pnpm tauri build` 走 `[profile.release]`：`codegen-units=1` + `lto=true` + `incremental=false` + `opt-level="s"` —— 体积最优、但本地一次 release 构建 8~10 分钟。日常验证只需要"能跑、二进制能产出"，体积可以放宽。

## What

在 `src-tauri/Cargo.toml` 追加 `[profile.dev-release]`，继承 release 但放开并行 codegen / thin LTO / 增量编译 / opt-level 2，给本地验证用。**不动 release profile**，保证 `npm run release` 出包行为不变。

```toml
[profile.dev-release]
inherits = "release"
codegen-units = 16
lto = "thin"
incremental = true
opt-level = 2
```

## Verify

跑一次 `pnpm tauri build --profile dev-release --no-bundle` 确认：
1. cargo profile 被识别（无 `unknown profile` 错误）
2. 构建成功产出 exe
3. 记录耗时，与 release 对比（预期 2~3 倍提速；冷构建因依赖首编可能仍 5+ 分钟）

## Out of scope

- 不改默认 release profile
- 不改 `npm run release` / `scripts/release.mjs`
- 不加 npm script alias（先验证后再视情况补）
