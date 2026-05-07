import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";

let dbPromise: Promise<Database> | null = null;

/**
 * Resolve the portable data dir (e.g. `C:/.../data` or
 * `.../target/debug/data` in dev) by calling the Rust `get_data_dir` command.
 * Path returned uses the OS-native separator; convert to forward slashes
 * before passing to sqlx via `Database.load`.
 */
export async function getDataDir(): Promise<string> {
  return invoke<string>("get_data_dir");
}

/**
 * Lazy singleton accessor for the SQLite connection.
 * First call: invokes `get_data_dir`, builds `sqlite:<abs>/app.db` URL,
 * and triggers tauri-plugin-sql to open the connection (which also runs
 * pending migrations on first open).
 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const dataDir = await getDataDir();
      const url = `sqlite:${dataDir.replace(/\\/g, "/")}/app.db`;
      return Database.load(url);
    })();
  }
  return dbPromise;
}
