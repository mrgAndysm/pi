<p align="center">
  <a href="https://pi.dev">
    <img alt="pi logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@earendil-works/pi-coding-agent?style=flat-square" /></a>
</p>

> 新贡献者提交的 issue 和 PR 默认会被自动关闭。维护者会每天审查被自动关闭的 issue。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

# Pi

Pi 是一个极简、可扩展的智能体（agent）框架，你可以把它打造成自己想要的样子。

让 Pi 适应你的工作流，而不是反过来。通过[扩展](packages/coding-agent/docs/extensions.md)、[技能](packages/coding-agent/docs/skills.md)、[提示词模板](packages/coding-agent/docs/prompt-templates.md)和[主题](packages/coding-agent/docs/themes.md)来定制 Pi。把它们打包成 [Pi 包](packages/coding-agent/docs/packages.md)，通过 npm 或 git 分享。

Pi 自带强大的默认配置，但刻意省略了子智能体（sub-agent）和计划模式（plan mode）之类的功能。需要的话，让 Pi 帮你构建，或者安装一个按你的方式实现该功能的包。

你可以[交互式](packages/coding-agent/docs/usage.md)使用 Pi，也可以在 [print 或 JSON 模式](packages/coding-agent/docs/cli.md)下做自动化，通过 [RPC](packages/coding-agent/docs/rpc.md) 控制它，或者用 [Pi TypeScript SDK](packages/coding-agent/docs/sdk.md) 构建应用。真实集成案例见 [OpenClaw](https://github.com/OpenClaw/OpenClaw)。

## 快速开始

安装命令行工具：

```bash
curl -fsSL https://pi.dev/install.sh | sh
```

Windows 上：

```shell
powershell -c "irm https://pi.dev/install.ps1 | iex"
```

安装器会锁定所有依赖，之后可用 `pi update` 升级 Pi。也可以直接用 npm 安装（不会锁定间接依赖）：

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Pi 需要 Node.js 22.19 或更高版本。macOS、Linux 和 Windows 的安装器会在需要时自动安装 Node。常规 npm 安装不需要运行依赖的生命周期脚本。

在你想让 Pi 工作的目录中启动它：

```bash
cd /path/to/project
pi
```

使用内置 AI 服务商时，在 Pi 中运行 `/login` 连接订阅或 API key，然后给 Pi 下达任务。

完整的安装和使用说明见[文档](https://pi.dev/docs/latest)，演示见 [pi.dev](https://pi.dev)。

## 用 Nix 运行

```bash
nix run github:earendil-works/pi/stable
```

`stable` 指向最新发布版本。用 `nix profile add github:earendil-works/pi/stable` 安装，用 `nix profile upgrade pi` 升级。可以用 `github:earendil-works/pi/v1.0.0` 这样的发布标签锁定版本，或者用 `github:earendil-works/pi` 获取 `main` 分支上未发布的改动。Nix 会从源码构建 Pi。

支持 Linux 和 macOS 的 ARM64 与 x86-64。用 `nix build .` 或 `nix run .` 构建或运行你的本地检出。

Nix 构建是离线的，因此内置模型数据来自 `nix/model-catalog.json` 中锁定的 pi.dev 模型目录版本。运行时，Pi 仍会照常叠加 pi.dev 上更新的目录数据。当锁定版本与检出代码不再匹配时（例如新增了服务商或某服务商增加了新的模型类型），Nix 工作流会替换 `main` 上的锁定。手动刷新：

```bash
npm run update:model-catalog-pin
```

## 目录结构

本仓库是一个 npm workspace monorepo，按"库 / 应用 / 构建工具"三层组织：

```
pi/
├── apps/                         # 最终交付形态（应用）
│   └── desktop/                   # Tauri 桌面客户端（React + highlight.js）
│       ├── src/                  # 前端：聊天视图、会话列表、Tauri RPC 封装
│       └── src-tauri/            # Rust 侧：sidecar 进程管理、commands/rpc 桥接
├── packages/                     # 可独立发布的库
│   ├── coding-agent/             # CLI 入口（bin: pi）+ 交互式模式 + RPC 模式
│   ├── agent/                    # 智能体运行时（工具调用 / 状态管理）
│   ├── durable/                  # 会话 / 任务 / 文档持久化运行时
│   ├── ai/                       # 多服务商 LLM API（OpenAI / Anthropic / Google …）
│   ├── tui/                      # 终端 UI（差分渲染 / markdown 组件）
│   ├── mcp/                      # Model Context Protocol 客户端 + OAuth 传输
│   ├── env/                      # SSH / 本地环境管理（daemon + PTY）
│   ├── chord/                    # 类型化宿主运行时（插件热重载 / RPC / 复制状态）
│   ├── codemode/                 # 隔离执行 VM（支持 WebAssembly / Cloudflare Workers）
│   ├── telemetry/                # 遥测契约与适配器（厂商中立）
│   └── evals/                    # 评估 harness（smoke / plan / 真实任务）
├── scripts/                      # 构建 / 检查 / 发布工具
├── nix/                          # Nix 离线构建（含锁定的模型目录）
├── .pi/                          # 仓库自身的开发技能 / 提示词 / 扩展
└── AGENTS.md / CONTRIBUTING.md   # 贡献规则（同时适用于人和智能体）
```

**分层原则**

- `packages/*` 每个都是独立的 npm 包，可以在 monorepo 外单独消费；它们之间的依赖必须通过 `package.json` 显式声明。
- `apps/*` 是交付形态，依赖 `packages/*` 暴露的 API。目前只有桌面端，CLI 入口在 `packages/coding-agent`。
- `scripts/*` 不发布，只供仓库开发使用。
- `.pi/` 不是源码的一部分，是 Pi 用来辅助自己开发这个仓库的技能与提示词集合。

**数据流**

用户任务 → coding-agent（CLI/RPC 模式） → agent（工具调用） → durable（会话） → ai（LLM API）→ mcp（可选的外部上下文）。桌面端通过 Tauri sidecar 启动 `pi` 的 RPC 模式进程，再用 JSON-RPC 事件流呈现状态。

## 包说明

本 monorepo 包含 Pi CLI 及其支撑库。

| 包 | 类型 | 说明 |
|---------|------|-------------|
| **@earendil-works/pi-coding-agent** | CLI | `pi` 命令行，交互式模式 / RPC 模式入口 |
| **@earendil-works/pi-agent-core** | 库 | 带工具调用和状态管理的智能体运行时 |
| **@earendil-works/pi-durable** | 库 | 持久化的会话、任务和文档运行时 |
| **@earendil-works/pi-ai** | 库 | 统一的多服务商 LLM API（OpenAI、Anthropic、Google 等） |
| **@earendil-works/pi-tui** | 库 | 终端 UI 库（差分渲染、markdown、输入组件） |
| **@earendil-works/pi-mcp** | 库 | Model Context Protocol 客户端（stdio / HTTP / OAuth） |
| **@earendil-works/pi-env** | 库 + daemon | SSH / 本地环境管理（Rust daemon + PTY） |
| **@earendil-works/chord** | 库 | 类型化宿主运行时：热重载插件、契约、复制状态、JSON RPC |
| **@earendil-works/pi-codemode** | 库 | 隔离执行 VM（支持 WebAssembly / Cloudflare Workers） |
| **@earendil-works/pi-telemetry** | 库 | 厂商中立的遥测契约、参考适配器、类型化 schema |
| **@earendil-works/pi-evals** | 库 | 评估 harness（smoke / plan / 真实任务） |
| **@earendil-works/pi-desktop** | 应用 | React + Tauri 桌面客户端（未发布 npm） |

Slack/聊天自动化与工作流见 [earendil-works/pi-chat](https://github.com/earendil-works/pi-chat)。

## 权限与容器化

Pi 不内置限制文件系统、进程、网络或凭据访问的权限系统。默认情况下，它以启动它的用户和进程的权限运行。

如果需要更强的隔离边界，请把 Pi 容器化或放入沙箱。[packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) 给出三种方案：

- **Gondolin 扩展**：`pi` 和服务商认证保留在宿主机，把内置工具和 `!` 命令路由进本地 Linux 微型虚拟机。
- **普通 Docker**：把整个 `pi` 进程跑在本地容器中，实现简单隔离。
- **OpenShell**：把整个 `pi` 进程跑在策略控制的沙箱中。

## 贡献

贡献指南见 [CONTRIBUTING.md](CONTRIBUTING.md)，项目专属规则（同时适用于人类和智能体）见 [AGENTS.md](AGENTS.md)。Pi 的长期规划见 [RFC](https://rfc.earendil.com/keyword/pi/)。

## 开发

```bash
npm install --ignore-scripts  # 安装全部依赖，不运行生命周期脚本
npm run build         # 刷新模型数据，然后构建所有包
npm run build:offline # 使用现有模型数据离线重新构建
npm run check         # Lint、格式检查和类型检查
./test.sh            # 运行测试（没有 API key 时跳过依赖 LLM 的测试）
./pi-test.sh         # 从源码运行 pi（可在任意目录执行）
```

### 在 monorepo 之外使用本地包

把所有公开包构建成一套一致的本地产物：

```bash
npm run pack:packages -- --out .artifacts/pi-packages
```

这会在构建 `pi-ai` 前刷新模型数据。模型数据已就绪、希望避免联网时，传 `--offline-model-data`。

然后配置一个外部项目消费其中一个包，并让它从同一套产物中解析所有 Pi 依赖。默认使用 npm：

```bash
node scripts/use-local-packages.mjs \
  --manifest .artifacts/pi-packages/manifest.json \
  --consumer ../my-project \
  --package @earendil-works/pi-durable \
  --package @earendil-works/pi-agent-core
cd ../my-project
npm install --ignore-scripts
```

对于 pnpm 项目，把 `--consumer` 指向工作区根目录：

```bash
node scripts/use-local-packages.mjs \
  --manifest .artifacts/pi-packages/manifest.json \
  --consumer ../my-project \
  --package @earendil-works/pi-agent-core \
  --package-manager pnpm
cd ../my-project
pnpm install --ignore-scripts
```

每个直接依赖重复一次 `--package`。该命令会用内容寻址的本地 `file:` 引用更新消费方的 `package.json`，并把间接依赖的 override 写入 `package.json`（npm）或 `pnpm-workspace.yaml`（pnpm）。安装或更新消费方期间保持产物目录可用。修改 Pi 源码后重新运行这两条命令。

## 从发布版源码构建独立二进制

GitHub 发布版包含带版本号的源码归档，其哈希由该发布版的 `SHA256SUMS` 文件覆盖。解压后运行与官方独立二进制相同的构建脚本：

```bash
VERSION="<release-version>"
tar -xzf "pi-${VERSION}-source.tar.gz"
cd "pi-${VERSION}"
./scripts/build-binaries.sh --offline-model-data --platform linux-x64 --out "$PWD/out"
```

归档中包含发布版模型数据和原生预编译产物。`--offline-model-data` 使用该模型数据而不刷新服务商目录。脚本会安装依赖并构建可执行文件及其运行时资源；依赖已就绪时可传 `--skip-install`。

## 供应链加固

我们把 npm 依赖变更当作经过评审的代码变更来对待。

- 直接外部依赖锁定到精确版本，内部工作区包保留版本范围。
- `.npmrc` 设置 `save-exact=true` 和 `min-release-age=2`，避免 npm 解析时拉到当天发布的依赖版本。
- `package-lock.json` 是依赖的事实来源。pre-commit 会阻止意外的 lockfile 提交，除非设置 `PI_ALLOW_LOCKFILE_CHANGE=1`。
- `npm run check` 校验锁定的直接依赖、原生 TypeScript 导入兼容性以及生成的 coding-agent 安装锁。
- pi.dev 安装器从 `packages/coding-agent/install-lock/`（由根 lockfile 生成）安装，以锁定间接依赖。npm 包本身不锁定间接依赖。
- 本地发布冒烟测试和 npm 发布使用同一套 tarball 打包器；npm 发布的是验证过的 tarball，而不是重新打包工作区目录。
- 本地发布安装、文档中的 npm 安装以及 `pi update --self` 在支持的情况下都使用 `--ignore-scripts`。
- CI 用 `npm ci --ignore-scripts` 安装，另有一个定时 GitHub 工作流运行 `npm audit --omit=dev` 和 `npm audit signatures --omit=dev`。
- 安装锁生成对依赖生命周期脚本有显式白名单；新增带生命周期脚本的依赖会导致检查失败，直到经过评审。

## 分享你的开源编程智能体会话

如果你用 Pi 或其他编程智能体做开源工作，请分享你的会话。

公开的开源会话数据能用真实任务、工具调用、失败和修复来改进编程智能体，而不是靠玩具基准测试。

完整说明见 [X 上的这篇帖子](https://x.com/badlogicgames/status/2037811643774652911)。

发布会话请使用 [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf)，设置方法见其 README.md。你只需要一个 Hugging Face 账号、Hugging Face CLI 和 `pi-share-hf`。

也可以看[这个视频](https://x.com/badlogicgames/status/2041151967695634619)，演示如何发布 `pi-mono` 会话。

作者自己定期发布的 `pi-mono` 工作会话：

- [Hugging Face 上的 badlogicgames/pi-mono](https://huggingface.co/datasets/badlogicgames/pi-mono)

## 许可证

MIT

<p align="center">
  <a href="https://pi.dev">pi.dev</a> 域名由以下方慷慨捐赠
  <br /><br />
  <a href="https://exe.dev"><img src="packages/coding-agent/docs/images/exy.png" alt="Exy mascot" width="48" /><br />exe.dev</a>
</p>
