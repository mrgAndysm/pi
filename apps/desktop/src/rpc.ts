import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ModelInfo, PiEvent, RpcSessionState, SessionStats } from "./types";

/** 启动指定项目的 sidecar pi.exe (--mode rpc)。幂等：已启动则直接返回。 */
export function startAgent(project: string, provider?: string, model?: string): Promise<void> {
	return invoke("start_agent", { project, provider, model });
}

export function stopAgent(project: string): Promise<void> {
	return invoke("stop_agent", { project });
}

export function sendPrompt(project: string, message: string): Promise<void> {
	return invoke("send_prompt", { project, message });
}

export function followUp(project: string, message: string): Promise<void> {
	return invoke("follow_up_message", { project, message });
}

export function abort(project: string): Promise<void> {
	return invoke("abort", { project });
}

export function newSession(project: string): Promise<void> {
	return invoke("new_session", { project });
}

export function getState(project: string): Promise<RpcSessionState> {
	return invoke("get_state", { project });
}

export function getAvailableModels(project: string): Promise<ModelInfo[]> {
	return invoke("get_available_models", { project });
}

export function setModel(project: string, provider: string, modelId: string): Promise<void> {
	return invoke("set_model", { project, provider, modelId });
}

export function getSessionStats(project: string): Promise<SessionStats> {
	return invoke("get_session_stats", { project });
}

export function switchSession(project: string, sessionPath: string): Promise<void> {
	return invoke("switch_session", { project, sessionPath });
}

export interface SessionFileInfo {
	path: string;
	name?: string;
	mtime_ms: number;
}

export function listSessions(project: string): Promise<SessionFileInfo[]> {
	return invoke("list_sessions", { project });
}

/** get_entries 的返回结构：条目数组 + 当前叶子 id（RPC 返回的是对象，不是数组）。 */
export interface EntriesResult {
	entries: unknown[];
	leafId: string | null;
}

export function getEntries(project: string): Promise<EntriesResult> {
	return invoke("get_entries", { project });
}

/** 订阅 sidecar 事件：payload 带 project 标签。 */
export function onPiEvent(listener: (project: string, event: PiEvent) => void): Promise<UnlistenFn> {
	return listen<{ project: string; event: PiEvent }>("pi-event", (e) => listener(e.payload.project, e.payload.event));
}

/** sidecar 进程退出通知。 */
export function onSidecarExit(listener: (project: string, code: number | null) => void): Promise<UnlistenFn> {
	return listen<{ project: string; code: number | null }>("sidecar-exit", (e) => listener(e.payload.project, e.payload.code));
}
