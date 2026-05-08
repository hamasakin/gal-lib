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
    if c.contains(&q) || q.contains(&c) {
        let short = q.chars().count().min(c.chars().count()) as f64;
        let long = q.chars().count().max(c.chars().count()) as f64;
        // Coverage ratio in [0.0, 1.0); 1.0 was handled by exact match above.
        let coverage = short / long;
        // Map 0.0..=1.0 to 70..=99 so containment always clears the
        // fuzzy threshold.
        return 70 + (coverage * 29.0) as u8;
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
}
