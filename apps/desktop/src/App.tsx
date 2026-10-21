import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatView } from "./components/ChatView";
import { InputBox } from "./components/InputBox";
import { ModelPicker } from "./components/ModelPicker";
import { ProjectSidebar, type Project } from "./components/ProjectSidebar";
import * as rpc from "./rpc";
import type { ChatMessage, MessageBadge, ModelInfo, PiEvent, RpcSessionState, SessionStats, ToolCallItem } from "./types";

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
		// 工具执行生命周期：RPC 转发的是 agent 的 tool_execution_* 事件
		case "tool_execution_start": {
			// 没有 assistant 气泡时（例如历史被清空）补一个，保证动作可见
			let cur = lastAssistant();
			if (!cur) {
				cur = { id: nextId(), role: "assistant", text: "", toolCalls: [], streaming: true };
				next.push(cur);
			}
			const tool: ToolCallItem = {
				id: String(ev.toolCallId ?? nextId()),
				toolName: String(ev.toolName ?? "tool"),
				args: ev.args,
				done: false,
			};
			next[next.indexOf(cur)] = { ...cur, toolCalls: [...cur.toolCalls, tool] };
			break;
		}
		case "tool_execution_update": {
			// 流式部分结果（如 bash 增量输出），只做预览，结束时由 end 事件覆盖
			const cur = lastAssistant();
			if (!cur) break;
			const id = String(ev.toolCallId);
			next[next.indexOf(cur)] = {
				...cur,
				toolCalls: cur.toolCalls.map((t) => (t.id === id ? { ...t, result: ev.partialResult } : t)),
			};
			break;
		}
		case "tool_execution_end": {
			const cur = lastAssistant();
			if (!cur) break;
			const id = String(ev.toolCallId);
			next[next.indexOf(cur)] = {
				...cur,
				toolCalls: cur.toolCalls.map((t) =>
					t.id === id
						? {
								...t,
								done: true,
								isError: Boolean(ev.isError),
								result: ev.result,
								durationMs: typeof ev.durationMs === "number" ? ev.durationMs : undefined,
							}
						: t,
				),
			};
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

/** 识别用户输入里的技能块 / 斜杠命令，拆出展示文本与徽标。 */
function parseUserInput(text: string): { text: string; badge?: MessageBadge } {
	// 历史记录里技能已展开为 <skill name="..." location="..."> 块，尾部可能跟调用参数
	const skillBlock = text.match(/^<skill name="([^"]+)" location="[^"]*">\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/);
	if (skillBlock) {
		return { text: skillBlock[2]?.trim() ?? "", badge: { kind: "skill", name: skillBlock[1] } };
	}
	// 本地刚发送、尚未展开的 /skill:name 输入
	const skillCommand = text.match(/^\/skill:([^\s]+)\s*([\s\S]*)$/);
	if (skillCommand) {
		return { text: skillCommand[2].trim(), badge: { kind: "skill", name: skillCommand[1] } };
	}
	// 其它斜杠命令，如 /compact、/help
	const command = text.match(/^\/([^\s]+)\s*([\s\S]*)$/);
	if (command) {
		return { text: command[2].trim(), badge: { kind: "command", name: command[1] } };
	}
	return { text };
}

/** 从 get_entries 结果提取可渲染的消息历史（包含工具调用与结果）。 */
function entriesToMessages(entries: unknown): ChatMessage[] {
	const out: ChatMessage[] = [];
	// 防御：结构异常时返回空列表，不让异常进入渲染阶段
	if (!Array.isArray(entries)) return out;
	/** toolCallId → 卡片引用，用于后置的 toolResult 回填 */
	const toolsById = new Map<string, ToolCallItem>();

	for (const e of entries) {
		const entry = e as {
			type?: string;
			message?: {
				role?: string;
				content?: unknown;
				toolCallId?: string;
				toolName?: string;
				isError?: boolean;
				durationMs?: number;
			};
		};
		if (entry.type !== "message" || !entry.message) continue;
		const { role, content } = entry.message;

		// 工具结果作为独立消息记录，按 toolCallId 回填到对应卡片
		if (role === "toolResult") {
			const tool = toolsById.get(String(entry.message.toolCallId ?? ""));
			if (tool) {
				tool.result = content;
				tool.isError = Boolean(entry.message.isError);
				tool.done = true;
				if (typeof entry.message.durationMs === "number") tool.durationMs = entry.message.durationMs;
			}
			continue;
		}

		if (role !== "user" && role !== "assistant") continue;
		let text = "";
		const toolCalls: ToolCallItem[] = [];
		if (typeof content === "string") {
			text = content;
		} else if (Array.isArray(content)) {
			for (const c of content) {
				const block = c as { type?: string; text?: string; id?: string; name?: string; arguments?: unknown };
				if (block?.type === "text" && block.text) text += block.text;
				// assistant 内容块里的工具调用：type = "toolCall"
				if (block?.type === "toolCall" && block.id) {
					const tool: ToolCallItem = {
						id: block.id,
						toolName: block.name ?? "tool",
						args: block.arguments,
						done: false,
					};
					toolCalls.push(tool);
					toolsById.set(tool.id, tool);
				}
			}
		}
		if (!text.trim() && toolCalls.length === 0) continue;
		// 用户消息可能带 /skill 或 /命令，拆出徽标后只展示正文
		const parsed = role === "user" ? parseUserInput(text) : { text };
		out.push({ id: nextId(), role, text: parsed.text, toolCalls, badge: parsed.badge, streaming: false });
	}

	// 没有结果记录的调用（会话中断等）也标记为已结束，避免一直显示执行中
	for (const tool of toolsById.values()) tool.done = true;
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
			const { entries } = await rpc.getEntries(activeProject);
			// 先在更新函数外解析，避免解析异常发生在 React 渲染阶段导致整页白屏
			const parsedMessages = entriesToMessages(entries);
			patchMessages(activeProject, () => parsedMessages);
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
		const parsed = parseUserInput(text);
		patchMessages(activeProject, (msgs) => [
			...msgs,
			{ id: nextId(), role: "user", text: parsed.text, toolCalls: [], badge: parsed.badge, streaming: false },
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
