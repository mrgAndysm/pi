import { useState } from "react";
import type { SessionFileInfo } from "../rpc";

export interface Project {
	path: string;
	name: string;
}

interface Props {
	projects: Project[];
	activeProject?: string;
	sessions: SessionFileInfo[];
	activeSessionPath?: string;
	onSelectProject: (path: string) => void;
	onAddProject: () => void;
	onRemoveProject: (path: string) => void;
	onSelectSession: (path: string) => void;
	onNewSession: () => void;
	busy: boolean;
}

/** 项目侧边栏：项目列表（每项目多会话）+ 目录添加/移除。 */
export function ProjectSidebar(p: Props) {
	const [expanded, setExpanded] = useState(true);
	return (
		<aside className="sidebar">
			<div className="sidebar-header">
				<button onClick={p.onAddProject}>+ 添加项目目录</button>
			</div>
			<div className="project-list">
				{p.projects.length === 0 && <div className="sidebar-empty">暂无项目，点击上方添加目录</div>}
				{p.projects.map((proj) => {
					const active = proj.path === p.activeProject;
					return (
						<div key={proj.path} className={`project-item ${active ? "active" : ""}`}>
							<div className="project-row" onClick={() => p.onSelectProject(proj.path)}>
								<span className="project-icon">◈</span>
								<span className="project-name" title={proj.path}>
									{proj.name}
								</span>
								<span
									className="project-remove"
									title="移除项目"
									onClick={(e) => {
										e.stopPropagation();
										p.onRemoveProject(proj.path);
									}}
								>
									×
								</span>
							</div>
							{active && (
								<div className="session-list">
									<div className="session-toolbar">
										<span className="session-toggle" onClick={() => setExpanded(!expanded)}>
											{expanded ? "▾" : "▸"} 会话 ({p.sessions.length})
										</span>
										<button className="mini-btn" onClick={p.onNewSession} disabled={p.busy}>
											+ 新会话
										</button>
									</div>
									{expanded &&
										p.sessions.map((s) => (
											<div
												key={s.path}
												className={`session-item ${s.path === p.activeSessionPath ? "active" : ""}`}
												title={s.path}
												onClick={() => p.onSelectSession(s.path)}
											>
												{s.name || s.path.split(/[\\/]/).pop()?.replace(/\.jsonl$/, "")}
											</div>
										))}
									{expanded && p.sessions.length === 0 && <div className="sidebar-empty">无历史会话</div>}
								</div>
							)}
						</div>
					);
				})}
			</div>
		</aside>
	);
}
