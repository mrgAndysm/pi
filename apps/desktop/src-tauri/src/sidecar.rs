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
    // externalBin 打包后 pi.exe 与主程序同级；开发环境下回退到资源目录
    let exe_path = std::env::current_exe().map_err(|e| format!("无法定位当前可执行文件: {e}"))?;
    let sidecar_path = exe_path
        .parent()
        .map(|dir| dir.join("pi.exe"))
        .filter(|p| p.exists())
        .or_else(|| {
            app.path()
                .resolve(
                    "binaries/pi-x86_64-pc-windows-msvc.exe",
                    tauri::path::BaseDirectory::Resource,
                )
                .ok()
                .filter(|p| p.exists())
        })
        .ok_or_else(|| {
            format!(
                "找不到 sidecar pi.exe（期望位置: {}）",
                exe_path
                    .parent()
                    .map(|d| d.join("pi.exe").display().to_string())
                    .unwrap_or_default()
            )
        })?;

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

    // pi 独立二进制从 exe 同目录查找 theme/ 等资源，打包后资源位于 binaries/，用环境变量指过去
    if let Some(res_dir) = exe_path
        .parent()
        .map(|d| d.join("binaries"))
        .filter(|d| d.join("package.json").exists())
    {
        cmd.env("PI_PACKAGE_DIR", res_dir);
    }

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
