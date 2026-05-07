---
phase: 02-library-ingest
plan: 02b
subsystem: metadata
tags: [title-cleaning, bangumi-client, vndb-client, rate-limiter, fuzzy-match]
requires: [02a]
provides:
  - title_clean_pipeline
  - metadata_module
  - bangumi_client
  - vndb_client
  - rate_limiter
  - match_score_levenshtein
affects:
  - src-tauri/src/title_clean.rs
  - src-tauri/src/metadata/mod.rs
  - src-tauri/src/metadata/types.rs
  - src-tauri/src/metadata/match_score.rs
  - src-tauri/src/metadata/limiter.rs
  - src-tauri/src/metadata/bangumi.rs
  - src-tauri/src/metadata/vndb.rs
  - src-tauri/src/lib.rs
tech-stack:
  added: []
  patterns:
    - regex-pipeline-via-once-cell-lazy
    - per-source-rate-limiter-singleton (governor token-bucket)
    - exponential-backoff-retry (1s/2s/4s) for 5xx/429/network only
    - levenshtein-normalized-confidence (0-100)
key-files:
  created:
    - src-tauri/src/title_clean.rs
    - src-tauri/src/metadata/mod.rs
    - src-tauri/src/metadata/types.rs
    - src-tauri/src/metadata/match_score.rs
    - src-tauri/src/metadata/limiter.rs
    - src-tauri/src/metadata/bangumi.rs
    - src-tauri/src/metadata/vndb.rs
  modified:
    - src-tauri/src/lib.rs
decisions:
  - "Title cleaning: 5-step regex pipeline (paren / noise / prefix / trail-date / whitespace), once_cell::Lazy compile-once"
  - "Bangumi UA = `gal-lib/0.1.0 (https://github.com/gal-lib/gal-lib)` to bypass 403"
  - "VNDB endpoint = api.vndb.org/kana/vn (Kana API), POST with filters/fields"
  - "Rate limits: Bangumi 1 req/s, VNDB 100 req/min via governor singleton"
  - "Retry: exp-backoff [1s, 2s, 4s] x3 for 5xx/429/network; 4xx (except 429) immediate fail"
  - "Confidence score: Levenshtein normalized; >=0.8 sim → 70..=99, exact → 100"
metrics:
  start: 2026-05-07
  completed: 2026-05-07
---

# Phase 2 Plan 02b: Title Cleaning + Bangumi/VNDB Clients + Rate Limiter Summary

**One-liner:** 落地 metadata 子系统纯逻辑层 — title 清洗 + Levenshtein 模糊评分 + Bangumi/VNDB 双源 client + governor 限速器 + 指数退避重试；02d 编排器消费这些模块。

## Tasks Completed

### Task 1: title_clean.rs — 5-step regex pipeline + 6 unit tests (commit `31b2a3a`)

- `src-tauri/src/title_clean.rs` (NEW) — 实现 `clean_title(raw: &str) -> String`，5 步固定顺序：
  1. **Strip parenthesized**: 全角 `（）` + ASCII `()` 内容（`RE_PAREN`）
  2. **Strip noise**: `汉化版|繁/简体|完整版|修正版|体験/体验版|全年龄/全年齢版|DL版|Steam版|Patch|Crack|v\d+(\.\d+)*|月发售` (case-insensitive, `RE_NOISE`)
  3. **Strip prefix**: 开头 1-6 个汉字/片假名/拉丁字母 + `_-:` 分隔符（`RE_PREFIX`，使用 `\p{Han}\p{Katakana}` Unicode 类）
  4. **Strip trailing date**: `YYYY[.-]?MM[.-]?DD` 末尾（`RE_TRAIL_DATE`）
  5. **Whitespace**: 全角空格 → 半角，`split_whitespace().join(" ")` 折叠，trim
- 4 个 `once_cell::sync::Lazy<Regex>` 编译期常量，运行时零分配开销
- `mod title_clean;` 追加到 `src-tauri/src/lib.rs`（仅模块声明，零 command 注册）
- 6 unit tests 全绿:
  - `strips_parenthesized_versions` — `Fate/stay night (汉化版) (v1.5)` → `Fate/stay night`
  - `strips_publisher_prefix` (×2) — `天使汉化_FateStayNight` → `FateStayNight` ; `ABC社 - クロスチャンネル` → `クロスチャンネル`
  - `strips_noise_tokens` — `Saya no Uta 完整版 v2.0` → `Saya no Uta`
  - `strips_trailing_date` — `Steins;Gate 2009.10.15` → `Steins;Gate`
  - `collapses_whitespace_and_fullwidth` — `  CLANNAD　　 全年龄版  ` → `CLANNAD`
  - `empty_input_safe` — `""` → `""`

### Task 2: metadata/ module — types + match_score + limiter + bangumi + vndb clients (commit `3067c86`)

- **`src-tauri/src/metadata/mod.rs`** (NEW) — module root；声明 5 个子模块（bangumi / limiter / match_score / types / vndb）+ 重新导出 `Candidate / MetadataDetail / MetadataError / MetadataSource`
- **`src-tauri/src/metadata/types.rs`** (NEW) — 共享数据类型：
  - `MetadataSource` 枚举（Bangumi / Vndb / Manual / None；serde rename_all="lowercase" 用于 `games.metadata_source` 列）
  - `Candidate { source, source_id, title, alias, cover_url, release_date, summary, confidence }`（confidence: u8, 0..=100）
  - `MetadataDetail { source, source_id, title, title_cn, cover_url, summary, release_date }`
  - `MetadataError` thiserror 枚举（Http via `#[from] reqwest::Error` / RateLimited / NotFound / Malformed / Io via `#[from] std::io::Error`）
- **`src-tauri/src/metadata/match_score.rs`** (NEW) — Levenshtein-normalized 0-100 评分；包含三个评分通道：
  1. **Exact match**（normalize 后相等）→ 100
  2. **Containment bonus** —— 一边完全包含另一边 → 70 + (short_len/long_len * 29) — 解决 galgame "CLANNAD" vs "CLANNAD - 全年齢版" 这种长后缀场景
  3. **Levenshtein normalized**：sim ≥ 0.8 映射到 70..=99，sim < 0.8 映射到 0..69（cap 防止跨 tier）
  - normalize: lowercase + strip whitespace + strip `／/-_:.&!?～~`
  - 5 unit tests 全绿（exact / case+whitespace tolerant / fuzzy_high / unrelated_low / empty inputs）
- **`src-tauri/src/metadata/limiter.rs`** (NEW) — governor token-bucket per-source singleton：
  - `BANGUMI`: `Quota::per_second(1)` —— 1 req/s
  - `VNDB`: `Quota::per_minute(100)` —— 100 req/min
  - 两个 `wait_*()` async helpers (`until_ready().await`) 让 client 在发请求前阻塞
- **`src-tauri/src/metadata/bangumi.rs`** (NEW) — Bangumi v0 API client：
  - `search(query)` → `POST https://api.bgm.tv/v0/search/subjects` body `{keyword, filter:{type:[4]}}`，返回 top-5 Candidates；置信度由 `match_score::score(query, hit.name)` 计算
  - `fetch_detail(id)` → `GET https://api.bgm.tv/v0/subjects/{id}`
  - **User-Agent = `gal-lib/0.1.0 (https://github.com/gal-lib/gal-lib)`** —— Bangumi 默认 UA 返 403
  - 15s 总超时；title 优先取 `name_cn`（非空 fallback name）
  - `with_retry`：5xx / 429 / 网络错误 → exp-backoff [1s/2s/4s] x 3 次；4xx (除 429) 立即失败
- **`src-tauri/src/metadata/vndb.rs`** (NEW) — VNDB Kana API client：
  - 端点 `POST https://api.vndb.org/kana/vn`
  - `search(query)`: filters `["search", "=", query]` + fields `id,title,titles{title,lang},image{url},description,released` + results 5
  - `fetch_detail(vndb_id)`: filters `["id", "=", vndb_id]`；title_cn 从 `titles[]` 中找 `lang in ["zh-Hans", "zh-Hant"]`
  - 同款 `with_retry`（与 bangumi.rs 一致）
- **`src-tauri/src/lib.rs`** — 仅追加 `mod metadata;` `mod title_clean;` 两行（按计划字面执行；无 command 注册，02d 处理）
- 验证：
  - `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0（38 个 dead-code warnings 是预期 —— 这些 fn 直到 02d/02e/02f 才有调用方）
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **16/16 passed**（4 既有：data_dir + db v1/v2 ; 6 title_clean ; 5 match_score ; 1 bangumi compile-only）

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] match_score.rs 计划期望与算法不匹配**

- **Found during:** Task 2 — `cargo test --lib` 失败 1 个
- **Issue:** Plan 中的 `fuzzy_high_score` 测试期望 `score("CLANNAD", "CLANNAD - 全年齢版") >= 70`，但纯 Levenshtein 归一化只能给出 44（query 7 chars vs candidate 11 chars，dist 4，sim = 1 - 4/11 = 0.636 < 0.8 阈值）。这是真实评分缺陷 —— galgame 候选标题经常带 `- 全年齢版` `(初回限定版)` 等后缀，纯 Levenshtein 会让"前缀完全匹配但后缀有 suffix 标签"的合理候选低于 META-07 锁定的 ≥80 自动绑定阈值。
- **Fix:** 在 Levenshtein 之前加 **containment bonus 通道**：当一边完全 substring-contains 另一边时，按 `coverage = short_len / long_len` 映射到 70..=99 区间。维持了 CONTEXT 锁定的"模糊匹配 ≥ 70"语义；exact match 仍优先返回 100；不影响"无关字串 < 50"语义（CONTAINMENT 不触发）。
- **Files modified:** `src-tauri/src/metadata/match_score.rs`（在 score 函数里加了 13 行的 containment bonus 通道；其余逻辑保持）
- **Commit:** `3067c86`

**2. [Rule 1 - Bug] match_score.rs 中 `(sim * 70.0) as u8.min(69)` 优先级错误**

- **Found during:** Task 2 — plan 给出的代码原样写入会编译失败
- **Issue:** Plan 文本 `(sim * 70.0) as u8.min(69)` —— Rust 中 `as` 比方法调用优先级低，等价于 `((sim * 70.0) as u8).min(69)` ✓ 但实际上 `.min(69)` 的字面 69 是 `i32`，与 `u8` 类型不匹配，会报 mismatched types。
- **Fix:** 改用显式 `if raw > 69 { 69 } else { raw }`（保持 cap @ 69 的语义）。
- **Files modified:** `src-tauri/src/metadata/match_score.rs`
- **Commit:** `3067c86`（与 #1 合并）

**3. [Rule 1 - Bug] `with_retry` 中 `matches!` macro 与 if-guard 共用 binding 编译失败**

- **Found during:** Task 2 — plan 给出的代码原样写入会编译失败
- **Issue:** Plan 文本 `matches!(&e, MetadataError::Http(he) if he.status()...)` —— `matches!` 宏支持 if-guard 但 guard 中绑定 `he` 在某些 Rust 版本/MSRV 上行为不稳，且 `matches!` 返回 bool 后无法用 `he` 做后续操作。
- **Fix:** 改用显式 `match &e { MetadataError::Http(he) => ..., _ => false }` —— 语义等价，更清晰，跨两个 client 文件保持一致。
- **Files modified:** `src-tauri/src/metadata/bangumi.rs`、`src-tauri/src/metadata/vndb.rs`
- **Commit:** `3067c86`

**4. [Rule 2 - Critical functionality] title_clean RE_PREFIX 范围扩展**

- **Found during:** Task 1 — plan 给出 `^[一-鿿A-Za-z]{1,4}\s*[\-_:]\s*` 直接用于测试 `天使汉化_FateStayNight` 时不匹配（Unicode 字符类问题 + 4 char 上限太严）
- **Issue:** "天使汉化" 是 4 个汉字，紧贴 `_` 没有 `\s*` 空格，且 `[一-鿿A-Za-z]` 的字面字符类范围在 regex crate 中行为依赖 unicode feature。改用 `\p{Han}\p{Katakana}A-Za-z` 显式 Unicode 类，并把上限放到 6 适配"雷竹工作室"等 4-5 字汉化组前缀。
- **Fix:** `^[\p{Han}\p{Katakana}A-Za-z]{1,6}\s*[\-_:]\s*`；同时 `RE_NOISE` 加入 `全年龄版|全年齢版`（计划 `collapses_whitespace_and_fullwidth` 测试期望 `CLANNAD　　 全年龄版` → `CLANNAD`，原 plan 的 noise 列表没有"全年龄版"）。
- **Files modified:** `src-tauri/src/title_clean.rs`
- **Commit:** `31b2a3a`

### Auth Gates

无（纯逻辑层；Bangumi/VNDB 公共 read-only API 不需要 token）。

### Deferred Issues

无。

## Threat Flags

无（纯逻辑层；HTTP client 使用 rustls-tls + 15s 超时 + 已有 retry/backoff 防 DoS 自身；UA 标识符暴露是设计意图，不是泄露）。

## Self-Check

### Files

- [x] `src-tauri/src/title_clean.rs` exists; contains `pub fn clean_title` ✓
- [x] `src-tauri/src/metadata/mod.rs` exists; declares 5 sub-modules ✓
- [x] `src-tauri/src/metadata/types.rs` exists; contains `MetadataSource` / `Candidate` / `MetadataDetail` / `MetadataError` ✓
- [x] `src-tauri/src/metadata/match_score.rs` exists; contains `pub fn score` ✓
- [x] `src-tauri/src/metadata/limiter.rs` exists; contains `Quota::per_second` + `Quota::per_minute` ✓
- [x] `src-tauri/src/metadata/bangumi.rs` exists; contains `api.bgm.tv/v0/search/subjects` + `gal-lib/0.1.0` UA ✓
- [x] `src-tauri/src/metadata/vndb.rs` exists; contains `api.vndb.org/kana/vn` ✓
- [x] `src-tauri/src/lib.rs` updated; contains `mod metadata` + `mod title_clean` ✓

### Build / Test

- [x] `cargo check --manifest-path src-tauri/Cargo.toml` → exit 0 ✓
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib` → **16/16 passed** ✓
  - 4 既有：data_dir build_db_url + ensure_creates + db migrations_v1 + db migrations_v2
  - 6 title_clean: paren / prefix / noise / trail-date / whitespace / empty
  - 5 match_score: exact / case+whitespace / fuzzy_high / unrelated_low / empty
  - 1 bangumi: module_compiles

### Commits

- [x] `31b2a3a` feat(02-02b): add title_clean module + tests ✓
- [x] `3067c86` feat(02-02b): add metadata module — bangumi + vndb + limiter + match_score ✓

## Self-Check: PASSED

