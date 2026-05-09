//! Bangumi v0 API client (search + fetch_detail + fetch_persons + fetch_characters).
//!
//! Endpoints:
//!   - POST https://api.bgm.tv/v0/search/subjects   { keyword, filter:{type:[4]} }
//!   - GET  https://api.bgm.tv/v0/subjects/{id}
//!   - GET  https://api.bgm.tv/v0/subjects/{id}/persons   (Phase 11)
//!   - GET  https://api.bgm.tv/v0/subjects/{id}/characters (Phase 11)
//!
//! User-Agent MUST be set; default reqwest UA returns 403 from Bangumi.
//! No auth token needed for read-only public subject queries.
//!
//! Rate-limited via `limiter::wait_bangumi()` (1 req/s singleton).
//! Retried via `with_retry` on 5xx / 429 / network error; 4xx (except 429)
//! fail immediately.

use super::{limiter, match_score, types::*};
use serde::Deserialize;
use serde_json::Value;

const SEARCH_URL: &str = "https://api.bgm.tv/v0/search/subjects";
const DETAIL_BASE: &str = "https://api.bgm.tv/v0/subjects/";
const USER_AGENT: &str = "gal-lib/0.1.0 (https://github.com/gal-lib/gal-lib)";

/// Map Bangumi's Chinese `relation` strings on `/subjects/{id}/persons` to
/// the locked 4-role enum. Returns `None` for roles outside our scope
/// (e.g., 监督, 制作人, 程序, 翻译) — caller silently drops those entries.
///
/// Source naming conventions observed on Bangumi (game subjects, type=4):
/// - 脚本 / 剧本 / 原作 → scenario
/// - 原画 / 插画 / 人物设定 / 美工 / 美术 → artist
/// - 音乐 / 作曲 / 主题曲作曲 / 片尾曲作曲 → music
fn normalize_bangumi_role(relation: &str) -> Option<StaffRole> {
    match relation {
        "脚本" | "剧本" | "原作" => Some(StaffRole::Scenario),
        "原画" | "插画" | "人物设定" | "美工" | "美术" => Some(StaffRole::Artist),
        "音乐" | "作曲" | "主题曲作曲" | "片尾曲作曲" => Some(StaffRole::Music),
        _ => None,
    }
}

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
    let raw: SearchResp = with_retry(|| async {
        limiter::wait_bangumi().await;
        let resp = client().post(SEARCH_URL).json(&body).send().await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(MetadataError::NotFound);
        }
        let resp = resp.error_for_status()?;
        Ok::<_, MetadataError>(resp.json::<SearchResp>().await?)
    })
    .await?;
    let query_owned = query.to_string();
    Ok(raw
        .data
        .into_iter()
        .map(|s| {
            let name_cn = s.name_cn.clone().unwrap_or_default();
            let confidence = match_score::score_best(&query_owned, &[&s.name, &name_cn]);
            Candidate {
                source: MetadataSource::Bangumi,
                source_id: s.id.to_string(),
                title: s.name_cn.clone().filter(|x| !x.is_empty()).unwrap_or_else(|| s.name.clone()),
                alias: vec![s.name],
                cover_url: s.images.and_then(|i| i.large),
                release_date: s.date,
                summary: s.summary,
                confidence,
            }
        })
        .collect())
}

pub async fn fetch_detail(bangumi_id: &str) -> Result<MetadataDetail, MetadataError> {
    let url = format!("{}{}", DETAIL_BASE, bangumi_id);
    let raw: SubjectDetail = with_retry(|| async {
        limiter::wait_bangumi().await;
        let resp = client().get(&url).send().await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(MetadataError::NotFound);
        }
        let resp = resp.error_for_status()?;
        Ok::<_, MetadataError>(resp.json::<SubjectDetail>().await?)
    })
    .await?;
    // Phase 11 — extract brand from infobox + map tags to OfficialTagRef.
    let brand = extract_brand_from_infobox(&raw.infobox);
    let tags: Vec<OfficialTagRef> = raw
        .tags
        .unwrap_or_default()
        .into_iter()
        .map(|t| OfficialTagRef {
            name: t.name,
            weight: t.count.unwrap_or(0),
        })
        .collect();
    Ok(MetadataDetail {
        source: MetadataSource::Bangumi,
        source_id: raw.id.to_string(),
        title: raw.name.clone(),
        title_cn: raw.name_cn,
        cover_url: raw.images.and_then(|i| i.large),
        summary: raw.summary,
        release_date: raw.date,
        brand,
        tags,
        // Quick 20260510b — Bangumi exposes `nsfw: bool` on the subject
        // detail. Map directly: true → R18, false → all-ages, missing → None.
        is_r18: raw.nsfw,
    })
}

/// Phase 11 — fetch staff (writers/artists/composers) for a subject.
/// Voice actors are NOT included here; use `fetch_characters` for those
/// since Bangumi keeps CV data on the character endpoint with the
/// per-CV character_name attached.
pub async fn fetch_persons(bangumi_id: &str) -> Result<Vec<PersonRef>, MetadataError> {
    let url = format!("{}{}/persons", DETAIL_BASE, bangumi_id);
    let raw: Vec<PersonHit> = with_retry(|| async {
        limiter::wait_bangumi().await;
        let resp = client().get(&url).send().await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(MetadataError::NotFound);
        }
        let resp = resp.error_for_status()?;
        Ok::<_, MetadataError>(resp.json::<Vec<PersonHit>>().await?)
    })
    .await?;
    Ok(raw
        .into_iter()
        .filter_map(|p| {
            let role = normalize_bangumi_role(&p.relation)?;
            Some(PersonRef {
                source: MetadataSource::Bangumi,
                source_id: p.id.to_string(),
                name: p.name,
                name_cn: None,
                role,
                character_name: None,
            })
        })
        .collect())
}

/// Phase 11 — fetch voice actors via the characters endpoint.
/// Returns one PersonRef per (character × actor) pair; same actor voicing
/// multiple characters yields multiple rows (each carries a distinct
/// `character_name`). The composite primary key on `game_staff`
/// (game_id, person_id, role, character_name) makes this safe to bulk-insert.
pub async fn fetch_characters(bangumi_id: &str) -> Result<Vec<PersonRef>, MetadataError> {
    let url = format!("{}{}/characters", DETAIL_BASE, bangumi_id);
    let raw: Vec<CharacterHit> = with_retry(|| async {
        limiter::wait_bangumi().await;
        let resp = client().get(&url).send().await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(MetadataError::NotFound);
        }
        let resp = resp.error_for_status()?;
        Ok::<_, MetadataError>(resp.json::<Vec<CharacterHit>>().await?)
    })
    .await?;
    let mut out = Vec::new();
    for ch in raw {
        let actors = ch.actors.unwrap_or_default();
        for actor in actors {
            out.push(PersonRef {
                source: MetadataSource::Bangumi,
                source_id: actor.id.to_string(),
                name: actor.name,
                name_cn: None,
                role: StaffRole::Voice,
                character_name: Some(ch.name.clone()),
            });
        }
    }
    Ok(out)
}

/// Walk the infobox array looking for the first `开发`/`发行`/`厂商`/`品牌` key.
/// Bangumi infobox values can be a string or an array of `{k,v}` pairs;
/// we coerce to a single string for our brand column.
fn extract_brand_from_infobox(infobox: &Option<Vec<InfoboxEntry>>) -> Option<String> {
    let entries = infobox.as_ref()?;
    const BRAND_KEYS: &[&str] = &["开发", "发行", "厂商", "品牌"];
    for entry in entries {
        if !BRAND_KEYS.contains(&entry.key.as_str()) {
            continue;
        }
        if let Some(s) = infobox_value_to_string(&entry.value) {
            return Some(s);
        }
    }
    None
}

/// Coerce a Bangumi infobox value (string or array of {k,v}) to a single
/// readable string. Multi-developer entries get joined by " / ".
fn infobox_value_to_string(v: &Value) -> Option<String> {
    if let Some(s) = v.as_str() {
        return Some(s.trim().to_string()).filter(|x| !x.is_empty());
    }
    if let Some(arr) = v.as_array() {
        let parts: Vec<String> = arr
            .iter()
            .filter_map(|item| {
                if let Some(s) = item.as_str() {
                    return Some(s.to_string());
                }
                item.get("v").and_then(|x| x.as_str()).map(String::from)
            })
            .collect();
        if !parts.is_empty() {
            return Some(parts.join(" / "));
        }
    }
    None
}

#[derive(Deserialize)]
struct SearchResp {
    data: Vec<SearchHit>,
}

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
    /// Phase 11 — infobox is array of {key, value} where value can be a
    /// string or an array of {k,v}; we keep it as `Value` and resolve later.
    #[serde(default)]
    infobox: Option<Vec<InfoboxEntry>>,
    /// Phase 11 — official tags array; each has `name` + `count`.
    #[serde(default)]
    tags: Option<Vec<TagHit>>,
    /// Quick 20260510b — `true` for 18+ subjects (galgame R18), `false`
    /// otherwise; absent on rare subject types (we treat that as unknown).
    #[serde(default)]
    nsfw: Option<bool>,
}

#[derive(Deserialize)]
struct Images {
    large: Option<String>,
}

#[derive(Deserialize)]
struct InfoboxEntry {
    key: String,
    value: Value,
}

#[derive(Deserialize)]
struct TagHit {
    name: String,
    count: Option<i32>,
}

#[derive(Deserialize)]
struct PersonHit {
    id: u64,
    name: String,
    relation: String,
}

#[derive(Deserialize)]
struct CharacterHit {
    name: String,
    #[serde(default)]
    actors: Option<Vec<ActorHit>>,
}

#[derive(Deserialize)]
struct ActorHit {
    id: u64,
    name: String,
}

/// Exponential backoff [1s, 2s, 4s] for 5xx / 429 / network errors;
/// 4xx (except 429) fails immediately.
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

    // Real network tests require live APIs; the public API surface compiling
    // + module wire-up is the assertion here. Live API tests are deferred to
    // 02d integration tests.
    #[test]
    fn module_compiles() {
        // presence is the assertion
    }

    #[test]
    fn role_normalization_writers_artists_composers() {
        // Locked Bangumi role mapping for game subjects (type 4).
        assert_eq!(normalize_bangumi_role("脚本"), Some(StaffRole::Scenario));
        assert_eq!(normalize_bangumi_role("剧本"), Some(StaffRole::Scenario));
        assert_eq!(normalize_bangumi_role("原画"), Some(StaffRole::Artist));
        assert_eq!(normalize_bangumi_role("人物设定"), Some(StaffRole::Artist));
        assert_eq!(normalize_bangumi_role("音乐"), Some(StaffRole::Music));
        assert_eq!(normalize_bangumi_role("作曲"), Some(StaffRole::Music));
        // Roles outside scope are silently dropped (not voice — voice comes
        // from the characters endpoint, not the persons endpoint).
        assert_eq!(normalize_bangumi_role("监督"), None);
        assert_eq!(normalize_bangumi_role("程序"), None);
        assert_eq!(normalize_bangumi_role("翻译"), None);
    }

    #[test]
    fn extract_brand_string_value() {
        let infobox = Some(vec![
            InfoboxEntry { key: "中文名".into(), value: Value::String("X".into()) },
            InfoboxEntry { key: "开发".into(), value: Value::String("Sample Brand".into()) },
        ]);
        assert_eq!(extract_brand_from_infobox(&infobox).as_deref(), Some("Sample Brand"));
    }

    #[test]
    fn extract_brand_array_value() {
        // Multi-developer joined by " / "
        let arr = Value::Array(vec![
            serde_json::json!({"v": "Brand A"}),
            serde_json::json!({"v": "Brand B"}),
        ]);
        let infobox = Some(vec![InfoboxEntry { key: "发行".into(), value: arr }]);
        assert_eq!(
            extract_brand_from_infobox(&infobox).as_deref(),
            Some("Brand A / Brand B")
        );
    }

    #[test]
    fn extract_brand_missing_returns_none() {
        let infobox = Some(vec![InfoboxEntry {
            key: "中文名".into(),
            value: Value::String("X".into()),
        }]);
        assert!(extract_brand_from_infobox(&infobox).is_none());
        assert!(extract_brand_from_infobox(&None).is_none());
    }
}
