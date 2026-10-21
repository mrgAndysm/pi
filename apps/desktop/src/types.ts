/** 从 packages/coding-agent 的 rpc-types.ts / json-event.ts 手工对齐的类型（不跨包 import）。 */

export interface ModelInfo {
	provider: string;
	id: string;
	contextWindow: number;
	reasoning: boolean;
}

export interface RpcSessionState {
	model?: { provider: string; id: string; [key: string]: unknown };
	thinkingLevel: string;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	messageCount: number;
	pendingMessageCount: number;
}

export interface SessionStats {
	totalInput: number;
	totalOutput: number;
	totalCacheRead: number;
	totalCacheWrite: number;
	totalCost: number;
	[key: string]: unknown;
}

/** 流式事件（对齐 JsonAgentSessionEvent，宽松处理） */
export interface PiEvent {
	type: string;
	[key: string]: unknown;
}

/** 用户输入里识别出的技能调用或斜杠命令 */
export interface MessageBadge {
	kind: "skill" | "command";
	/** 技能名或命令名（不含前导 /） */
	name: string;
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "system";
	/** markdown 文本（流式期间增量累积） */
	text: string;
	/** 工具调用卡片 */
	toolCalls: ToolCallItem[];
	/** 用户消息的 /skill、/命令 徽标 */
	badge?: MessageBadge;
	streaming: boolean;
}

export interface ToolCallItem {
	id: string;
	toolName: string;
	/** 工具入参：bash 为 { command }，read/edit/write 为 { path } 等 */
	args?: unknown;
	/** 原始结果：{ content: [{ type: "text", text }], details? } 或历史里的内容数组 */
	result?: unknown;
	isError?: boolean;
	done: boolean;
	/** 执行耗时（毫秒），由 tool_execution_end 提供 */
	durationMs?: number;
}
