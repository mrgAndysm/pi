//! 启动 sidecar pi.exe 进程。
//! Windows 下使用 CREATE_NO_WINDOW 标志隐藏控制台窗口。

use crate::rpc::RpcClient;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 为指定项目启动 pi.exe --mode rpc 子进程。
pub async fn spawn_agent(
    app: &AppHandle,
    rpc: &RpcClient,
    project: &str,
    _provider: Option<&str>,
    _model: Option<&str>,
) -> Result<(), String> {
    // sidecar 在打包后位于资源目录 binaries/ 下
    let sidecar_path = app
        .path()
        .resolve(
            "binaries/pi-x86_64-pc-windows-msvc.exe",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("找不到 sidecar: {e}"))?;

    let args = vec!["--mode", "rpc"];

    // tokio::process::Command 支持 Windows CREATE_NO_WINDOW
    let mut cmd = tokio::process::Command::new(&sidecar_path);
    cmd.args(&args)
        .current_dir(project)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("启动 pi.exe 失败: {e}"))?;

    let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
    let stderr = child.stderr.take().ok_or("无法获取 stderr")?;

    rpc.attach(project.to_string(), child, stdout, stderr, app.clone())
        .await;
    Ok(())
}

/// 打开目录选择器。
#[tauri::command]
pub async fn pick_project_dir(app: AppHandle) -> Result<Option<String>, String> {
    let result = app.dialog().file().blocking_pick_folder();
    match result {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}
