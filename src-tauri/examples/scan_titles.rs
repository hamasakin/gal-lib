//! One-off smoke test: walk a directory, print clean_title +
//! aggressive_clean for each top-level entry. Used to eyeball the
//! cleaning pipeline against a real galgame folder.
//!
//! Run with:
//!   cargo run --example scan_titles -- F:\galgame

use gal_lib_lib::title_clean::{aggressive_clean, clean_title};
use std::env;
use std::fs;
use std::path::Path;

fn main() {
    let path = env::args().nth(1).unwrap_or_else(|| {
        eprintln!("usage: scan_titles <directory>");
        std::process::exit(2);
    });
    let root = Path::new(&path);
    if !root.is_dir() {
        eprintln!("not a directory: {}", path);
        std::process::exit(2);
    }
    let mut entries: Vec<String> = fs::read_dir(root)
        .expect("read_dir")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    entries.sort();

    println!("scanning {} entries from {}", entries.len(), path);
    println!("─────────────────────────────────────────────────────────────");
    for raw in &entries {
        // Strip a trailing archive extension so cleaning matches what the
        // walker would see for an extracted directory.
        let stem = strip_archive_ext(raw);
        let std_clean = clean_title(stem);
        let aggressive = aggressive_clean(stem);
        let differ = std_clean != aggressive;
        println!("RAW  {}", raw);
        println!("  STD {}", std_clean);
        if differ {
            println!("  AGG {}", aggressive);
        }
        println!();
    }
}

fn strip_archive_ext(name: &str) -> &str {
    for ext in &[".rar", ".zip", ".7z", ".iso", ".mds"] {
        if let Some(stem) = name.strip_suffix(ext) {
            return stem;
        }
    }
    name
}
