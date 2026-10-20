import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatView } from "./components/ChatView";
import { InputBox } from "./components/InputBox";
import { ModelPicker } from "./components/ModelPicker";
import { ProjectSidebar, type Project } from "./components/ProjectSidebar";
import * as rpc from "./rpc";
import type { ChatMessage, ModelInfo, PiEvent, RpcSessionState, SessionStats, ToolCallItem } from "./types";

let msgSeq = 0;
const nextId = () => `m_${++msgSeq}`;

/** 把 Pi 流式事件折叠进消息列表。 */
function applyEvent(messages: ChatMessage[], ev: PiEvent): ChatMessage[] {
	const next = [...messages];
	const lastAssistant = (): ChatMessage | undefined => {
		for (let i = next.length - 1; i >= 0; i--) {
			if (next[i].role === "assistant") return next[i];
		}
		return undefined;
	};
	switch (ev.type) {
		case "message_start": {
			const msg = ev.message as { role?: string } | undefined;
			if (msg?.role === "assistant") {
				next.push({ id: nextId(), role: "assistant", text: "", toolCalls: [], streaming: true });
			}
			break;
		}
		case "message_update": {
			const cur = lastAssistant();
			const aev = ev.assistantMessageEvent as { type?: string; delta?: string } | undefined;
			if (cur && aev?.type === "text_delta" && typeof aev.delta === "string") {
				next[next.indexOf(cur)] = { ...cur, text: cur.text + aev.delta };
			}
			break;
		}
		case "message_end": {
			const cur = lastAssistant();
			if (cur) next[next.indexOf(cur)] = { ...cur, streaming: false };
			break;
		}
		case "toolcall_start": {
			const cur = lastAssistant();
			if (!cur) break;
			const tool: ToolCallItem = {
				id: String(ev.id ?? nextId()),
				toolName: String(ev.toolName ?? "tool"),
				args: (ev as Record<string, unknown>).args,
				done: false,
			};
			next[next.indexOf(cur)] = { ...cur, toolCalls: [...cur.toolCalls, tool] };
			break;
		}
		case "toolcall_end": {
			const cur = lastAssistant();
			if (!cur) break;
			const result = (ev as Record<string, unknown>).result;
			const isError = Boolean((ev as Record<string, unknown>).isError);
			const toolCalls = cur.toolCalls.map((t) =>
				t.id === String(ev.id)
					? { ...t, done: true, isError, result: typeof result === "string" ? result : JSON.stringify(result, null, 2) }
					: t,
			);
			next[next.indexOf(cur)] = { ...cur, toolCalls };
			break;
		}
		case "agent_settled": {
			const cur = lastAssistant();
			if (cur?.streaming) next[next.indexOf(cur)] = { ...cur, streaming: false };
			break;
		}
		case "compaction_start":
			next.push({ id: nextId(), role: "system", text: "⏳ 正在压缩上下文…", toolCalls: [], streaming: false });
			break;
		case "compaction_end":
			next.push({ id: nextId(), role: "system", text: "✓ 上下文压缩完成", toolCalls: [], streaming: false });
			break;
		default:
			break;
	}
	return next;
}

/** 从 get_entries 结果提取可渲染的消息历史（宽松解析）。 */
function entriesToMessages(entries: unknown[]): ChatMessage[] {
	const out: ChatMessage[] = [];
	for (const e of entries) {
		const entry = e as { type?: string; message?: { role?: string; content?: unknown } };
		if (entry.type !== "message" || !entry.message) continue;
		const { role, content } = entry.message;
		if (role !== "user" && role !== "assistant") continue;
		let text = "";
		if (typeof content === "string") text = content;
		else if (Array.isArray(content)) {
			for (const c of content) {
				const block = c as { type?: string; text?: string };
				if (block?.type === "text" && block.text) text += block.text;
			}
		}
		if (!text.trim()) continue;
		out.push({ id: nextId(), role, text, toolCalls: [], streaming: false });
	}
	return out;
}

const PROJECTS_KEY = "pi-desktop-projects";

function loadProjects(): Project[] {
	try {
		const raw = localStorage.getItem(PROJECTS_KEY);
		if (!raw) return [];
		const arr = JSON.parse(raw);
		return Array.isArray(arr) ? arr.filter((p) => p && typeof p.path === "string") : [];
	} catch {
		return [];
	}
}

export default function App() {
	const [projects, setProjects] = useState<Project[]>(loadProjects);
	const [activeProject, setActiveProject] = useState<string>();
	const [runningProjects, setRunningProjects] = useState<Set<string>>(new Set());
	/** 每个项目独立的消息列表 */
	const [messagesByProject, setMessagesByProject] = useState<Record<string, ChatMessage[]>>({});
	const [sessions, setSessions] = useState<rpc.SessionFileInfo[]>([]);
	const [activeSessionPath, setActiveSessionPath] = useState<string>();
	const [state, setState] = useState<RpcSessionState>();
	const [models, setModels] = useState<ModelInfo[]>([]);
	const [stats, setStats] = useState<SessionStats>();
	const [startError, setStartError] = useState<string>();
	const chatRef = useRef<HTMLDivElement>(null);

	const messages = activeProject ? (messagesByProject[activeProject] ?? []) : [];

	const patchMessages = useCallback((project: string, fn: (msgs: ChatMessage[]) => ChatMessage[]) => {
		setMessagesByProject((prev) => ({ ...prev, [project]: fn(prev[project] ?? []) }));
	}, []);

	const refreshState = useCallback(async (project: string) => {
		try {
			setState(await rpc.getState(project));
		} catch {
			/* agent 未就绪 */
		}
	}, []);

	const refreshSessions = useCallback(async (project: string) => {
		try {
			setSessions(await rpc.listSessions(project));
		} catch {
			/* ignore */
		}
	}, []);

	/** 切换项目：懒启动 sidecar，加载会话列表与状态。 */
	const selectProject = useCallback(
		async (path: string) => {
			setActiveProject(path);
			setStartError(undefined);
			setActiveSessionPath(undefined);
			setSessions([]);
			setState(undefined);
			try {
				await rpc.startAgent(path);
				setRunningProjects((prev) => new Set(prev).add(path));
				await refreshState(path);
				await refreshSessions(path);
				rpc.getAvailableModels(path).then(setModels).catch(() => {});
				rpc.getSessionStats(path).then(setStats).catch(() => {});
			} catch (e) {
				setStartError(String(e));
			}
		},
		[refreshState, refreshSessions],
	);

	// 订阅 sidecar 事件（按 project 路由到对应消息列表）
	useEffect(() => {
		let un1: (() => void) | undefined;
		let un2: (() => void) | undefined;
		rpc.onPiEvent((project, ev) => {
			patchMessages(project, (msgs) => applyEvent(msgs, ev));
			if (ev.type === "agent_settled") {
				setActiveProject((cur) => {
					if (cur === project) {
						refreshState(project);
						rpc.getSessionStats(project).then(setStats).catch(() => {});
						refreshSessions(project);
					}
					return cur;
				});
			}
		}).then((u) => (un1 = u));
		rpc.onSidecarExit((project) => {
			setRunningProjects((prev) => {
				const next = new Set(prev);
				next.delete(project);
				return next;
			});
			patchMessages(project, (msgs) => [
				...msgs,
				{ id: nextId(), role: "system", text: "✗ agent 进程已退出", toolCalls: [], streaming: false },
			]);
		}).then((u) => (un2 = u));
		return () => {
			un1?.();
			un2?.();
		};
	}, [patchMessages, refreshState, refreshSessions]);

	// 自动滚动到底部
	useEffect(() => {
		const el = chatRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages]);

	const addProject = async () => {
		const selected = await open({ directory: true, multiple: false, title: "选择项目目录" });
		if (typeof selected !== "string") return;
		const path = selected;
		const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
		setProjects((prev) => {
			if (prev.some((p) => p.path === path)) return prev;
			const next = [...prev, { path, name }];
			localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
			return next;
		});
		selectProject(path);
	};

	const removeProject = (path: string) => {
		rpc.stopAgent(path).catch(() => {});
		setProjects((prev) => {
			const next = prev.filter((p) => p.path !== path);
			localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
			return next;
		});
		if (activeProject === path) {
			setActiveProject(undefined);
			setMessagesByProject((prev) => {
				const next = { ...prev };
				delete next[path];
				return next;
			});
		}
	};

	const selectSession = async (sessionPath: string) => {
		if (!activeProject) return;
		try {
			await rpc.switchSession(activeProject, sessionPath);
			setActiveSessionPath(sessionPath);
			const entries = await rpc.getEntries(activeProject);
			patchMessages(activeProject, () => entriesToMessages(entries));
			refreshState(activeProject);
		} catch (e) {
			patchMessages(activeProject, (msgs) => [
				...msgs,
				{ id: nextId(), role: "system", text: `✗ 切换会话失败: ${String(e)}`, toolCalls: [], streaming: false },
			]);
		}
	};

	const handleNewSession = async () => {
		if (!activeProject) return;
		await rpc.newSession(activeProject);
		patchMessages(activeProject, () => []);
		setActiveSessionPath(undefined);
		refreshState(activeProject);
		refreshSessions(activeProject);
	};

	const handleSend = async (text: string, mode: "prompt" | "followUp") => {
		if (!activeProject) return;
		patchMessages(activeProject, (msgs) => [
			...msgs,
			{ id: nextId(), role: "user", text, toolCalls: [], streaming: false },
		]);
		try {
			if (mode === "followUp" || state?.isStreaming) {
				await rpc.followUp(activeProject, text);
			} else {
				await rpc.sendPrompt(activeProject, text);
			}
		} catch (e) {
			patchMessages(activeProject, (msgs) => [
				...msgs,
				{ id: nextId(), role: "system", text: `✗ 发送失败: ${String(e)}`, toolCalls: [], streaming: false },
			]);
		}
	};

	return (
		<div className="app">
			<div className="scanlines" />
			<ProjectSidebar
				projects={projects}
				activeProject={activeProject}
				sessions={sessions}
				activeSessionPath={activeSessionPath}
				onSelectProject={selectProject}
				onAddProject={addProject}
				onRemoveProject={removeProject}
				onSelectSession={selectSession}
				onNewSession={handleNewSession}
				busy={state?.isStreaming ?? false}
			/>
			<div className="main">
				{!activeProject ? (
					<div className="setup-page">
						<h1 className="neon-title">PI DESKTOP</h1>
						<div className="setup-hint">◈ 从左侧选择或添加项目目录开始 ◈</div>
						{startError && <div className="error">启动失败：{startError}</div>}
					</div>
				) : (
					<>
						<div className="project-banner">
							<span className="project-banner-path">{activeProject}</span>
							{runningProjects.has(activeProject) ? (
								<span className="badge badge-on">AGENT ONLINE</span>
							) : (
								<span className="badge badge-off">AGENT OFFLINE</span>
							)}
							{startError && <span className="error"> {startError}</span>}
						</div>
						<div className="chat-scroll" ref={chatRef}>
							<ChatView messages={messages} />
						</div>
						<InputBox
							streaming={state?.isStreaming ?? false}
							disabled={!runningProjects.has(activeProject)}
							onSend={handleSend}
							onAbort={() => activeProject && rpc.abort(activeProject).catch(() => {})}
						/>
						<div className="status-bar">
							<ModelPicker
								models={models}
								current={state?.model ? { provider: state.model.provider, id: state.model.id } : undefined}
								disabled={state?.isStreaming ?? false}
								onChange={(provider, modelId) =>
									activeProject && rpc.setModel(activeProject, provider, modelId).then(() => refreshState(activeProject)).catch(() => {})
								}
							/>
							<div className="status-item">thinking: {state?.thinkingLevel ?? "-"}</div>
							{stats && (
								<div className="status-item">
									tokens: {stats.totalInput + stats.totalOutput} · 费用: ${stats.totalCost?.toFixed(4) ?? "0"}
								</div>
							)}
							{state?.isStreaming && (
								<div className="status-item">
									<span className="streaming-dot" /> 生成中
								</div>
							)}
						</div>
					</>
				)}
			</div>
		</div>
	);
}
