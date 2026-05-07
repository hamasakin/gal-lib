//! Database migration registry for tauri-plugin-sql.
//!
//! Schema v1 lives in `migrations/0001_init.sql` and is embedded at compile
//! time via `include_str!` so the migration ships inside the exe (no external
//! .sql file shipped alongside the binary).
//!
//! Schema v2 (Phase 2) adds `scan_roots` + 4 metadata columns on `games`.

use tauri_plugin_sql::{Migration, MigrationKind};

const INIT_SQL: &str = include_str!("../migrations/0001_init.sql");
const V2_SQL: &str = include_str!("../migrations/0002_add_scan_and_metadata.sql");

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
        assert_eq!(m.len(), 2, "v2: exactly two migrations registered");
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
}
