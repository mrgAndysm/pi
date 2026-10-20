//! Tauri commands：前端 invoke() 的入口。所有 agent 命令带 project（项目目录）参数。

use serde::Serialize;
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

use crate::rpc::RpcClient;
use crate::sidecar;

pub struct AppState {
    pub rpc: Arc<RpcClient>,
}

#[tauri::command]
pub async fn start_agent(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project: String,
    provider: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    if state.rpc.is_running(&project).await {
        return Ok(()); // 已启动则幂等返回
    }
    sidecar::spawn_agent(&app, &state.rpc, &project, provider.as_deref(), model.as_deref()).await
}

#[tauri::command]
pub async fn stop_agent(state: State<'_, AppState>, project: String) -> Result<(), String> {
    state.rpc.detach(&project).await;
    Ok(())
}

#[tauri::command]
pub async fn agent_running(state: State<'_, AppState>, project: String) -> Result<bool, String> {
    Ok(state.rpc.is_running(&project).await)
}

#[tauri::command]
pub async fn send_prompt(state: State<'_, AppState>, project: String, message: String) -> Result<(), String> {
    state.rpc.send(&project, json!({ "type": "prompt", "message": message })).await?;
    Ok(())
}

#[tauri::command]
pub async fn steer_message(state: State<'_, AppState>, project: String, message: String) -> Result<(), String> {
    state.rpc.send(&project, json!({ "type": "steer", "message": message })).await?;
    Ok(())
}

#[tauri::command]
pub async fn follow_up_message(state: State<'_, AppState>, project: String, message: String) -> Result<(), String> {
    state.rpc.send(&project, json!({ "type": "follow_up", "message": message })).await?;
    Ok(())
}

#[tauri::command]
pub async fn abort(state: State<'_, AppState>, project: String) -> Result<(), String> {
    state.rpc.send(&project, json!({ "type": "abort" })).await?;
    Ok(())
}

#[tauri::command]
pub async fn new_session(state: State<'_, AppState>, project: String) -> Result<(), String> {
    state.rpc.send(&project, json!({ "type": "new_session" })).await?;
    Ok(())
}

#[tauri::command]
pub async fn get_state(state: State<'_, AppState>, project: String) -> Result<serde_json::Value, String> {
    state.rpc.send(&project, json!({ "type": "get_state" })).await
}

#[tauri::command]
pub async fn get_available_models(state: State<'_, AppState>, project: String) -> Result<serde_json::Value, String> {
    let data = state.rpc.send(&project, json!({ "type": "get_available_models" })).await?;
    Ok(data.get("models").cloned().unwrap_or(json!([])))
}

#[tauri::command]
pub async fn set_model(state: State<'_, AppState>, project: String, provider: String, model_id: String) -> Result<(), String> {
    state
        .rpc
        .send(&project, json!({ "type": "set_model", "provider": provider, "modelId": model_id }))
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn get_session_stats(state: State<'_, AppState>, project: String) -> Result<serde_json::Value, String> {
    state.rpc.send(&project, json!({ "type": "get_session_stats" })).await
}

#[tauri::command]
pub async fn switch_session(state: State<'_, AppState>, project: String, session_path: String) -> Result<(), String> {
    state
        .rpc
        .send(&project, json!({ "type": "switch_session", "sessionPath": session_path }))
        .await?;
    Ok(())
}

/// 会话历史条目（宽松 JSON，由前端解析渲染）。
#[tauri::command]
pub async fn get_entries(state: State<'_, AppState>, project: String) -> Result<serde_json::Value, String> {
    state.rpc.send(&project, json!({ "type": "get_entries" })).await
}

// ---------- 会话文件枚举（按 cwd 编码目录，对齐 session-manager.ts 的规则） ----------

#[derive(Serialize)]
pub struct SessionFileInfo {
    pub path: String,
    pub name: Option<String>,
    pub mtime_ms: u64,
}

/// 与 getDefaultSessionDirPath 一致：`--{cwd 去掉前导斜杠、:/\ 替换为 -}--`
fn encode_cwd(cwd: &str) -> String {
    let trimmed = cwd.trim_start_matches(['/', '\\']);
    let replaced: String = trimmed
        .chars()
        .map(|c| if c == '/' || c == '\\' || c == ':' { '-' } else { c })
        .collect();
    format!("--{replaced}--")
}

fn session_dir_for(cwd: &str) -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or("找不到用户目录")?;
    Ok(PathBuf::from(home)
        .join(".pi")
        .join("agent")
        .join("sessions")
        .join(encode_cwd(cwd)))
}

/// 列出某项目目录下的所有会话文件（按修改时间倒序）。
#[tauri::command]
pub async fn list_sessions(project: String) -> Result<Vec<SessionFileInfo>, String> {
    let dir = session_dir_for(&project)?;
    let mut out: Vec<SessionFileInfo> = Vec::new();
    let read = match std::fs::read_dir(&dir) {
        Ok(r) => r,
        Err(_) => return Ok(out), // 目录不存在 = 无会话
    };
    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let mtime_ms = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        // 读首行尝试提取会话名（header JSON 的 name 字段）
        let name = std::fs::File::open(&path).ok().and_then(|f| {
            use std::io::{BufRead, BufReader};
            let mut first = String::new();
            BufReader::new(f).read_line(&mut first).ok()?;
            let v: serde_json::Value = serde_json::from_str(first.trim()).ok()?;
            v.get("name").and_then(|n| n.as_str()).map(|s| s.to_string())
        });
        out.push(SessionFileInfo {
            path: path.to_string_lossy().to_string(),
            name,
            mtime_ms,
        });
    }
    out.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
    Ok(out)
}
