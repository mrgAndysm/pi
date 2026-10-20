# Pi Agent Desktop MVP 实施计划

## Context

用户有一个目标桌面应用(截图所示 "pi-agent-desktop",会话侧边栏 + 聊天流 + Markdown 渲染 + 模型选择 + 自动更新),希望基于本仓库的 Pi agent 能力开发。本仓库是 CLI/TUI 项目,无任何桌面应用代码。

已确认的架构决策:
- **桌面壳**: Tauri 2 (Rust 后端 + Web 前端)
- **集成方式**: sidecar —— 将已编译的 `pi.exe` 打包进 Tauri,Rust 后端以 `--mode rpc` 启动它,通过 stdio 走 JSONL RPC 协议通信
- **前端**: React + TypeScript + Vite
- **范围**: MVP —— 会话列表、聊天流式渲染、输入框、模型选择;技能/插件/设置/自动更新留待后续迭代

关键依据: 仓库已自带完整 RPC 协议 ([rpc-types.ts](file:///f:/pim/pi/packages/coding-agent/src/modes/rpc/rpc-types.ts)) 和参考客户端 [rpc-client.ts](file:///f:/pim/pi/packages/coding-agent/src/modes/rpc/rpc-client.ts),Rust 端只需复刻其语义(带 id 请求/响应匹配 + 事件广播)。根 `package.json` workspaces 已包含 `apps/*`,新应用落在 `apps/desktop`。

## 架构总览

```
apps/desktop
├── src-tauri/                 # Rust 后端
│   ├── src/main.rs            # Tauri 入口
│   ├── src/sidecar.rs         # pi.exe 进程管理(spawn/stdio/重启)
│   ├── src/rpc.rs             # JSONL RPC 客户端(复刻 RpcClient 语义)
│   ├── src/commands.rs        # Tauri commands → 前端暴露
│   ├── binaries/              # sidecar 二进制(构建时拷入)
│   │   └── pi-x86_64-pc-windows-msvc.exe
│   └── tauri.conf.json        # externalBin 配置
├── src/                       # React 前端
│   ├── App.tsx
│   ├── components/
│   │   ├── SessionSidebar.tsx # 会话列表
│   │   ├── ChatView.tsx       # 消息流(markdown + 代码高亮 + 工具调用)
│   │   ├── InputBox.tsx       # 输入框(Enter=prompt / Alt+Enter=follow_up)
│   │   └── ModelPicker.tsx    # 模型选择
│   ├── rpc.ts                 # invoke() 封装 + listen() 事件订阅
│   └── types.ts               # 从 rpc-types.ts 手工对齐的 TS 类型
├── package.json
└── vite.config.ts
```

数据流: React `invoke()` → Tauri command → Rust rpc.rs → stdin JSONL → pi.exe;pi.exe stdout 事件 → Rust → Tauri `emit()` → React `listen()`。

## 实施步骤

### 1. 脚手架 `apps/desktop`

- 用 `npm create tauri-app` 模板手工创建(不跑交互式 CLI): React-TS + Vite
- `src-tauri/tauri.conf.json`: `bundle.externalBin: ["binaries/pi"]`,identifier `com.pi.desktop`,窗口 1280×800
- sidecar 命名遵循 Tauri 约定: `pi-x86_64-pc-windows-msvc.exe`
- 根 `package.json` 无需改 workspaces(已含 `apps/*`);`npm install` 后验证根 `npm run check` 不受影响(若根 `tsc --noEmit` 扫到 apps/,在根 tsconfig 排除,前端由 vite 自己的 tsconfig 管)
- 新增脚本(可选): 根 `package.json` 加 `"build:desktop": "npm --prefix apps/desktop run tauri build"`

依赖(锁精确版本,遵守仓库供应链规则): `@tauri-apps/api`、`@tauri-apps/cli`、`react`、`react-dom`、`react-markdown`、`remark-gfm`、`highlight.js`(复用 export-html 的同款高亮库);Rust 侧 `tauri`、`tauri-plugin-shell`、`serde`、`serde_json`、`tokio`。

### 2. Rust 后端

- `sidecar.rs`: `tauri::process::Command::new_sidecar("pi")` 传 `["--mode", "rpc", "--provider", ..., "--model", ...]`(参考 [rpc-client.ts#L74-L98](file:///f:/pim/pi/packages/coding-agent/src/modes/rpc/rpc-client.ts#L74-L98));`cwd` 为用户选择的项目目录;捕获 stderr 用于错误诊断;进程退出时拒绝所有 pending 请求并向前端发 `sidecar-exit` 事件
- `rpc.rs`:
  - 写: 每条命令分配 `req_N` id,序列化为单行 JSON 写 stdin(参考 `serializeJsonLine`)
  - 读: stdout 按 `\n` 切行 JSON 解析;`type: "response"` 且带 id → 匹配 pending map;其余 → 作为 session 事件 `app.emit("pi-event", payload)` 广播
  - 超时 30s,与 RpcClient 一致
- `commands.rs`(MVP 命令集,一一对应 RPC 命令):
  - `start_agent(cwd, provider?, model?)` / `stop_agent()`
  - `send_prompt(message, images?)`、`steer(message)`、`follow_up(message)`、`abort()`
  - `new_session()`、`get_state()`、`switch_session(path)`
  - `get_available_models()`、`set_model(provider, model_id)`
  - `get_session_stats()`(底部 token/费用统计)
- MVP 暂不实现: extension_ui_request 交互(收到时自动回 cancelled)、bash 交互、compaction 手动触发

### 3. React 前端 MVP

- `types.ts`: 按 [rpc-types.ts](file:///f:/pim/pi/packages/coding-agent/src/modes/rpc/rpc-types.ts) 和 [json-event.ts](file:///f:/pim/pi/packages/coding-agent/src/modes/json-event.ts) 手写对齐 TS 类型(`RpcSessionState`、`JsonAgentSessionEvent`、`ModelInfo` 等),不走跨包 import(避免搅乱 monorepo 依赖检查)
- `SessionSidebar`: 会话名 + 新建按钮;`new_session` / `switch_session`;样式参考截图深色主题(色值取自 [dark.json](file:///f:/pim/pi/packages/coding-agent/src/modes/interactive/theme/dark.json))
- `ChatView`:
  - 事件驱动渲染: `message_start` 建消息、`message_update`(text_delta)追加流式文本、`toolcall_start`/`toolcall_end` 渲染工具卡片(可折叠)、`agent_settled` 收尾
  - Markdown: `react-markdown` + `remark-gfm`(表格)+ `highlight.js`(代码块 + 复制按钮)
  - 图片消息、`compaction_start/end`、`auto_retry_*` 显示为系统提示条
- `InputBox`: textarea;Enter 发送 `send_prompt`(agent 忙时按 `streamingBehavior` 处理);Alt+Enter 走 `follow_up`;流式期间发送按钮变为停止(`abort`);`/` 前缀提示斜杠命令(MVP 仅本地提示,仍作为 prompt 文本发送)
- `ModelPicker`: 启动时 `get_available_models` 填充,切换调 `set_model`;显示 contextWindow/reasoning 标识
- 底部状态栏: `get_session_stats` 轮询(agent_settled 后刷新),显示 token 用量与费用;模型名、thinking level

### 4. sidecar 打包链路

- 新增 `apps/desktop/scripts/sync-sidecar.mjs`: 从 `packages/coding-agent/binaries/windows-x64/pi.exe` 拷贝为 `src-tauri/binaries/pi-x86_64-pc-windows-msvc.exe`;若不存在则提示先跑 `npm run build` + `scripts/build-binaries.sh`
- pi.exe 运行依赖的资源(theme/assets/export-html/photon wasm/native prebuilds)目前在 `binaries/windows-x64/` 下与 exe 同目录 —— 需确认 sidecar 运行时能否找到这些资源(pi 通过 [config.ts](file:///f:/pim/pi/packages/coding-agent/src/config.ts) 的 helper 解析资源路径,bundle 模式 `PI_BUNDLED_NODE=true` 下资源应内嵌或相对 exe 解析;若运行时缺资源,把同目录资源一并拷入 `src-tauri/binaries/` 并在 tauri.conf 配 `resources`)

### 5. 构建与验证

- 前置: 安装 Rust 工具链(rustup);`npm install`(workspace 联动)
- 开发: `npm --prefix apps/desktop run tauri dev` 启动应用
  - 验证: 新建会话 → 发送 prompt → 流式渲染 → 工具调用折叠卡片 → 切换模型 → 查看统计
  - pi.exe 未就绪时 UI 显示引导页而非崩溃
- 打包: `npm --prefix apps/desktop run tauri build` 产出 NSIS 安装包;安装后验证 sidecar 随应用启动、RPC 通畅
- 回归: 根 `npm run check` 通过(不新增错误);不改动 packages/* 任何代码

## 风险与备注

- **Rust 工具链**: 当前机器未确认安装 rustup,第一步先检查
- **单平台**: MVP 仅 windows-x64;跨平台只需重复 `build-binaries.sh` 其他 target 并补 sidecar 三元组命名
- **RPC 超时**: 30s 对长编译类 bash 命令可能不足,MVP 接受,后续按命令类型差异化
- **自动更新**(截图中的"有可用更新"弹窗)不在 MVP;Tauri updater 插件留待迭代
