import { useRef, useState } from "react";

interface Props {
	streaming: boolean;
	disabled: boolean;
	onSend: (text: string, mode: "prompt" | "followUp") => void;
	onAbort: () => void;
}

/** 输入框：Enter 发送 prompt，Alt+Enter 发送 follow_up，流式期间按钮变停止。 */
export function InputBox({ streaming, disabled, onSend, onAbort }: Props) {
	const [text, setText] = useState("");
	const ref = useRef<HTMLTextAreaElement>(null);

	const submit = (mode: "prompt" | "followUp") => {
		const value = text.trim();
		if (!value) return;
		onSend(value, mode);
		setText("");
	};

	return (
		<div className="input-area">
			<div className="input-row">
				<textarea
					ref={ref}
					value={text}
					placeholder={disabled ? "等待 agent 启动…" : "消息… (Enter 发送 / Alt+Enter 追加)"}
					disabled={disabled}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault();
							submit(e.altKey ? "followUp" : "prompt");
						}
					}}
				/>
				{streaming ? (
					<button className="stop" onClick={onAbort}>
						停止
					</button>
				) : (
					<button onClick={() => submit("prompt")} disabled={disabled || !text.trim()}>
						发送
					</button>
				)}
			</div>
			<div className="input-hint">Enter 发送 · Alt+Enter 排队追加 · / 开头使用斜杠命令</div>
		</div>
	);
}
