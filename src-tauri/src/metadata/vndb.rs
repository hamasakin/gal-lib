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
            let confidence = match_score::score(&query_owned, &hit.title);
            Candidate {
                source: MetadataSource::Vndb,
                source_id: hit.id,
                title: hit.title.clone(),
                alias: hit
                    .titles
                    .unwrap_or_default()
                    .into_iter()
                    .map(|t| t.title)
                    .collect(),
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
        "fields": "id,title,titles{title,lang},image{url},description,released",
        "results": 1
    });
    let raw: SearchResp = with_retry(|| async {
        limiter::wait_vndb().await;
        let resp = client().post(ENDPOINT).json(&body).send().await?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(MetadataError::NotFound);
        }
        let resp = resp.error_for_status()?;
        Ok::<_, MetadataError>(resp.json::<SearchResp>().await?)
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

/// Exponential backoff [1s, 2s, 4s] for 5xx / 429 / network errors;
/// 4xx (except 429) fails immediately. Mirrors `bangumi::with_retry`.
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
