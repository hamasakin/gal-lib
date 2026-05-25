//! Per-game ingest orchestrator: parallel Bangumi+VNDB search → merge → cache cover.
//!
//! Pipeline (per `DiscoveredGame`):
//!   1. Search Bangumi AND VNDB in parallel by `clean_name`
//!   2. Merge candidates from both sources, sort by confidence desc
//!   3. If best ≥ 80 → use it
//!   4. If chosen, download cover into `data/covers/{game_id}.{ext}`
//!   5. Return `IngestResult` for caller to UPDATE `games` row
//!
//! Why parallel rather than Bangumi-first/VNDB-fallback: Bangumi sometimes
//! returns a wrong hit ≥ 80 (collision with a same-named CN translation
//! patch or doujin), suppressing the correct VNDB hit. Parallel-merge lets
//! the highest-confidence candidate win regardless of source.
//!
//! Returning a plain struct (not executing SQL) keeps this layer testable
//! in isolation — the caller (`commands::start_scan`) owns the DB pool.
//!
//! No-match path: returns an `IngestResult` with `metadata_source = "none"`
//! so the row is still inserted (UI shows "metadata-pending" badge per
//! 02-CONTEXT § Card Grid Virtualization).
//!
//! 20260509f — two-phase ingest contract (callers in `commands.rs`):
//!   Phase 1 (placeholder INSERT): caller runs `INSERT ... ON CONFLICT(path)`
//!     immediately after `discover` finishes, returns the `game_id`. Row is
//!     visible in the grid as `metadata_source=NULL last_scanned_at=NULL`
//!     (rendered by GameCard as "获取中"). No network I/O; never blocks.
//!   Phase 2 (enrich): caller emits `meta-fetch-progress { phase:"started" }`,
//!     calls `process_game(game_id, data_dir, dg)`, then UPDATEs the row
//!     and emits `meta-fetch-progress { phase:"finished" }`.
//! `process_game` / `refresh_for_query` signatures are intentionally
//! unchanged — splitting the SQL halves out at the command layer keeps
//! the ingest module pure (no DB access here) and avoids touching every
//! existing call site (add_game / refresh_metadata / refresh_all_metadata
//! / bind_metadata).

use crate::cover_cache;
use crate::metadata::types::{OfficialTagRef, PersonRef};
use crate::metadata::{self, Candidate, MetadataSource};
use crate::scan::DiscoveredGame;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tokio::sync::OnceCell;

/// SQL-parameter-shaped struct: caller does `UPDATE games SET ...`.
///
/// Field names match `games` columns 1:1 to keep the binding obvious.
/// `metadata_source` is the string form (`"bangumi"` / `"vndb"` / `"none"`)
/// matching the schema-v2 TEXT column.
#[derive(Debug, Clone)]
pub struct IngestResult {
    pub games_path: String,
    pub name: String,
    pub name_cn: Option<String>,
    pub executable_path: Option<String>,
    pub cover_path: Option<String>,
    pub cover_url: Option<String>,
    pub bangumi_id: Option<String>,
    pub vndb_id: Option<String>,
    pub metadata_source: String,
    pub match_confidence: Option<u8>,
    /// Phase 11 — synopsis text from MetadataDetail; None if no detail fetch
    /// (no-match path) or if the source returned an empty summary.
    pub summary: Option<String>,
    /// Phase 11 — brand / publisher / circle name from MetadataDetail.
    pub brand: Option<String>,
    /// Phase 11 — combined `fetch_persons` + `fetch_characters` result for
    /// the chosen source. Empty when the chosen source's fetch failed (best
    /// effort) or when no candidate was bound.
    pub staff: Vec<PersonRef>,
    /// Phase 11 — official tags from MetadataDetail.
    pub tags: Vec<OfficialTagRef>,
    /// Quick 20260512b — release year parsed from `MetadataDetail.release_date`
    /// (formats: "YYYY", "YYYY-MM", "YYYY-MM-DD"). `None` is preserved as
    /// "no opinion" so the apply path uses COALESCE to keep a prior manual
    /// year (symmetric with brand).
    pub release_year: Option<i32>,
    /// Quick 260525-g1m — 官方评分（0..=10 归一化后）。来自 MetadataDetail.rating；
    /// 无 match 路径 / 源未返回时 NULL。
    pub external_rating: Option<f64>,
    /// Quick 260525-g1m — 官方评分投票数。来自 MetadataDetail.rating_count。
    pub external_rating_count: Option<i64>,
    /// Quick 260525-g1m — "bangumi" | "vndb"（小写源串，与 metadata_source 同口径）；
    /// metadata_source == "none" / "manual" 时为 None。
    pub external_rating_source: Option<String>,
}

/// Quick 20260512b — parse a 4-digit year from the leading portion of a
/// `release_date` string (Bangumi `air_date` / VNDB `released` are both
/// `YYYY-MM-DD`, occasionally `YYYY-MM` or `YYYY`). Returns `None` when the
/// prefix isn't a 4-digit number or the year falls outside 1980..=2100
/// (galgame era guard — protects against junk like "9999-12" that some
/// VNDB rows carry for TBA titles).
pub fn parse_release_year(s: Option<&str>) -> Option<i32> {
    let raw = s?.trim();
    if raw.len() < 4 {
        return None;
    }
    let year: i32 = raw.get(..4)?.parse().ok()?;
    if (1980..=2100).contains(&year) {
        Some(year)
    } else {
        None
    }
}

/// Auto-bind threshold (locked in 02-CONTEXT § Metadata Match Pipeline).
const AUTO_BIND_THRESHOLD: u8 = 80;

/// Search Bangumi + VNDB concurrently, merge results, return the highest
/// confidence candidate at-or-above `AUTO_BIND_THRESHOLD`.
///
/// Either source erroring is non-fatal — we just lose its candidates.
/// If neither source produces a ≥ threshold hit, returns `None`.
async fn pick_best_across_sources(query: &str) -> Option<Candidate> {
    let (b, v) = tokio::join!(
        metadata::bangumi::search(query),
        metadata::vndb::search(query),
    );
    let mut pool: Vec<Candidate> = Vec::new();
    // debug auto-scan-metadata-match-low — surface (don't silently swallow)
    // search errors. A swallowed VNDB 429 used to be invisible: the game
    // just came back metadata_source="none" with no trace of why.
    let mut bangumi_n: isize = -1;
    let mut vndb_n: isize = -1;
    match b {
        Ok(hits) => {
            bangumi_n = hits.len() as isize;
            pool.extend(hits);
        }
        Err(e) => eprintln!("[ingest] bangumi search failed for {:?}: {}", query, e),
    }
    match v {
        Ok(hits) => {
            vndb_n = hits.len() as isize;
            pool.extend(hits);
        }
        Err(e) => eprintln!("[ingest] vndb search failed for {:?}: {}", query, e),
    }
    // debug auto-scan-metadata-match-low — one diagnostic line per query so a
    // single scan run is fully conclusive: it shows the query string, per-source
    // hit counts (-1 = that source ERRORED, 0 = returned empty), and the best
    // confidence found. Distinguishes a search FAILURE from a low-confidence /
    // wrong-query MISS without needing another run.
    let best = pool.iter().map(|c| c.confidence).max().unwrap_or(0);
    eprintln!(
        "[ingest-diag] query={:?} bangumi_hits={} vndb_hits={} best_confidence={}",
        query, bangumi_n, vndb_n, best
    );
    pool.into_iter()
        .filter(|c| c.confidence >= AUTO_BIND_THRESHOLD)
        .max_by_key(|c| c.confidence)
}

/// 20260509g — cross-game query dedup cache. Scope: ONE `start_scan` call.
///
/// Multiple parallel ingest tasks may end up cleaning down to the same
/// query string (common case: a series of doujin entries that all reduce
/// to the same parent title after `title_clean::clean_title`). The cache
/// uses `tokio::sync::OnceCell` per-key so the first task to hit a key
/// runs the Bangumi+VNDB search; concurrent followers `await` the same
/// future and reuse its result. Prevents thundering-herd against the
/// rate limiter.
///
/// Used only by `process_game_cached` on the start_scan code path.
/// `process_game` / `refresh_for_query` keep their cache-less signatures
/// so add_game / refresh_metadata / refresh_all_metadata / bind_metadata
/// don't need rewiring.
pub type QueryCache = Mutex<HashMap<String, Arc<OnceCell<Option<Candidate>>>>>;

/// Construct a fresh empty QueryCache wrapped in `Arc` so it can be
/// `clone()`d into each spawned ingest task.
pub fn new_query_cache() -> Arc<QueryCache> {
    Arc::new(Mutex::new(HashMap::new()))
}

/// `pick_best_across_sources` with per-query memoization.
///
/// Cache hit → returns the previously-computed `Option<Candidate>`.
/// Cache miss → first caller runs `pick_best_across_sources(query)`;
/// concurrent callers await the same OnceCell::get_or_init future.
///
/// `Candidate` derives `Clone` so we can hand out independent owned values
/// to each caller without juggling lifetimes.
pub async fn pick_best_with_cache(query: &str, cache: &QueryCache) -> Option<Candidate> {
    // Phase 1: get-or-insert the OnceCell entry under a short Mutex hold.
    // We never hold the Mutex across an await — the inner Arc<OnceCell>
    // is what serializes the actual work.
    let cell = {
        let mut g = cache.lock().expect("query cache mutex poisoned");
        g.entry(query.to_string())
            .or_insert_with(|| Arc::new(OnceCell::new()))
            .clone()
    };
    // Phase 2: first caller fetches, others await the same future. Result
    // is cloned so each caller owns an independent Option<Candidate>.
    let query_owned = query.to_string();
    cell.get_or_init(|| async move { pick_best_across_sources(&query_owned).await })
        .await
        .clone()
}

/// Phase 11 — best-effort enrichment fetch for a chosen candidate.
///
/// Issues 3 calls per source:
///   - `fetch_detail` for summary / brand / official tags
///   - `fetch_persons` for scenario / artist / music staff
///   - `fetch_characters` for voice actors
///
/// All three are best-effort: any error is logged via stderr and the
/// affected slice falls back to its empty default. The returned tuple
/// matches `(summary, brand, staff, tags)` exactly so the caller can
/// assign into IngestResult fields directly.
async fn fetch_enrichment(
    source: MetadataSource,
    source_id: &str,
) -> (
    Option<String>,
    Option<String>,
    Vec<PersonRef>,
    Vec<OfficialTagRef>,
    Option<i32>,
    Option<f64>,
    Option<i64>,
    Option<String>,
) {
    // Quick 260525-g1m — `source_str` 是 IngestResult.external_rating_source 的字符串口径，
    // 与 metadata_source 完全一致：bangumi/vndb 时填名字，manual/none 时 None。
    let source_str: Option<String> = match source {
        MetadataSource::Bangumi => Some("bangumi".to_string()),
        MetadataSource::Vndb => Some("vndb".to_string()),
        _ => None,
    };
    // 1. Detail (summary, brand, tags, release_year, rating, rating_count). On error: log + empty.
    let detail = match source {
        MetadataSource::Bangumi => metadata::bangumi::fetch_detail(source_id).await,
        MetadataSource::Vndb => metadata::vndb::fetch_detail(source_id).await,
        _ => return (None, None, Vec::new(), Vec::new(), None, None, None, None),
    };
    let (summary, brand, tags, release_year, rating, rating_count) = match detail {
        Ok(d) => {
            let year = parse_release_year(d.release_date.as_deref());
            (d.summary, d.brand, d.tags, year, d.rating, d.rating_count)
        }
        Err(e) => {
            eprintln!(
                "[ingest] fetch_detail failed for {:?}/{}: {}",
                source, source_id, e
            );
            (None, None, Vec::new(), None, None, None)
        }
    };

    // 2. Persons (scenario / artist / music). Best-effort.
    let persons = match source {
        MetadataSource::Bangumi => metadata::bangumi::fetch_persons(source_id).await,
        MetadataSource::Vndb => metadata::vndb::fetch_persons(source_id).await,
        _ => Ok(Vec::new()),
    };
    let mut staff = match persons {
        Ok(v) => v,
        Err(e) => {
            eprintln!(
                "[ingest] fetch_persons failed for {:?}/{}: {}",
                source, source_id, e
            );
            Vec::new()
        }
    };

    // 3. Characters / VAs. Best-effort. Concatenate onto staff.
    let characters = match source {
        MetadataSource::Bangumi => metadata::bangumi::fetch_characters(source_id).await,
        MetadataSource::Vndb => metadata::vndb::fetch_characters(source_id).await,
        _ => Ok(Vec::new()),
    };
    match characters {
        Ok(v) => staff.extend(v),
        Err(e) => eprintln!(
            "[ingest] fetch_characters failed for {:?}/{}: {}",
            source, source_id, e
        ),
    }

    // Quick 260525-g1m — rating / rating_count / source_str 仅当 detail Ok 才有；
    // 走 Err 分支会被早 return 截掉，到这里时 rating/rating_count 已就位。
    // source_str 不受 detail 成功与否影响（由顶层 source 枚举决定）。
    (summary, brand, staff, tags, release_year, rating, rating_count, source_str)
}

/// Process one discovered game: search → fallback → cover-cache.
///
/// `game_id_for_cover` is the SQLite ROWID of the freshly-inserted `games`
/// row; it's used as the cover filename stem (`covers/{id}.{ext}`).
/// Caller is expected to:
///   1. INSERT INTO games (path, name, executable_path) → get rowid
///   2. Call `process_game(rowid, data_dir, &discovered).await`
///   3. UPDATE games SET ... using the returned IngestResult
pub async fn process_game(
    game_id_for_cover: i64,
    data_dir: &Path,
    discovered: &DiscoveredGame,
) -> IngestResult {
    // Default name = clean_name if non-empty, else raw_name (preserves
    // disk-truth fallback for pathological titles like "_____").
    let default_name = if discovered.clean_name.trim().is_empty() {
        discovered.raw_name.clone()
    } else {
        discovered.clean_name.clone()
    };

    let mut result = IngestResult {
        games_path: discovered.path.to_string_lossy().into_owned(),
        name: default_name,
        name_cn: None,
        executable_path: discovered
            .executable
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned()),
        cover_path: None,
        cover_url: None,
        bangumi_id: None,
        vndb_id: None,
        metadata_source: "none".into(),
        match_confidence: None,
        summary: None,
        brand: None,
        staff: Vec::new(),
        tags: Vec::new(),
        release_year: None,
        external_rating: None,
        external_rating_count: None,
        external_rating_source: None,
    };

    // Skip metadata search entirely when clean_name is empty (defensive).
    if discovered.clean_name.trim().is_empty() {
        return result;
    }

    // 1. Search BOTH sources in parallel on the standard cleaned query.
    let mut final_choice = pick_best_across_sources(&discovered.clean_name).await;

    // 1b. Fan-out cascade: if the standard query missed, dispatch one
    //     extra Bangumi+VNDB search per CJK-bearing run isolated from
    //     the raw directory name. Catches the decorated-subtitle pattern
    //     `MainTitle ーSubtitleー` where neither half plus filler scored
    //     ≥80 against the merged query but one half alone matches.
    //     Each candidate is deduped against the standard query so we
    //     never double-spend the limiter on the same string.
    if final_choice.is_none() {
        let candidates = crate::title_clean::aggressive_candidates(&discovered.raw_name);
        for cand in candidates {
            if cand == discovered.clean_name {
                continue;
            }
            if let Some(c) = pick_best_across_sources(&cand).await {
                // Keep the highest-confidence pick across all candidates.
                final_choice = match final_choice {
                    None => Some(c),
                    Some(prev) if c.confidence > prev.confidence => Some(c),
                    other => other,
                };
            }
        }
    }

    if let Some(c) = final_choice {
        result.name = c.title.clone();
        result.match_confidence = Some(c.confidence);
        result.metadata_source = match c.source {
            MetadataSource::Bangumi => "bangumi",
            MetadataSource::Vndb => "vndb",
            MetadataSource::Manual => "manual",
            MetadataSource::None => "none",
        }
        .into();
        match c.source {
            MetadataSource::Bangumi => result.bangumi_id = Some(c.source_id.clone()),
            MetadataSource::Vndb => result.vndb_id = Some(c.source_id.clone()),
            _ => {}
        }
        result.cover_url = c.cover_url.clone();

        // 3. Cover cache (best-effort; failure leaves cover_path NULL,
        //    frontend falls back to the remote cover_url which we always
        //    persist on the row regardless of cache outcome).
        if let Some(url) = &c.cover_url {
            match cover_cache::cache_cover(data_dir, game_id_for_cover, url).await {
                Ok(rel) => result.cover_path = Some(rel.to_string_lossy().into_owned()),
                Err(e) => eprintln!(
                    "[ingest] cover cache failed for game {} ({}): {}",
                    game_id_for_cover, url, e
                ),
            }
        }

        // 4. Phase 11 — best-effort enrichment fetch (summary / brand /
        //    staff / tags). Any failure logs and leaves the field empty;
        //    never aborts ingest. Quick 20260512b — also captures release_year.
        //    Quick 260525-g1m — 8 元组扩展：external_rating / count / source。
        let (summary, brand, staff, tags, release_year, ext_r, ext_rc, ext_rs) =
            fetch_enrichment(c.source, &c.source_id).await;
        result.summary = summary;
        result.brand = brand;
        result.staff = staff;
        result.tags = tags;
        result.release_year = release_year;
        result.external_rating = ext_r;
        result.external_rating_count = ext_rc;
        result.external_rating_source = ext_rs;
    }

    result
}

/// 20260509g — `process_game` with cross-game query dedup. Same algorithm
/// as `process_game`, but every Bangumi+VNDB search goes through `cache`
/// so multiple concurrent ingest tasks (in `start_scan`'s JoinSet) don't
/// re-search a string that another task is already searching.
///
/// Why a parallel function instead of an Option<&QueryCache> parameter on
/// `process_game`: keeps `process_game` (called by `add_game` /
/// `refresh_metadata` / `refresh_all_metadata` / `bind_metadata`) entirely
/// untouched — its signature, contract, and tests are unchanged. Only the
/// start_scan path picks up cache behaviour.
pub async fn process_game_cached(
    game_id_for_cover: i64,
    data_dir: &Path,
    discovered: &DiscoveredGame,
    cache: &QueryCache,
) -> IngestResult {
    let default_name = if discovered.clean_name.trim().is_empty() {
        discovered.raw_name.clone()
    } else {
        discovered.clean_name.clone()
    };

    let mut result = IngestResult {
        games_path: discovered.path.to_string_lossy().into_owned(),
        name: default_name,
        name_cn: None,
        executable_path: discovered
            .executable
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned()),
        cover_path: None,
        cover_url: None,
        bangumi_id: None,
        vndb_id: None,
        metadata_source: "none".into(),
        match_confidence: None,
        summary: None,
        brand: None,
        staff: Vec::new(),
        tags: Vec::new(),
        release_year: None,
        external_rating: None,
        external_rating_count: None,
        external_rating_source: None,
    };

    if discovered.clean_name.trim().is_empty() {
        return result;
    }

    // 1. Standard cleaned query through the cache.
    let mut final_choice = pick_best_with_cache(&discovered.clean_name, cache).await;

    // 1b. Fan-out cascade with per-candidate cache lookups (each fan-out
    //     candidate is also a query string that may collide across games).
    if final_choice.is_none() {
        let candidates = crate::title_clean::aggressive_candidates(&discovered.raw_name);
        for cand in candidates {
            if cand == discovered.clean_name {
                continue;
            }
            if let Some(c) = pick_best_with_cache(&cand, cache).await {
                final_choice = match final_choice {
                    None => Some(c),
                    Some(prev) if c.confidence > prev.confidence => Some(c),
                    other => other,
                };
            }
        }
    }

    if let Some(c) = final_choice {
        result.name = c.title.clone();
        result.match_confidence = Some(c.confidence);
        result.metadata_source = match c.source {
            MetadataSource::Bangumi => "bangumi",
            MetadataSource::Vndb => "vndb",
            MetadataSource::Manual => "manual",
            MetadataSource::None => "none",
        }
        .into();
        match c.source {
            MetadataSource::Bangumi => result.bangumi_id = Some(c.source_id.clone()),
            MetadataSource::Vndb => result.vndb_id = Some(c.source_id.clone()),
            _ => {}
        }
        result.cover_url = c.cover_url.clone();

        if let Some(url) = &c.cover_url {
            match cover_cache::cache_cover(data_dir, game_id_for_cover, url).await {
                Ok(rel) => result.cover_path = Some(rel.to_string_lossy().into_owned()),
                Err(e) => eprintln!(
                    "[ingest] cover cache failed for game {} ({}): {}",
                    game_id_for_cover, url, e
                ),
            }
        }

        // Phase 11 — same enrichment fetch as `process_game`. The query
        // dedup cache only covers `pick_best_*` (search results); detail/
        // persons/characters aren't cached because each game's source_id
        // is unique by construction. Quick 20260512b — release_year too.
        // Quick 260525-g1m — 8 元组扩展：external_rating / count / source。
        let (summary, brand, staff, tags, release_year, ext_r, ext_rc, ext_rs) =
            fetch_enrichment(c.source, &c.source_id).await;
        result.summary = summary;
        result.brand = brand;
        result.staff = staff;
        result.tags = tags;
        result.release_year = release_year;
        result.external_rating = ext_r;
        result.external_rating_count = ext_rc;
        result.external_rating_source = ext_rs;
    }

    result
}

/// Re-fetch metadata for an already-bound game (used by `refresh_metadata`
/// command). Same as `process_game` but caller already has a `clean_name`
/// query (often `games.name` after a prior bind).
///
/// Splits out so the command layer doesn't need to construct a fake
/// `DiscoveredGame`; pre-existing metadata fields on the row are
/// authoritative for the caller — we only return the freshly-fetched
/// `IngestResult`.
pub async fn refresh_for_query(
    game_id_for_cover: i64,
    data_dir: &Path,
    games_path: &str,
    query: &str,
    executable_path: Option<&str>,
) -> IngestResult {
    let discovered = DiscoveredGame {
        path: std::path::PathBuf::from(games_path),
        raw_name: query.to_string(),
        clean_name: query.to_string(),
        executable: executable_path.map(std::path::PathBuf::from),
    };
    process_game(game_id_for_cover, data_dir, &discovered).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::DiscoveredGame;
    use std::path::PathBuf;

    /// Empty clean_name → no metadata search performed (defensive); result
    /// keeps the path / raw_name as-is and metadata_source is "none".
    /// This avoids a network round-trip + a Bangumi 4xx for empty queries.
    #[tokio::test]
    async fn empty_clean_name_skips_search() {
        let tmp = std::env::temp_dir().join(format!(
            "gal-lib-ingest-empty-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|x| x.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&tmp).unwrap();
        let dg = DiscoveredGame {
            path: PathBuf::from("X:/games/_____"),
            raw_name: "_____".into(),
            clean_name: String::new(),
            executable: None,
        };
        let res = process_game(1, &tmp, &dg).await;
        assert_eq!(res.metadata_source, "none");
        assert_eq!(res.name, "_____"); // raw fallback
        assert!(res.bangumi_id.is_none() && res.vndb_id.is_none());
        assert!(res.cover_path.is_none());
        // Phase 11 — new fields default to None / empty Vec when no match.
        assert!(res.summary.is_none());
        assert!(res.brand.is_none());
        assert!(res.staff.is_empty());
        assert!(res.tags.is_empty());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn module_compiles() {
        // presence is the assertion; live API tests deferred to dev smoke
    }
}
