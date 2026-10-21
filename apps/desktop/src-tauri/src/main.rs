//! Pi Desktop —— Tauri 入口。
//! release 构建使用 windows 子系统，避免启动时弹出控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod rpc;
mod sidecar;

use std::sync::Arc;

fn main() {
    let state = commands::AppState {
        rpc: Arc::new(rpc::RpcClient::new()),
    };
    let rpc_for_exit = state.rpc.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            commands::start_agent,
            commands::stop_agent,
            commands::agent_running,
            commands::send_prompt,
            commands::steer_message,
            commands::follow_up_message,
            commands::abort,
            commands::new_session,
            commands::get_state,
            commands::get_available_models,
            commands::set_model,
            commands::get_session_stats,
            commands::switch_session,
            commands::get_entries,
            commands::list_sessions,
            sidecar::pick_project_dir,
        ])
        // 应用退出时清理所有 sidecar 子进程
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let rpc = rpc_for_exit.clone();
                tauri::async_runtime::block_on(async move {
                    rpc.detach_all().await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("运行 Pi Desktop 失败");
}
