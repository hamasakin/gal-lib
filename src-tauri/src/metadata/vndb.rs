//! VNDB Kana API client (POST /kana/vn).
//!
//! Endpoint:
//!   POST https://api.vndb.org/kana/vn
//!   body: { filters, fields, results }
//!
//! Read-only public access — no token required (token unlocks user-scoped
//! voted-by filters; out of scope for v1).
//!
//! Rate-limited via `limiter::wait_vndb()` (100 req/min singleton).
//! Retried via `with_retry` on 5xx / 429 / network error; 4xx (except 429)
//! fail immediately.
//!
//! Phase 11 — `fetch_detail` widened to one combined GraphQL query that
//! pulls staff/va/developers/tags in addition to the basic title fields,
//! since VNDB allows arbitrary depth in a single call. Bangumi by contrast
//! requires separate /persons + /characters endpoints.

use super::{limiter, match_score, types::*};
use serde::Deserialize;

const ENDPOINT: &str = "https://api.vndb.org/kana/vn";

/// Map VNDB English `role` strings on `vn.staff[]` to the locked 4-role enum.
/// VNDB has more granular roles than Bangumi; we collapse `art` and
/// `chardesign` into `artist` so a single person who's both rolled appears
/// once per game (composite key `(game_id, person_id, role, character_name)`
/// dedups). Non-creative roles (`director`, `staff`, `translator`) are
/// silently dropped.
///
/// Reference VNDB role enum (vn.staff[].role):
///   scenario, original, art, chardesign, music, songs, director, staff,
///   translator, editor, qa, etc.
fn normalize_vndb_role(role: &str) -> Option<StaffRole> {
    match role {
        "scenario" | "original" => Some(StaffRole::Scenario),
        "art" | "chardesign" => Some(StaffRole::Artist),
        "music" | "songs" => Some(StaffRole::Music),
        _ => None,
    }
}

/// Lazily-built shared HTTP client. See bangumi.rs for full rationale —
/// memoizes the first successful build, surfaces TLS-init failure as
/// `MetadataError::Http` rather than panicking the whole Tauri backend
/// (CR-04 in 260524 review).
static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

fn client() -> Result<&'static reqwest::Client, MetadataError> {
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let c = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let _ = CLIENT.set(c);
    Ok(CLIENT
        .get()
        .expect("CLIENT initialized above or by racing thread"))
}

pub async fn search(query: &str) -> Result<Vec<Candidate>, MetadataError> {
    // VNDB's `search` filter is already a fuzzy substring/token match
    // across visible titles + aliases (no extra "fuzzy" mode exists).
    // Knobs we can turn for recall:
    //   - results: page size, default 10, max 100. We were capped at 5,
    //     missing relevant matches that ranked 6+. Bump to 25 — wide
    //     enough to catch an off-by-name candidate, still cheap on the
    //     limiter.
    //   - sort: when `search` is the active filter, "searchrank" orders
    //     by VNDB's internal relevance score (most-relevant first). Our
    //     own score_best then re-ranks across name pool, but starting
    //     from a relevance-sorted page reduces the chance of a strong
    //     candidate being silently truncated.
    let body = serde_json::json!({
        "filters": ["search", "=", query],
        "fields": "id,title,titles{title,lang},image{url},description,released",
        "results": 25,
        "sort": "searchrank",
    });
    let raw: SearchResp = with_retry(|| async {
        limiter::wait_vndb().await;
        let resp = client()?.post(ENDPOINT).json(&body).send().await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(MetadataError::NotFound);
        }
        let resp = resp.error_for_status()?;
        Ok::<_, MetadataError>(resp.json::<SearchResp>().await?)
    })
    .await?;
    let query_owned = query.to_string();
    Ok(raw
        .results
        .into_iter()
        .map(|hit| {
            let alias: Vec<String> = hit
                .titles
                .unwrap_or_default()
                .into_iter()
                .map(|t| t.title)
                .collect();
            // Score across canonical title + every alternate title (zh-Hans
            // / ja / en variants). Without this, a Japanese directory name
            // scores 0 against an English `title` even when one of the
            // alternates is a perfect Japanese match.
            let mut pool: Vec<&str> = vec![hit.title.as_str()];
            pool.extend(alias.iter().map(|s| s.as_str()));
            let confidence = match_score::score_best(&query_owned, &pool);
            Candidate {
                source: MetadataSource::Vndb,
                source_id: hit.id,
                title: hit.title.clone(),
                alias,
                cover_url: hit.image.and_then(|i| i.url),
                release_date: hit.released,
                summary: hit.description,
                confidence,
            }
        })
        .collect())
}

pub async fn fetch_detail(vndb_id: &str) -> Result<MetadataDetail, MetadataError> {
    let body = serde_json::json!({
        "filters": ["id", "=", vndb_id],
        "fields": "id,title,titles{title,lang},image{url},description,released,\
            developers{name,original},tags{name,rating,spoiler,category},\
            staff{id,name,original,role},va{staff{id,name,original},character{name,original}},\
            rating,votecount",
        "results": 1
    });
    let raw: DetailResp = with_retry(|| async {
        limiter::wait_vndb().await;
        let resp = client()?.post(ENDPOINT).json(&body).send().await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(MetadataError::NotFound);
        }
        let resp = resp.error_for_status()?;
        Ok::<_, MetadataError>(resp.json::<DetailResp>().await?)
    })
    .await?;
    let hit = raw.results.into_iter().next().ok_or(MetadataError::NotFound)?;
    let title_cn = hit.titles.as_ref().and_then(|ts| {
        ts.iter()
            .find(|t| {
                t.lang.as_deref() == Some("zh-Hans") || t.lang.as_deref() == Some("zh-Hant")
            })
            .map(|t| t.title.clone())
    });
    let brand = hit
        .developers
        .as_ref()
        .and_then(|devs| {
            let names: Vec<String> = devs.iter().map(|d| d.name.clone()).collect();
            if names.is_empty() {
                None
            } else {
                Some(names.join(" / "))
            }
        });
    // Filter out spoilers >= 2 (full-spoiler tags) and convert to OfficialTagRef.
    let tags = hit
        .tags
        .unwrap_or_default()
        .into_iter()
        .filter(|t| t.spoiler.unwrap_or(0) < 2)
        .map(|t| OfficialTagRef {
            name: t.name,
            // VNDB rating is float 0..=3 — multiply by 100 + round to keep
            // schema integer-typed. Higher = more strongly tagged.
            weight: ((t.rating.unwrap_or(0.0)) * 100.0).round() as i32,
        })
        .collect();
    Ok(MetadataDetail {
        source: MetadataSource::Vndb,
        source_id: hit.id,
        title: hit.title,
        title_cn,
        cover_url: hit.image.and_then(|i| i.url),
        summary: hit.description,
        release_date: hit.released,
        brand,
        tags,
        // Quick 260525-g1m — VNDB rating 是 0..=100 1 位小数 float；除以 10 归一化到
        // 0..=10 与 Bangumi 同口径。注意：DetailHit.rating 是 VN 整体评分 (顶层 field)，
        // 与 TagEntry.rating (标签权重 0..=3) 各自独立。
        rating: hit.rating.map(|r| r / 10.0),
        rating_count: hit.votecount,
    })
}

/// Phase 11 — VNDB staff fetch. Returns scenario/artist/music persons
/// (not voice; use `fetch_va`). Uses the same combined detail call so
/// callers that already have a `MetadataDetail` should call `fetch_va`
/// only when they need voice. To keep the data flow uniform with the
/// Bangumi client (`fetch_persons` returns non-voice; `fetch_characters`
/// returns voice), we expose two functions but both run the same backend
/// call — they read different sub-arrays of the response.
pub async fn fetch_persons(vndb_id: &str) -> Result<Vec<PersonRef>, MetadataError> {
    let body = serde_json::json!({
        "filters": ["id", "=", vndb_id],
        "fields": "staff{id,name,original,role}",
        "results": 1,
    });
    let raw: StaffResp = with_retry(|| async {
        limiter::wait_vndb().await;
        let resp = client()?.post(ENDPOINT).json(&body).send().await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(MetadataError::NotFound);
        }
        let resp = resp.error_for_status()?;
        Ok::<_, MetadataError>(resp.json::<StaffResp>().await?)
    })
    .await?;
    let hit = raw.results.into_iter().next().ok_or(MetadataError::NotFound)?;
    let staff = hit.staff.unwrap_or_default();
    let mut out = Vec::with_capacity(staff.len());
    for s in staff {
        let Some(role) = normalize_vndb_role(&s.role) else {
            continue;
        };
        out.push(PersonRef {
            source: MetadataSource::Vndb,
            source_id: s.id,
            name: s.name,
            name_cn: s.original,
            role,
            character_name: None,
        });
    }
    Ok(out)
}

/// Phase 11 — VNDB VA fetch. Returns one PersonRef per (character × actor).
pub async fn fetch_characters(vndb_id: &str) -> Result<Vec<PersonRef>, MetadataError> {
    let body = serde_json::json!({
        "filters": ["id", "=", vndb_id],
        "fields": "va{staff{id,name,original},character{name,original}}",
        "results": 1,
    });
    let raw: VaResp = with_retry(|| async {
        limiter::wait_vndb().await;
        let resp = client()?.post(ENDPOINT).json(&body).send().await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(MetadataError::NotFound);
        }
        let resp = resp.error_for_status()?;
        Ok::<_, MetadataError>(resp.json::<VaResp>().await?)
    })
    .await?;
    let hit = raw.results.into_iter().next().ok_or(MetadataError::NotFound)?;
    let va = hit.va.unwrap_or_default();
    let mut out = Vec::with_capacity(va.len());
    for entry in va {
        let staff = entry.staff;
        let character = entry.character;
        out.push(PersonRef {
            source: MetadataSource::Vndb,
            source_id: staff.id,
            name: staff.name,
            name_cn: staff.original,
            role: StaffRole::Voice,
            character_name: Some(character.name),
        });
    }
    Ok(out)
}

#[derive(Deserialize)]
struct SearchResp {
    results: Vec<Hit>,
}

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
struct TitleEntry {
    title: String,
    lang: Option<String>,
}

#[derive(Deserialize)]
struct Image {
    url: Option<String>,
}

// ── Phase 11 enrichment response shapes ─────────────────────────────────

#[derive(Deserialize)]
struct DetailResp {
    results: Vec<DetailHit>,
}

#[derive(Deserialize)]
struct DetailHit {
    id: String,
    title: String,
    titles: Option<Vec<TitleEntry>>,
    image: Option<Image>,
    description: Option<String>,
    released: Option<String>,
    #[serde(default)]
    developers: Option<Vec<DeveloperEntry>>,
    #[serde(default)]
    tags: Option<Vec<TagEntry>>,
    /// Quick 260525-g1m — VNDB VN 整体评分 (0..=100 float, 1 位小数)；
    /// 归一化 /10 后写入 MetadataDetail.rating。
    #[serde(default)]
    rating: Option<f64>,
    /// Quick 260525-g1m — VNDB 投票数 (votecount)。
    #[serde(default)]
    votecount: Option<i64>,
}

#[derive(Deserialize)]
struct DeveloperEntry {
    name: String,
    #[allow(dead_code)]
    original: Option<String>,
}

#[derive(Deserialize)]
struct TagEntry {
    name: String,
    rating: Option<f64>,
    spoiler: Option<u8>,
}

#[derive(Deserialize)]
struct StaffResp {
    results: Vec<StaffHit>,
}

#[derive(Deserialize)]
struct StaffHit {
    #[serde(default)]
    staff: Option<Vec<StaffEntry>>,
}

#[derive(Deserialize)]
struct StaffEntry {
    id: String,
    name: String,
    original: Option<String>,
    role: String,
}

#[derive(Deserialize)]
struct VaResp {
    results: Vec<VaHit>,
}

#[derive(Deserialize)]
struct VaHit {
    #[serde(default)]
    va: Option<Vec<VaEntry>>,
}

#[derive(Deserialize)]
struct VaEntry {
    staff: VaStaff,
    character: VaCharacter,
}

#[derive(Deserialize)]
struct VaStaff {
    id: String,
    name: String,
    original: Option<String>,
}

#[derive(Deserialize)]
struct VaCharacter {
    name: String,
    #[allow(dead_code)]
    original: Option<String>,
}

/// Exponential backoff [2s, 5s, 10s, 20s] for 5xx / 429 / network errors;
/// 4xx (except 429) fails immediately. Mirrors `bangumi::with_retry`.
async fn with_retry<F, Fut, T>(f: F) -> Result<T, MetadataError>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, MetadataError>>,
{
    // debug auto-scan-metadata-match-low — widened from [1s,2s,4s] (~7s
    // total) to ~37s total: VNDB's server-side 429 throttle window during a
    // bulk scan outlasted the old budget, so games past the startup batch
    // exhausted all 3 retries and lost their VNDB candidate entirely.
    let delays = [2000u64, 5000, 10000, 20000];
    let mut last_err: Option<MetadataError> = None;
    for (i, &delay) in delays.iter().enumerate() {
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                let retriable = match &e {
                    MetadataError::Http(he) => he
                        .status()
                        .map(|s| s.as_u16() >= 500 || s.as_u16() == 429)
                        .unwrap_or(true),
                    _ => false,
                };
                if !retriable || i == delays.len() - 1 {
                    return Err(e);
                }
                last_err = Some(e);
                tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
            }
        }
    }
    Err(last_err.unwrap_or(MetadataError::Malformed("retry exhausted".into())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_normalization_collapses_art_and_chardesign() {
        // VNDB has both `art` and `chardesign` as separate roles; we
        // collapse them so a single artist appearing under both doesn't
        // generate two `game_staff` rows for the same role.
        assert_eq!(normalize_vndb_role("scenario"), Some(StaffRole::Scenario));
        assert_eq!(normalize_vndb_role("original"), Some(StaffRole::Scenario));
        assert_eq!(normalize_vndb_role("art"), Some(StaffRole::Artist));
        assert_eq!(normalize_vndb_role("chardesign"), Some(StaffRole::Artist));
        assert_eq!(normalize_vndb_role("music"), Some(StaffRole::Music));
        assert_eq!(normalize_vndb_role("songs"), Some(StaffRole::Music));
        // Non-creative roles dropped (matches Bangumi behavior).
        assert_eq!(normalize_vndb_role("director"), None);
        assert_eq!(normalize_vndb_role("staff"), None);
        assert_eq!(normalize_vndb_role("translator"), None);
        assert_eq!(normalize_vndb_role(""), None);
    }
}
