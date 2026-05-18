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
    // Quick 260519-21s — 置信度最低门槛降到 0。此前 containment 分支用一个
    // 人为下限 baseline（prefix 80 / 非 prefix 70）把弱匹配候选硬抬上去，
    // 用户在 MetadataPicker 里看到的是被美化过的虚高分。现在 baseline 改为
    // 0：containment 候选只拿到由 coverage（短串对长串的覆盖率）算出的真实
    // 低分，最差的候选也能如实显示接近 0 的置信度并被用户手动选中应用。
    //
    // prefix 仍是强信号——目录名是候选标题前缀（≥3 字符）通常意味着用户的
    // 目录名是该作品的简写。因此保留一个**相对加成**（不是下限）：prefix
    // 命中在同等 coverage 下比非 prefix 高一档，使排序里 prefix 候选仍排在
    // 前面，但不再凭空抬到 70/80。
    //
    // 注意：auto-bind（≥80 自动绑定）门槛是 ingest 阶段的独立常量
    // （AUTO_BIND_THRESHOLD），不复用本函数的 baseline——本次只降匹配评分的
    // 保底门槛，不动 auto-bind 行为。
    if c.contains(&q) || q.contains(&c) {
        let short_len = q.chars().count().min(c.chars().count()) as f64;
        let long_len = q.chars().count().max(c.chars().count()) as f64;
        // Coverage ratio in [0.0, 1.0); 1.0 was handled by exact match above.
        let coverage = short_len / long_len;
        let is_prefix =
            (c.starts_with(&q) || q.starts_with(&c)) && short_len >= 3.0;
        // 门槛降到 0：不再有人为下限抬升。真实分 = coverage 映射到 0..=99。
        let baseline: u8 = 0;
        let span = (99 - baseline) as f64;
        // prefix 相对加成（非下限）：同 coverage 下 prefix 比非 prefix 高一档，
        // 保证排序里 prefix 候选仍占优；clamp 到 99 避免越过 exact-match 的 100。
        let prefix_bonus: u8 = if is_prefix { 10 } else { 0 };
        let raw = baseline + (coverage * span) as u8;
        return raw.saturating_add(prefix_bonus).min(99);
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
        // Quick 260519-21s — baseline 降到 0 后，containment 命中只拿真实
        // coverage 分（不再有 70 下限）。这里仍验证：prefix containment 命中
        // 拿到一个明显非 0 的正分，且永远低于 exact-match 的 100。
        let s = score("CLANNAD", "CLANNAD - 全年齢版");
        assert!(s > 0 && s < 100, "got {}", s);
        // 同时它应高于一个完全不相关的低分对照，证明 containment 仍是强信号。
        assert!(
            s > score("CLANNAD", "Symphonic Rain"),
            "containment 命中应高于无关候选, got {}",
            s,
        );
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
    fn prefix_containment_scores_above_short_prefix() {
        // Quick 260519-21s — baseline 降到 0 后不再有 70/80 人为下限。
        // 原 Quick 20260512d 的语义（`アマエミ` 应作为 `アマエミ ～…～`
        // 的强 prefix 命中）改为验证**相对关系**：≥3 字符的 prefix 命中
        // 比 2 字符的短 prefix 命中分更高（更长的 prefix → 更高 coverage
        // + prefix 相对加成），且都低于 exact-match 的 100。
        let long_prefix =
            score("アマエミ", "アマエミ ～甘やかさせて♥もっとデキてる彼女～");
        let short_prefix =
            score("アマ", "アマエミ ～甘やかさせて♥もっとデキてる彼女～");
        assert!(long_prefix < 100, "shouldn't be exact, got {}", long_prefix);
        assert!(
            long_prefix > short_prefix,
            "更长的 prefix 命中应分更高: long={} short={}",
            long_prefix,
            short_prefix,
        );
    }

    #[test]
    fn prefix_scores_above_non_prefix_at_same_coverage() {
        // Quick 260519-21s — baseline 降到 0 后，prefix 不再是「下限」而是
        // 「相对加成」。验证：同等 coverage 下，prefix 命中仍比非 prefix
        // 命中分更高，保证 MetadataPicker 候选排序里 prefix 候选占优。
        //
        // `abc` vs `abcxyz`：prefix（c.starts_with(q)），coverage = 3/6。
        // `bcd` vs `abcdef`：非 prefix 子串，coverage 同为 3/6。
        let prefix_hit = score("abc", "abcxyz");
        let non_prefix_hit = score("bcd", "abcdef");
        assert!(
            prefix_hit > non_prefix_hit,
            "同 coverage 下 prefix 应高于非 prefix: prefix={} non_prefix={}",
            prefix_hit,
            non_prefix_hit,
        );
    }

    #[test]
    fn weak_containment_no_longer_floored() {
        // Quick 260519-21s — 核心需求：置信度门槛降到 0。一个 coverage 很低
        // 的 containment 候选（短串只覆盖长串一小部分）此前被 70 下限硬抬，
        // 现在应如实拿到一个明显 < 70 的低分，让用户看到「这是个差候选」。
        let s = score("Channel", "Cross Channel Long Edition Extra");
        assert!(
            s < 70,
            "弱 containment 候选不应再被抬到 70 下限, got {}",
            s,
        );
        // 仍是正分（containment 命中），用户可手动选中应用。
        assert!(s > 0, "containment 命中仍应有正分, got {}", s);
    }
}
