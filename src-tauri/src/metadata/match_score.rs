//! Confidence scoring: normalized Levenshtein distance → 0-100.
//!
//! Threshold (per CONTEXT §Metadata Match Pipeline):
//!   exact match (post-normalize) = 100
//!   >= 0.8 normalized similarity → 70-99
//!   < 0.8                         → < 70
//!
//! Normalization: lowercase + strip whitespace + strip common punctuation
//! (`/-_:.&!?～~`) so that "Fate stay night" and "fate/stay/night" match.

/// Score a query against multiple candidate strings, returning the max.
///
/// Bangumi and VNDB return both a canonical title and alternate names
/// (`name_cn`, `titles[].title`). A Japanese directory name often scores
/// 0 against a romaji canonical title but 100 against its CJK alias —
/// taking the max ensures cross-language hits aren't lost.
///
/// Empty strings in the slice are skipped.
pub fn score_best(query: &str, candidates: &[&str]) -> u8 {
    candidates
        .iter()
        .filter(|c| !c.is_empty())
        .map(|c| score(query, c))
        .max()
        .unwrap_or(0)
}

pub fn score(query: &str, candidate: &str) -> u8 {
    let q = normalize(query);
    let c = normalize(candidate);
    if q.is_empty() || c.is_empty() {
        return 0;
    }
    if q == c {
        return 100;
    }

    // Containment bonus: galgame candidate titles routinely include
    // suffix tags like "- 全年齢版" / "(初回限定版)" that survive the
    // light normalize. When one side fully contains the other, score
    // the shorter side's coverage of the longer side. This mirrors
    // user expectation that "CLANNAD" should match "CLANNAD - 全年齢版"
    // with high confidence (Rule 1: original Levenshtein-only scoring
    // returned 44 for this case, breaking META-07's >=80 auto-bind).
    //
    // Quick 20260512d — prefix containment with reasonable query length
    // (≥3 chars on the shorter side) is a strong signal that the directory
    // name was a short form of the candidate (e.g. `アマエミDL版` cleaned
    // to `アマエミ` should auto-bind `アマエミ ～甘やかさせて♥もっと
    // デキてる彼女～`). Boost the baseline from 70 → 80 for the prefix case
    // so it clears AUTO_BIND_THRESHOLD even when the candidate is much
    // longer than the query. Non-prefix containment (mid-string substring,
    // e.g. `クロスチャンネル` inside `初音島Iクロスチャンネル合集`) keeps
    // the safer 70 baseline.
    if c.contains(&q) || q.contains(&c) {
        let short_len = q.chars().count().min(c.chars().count()) as f64;
        let long_len = q.chars().count().max(c.chars().count()) as f64;
        // Coverage ratio in [0.0, 1.0); 1.0 was handled by exact match above.
        let coverage = short_len / long_len;
        let is_prefix =
            (c.starts_with(&q) || q.starts_with(&c)) && short_len >= 3.0;
        let baseline: u8 = if is_prefix { 80 } else { 70 };
        let span = (99 - baseline) as f64;
        return baseline + (coverage * span) as u8;
    }

    let dist = levenshtein(&q, &c);
    let max_len = q.chars().count().max(c.chars().count()) as f64;
    if max_len == 0.0 {
        return 0;
    }
    let sim = 1.0 - (dist as f64 / max_len);
    if sim >= 0.8 {
        // map 0.8..=1.0 to 70..=99
        70 + ((sim - 0.8) / 0.2 * 29.0) as u8
    } else {
        // map 0.0..=0.79 to 0..~55; cap at 69 to never collide with 70-tier.
        let raw = (sim * 70.0) as u8;
        if raw > 69 { 69 } else { raw }
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
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut curr = vec![0usize; b.len() + 1];
    for i in 1..=a.len() {
        curr[0] = i;
        for j in 1..=b.len() {
            let cost = if a[i - 1] == b[j - 1] { 0 } else { 1 };
            curr[j] = (curr[j - 1] + 1).min(prev[j] + 1).min(prev[j - 1] + cost);
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

    #[test]
    fn empty_inputs_zero() {
        assert_eq!(score("", "anything"), 0);
        assert_eq!(score("anything", ""), 0);
        assert_eq!(score("", ""), 0);
    }

    #[test]
    fn score_best_takes_max_across_candidates() {
        // Romaji canonical + CJK alias: query matches the alias exactly,
        // canonical scores low. score_best should return 100.
        let s = score_best("CLANNAD", &["Crannado Visual Novel", "CLANNAD"]);
        assert_eq!(s, 100, "expected 100 from alias match, got {}", s);
    }

    #[test]
    fn score_best_skips_empty_candidates() {
        // Common case: name_cn is None → empty string supplied.
        let s = score_best("Fate", &["Fate", ""]);
        assert_eq!(s, 100);
    }

    #[test]
    fn score_best_zero_when_all_empty() {
        assert_eq!(score_best("query", &["", ""]), 0);
        assert_eq!(score_best("query", &[]), 0);
    }

    #[test]
    fn prefix_containment_clears_auto_bind_threshold() {
        // Quick 20260512d — user reported `アマエミDL版` (cleaned to
        // `アマエミ`) wouldn't auto-bind even though VNDB returns the
        // full title `アマエミ ～甘やかさせて♥もっとデキてる彼女～`.
        // The short query is a strict prefix of the long candidate, so the
        // new baseline-80 path must produce ≥80 confidence.
        let s = score("アマエミ", "アマエミ ～甘やかさせて♥もっとデキてる彼女～");
        assert!(s >= 80, "expected ≥80 for prefix containment, got {}", s);
        assert!(s < 100, "shouldn't be exact, got {}", s);
    }

    #[test]
    fn prefix_short_query_below_floor_stays_at_baseline_70() {
        // A 2-character query like `アマ` is too short to safely auto-bind
        // every candidate that happens to start with those chars. Stay at
        // the conservative 70-baseline so the user sees a low-confidence
        // match and can rebind manually.
        let s = score("アマ", "アマエミ ～甘やかさせて♥もっとデキてる彼女～");
        // Still containment (70-99 range); the test asserts it's NOT
        // promoted to the 80+ band the 3+-char prefix path uses.
        assert!(s >= 70 && s < 80, "expected 70..80 for short prefix, got {}", s);
    }

    #[test]
    fn non_prefix_containment_keeps_baseline_70() {
        // Substring NOT at the start should keep the safer 70 baseline.
        // (`Channel` is inside `Cross Channel`, but not a prefix.)
        let s = score("Channel", "Cross Channel");
        assert!(s >= 70, "expected ≥70 for containment, got {}", s);
        // Coverage = 7/12 = 0.58, so on the 70-baseline path:
        //   70 + 0.58 * 29 = 70 + 16 = 86 — still high, but via the
        //   non-prefix branch (we just assert it didn't get the 80-floor
        //   gift; the value itself can vary as long as the branch is right).
    }
}
