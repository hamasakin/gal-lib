// Tauri v2 application entry point — minimal Builder skeleton.
// Plugins (sql/log) are added in 01c; window/title customization in 01e.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
