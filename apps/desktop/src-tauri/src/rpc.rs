//! JSONL RPC 客户端，复刻 packages/coding-agent/src/modes/rpc/rpc-client.ts 的语义：
//! - 每条命令分配 `req_N` id，单行 JSON 写入 stdin
//! - stdout 按行解析：`type == "response"` 且 id 命中 pending → 完成请求；其余作为 session 事件广播
//! - 30 秒请求超时
//!
//! 多项目：每个项目（cwd）一个独立 sidecar 进程，事件携带 project 标签广播。
//! Windows 下使用 CREATE_NO_WINDOW 隐藏 sidecar 的控制台窗口。

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdout};
use tokio::sync::{oneshot, Mutex};

/// 与 RpcClient 一致的 30s 请求超时
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>;

/// 运行中的 sidecar 会话。
pub struct AgentHandle {
    /// Option 以便 kill() 时能 take 出所有权
    child: Mutex<Option<Child>>,
    pending: PendingMap,
}

/// 多项目 RPC 客户端：key 为项目目录（cwd）。
pub struct RpcClient {
    agents: Arc<Mutex<HashMap<String, Arc<AgentHandle>>>>,
    counter: AtomicU64,
}

impl RpcClient {
    pub fn new() -> Self {
        Self {
            agents: Arc::new(Mutex::new(HashMap::new())),
            counter: AtomicU64::new(0),
        }
    }

    pub async fn is_running(&self, project: &str) -> bool {
        self.agents.lock().await.contains_key(project)
    }

    /// 注册已 spawn 的 sidecar 子进程，并启动 stdout/stderr 读取循环。
    pub async fn attach(
        &self,
        project: String,
        child: Child,
        stdout: ChildStdout,
        stderr: ChildStderr,
        app: AppHandle,
    ) {
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let pending_for_loop = pending.clone();
        let agents_for_exit = self.agents.clone();
        let project_for_loop = project.clone();

        // stdout 读取循环
        let app_for_stdout = app.clone();
        let project_for_stdout = project.clone();
        tauri::async_runtime::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                handle_line(&line, &pending_for_loop, &app_for_stdout, &project_for_stdout).await;
            }
            // stdout EOF = 进程退出
            let mut map = pending_for_loop.lock().await;
            for (_, tx) in map.drain() {
                let _ = tx.send(Err("agent 进程退出".into()));
            }
            drop(map);
            agents_for_exit.lock().await.remove(&project_for_stdout);
            let _ = app_for_stdout.emit(
                "sidecar-exit",
                json!({ "project": project_for_stdout, "code": null }),
            );
        });

        // stderr 读取循环（仅记录）
        tauri::async_runtime::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[pi:{}] {}", project_for_loop, line);
            }
        });

        self.agents.lock().await.insert(
            project,
            Arc::new(AgentHandle {
                child: Mutex::new(Some(child)),
                pending,
            }),
        );
    }

    /// 终止指定项目的 sidecar。
    pub async fn detach(&self, project: &str) {
        let handle = self.agents.lock().await.remove(project);
        if let Some(handle) = handle {
            if let Some(mut child) = handle.child.lock().await.take() {
                let _ = child.kill().await;
            }
        }
    }

    /// 终止所有 sidecar（应用退出时调用）。
    pub async fn detach_all(&self) {
        let mut map = self.agents.lock().await;
        for (_, handle) in map.drain() {
            if let Some(mut child) = handle.child.lock().await.take() {
                let _ = child.kill().await;
            }
        }
    }

    /// 发送一条 RPC 命令并等待响应的 data 字段。
    pub async fn send(&self, project: &str, mut command: Value) -> Result<Value, String> {
        let id = format!("req_{}", self.counter.fetch_add(1, Ordering::Relaxed) + 1);
        command["id"] = json!(id);

        let (tx, rx) = oneshot::channel::<Result<Value, String>>();

        let agent = {
            let map = self.agents.lock().await;
            map.get(project).cloned()
        };
        let agent = agent.ok_or_else(|| format!("项目未启动 agent: {project}"))?;
        agent.pending.lock().await.insert(id.clone(), tx);

        // 单行 JSON + \n
        let mut line = serde_json::to_string(&command).map_err(|e| e.to_string())?;
        line.push('\n');
        {
            let mut child_guard = agent.child.lock().await;
            let child = child_guard.as_mut().ok_or("agent 进程已终止")?;
            let stdin = child.stdin.as_mut().ok_or("agent stdin 不可用")?;
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| format!("写入 stdin 失败: {e}"))?;
        }

        match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("agent 进程已退出".into()),
            Err(_) => Err(format!("等待响应超时: {}", command["type"])),
        }
    }
}

/// 处理一行 stdout：response 路由到 pending，其余作为事件广播（带 project 标签）。
async fn handle_line(line: &str, pending: &PendingMap, app: &AppHandle, project: &str) {
    if line.is_empty() {
        return;
    }
    let Ok(data) = serde_json::from_str::<Value>(line) else {
        return; // 忽略非 JSON 行
    };

    let is_response = data.get("type").and_then(Value::as_str) == Some("response");
    if is_response {
        if let Some(id) = data.get("id").and_then(Value::as_str) {
            let mut map = pending.lock().await;
            if let Some(tx) = map.remove(id) {
                let success = data.get("success").and_then(Value::as_bool) == Some(true);
                let result = if success {
                    Ok(data.get("data").cloned().unwrap_or(Value::Null))
                } else {
                    Err(data
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("未知错误")
                        .to_string())
                };
                let _ = tx.send(result);
                return;
            }
        }
    }

    // session 事件 → 前端，附带 project 以便多项目区分
    let _ = app.emit("pi-event", json!({ "project": project, "event": data }));
}
