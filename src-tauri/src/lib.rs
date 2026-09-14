//! sub2api 重授权台 · 本地单机版。
//!
//! 与服务器端 CLI（`sub2api-operator`）共用同一套核心逻辑（path 依赖），
//! 本 crate 只负责：界面 IPC、进度事件转发、本地浏览器 worker 的唤醒。

mod commands;
mod state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            state::init(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::check_engines,
            commands::load_settings,
            commands::save_settings,
            commands::load_credentials,
            commands::save_credentials,
            commands::list_accounts,
            commands::start_reauth,
            commands::cancel_reauth,
            commands::apply_result,
            commands::check_cdk_left,
            commands::merge_cdk,
            commands::open_external,
            commands::ping,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
