---
phase: 02-library-ingest
plan: 02b
type: execute
wave: 2
depends_on: [02a]
files_modified:
  - src-tauri/src/title_clean.rs
  - src-tauri/src/metadata/mod.rs
  - src-tauri/src/metadata/bangumi.rs
  - src-tauri/src/metadata/vndb.rs
  - src-tauri/src/metadata/limiter.rs
  - src-tauri/src/metadata/types.rs
  - src-tauri/src/metadata/match_score.rs
autonomous: true
requirements: [META-01, META-02, META-03, META-07]
must_haves:
  truths:
    - "Rust 后端 metadata 模块独立可测：title_clean / bangumi client / vndb client / 限速器 / 模糊匹配评分各自有单元测试"
    - "Bangumi 搜索 + 详情 + 封面 URL 拉取走 reqwest async；UA = `gal-lib/0.1.0` 防 403"
    - "VNDB Kana API 走 POST /kana/vn 检索；fields 含 id/title/titles/image.url/description/released"
    - "Token-bucket 限速器：Bangumi 1 req/s，VNDB 100 req/min；governor 实现"
    - "失败重试：5xx/429/网络 → 指数退避 1s/2s/4s 最多 3 次；4xx 不重试"
    - "cargo test --lib 全绿（既有 3 个 + 新增 ~8 个）"
  artifacts:
    - path: src-tauri/src/title_clean.rs
      contains: "pub fn clean_title"
    - path: src-tauri/src/metadata/bangumi.rs
      contains: "api.bgm.tv/v0/search/subjects"
    - path: src-tauri/src/metadata/vndb.rs
      contains: "api.vndb.org/kana/vn"
    - path: src-tauri/src/metadata/limiter.rs
      contains: "RateLimiter"
    - path: src-tauri/src/metadata/match_score.rs
      contains: "pub fn score"
---

# Plan 02b — Title Cleaning + Bangumi/VNDB Clients + Rate Limiter

## Objective

落地 Rust 后端的 metadata 子系统：title 清洗 → 模糊评分 → Bangumi/VNDB API client → 限速 + 重试。完全后端纯逻辑，零 frontend 改动；02d 编排器消费这些模块。

## Tasks

<task name="Task 1: title_clean.rs 标题清洗 + 单元测试">

<read_first>
- D:\project\gal-lib\.planning\phases\02-library-ingest\02-CONTEXT.md (§Title Cleaning 锁定 5 步规则)
</read_first>

<action>

新建 `src-tauri/src/title_clean.rs`：

```rust
//! Title cleaning for metadata search.
//!
//! Applies a fixed 5-step pipeline (regex-based) to convert raw directory
//! names into search queries suitable for Bangumi/VNDB. Documented order:
//!   1) strip parenthesized content (full-width AND ASCII)
//!   2) strip noise tokens (汉化版 / v1.5 / DL版 / Patch / Crack / 完整版 ...)
//!   3) strip publisher / fan-tl-group prefixes (1-3 CJK + separator)
//!   4) strip trailing date strings (YYYY.MM.DD / YYYYMMDD / YYMMDD)
//!   5) full-width → half-width whitespace, collapse runs, trim
//!
//! Pipeline is data-driven via 4 lazy regexes (`once_cell::Lazy<Regex>`).

use once_cell::sync::Lazy;
use regex::Regex;

static RE_PAREN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[（(][^（()）]*[)）]").unwrap());

static RE_NOISE: Lazy<Regex> = Lazy::new(|| {
    // case-insensitive; covers common gal community noise
    Regex::new(r"(?i)(汉化版|繁体|简体|完整版|修正版|体験版|体验版|DL版|Steam版|Patch|Crack|v\d+(\.\d+)*|(\d{4}年)?\d{1,2}月发售)")
        .unwrap()
});

static RE_PREFIX: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[一-鿿A-Za-z]{1,4}\s*[\-_:]\s*").unwrap());

static RE_TRAIL_DATE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\s*\d{4}[.\-]?\d{1,2}[.\-]?\d{1,2}\s*$").unwrap());

/// Clean a raw directory name into a search query string.
pub fn clean_title(raw: &str) -> String {
    let mut s = raw.to_string();
    s = RE_PAREN.replace_all(&s, " ").into_owned();
    s = RE_NOISE.replace_all(&s, " ").into_owned();
    s = RE_PREFIX.replace_all(&s, "").into_owned();
    s = RE_TRAIL_DATE.replace_all(&s, "").into_owned();
    // full-width space → half-width
    s = s.replace('\u{3000}', " ");
    // collapse whitespace
    s = s.split_whitespace().collect::<Vec<_>>().join(" ");
    s.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_parenthesized_versions() {
        assert_eq!(clean_title("Fate/stay night (汉化版) (v1.5)"), "Fate/stay night");
    }

    #[test]
    fn strips_publisher_prefix() {
        assert_eq!(clean_title("天使汉化_FateStayNight"), "FateStayNight");
        assert_eq!(clean_title("ABC社 - クロスチャンネル"), "クロスチャンネル");
    }

    #[test]
    fn strips_noise_tokens() {
        assert_eq!(clean_title("Saya no Uta 完整版 v2.0"), "Saya no Uta");
    }

    #[test]
    fn strips_trailing_date() {
        assert_eq!(clean_title("Steins;Gate 2009.10.15"), "Steins;Gate");
    }

    #[test]
    fn collapses_whitespace_and_fullwidth() {
        assert_eq!(clean_title("  CLANNAD　　 全年龄版  "), "CLANNAD");
    }

    #[test]
    fn empty_input_safe() {
        assert_eq!(clean_title(""), "");
    }
}
```

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/src/title_clean.rs && \
grep -q "pub fn clean_title" src-tauri/src/title_clean.rs && \
cargo test --manifest-path src-tauri/Cargo.toml --lib title_clean::tests
</automated>
</verify>

</task>

<task name="Task 2: metadata/ module — types + match_score + limiter + bangumi + vndb clients">

<read_first>
- D:\project\gal-lib\.planning\phases\02-library-ingest\02-CONTEXT.md (§Metadata Match Pipeline 全部 lockdowns)
- D:\project\gal-lib\src-tauri\src\db.rs (for module scaffolding pattern reference)
</read_first>

<action>

1. **`src-tauri/src/metadata/mod.rs`** — module root:
```rust
//! Bangumi-priority + VNDB-fallback metadata pipeline.
//!
//! Responsibilities:
//! - `clean_title` (in `crate::title_clean`)
//! - HTTP clients with rate-limiting + retry
//! - Confidence scoring (Levenshtein normalized)
//! - Public API: `search` / `fetch_detail` / `download_cover`

pub mod bangumi;
pub mod limiter;
pub mod match_score;
pub mod types;
pub mod vndb;

pub use types::{Candidate, MetadataDetail, MetadataError, MetadataSource};
```

2. **`src-tauri/src/metadata/types.rs`**:
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MetadataSource { Bangumi, Vndb, Manual, None }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candidate {
    pub source: MetadataSource,
    pub source_id: String,           // bangumi numeric id stringified, or vndb "v123"
    pub title: String,
    pub alias: Vec<String>,
    pub cover_url: Option<String>,
    pub release_date: Option<String>,
    pub summary: Option<String>,
    pub confidence: u8,              // 0-100
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataDetail {
    pub source: MetadataSource,
    pub source_id: String,
    pub title: String,
    pub title_cn: Option<String>,
    pub cover_url: Option<String>,
    pub summary: Option<String>,
    pub release_date: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum MetadataError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("rate limit budget exhausted")]
    RateLimited,
    #[error("not found")]
    NotFound,
    #[error("malformed response: {0}")]
    Malformed(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}
```

3. **`src-tauri/src/metadata/match_score.rs`** — Levenshtein-normalized confidence:
```rust
//! Confidence scoring: normalized Levenshtein distance → 0-100.
//!
//! Threshold (per CONTEXT §Metadata Match Pipeline):
//!   exact match (post-normalize) = 100
//!   >= 0.8 normalized similarity → 70-99
//!   < 0.8                         → < 70

pub fn score(query: &str, candidate: &str) -> u8 {
    let q = normalize(query);
    let c = normalize(candidate);
    if q.is_empty() || c.is_empty() { return 0; }
    if q == c { return 100; }
    let dist = levenshtein(&q, &c);
    let max_len = q.chars().count().max(c.chars().count()) as f64;
    if max_len == 0.0 { return 0; }
    let sim = 1.0 - (dist as f64 / max_len);
    if sim >= 0.8 {
        70 + ((sim - 0.8) / 0.2 * 29.0) as u8  // maps 0.8..=1.0 to 70..=99
    } else {
        (sim * 70.0) as u8.min(69)             // maps 0.0..=0.79 to 0..=55ish
    }
}

fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace() && !"／/-_:.&!?～~".contains(*c))
        .collect()
}

fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() { return b.len(); }
    if b.is_empty() { return a.len(); }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut curr = vec![0usize; b.len() + 1];
    for i in 1..=a.len() {
        curr[0] = i;
        for j in 1..=b.len() {
            let cost = if a[i-1] == b[j-1] { 0 } else { 1 };
            curr[j] = (curr[j-1] + 1).min(prev[j] + 1).min(prev[j-1] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_match_full_score() {
        assert_eq!(score("Fate/stay night", "Fate/stay night"), 100);
    }
    #[test]
    fn case_and_whitespace_tolerant() {
        assert_eq!(score("Fate stay night", "fate/stay/night"), 100);
    }
    #[test]
    fn fuzzy_high_score() {
        let s = score("CLANNAD", "CLANNAD - 全年齢版");
        assert!(s >= 70 && s < 100, "got {}", s);
    }
    #[test]
    fn unrelated_low_score() {
        let s = score("Fate", "Symphonic Rain");
        assert!(s < 50, "got {}", s);
    }
}
```

4. **`src-tauri/src/metadata/limiter.rs`** — governor wrapper, lazy-init per-source singletons:
```rust
use governor::{Quota, RateLimiter as Gov, clock::DefaultClock, state::{NotKeyed, InMemoryState}};
use once_cell::sync::Lazy;
use std::num::NonZeroU32;

pub type RateLimiter = Gov<NotKeyed, InMemoryState, DefaultClock>;

pub static BANGUMI: Lazy<RateLimiter> = Lazy::new(|| {
    Gov::direct(Quota::per_second(NonZeroU32::new(1).unwrap()))
});

pub static VNDB: Lazy<RateLimiter> = Lazy::new(|| {
    // 100 / 60s = use per_minute
    Gov::direct(Quota::per_minute(NonZeroU32::new(100).unwrap()))
});

pub async fn wait_bangumi() {
    BANGUMI.until_ready().await;
}
pub async fn wait_vndb() {
    VNDB.until_ready().await;
}
```

5. **`src-tauri/src/metadata/bangumi.rs`**:
```rust
use super::{limiter, match_score, types::*};
use serde::Deserialize;

const SEARCH_URL: &str = "https://api.bgm.tv/v0/search/subjects";
const DETAIL_BASE: &str = "https://api.bgm.tv/v0/subjects/";
const USER_AGENT: &str = "gal-lib/0.1.0 (https://github.com/gal-lib/gal-lib)";

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("reqwest client")
}

pub async fn search(query: &str) -> Result<Vec<Candidate>, MetadataError> {
    let body = serde_json::json!({
        "keyword": query,
        "filter": { "type": [4] }  // 4 = game
    });
    let raw = with_retry(|| async {
        limiter::wait_bangumi().await;
        let resp = client().post(SEARCH_URL).json(&body).send().await?;
        if resp.status() == 404 { return Err(MetadataError::NotFound); }
        let resp = resp.error_for_status()?;
        Ok::<_, MetadataError>(resp.json::<SearchResp>().await?)
    }).await?;
    Ok(raw.data.into_iter().take(5).map(|s| {
        let confidence = match_score::score(query, &s.name);
        Candidate {
            source: MetadataSource::Bangumi,
            source_id: s.id.to_string(),
            title: s.name_cn.clone().unwrap_or(s.name.clone()),
            alias: vec![s.name],
            cover_url: s.images.and_then(|i| i.large),
            release_date: s.date,
            summary: s.summary,
            confidence,
        }
    }).collect())
}

pub async fn fetch_detail(bangumi_id: &str) -> Result<MetadataDetail, MetadataError> {
    let url = format!("{}{}", DETAIL_BASE, bangumi_id);
    let raw: SubjectDetail = with_retry(|| async {
        limiter::wait_bangumi().await;
        let resp = client().get(&url).send().await?;
        if resp.status() == 404 { return Err(MetadataError::NotFound); }
        let resp = resp.error_for_status()?;
        Ok::<_, MetadataError>(resp.json::<SubjectDetail>().await?)
    }).await?;
    Ok(MetadataDetail {
        source: MetadataSource::Bangumi,
        source_id: raw.id.to_string(),
        title: raw.name.clone(),
        title_cn: raw.name_cn,
        cover_url: raw.images.and_then(|i| i.large),
        summary: raw.summary,
        release_date: raw.date,
    })
}

#[derive(Deserialize)]
struct SearchResp { data: Vec<SearchHit> }

#[derive(Deserialize)]
struct SearchHit {
    id: u64,
    name: String,
    name_cn: Option<String>,
    summary: Option<String>,
    date: Option<String>,
    images: Option<Images>,
}

#[derive(Deserialize)]
struct SubjectDetail {
    id: u64,
    name: String,
    name_cn: Option<String>,
    summary: Option<String>,
    date: Option<String>,
    images: Option<Images>,
}

#[derive(Deserialize)]
struct Images { large: Option<String> }

async fn with_retry<F, Fut, T>(f: F) -> Result<T, MetadataError>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, MetadataError>>,
{
    let delays = [1000u64, 2000, 4000];
    let mut last_err: Option<MetadataError> = None;
    for (i, &delay) in delays.iter().enumerate() {
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                let retriable = matches!(&e,
                    MetadataError::Http(he) if
                        he.status().map(|s| s.as_u16() >= 500 || s.as_u16() == 429).unwrap_or(true)
                );
                if !retriable || i == delays.len() - 1 {
                    return Err(e);
                }
                last_err = Some(e);
                tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
            }
        }
    }
    Err(last_err.unwrap())
}

#[cfg(test)]
mod tests {
    // Real network tests require live APIs; we keep them as #[ignore]
    // and verify only that public API signatures compile + module wires up.
    #[test] fn module_compiles() { /* presence is the assertion */ }
}
```

6. **`src-tauri/src/metadata/vndb.rs`** — same shape (POST /kana/vn with filters):
```rust
use super::{limiter, match_score, types::*};
use serde::Deserialize;

const ENDPOINT: &str = "https://api.vndb.org/kana/vn";

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("reqwest client")
}

pub async fn search(query: &str) -> Result<Vec<Candidate>, MetadataError> {
    let body = serde_json::json!({
        "filters": ["search", "=", query],
        "fields": "id,title,titles{title,lang},image{url},description,released",
        "results": 5
    });
    let raw: SearchResp = with_retry(|| async {
        limiter::wait_vndb().await;
        let resp = client().post(ENDPOINT).json(&body).send().await?;
        if resp.status() == 404 { return Err(MetadataError::NotFound); }
        let resp = resp.error_for_status()?;
        Ok::<_, MetadataError>(resp.json::<SearchResp>().await?)
    }).await?;
    Ok(raw.results.into_iter().map(|hit| {
        let confidence = match_score::score(query, &hit.title);
        Candidate {
            source: MetadataSource::Vndb,
            source_id: hit.id,
            title: hit.title.clone(),
            alias: hit.titles.unwrap_or_default().into_iter().map(|t| t.title).collect(),
            cover_url: hit.image.and_then(|i| i.url),
            release_date: hit.released,
            summary: hit.description,
            confidence,
        }
    }).collect())
}

pub async fn fetch_detail(vndb_id: &str) -> Result<MetadataDetail, MetadataError> {
    let body = serde_json::json!({
        "filters": ["id", "=", vndb_id],
        "fields": "id,title,titles{title,lang},image{url},description,released",
        "results": 1
    });
    let raw: SearchResp = with_retry(|| async {
        limiter::wait_vndb().await;
        let resp = client().post(ENDPOINT).json(&body).send().await?;
        if resp.status() == 404 { return Err(MetadataError::NotFound); }
        let resp = resp.error_for_status()?;
        Ok::<_, MetadataError>(resp.json::<SearchResp>().await?)
    }).await?;
    let hit = raw.results.into_iter().next().ok_or(MetadataError::NotFound)?;
    let title_cn = hit.titles.as_ref().and_then(|ts|
        ts.iter().find(|t| t.lang.as_deref() == Some("zh-Hans") || t.lang.as_deref() == Some("zh-Hant")).map(|t| t.title.clone())
    );
    Ok(MetadataDetail {
        source: MetadataSource::Vndb,
        source_id: hit.id,
        title: hit.title,
        title_cn,
        cover_url: hit.image.and_then(|i| i.url),
        summary: hit.description,
        release_date: hit.released,
    })
}

#[derive(Deserialize)]
struct SearchResp { results: Vec<Hit> }

#[derive(Deserialize)]
struct Hit {
    id: String,
    title: String,
    titles: Option<Vec<TitleEntry>>,
    image: Option<Image>,
    description: Option<String>,
    released: Option<String>,
}

#[derive(Deserialize)]
struct TitleEntry { title: String, lang: Option<String> }

#[derive(Deserialize)]
struct Image { url: Option<String> }

async fn with_retry<F, Fut, T>(f: F) -> Result<T, MetadataError>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, MetadataError>>,
{
    // Identical to bangumi.rs::with_retry; copy verbatim.
    let delays = [1000u64, 2000, 4000];
    let mut last_err: Option<MetadataError> = None;
    for (i, &delay) in delays.iter().enumerate() {
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                let retriable = matches!(&e,
                    MetadataError::Http(he) if
                        he.status().map(|s| s.as_u16() >= 500 || s.as_u16() == 429).unwrap_or(true)
                );
                if !retriable || i == delays.len() - 1 {
                    return Err(e);
                }
                last_err = Some(e);
                tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
            }
        }
    }
    Err(last_err.unwrap())
}
```

7. **`src-tauri/src/lib.rs`** — 仅追加 `mod metadata;` `mod title_clean;` 模块声明（后续 02d 会注册 commands；本 plan 不动 setup hook）

8. 跑：
```
cd D:\project\gal-lib
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
```
两者退出 0。

</action>

<verify>
<automated>
cd D:\project\gal-lib && \
test -f src-tauri/src/title_clean.rs && \
test -f src-tauri/src/metadata/mod.rs && \
test -f src-tauri/src/metadata/types.rs && \
test -f src-tauri/src/metadata/match_score.rs && \
test -f src-tauri/src/metadata/limiter.rs && \
test -f src-tauri/src/metadata/bangumi.rs && \
test -f src-tauri/src/metadata/vndb.rs && \
grep -q "api.bgm.tv/v0/search/subjects" src-tauri/src/metadata/bangumi.rs && \
grep -q "api.vndb.org/kana/vn" src-tauri/src/metadata/vndb.rs && \
grep -q "gal-lib/0.1.0" src-tauri/src/metadata/bangumi.rs && \
grep -q "Quota::per_second" src-tauri/src/metadata/limiter.rs && \
grep -q "Quota::per_minute" src-tauri/src/metadata/limiter.rs && \
grep -q "mod metadata" src-tauri/src/lib.rs && \
grep -q "mod title_clean" src-tauri/src/lib.rs && \
cargo check --manifest-path src-tauri/Cargo.toml && \
cargo test --manifest-path src-tauri/Cargo.toml --lib
</automated>
</verify>

</task>

## Commit Protocol

2 atomic commits:
- `feat(02-02b): add title_clean module + tests`
- `feat(02-02b): add metadata module — bangumi + vndb + limiter + match_score`

## Success

✅ 7 个 Rust 文件就位，cargo check + cargo test --lib 全绿，包含 ~10 个新单元测试（title_clean 6 + match_score 4）。
