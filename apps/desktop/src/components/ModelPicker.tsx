import type { ModelInfo } from "../types";

interface Props {
	models: ModelInfo[];
	current?: { provider: string; id: string };
	onChange: (provider: string, modelId: string) => void;
	disabled: boolean;
}

/** 模型选择下拉框。 */
export function ModelPicker({ models, current, onChange, disabled }: Props) {
	const value = current ? `${current.provider}/${current.id}` : "";
	return (
		<div className="status-item">
			<span>模型</span>
			<select
				value={value}
				disabled={disabled || models.length === 0}
				onChange={(e) => {
					const [provider, ...rest] = e.target.value.split("/");
					onChange(provider, rest.join("/"));
				}}
			>
				{value === "" && <option value="">未选择</option>}
				{models.map((m) => (
					<option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
						{m.provider}/{m.id}
						{m.reasoning ? " 🧠" : ""}
					</option>
				))}
			</select>
		</div>
	);
}
