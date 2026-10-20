import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import type { ChatMessage, ToolCallItem } from "../types";

/** 代码块：高亮 + 复制按钮。 */
function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
	const lang = /language-(\w+)/.exec(className || "")?.[1];
	const raw = String(children ?? "").replace(/\n$/, "");
	let html: string;
	try {
		html = lang && hljs.getLanguage(lang) ? hljs.highlight(raw, { language: lang }).value : hljs.highlightAuto(raw).value;
	} catch {
		html = raw;
	}
	return (
		<pre>
			<button
				className="copy-btn"
				style={{ position: "absolute", top: 6, right: 8, fontSize: 11, padding: "2px 8px" }}
				onClick={(e) => {
					navigator.clipboard.writeText(raw);
					const btn = e.currentTarget;
					btn.textContent = "已复制";
					setTimeout(() => (btn.textContent = "复制"), 1500);
				}}
			>
				复制
			</button>
			<code className={className} dangerouslySetInnerHTML={{ __html: html }} />
		</pre>
	);
}

function ToolCallCard({ tool }: { tool: ToolCallItem }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="tool-call">
			<div className="tool-call-header" onClick={() => setOpen(!open)}>
				<span>{open ? "▾" : "▸"}</span>
				<span className="tool-name">{tool.toolName}</span>
				<span className={`tool-status ${tool.isError ? "error" : ""}`}>
					{tool.done ? (tool.isError ? "✗ 失败" : "✓ 完成") : "… 执行中"}
				</span>
			</div>
			{open && (
				<div className="tool-call-body">
					{tool.args !== undefined && <div>{JSON.stringify(tool.args, null, 2)}</div>}
					{tool.result !== undefined && (
						<div style={{ marginTop: 8, color: tool.isError ? "var(--error)" : undefined }}>{tool.result}</div>
					)}
				</div>
			)}
		</div>
	);
}

/** 聊天消息流：user / assistant(markdown) / system 提示条。 */
export function ChatView({ messages }: { messages: ChatMessage[] }) {
	if (messages.length === 0) {
		return (
			<div className="chat-view">
				<div className="chat-empty">输入消息开始与 Pi 对话</div>
			</div>
		);
	}
	return (
		<div className="chat-view">
			{messages.map((m) => {
				if (m.role === "system") {
					return (
						<div key={m.id} className="message message-system">
							{m.text}
						</div>
					);
				}
				if (m.role === "user") {
					return (
						<div key={m.id} className="message message-user">
							{m.text}
						</div>
					);
				}
				return (
					<div key={m.id} className="message message-assistant">
						<div className="markdown">
							<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>
								{m.text}
							</ReactMarkdown>
						</div>
						{m.toolCalls.map((t) => (
							<ToolCallCard key={t.id} tool={t} />
						))}
						{m.streaming && <span className="streaming-dot" />}
					</div>
				);
			})}
		</div>
	);
}
