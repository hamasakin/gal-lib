//! Bangumi v0 API client (search + fetch_detail).
//!
//! Endpoints:
//!   - POST https://api.bgm.tv/v0/search/subjects   { keyword, filter:{type:[4]} }
//!   - GET  https://api.bgm.tv/v0/subjects/{id}
//!
//! User-Agent MUST be set; default reqwest UA returns 403 from Bangumi.
//! No auth token needed for read-only public subject queries.
//!
//! Rate-limited via `limiter::wait_bangumi()` (1 req/s singleton).
//! Retried via `with_retry` on 5xx / 429 / network error; 4xx (except 429)
//! fail immediately.

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
        .take(5)
        .map(|s| {
            let confidence = match_score::score(&query_owned, &s.name);
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
}

#[derive(Deserialize)]
struct Images {
    large: Option<String>,
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
    // Real network tests require live APIs; the public API surface compiling
    // + module wire-up is the assertion here. Live API tests are deferred to
    // 02d integration tests.
    #[test]
    fn module_compiles() {
        // presence is the assertion
    }
}
