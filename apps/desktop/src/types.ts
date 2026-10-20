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

export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "system";
	/** markdown 文本（流式期间增量累积） */
	text: string;
	/** 工具调用卡片 */
	toolCalls: ToolCallItem[];
	streaming: boolean;
}

export interface ToolCallItem {
	id: string;
	toolName: string;
	args?: unknown;
	result?: string;
	isError?: boolean;
	done: boolean;
}
