import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, ToolCallItem } from "../types";

/** 代码块：高亮 + 复制按钮。
 *  react-markdown 会把 fenced code block 渲染成 <pre><code className="language-xxx">源码</code></pre>，
 *  所以给 pre 的 children 实际上是内层 <code> 这个 React 元素；直接 String(children) 会变成
 *  "[object Object]"，高亮语言也得从内层 className 上拿。
 */
function CodeBlock({ children }: { children?: React.ReactNode }) {
	// pre 的 children 就是 <code className="language-xxx">raw text</code> 这个 React 元素
	const codeEl = children as React.ReactElement<{ className?: string; children?: React.ReactNode }> | undefined;
	const codeChild = codeEl?.props?.children;
	const className = codeEl?.props?.className ?? "";
	const langMatch = /language-(\w+)/.exec(className);
	const lang = langMatch?.[1];
	// code 里的文本节点：react-markdown 直接传字符串；remark-gfm / 插件可能包一层数组
	const raw = extractText(codeChild).replace(/\n$/, "");
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

/** 从 React 节点里递归抽出纯文本。react-markdown 里 code 的 children 可能是 string、
 *  带 {value} 字段的 AST 文本节点对象，或插件注入的嵌套元素；这里都兜底处理。
 */
function extractText(node: React.ReactNode): string {
	if (node === null || node === undefined) return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(extractText).join("");
	// Promise / ReactPortal 等不是我们关心的对象类型
	if (typeof node !== "object" || node instanceof Promise) return "";
	const rec = node as unknown as Record<string, unknown>;
	if (typeof rec.value === "string") return rec.value; // remark 等插件把文本节点表示成 { value }
	const nested = rec.children;
	if (Array.isArray(nested)) return nested.map((c) => extractText(c as React.ReactNode)).join("");
	if (typeof nested === "string" || typeof nested === "number") return String(nested);
	// React 元素：从 props.children 里继续抽
	if (rec.props && typeof (rec.props as { children?: unknown }).children !== "undefined") {
		return extractText((rec.props as { children: React.ReactNode }).children);
	}
	return ""; // 拿不到文本时不要退化成 String(obj) → "[object Object]"
}

/** 把内容块数组（text/image）压成纯文本，识别不了时返回 undefined。 */
function contentToText(content: unknown[]): string | undefined {
	const parts: string[] = [];
	for (const item of content) {
		const block = item as { type?: string; text?: string };
		if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
		else if (block?.type === "image") parts.push("[图片]");
	}
	return parts.length > 0 ? parts.join("\n") : undefined;
}

/** 工具结果可能是 { content: [...] }、内容数组、字符串或任意 JSON。 */
function formatResult(result: unknown): string | undefined {
	if (result === undefined || result === null) return undefined;
	if (typeof result === "string") return result;
	if (Array.isArray(result)) return contentToText(result) ?? JSON.stringify(result, null, 2);
	if (typeof result === "object") {
		const content = (result as { content?: unknown }).content;
		if (Array.isArray(content)) {
			const text = contentToText(content);
			if (text !== undefined) return text;
		}
		return JSON.stringify(result, null, 2);
	}
	return String(result);
}

/** 标题行摘要：优先展示命令、路径、模式等最能说明动作的参数。 */
function summarizeArgs(tool: ToolCallItem): string | undefined {
	const args = tool.args as Record<string, unknown> | undefined;
	if (!args || typeof args !== "object") return undefined;
	const keys = ["command", "path", "filePath", "pattern", "url", "query", "name", "description"];
	for (const key of keys) {
		const value = args[key];
		if (typeof value === "string" && value.trim()) return value;
	}
	return undefined;
}

/** 耗时格式化：小于 1 秒显示毫秒。 */
function formatDuration(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function ToolCallCard({ tool }: { tool: ToolCallItem }) {
	const [open, setOpen] = useState(false);
	const summary = summarizeArgs(tool);
	const result = formatResult(tool.result);
	return (
		<div className="tool-call">
			<div className="tool-call-header" onClick={() => setOpen(!open)}>
				<span className="tool-caret">{open ? "▾" : "▸"}</span>
				<span className="tool-name">{tool.toolName}</span>
				{summary && (
					<span className="tool-args" title={summary}>
						{summary}
					</span>
				)}
				<span className={`tool-status ${tool.isError ? "error" : tool.done ? "" : "running"}`}>
					{tool.done ? (tool.isError ? "✗ 失败" : "✓ 完成") : "… 执行中"}
				</span>
				{tool.done && tool.durationMs !== undefined && <span className="tool-duration">{formatDuration(tool.durationMs)}</span>}
			</div>
			{open && (
				<div className="tool-call-body">
					{tool.args !== undefined && (
						<>
							<div className="tool-section-label">参数</div>
							<div>{JSON.stringify(tool.args, null, 2)}</div>
						</>
					)}
					{result !== undefined && (
						<>
							<div className="tool-section-label">结果</div>
							<div style={tool.isError ? { color: "var(--error)" } : undefined}>{result}</div>
						</>
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
							{m.badge && (
								<span className={`msg-badge ${m.badge.kind}`}>
									{m.badge.kind === "skill" ? "SKILL" : "CMD"} · {m.badge.name}
								</span>
							)}
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
