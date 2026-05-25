//! Database migration registry for tauri-plugin-sql.
//!
//! Schema v1 lives in `migrations/0001_init.sql` and is embedded at compile
//! time via `include_str!` so the migration ships inside the exe (no external
//! .sql file shipped alongside the binary).
//!
//! Schema v2 (Phase 2) adds `scan_roots` + 4 metadata columns on `games`.
//! Schema v3 (Phase 3) adds 3 launch-config columns on `games` and 2
//! session-status columns on `sessions` (status + exit_code).
//! Schema v4 (Phase 4) adds 3 metadata/state columns on `games`
//! (brand + release_year + is_favorite).
//! Schema v5 (Phase 5) adds 2 columns on `games` (screenshot_interval_sec +
//! save_path) and 2 new tables (`screenshots`, `save_backups`) with FK
//! ON DELETE CASCADE + per-table game_id index.
//! Schema v7 (Phase 11) adds metadata-enrichment infrastructure:
//! `games.summary` column + 3 new tables (`persons`, `game_staff`,
//! `game_official_tags`) for cross-source author/artist/VA/composer storage
//! and Bangumi/VNDB official tag lists.
//! Schema v8 (Quick 20260510b) adds `games.age_rating` (R18/全年龄/NULL)
//! and 2 new tables (`custom_views`, `custom_view_games`) for user-curated
//! game lists.
//! Schema v9 (Phase 12) adds 1 new table (`scan_review_queue`) for
//! persistent low-confidence ingest matches awaiting manual review.
//! Schema v10 (Quick 260513-404) drops `games.age_rating` column
//! (R18 分类整体删除；custom_views / custom_view_games 表保留)。
//! Schema v11 (Quick 260515-loading-phase-sort) adds `games.metadata_fetched_at`
//! column + index — dedicated sort anchor for "metadata last fetched" time.
//! Schema v12 (Quick 260516-q3y) adds 1 new table (`scan_skip_dirs`) — a
//! persistent skip-list of brand parent directories split into per-game
//! subdir entries, so a full scan never re-discovers them as games.
//! Schema v13 (Quick 260525-g1m) adds 3 columns on `games`
//! (external_rating + external_rating_count + external_rating_source) and
//! index `idx_games_external_rating` —— 官方评分（Bangumi/VNDB）入库与排序锚点。
//! Schema v14 (Quick 260526-0bi) drops `games.rating` column —— 本地用户评分
//! 字段移除，仅保留 v13 引入的官方评分 `external_rating`。

use tauri_plugin_sql::{Migration, MigrationKind};

const INIT_SQL: &str = include_str!("../migrations/0001_init.sql");
const V2_SQL: &str = include_str!("../migrations/0002_add_scan_and_metadata.sql");
const V3_SQL: &str = include_str!("../migrations/0003_add_launch_and_session_status.sql");
const V4_SQL: &str = include_str!("../migrations/0004_add_brand_year_favorite.sql");
const V5_SQL: &str = include_str!("../migrations/0005_add_screenshots_and_saves.sql");
const V6_SQL: &str = include_str!("../migrations/0006_disable_default_screenshots.sql");
const V7_SQL: &str = include_str!("../migrations/0007_add_metadata_enrichment.sql");
const V8_SQL: &str = include_str!("../migrations/0008_add_age_rating_and_custom_views.sql");
const V9_SQL: &str = include_str!("../migrations/0009_add_scan_review_queue.sql");
const V10_SQL: &str = include_str!("../migrations/0010_drop_age_rating.sql");
const V11_SQL: &str = include_str!("../migrations/0011_add_metadata_fetched_at.sql");
const V12_SQL: &str = include_str!("../migrations/0012_add_scan_skip_dirs.sql");
const V13_SQL: &str = include_str!("../migrations/0013_add_external_rating.sql");
const V14_SQL: &str = include_str!("../migrations/0014_drop_local_rating.sql");

/// All migrations to register with tauri-plugin-sql, in version order.
/// Add future migrations as additional entries with monotonically increasing
/// `version` values (sqlx tracks applied versions in `_sqlx_migrations`).
pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init_schema",
            sql: INIT_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_scan_roots_and_metadata_columns",
            sql: V2_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_launch_and_session_status",
            sql: V3_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_brand_year_favorite",
            sql: V4_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_screenshots_and_saves",
            sql: V5_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "disable_default_screenshots",
            sql: V6_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_metadata_enrichment",
            sql: V7_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_age_rating_and_custom_views",
            sql: V8_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add_scan_review_queue",
            sql: V9_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "drop_age_rating",
            sql: V10_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "add_metadata_fetched_at",
            sql: V11_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "add_scan_skip_dirs",
            sql: V12_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "add_external_rating",
            sql: V13_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "drop_local_rating",
            sql: V14_SQL,
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_v1_includes_required_objects() {
        let m = migrations();
        assert!(m.len() >= 1, "at least one migration registered");
        let m1 = m.iter().find(|x| x.version == 1).expect("v1 present");
        assert_eq!(m1.description, "init_schema");
        // sanity-check the embedded SQL covers all five tables and the schema_version row
        assert!(m1.sql.contains("CREATE TABLE games"));
        assert!(m1.sql.contains("CREATE TABLE sessions"));
        assert!(m1.sql.contains("CREATE TABLE tags"));
        assert!(m1.sql.contains("CREATE TABLE game_tags"));
        assert!(m1.sql.contains("CREATE TABLE app_meta"));
        assert!(m1.sql.contains("'schema_version', '1'"));
    }

    #[test]
    fn migrations_v2_adds_scan_roots_and_columns() {
        let m = migrations();
        assert!(m.len() >= 2, "at least two migrations registered");
        let m2 = m.iter().find(|x| x.version == 2).expect("v2 present");
        assert_eq!(m2.description, "add_scan_roots_and_metadata_columns");
        // sanity-check the embedded SQL contains the new table + 4 column adds + version bump
        assert!(m2.sql.contains("CREATE TABLE scan_roots"));
        let add_column_count = m2.sql.matches("ADD COLUMN").count();
        assert_eq!(add_column_count, 4, "v2: exactly 4 ADD COLUMN statements");
        assert!(m2.sql.contains("cover_url"));
        assert!(m2.sql.contains("metadata_source"));
        assert!(m2.sql.contains("match_confidence"));
        assert!(m2.sql.contains("last_scanned_at"));
        assert!(m2.sql.contains("schema_version") && m2.sql.contains("'2'"));
    }

    #[test]
    fn migrations_v3_adds_launch_columns_and_session_status() {
        let m = migrations();
        assert!(m.len() >= 3, "at least three migrations registered");
        let m3 = m.iter().find(|x| x.version == 3).expect("v3 present");
        assert_eq!(m3.description, "add_launch_and_session_status");

        // Phase 3 adds 3 launch-config columns on games + 2 status columns on sessions.
        // Count actual ALTER ... ADD COLUMN statements (not the substring "ADD COLUMN"
        // that may appear in SQL comments documenting the migration).
        let add_column_count = m3
            .sql
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !t.starts_with("--") && t.contains("ADD COLUMN")
            })
            .count();
        assert_eq!(add_column_count, 5, "v3: exactly 5 ADD COLUMN statements");

        // games: launch-config columns
        assert!(m3.sql.contains("le_profile"), "v3 sql contains le_profile");
        assert!(m3.sql.contains("launch_args"), "v3 sql contains launch_args");
        assert!(m3.sql.contains("cwd"), "v3 sql contains cwd");

        // sessions: status + exit_code, with the locked CHECK constraint members.
        assert!(m3.sql.contains("exit_code"), "v3 sql contains exit_code");
        assert!(
            m3.sql.contains("CHECK(status IN ('starting','running','completed','launch_failed','cancelled'))"),
            "v3 sql contains exact session status CHECK constraint"
        );

        // schema_version bumped to 3.
        assert!(
            m3.sql.contains("schema_version") && m3.sql.contains("'3'"),
            "v3 sql bumps schema_version to '3'"
        );
    }

    #[test]
    fn migrations_v4_adds_brand_year_favorite() {
        let m = migrations();
        assert!(m.len() >= 4, "at least four migrations registered");
        let m4 = m.iter().find(|x| x.version == 4).expect("v4 present");
        assert_eq!(m4.description, "add_brand_year_favorite");

        // Phase 4 adds 3 metadata/state columns on games.
        // Count actual ALTER ... ADD COLUMN statements (skip SQL comments).
        let add_column_count = m4
            .sql
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !t.starts_with("--") && t.contains("ADD COLUMN")
            })
            .count();
        assert_eq!(add_column_count, 3, "v4: exactly 3 ADD COLUMN statements");

        // games: brand + release_year + is_favorite (with exact type signatures).
        assert!(
            m4.sql.contains("brand TEXT"),
            "v4 sql contains brand TEXT"
        );
        assert!(
            m4.sql.contains("release_year INTEGER"),
            "v4 sql contains release_year INTEGER"
        );
        assert!(
            m4.sql.contains("is_favorite INTEGER NOT NULL DEFAULT 0"),
            "v4 sql contains is_favorite INTEGER NOT NULL DEFAULT 0"
        );

        // schema_version bumped to 4.
        assert!(
            m4.sql.contains("schema_version") && m4.sql.contains("'4'"),
            "v4 sql bumps schema_version to '4'"
        );
    }

    #[test]
    fn migrations_v5_adds_screenshots_and_saves() {
        let m = migrations();
        assert!(m.len() >= 5, "v5: at least five migrations registered");
        let m5 = m.iter().find(|x| x.version == 5).expect("v5 present");
        assert_eq!(m5.description, "add_screenshots_and_saves");

        // Phase 5 adds 2 columns on games + 2 new tables + 2 indexes.
        // Count actual ALTER ... ADD COLUMN statements (skip SQL comments).
        let add_column_count = m5
            .sql
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !t.starts_with("--") && t.contains("ADD COLUMN")
            })
            .count();
        assert_eq!(add_column_count, 2, "v5: exactly 2 ADD COLUMN statements");

        // games: new columns (screenshot_interval_sec + save_path).
        assert!(
            m5.sql.contains("screenshot_interval_sec"),
            "v5 sql contains screenshot_interval_sec"
        );
        assert!(
            m5.sql.contains("save_path"),
            "v5 sql contains save_path"
        );

        // New tables — screenshots + save_backups, both with FK ON DELETE CASCADE.
        assert!(
            m5.sql.contains("CREATE TABLE screenshots"),
            "v5 sql creates screenshots table"
        );
        assert!(
            m5.sql.contains("CREATE TABLE save_backups"),
            "v5 sql creates save_backups table"
        );
        // Count `ON DELETE CASCADE` only on non-comment lines (the migration's
        // header doc-comment also names the clause).
        let cascade_count = m5
            .sql
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !t.starts_with("--") && t.contains("ON DELETE CASCADE")
            })
            .count();
        assert_eq!(
            cascade_count, 2,
            "v5: both new tables use ON DELETE CASCADE"
        );

        // Indexes on game_id columns for both new tables.
        assert!(
            m5.sql.contains("CREATE INDEX idx_screenshots_game_id"),
            "v5 sql creates idx_screenshots_game_id"
        );
        assert!(
            m5.sql.contains("CREATE INDEX idx_save_backups_game_id"),
            "v5 sql creates idx_save_backups_game_id"
        );

        // schema_version bumped to 5.
        assert!(
            m5.sql.contains("schema_version") && m5.sql.contains("'5'"),
            "v5 sql bumps schema_version to '5'"
        );
    }

    #[test]
    fn migrations_v7_adds_metadata_enrichment() {
        let m = migrations();
        assert!(m.len() >= 7, "v7: at least seven migrations registered");
        let m7 = m.iter().find(|x| x.version == 7).expect("v7 present");
        assert_eq!(m7.description, "add_metadata_enrichment");

        // Phase 11 adds 1 column on games + 3 new tables + 4 indexes.
        let add_column_count = m7
            .sql
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !t.starts_with("--") && t.contains("ADD COLUMN")
            })
            .count();
        assert_eq!(add_column_count, 1, "v7: exactly 1 ADD COLUMN statement");

        // games.summary column
        assert!(
            m7.sql.contains("ADD COLUMN summary TEXT"),
            "v7 sql adds summary TEXT column to games"
        );

        // 3 new tables
        assert!(
            m7.sql.contains("CREATE TABLE persons"),
            "v7 sql creates persons table"
        );
        assert!(
            m7.sql.contains("CREATE TABLE game_staff"),
            "v7 sql creates game_staff table"
        );
        assert!(
            m7.sql.contains("CREATE TABLE game_official_tags"),
            "v7 sql creates game_official_tags table"
        );

        // role CHECK constraint with the locked 4-role enum
        assert!(
            m7.sql.contains("CHECK(role IN ('scenario','artist','voice','music'))"),
            "v7 sql contains exact game_staff role CHECK constraint"
        );

        // FK ON DELETE CASCADE on both N:M tables
        let cascade_count = m7
            .sql
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !t.starts_with("--") && t.contains("ON DELETE CASCADE")
            })
            .count();
        assert!(
            cascade_count >= 3,
            "v7: at least 3 ON DELETE CASCADE clauses (game_staff×2, official_tags×1)"
        );

        // 4 indexes
        assert!(
            m7.sql.contains("CREATE INDEX idx_game_staff_game"),
            "v7 sql creates idx_game_staff_game"
        );
        assert!(
            m7.sql.contains("CREATE INDEX idx_game_staff_person_role"),
            "v7 sql creates idx_game_staff_person_role"
        );
        assert!(
            m7.sql.contains("CREATE INDEX idx_official_tags_game"),
            "v7 sql creates idx_official_tags_game"
        );
        assert!(
            m7.sql.contains("CREATE INDEX idx_official_tags_name"),
            "v7 sql creates idx_official_tags_name"
        );

        // schema_version bumped to 7
        assert!(
            m7.sql.contains("schema_version") && m7.sql.contains("'7'"),
            "v7 sql bumps schema_version to '7'"
        );
    }

    #[test]
    fn migrations_v8_adds_age_rating_and_custom_views() {
        let m = migrations();
        let m8 = m.iter().find(|x| x.version == 8).expect("v8 present");
        assert_eq!(m8.description, "add_age_rating_and_custom_views");

        // 1 ADD COLUMN (games.age_rating)
        let add_column_count = m8
            .sql
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !t.starts_with("--") && t.contains("ADD COLUMN")
            })
            .count();
        assert_eq!(add_column_count, 1, "v8: exactly 1 ADD COLUMN statement");

        assert!(
            m8.sql.contains("ADD COLUMN age_rating TEXT"),
            "v8 adds age_rating column"
        );
        assert!(
            m8.sql.contains("age_rating IN ('all_ages','r18')"),
            "v8 enforces age_rating CHECK constraint"
        );

        // 2 new tables
        assert!(
            m8.sql.contains("CREATE TABLE custom_views"),
            "v8 creates custom_views"
        );
        assert!(
            m8.sql.contains("CREATE TABLE custom_view_games"),
            "v8 creates custom_view_games"
        );

        // FK ON DELETE CASCADE on join table (×2 for view_id + game_id)
        let cascade_count = m8
            .sql
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !t.starts_with("--") && t.contains("ON DELETE CASCADE")
            })
            .count();
        assert_eq!(cascade_count, 2, "v8: 2 ON DELETE CASCADE clauses");

        assert!(
            m8.sql.contains("CREATE INDEX idx_custom_view_games_game"),
            "v8 creates idx_custom_view_games_game"
        );

        // schema_version bumped to 8
        assert!(
            m8.sql.contains("schema_version") && m8.sql.contains("'8'"),
            "v8 bumps schema_version to '8'"
        );
    }

    #[test]
    fn migrations_v9_adds_scan_review_queue() {
        let m = migrations();
        let m9 = m.iter().find(|x| x.version == 9).expect("v9 present");
        assert_eq!(m9.description, "add_scan_review_queue");

        // No ADD COLUMN — only a new table + index
        let add_column_count = m9
            .sql
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !t.starts_with("--") && t.contains("ADD COLUMN")
            })
            .count();
        assert_eq!(add_column_count, 0, "v9: no ADD COLUMN statements");

        // New table
        assert!(
            m9.sql.contains("CREATE TABLE scan_review_queue"),
            "v9 creates scan_review_queue"
        );

        // FK ON DELETE CASCADE on game_id (drops queue rows when their game is deleted)
        let cascade_count = m9
            .sql
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !t.starts_with("--") && t.contains("ON DELETE CASCADE")
            })
            .count();
        assert_eq!(cascade_count, 1, "v9: 1 ON DELETE CASCADE clause");

        // Index for ORDER BY created_at DESC
        assert!(
            m9.sql.contains("CREATE INDEX idx_scan_review_queue_created"),
            "v9 creates idx_scan_review_queue_created"
        );

        // schema_version bumped to 9
        assert!(
            m9.sql.contains("schema_version") && m9.sql.contains("'9'"),
            "v9 bumps schema_version to '9'"
        );
    }

    #[test]
    fn migrations_v10_drops_age_rating() {
        let m = migrations();
        let m10 = m.iter().find(|x| x.version == 10).expect("v10 present");
        assert_eq!(m10.description, "drop_age_rating");

        // No ADD COLUMN — this migration only drops a column.
        let add_column_count = m10
            .sql
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !t.starts_with("--") && t.contains("ADD COLUMN")
            })
            .count();
        assert_eq!(add_column_count, 0, "v10: no ADD COLUMN statements");

        // DROP COLUMN age_rating — sqlx 0.8 bundles SQLite >= 3.42 so the
        // native `ALTER TABLE ... DROP COLUMN` form is fine.
        assert!(
            m10.sql.contains("DROP COLUMN age_rating"),
            "v10 drops age_rating column"
        );

        // schema_version bumped to 10
        assert!(
            m10.sql.contains("schema_version") && m10.sql.contains("'10'"),
            "v10 bumps schema_version to '10'"
        );
    }

    #[test]
    fn migrations_v14_drops_local_rating() {
        let m = migrations();
        let m14 = m.iter().find(|x| x.version == 14).expect("v14 present");
        assert_eq!(m14.description, "drop_local_rating");

        // No ADD COLUMN — this migration only drops a column.
        let add_column_count = m14
            .sql
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !t.starts_with("--") && t.contains("ADD COLUMN")
            })
            .count();
        assert_eq!(add_column_count, 0, "v14: no ADD COLUMN statements");

        assert!(
            m14.sql.contains("DROP COLUMN rating"),
            "v14 drops rating column"
        );
        assert!(
            m14.sql.contains("schema_version") && m14.sql.contains("'14'"),
            "v14 bumps schema_version to '14'"
        );
    }
}
