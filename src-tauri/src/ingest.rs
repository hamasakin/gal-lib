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

use crate::cover_cache;
use crate::metadata::{self, Candidate, MetadataSource};
use crate::scan::DiscoveredGame;
use std::path::Path;

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
    if let Ok(hits) = b {
        pool.extend(hits);
    }
    if let Ok(hits) = v {
        pool.extend(hits);
    }
    pool.into_iter()
        .filter(|c| c.confidence >= AUTO_BIND_THRESHOLD)
        .max_by_key(|c| c.confidence)
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
    };

    // Skip metadata search entirely when clean_name is empty (defensive).
    if discovered.clean_name.trim().is_empty() {
        return result;
    }

    // 1. Search BOTH sources in parallel, merge, pick best ≥ threshold.
    let mut final_choice = pick_best_across_sources(&discovered.clean_name).await;

    // 1b. Cascade: if the standard clean missed both sources, retry once
    //     with the aggressive clean (longest contiguous CJK run) — handles
    //     scene-release directories like "[180216] [PULLTOP] ... 見上げて
    //     ごらん、夜空の星を FINE DAYS (iso+mds)" where standard clean
    //     leaves enough trailing noise to drive both APIs below threshold.
    if final_choice.is_none() {
        let aggressive = crate::title_clean::aggressive_clean(&discovered.raw_name);
        if !aggressive.trim().is_empty() && aggressive != discovered.clean_name {
            final_choice = pick_best_across_sources(&aggressive).await;
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
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn module_compiles() {
        // presence is the assertion; live API tests deferred to dev smoke
    }
}
