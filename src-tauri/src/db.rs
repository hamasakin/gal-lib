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

use tauri_plugin_sql::{Migration, MigrationKind};

const INIT_SQL: &str = include_str!("../migrations/0001_init.sql");
const V2_SQL: &str = include_str!("../migrations/0002_add_scan_and_metadata.sql");
const V3_SQL: &str = include_str!("../migrations/0003_add_launch_and_session_status.sql");
const V4_SQL: &str = include_str!("../migrations/0004_add_brand_year_favorite.sql");
const V5_SQL: &str = include_str!("../migrations/0005_add_screenshots_and_saves.sql");

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
        assert_eq!(m.len(), 5, "v5: exactly five migrations registered");
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
}
