<h1 align="center">OpenMake LLM</h1>

<p align="center">
  <strong>面向开源权重模型与自带密钥（BYOK）模型的开源、本地优先、自托管 AI 工作台。</strong><br/>
  vLLM/LiteLLM 推理 · 自主 AI 智能体 · MCP 工具 · 深度研究 · Docker 沙箱。
</p>

<p align="center">
  <a href="https://github.com/openmake/openmake_llm/actions/workflows/ci.yml"><img src="https://github.com/openmake/openmake_llm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/github/package-json/v/openmake/openmake_llm?label=version&color=green" alt="Version" />
  <img src="https://img.shields.io/badge/node-%3E%3D24%20%3C25-brightgreen.svg" alt="Node >=24 <25" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg" alt="TypeScript strict" />
  <img src="https://img.shields.io/badge/Next.js-16-black.svg" alt="Next.js 16" />
</p>

<p align="center">
  <a href="https://openmake.cc/en/">官网</a> ·
  <a href="https://chat.openmake.cc">在线演示</a> ·
  <a href="https://bench.openmake.cc">Bench</a> ·
  <a href="https://openmake.cc/en/docs/">自托管指南</a><br/>
  <a href="README.md">English</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.ja.md">日本語</a> ·
  <strong>简体中文</strong>
</p>

---

> 本文是英文 [README.md](README.md) 的简体中文翻译。若内容不一致，以英文版和代码为准。

## 概览

**OpenMake LLM** 是一个运行在你自己硬件上的自托管 AI 助手。它通过 **vLLM** 提供本地模型，前置 **LiteLLM 代理**（OpenAI 兼容），并把*同一套*抽象路由到你用自己密钥注册的外部服务商（**OpenRouter、NVIDIA NIM、Ollama** 本地/云端，均为 OpenAI 兼容；同时内置 Anthropic 适配器）。因此默认情况下，你的数据始终留在自己的机器上。

每个请求都流经一条轻量的**消息管线**，它完成服务商门控、安全与语言策略、提示词与工具组装，全程*无需*额外的 LLM 路由往返。随后本地模型与外部模型共用同一条执行路径和常开的工具循环。当前的 **`ExecutionPlanBuilder`** 有意保持精简：当选中了某个已授权的自定义智能体时，它才加载该智能体。行为只由正交的几个维度控制——**模型 · 风格 · 模式开关 · 自定义智能体**，而不是不透明的预设。进阶用户还可以更进一步，启用**按角色的模型编排**——为每个功能角色（智能体、评审、研究、并行子智能体、复审、思考摘要）分别指定本地或外部模型。除了聊天之外，它还加入了自主智能体、深度研究管线以及 MCP 工具系统，全部置于 JWT 认证与基于角色的访问控制之后。

> **单机设计：**应用（API + Web）由 **PM2** 运行，而有状态依赖（PostgreSQL / Redis）以及被沙箱化的智能体 / MCP / 产物进程运行在 **Docker** 中以实现隔离。

**一览**

| | |
|---|---|
| 🧠 **1 个本地模型，按请求路由** | `qwen3.8-27b` 经 vLLM + LiteLLM 提供，带 262K 上下文适配保护 |
| 🎛️ **按角色的模型编排** | 为每个功能角色指定不同模型（本地或 BYOK 外部）；支持按用户与管理员全局映射、带令牌预算的服务器共享密钥 |
| 🤖 **自主智能体** | Manus 风格的多轮智能体运行在持久化 Docker 沙箱中（shell · Python · 浏览器 · 文件），高风险步骤需人工批准 |
| 🔬 **深度研究** | 扇出式网页搜索 → 抓取来源 → 声明核验 → 带引用的综合 |
| 📊 **报告管线** | 报告类请求由模型产出数据，服务端通过固定设计模板把它渲染为 HTML 产物，可导出 **PDF/DOCX** |
| 📓 **NotebookLM 接地** | 直接在输入框中把你的某个 Google NotebookLM 笔记本固定为对话上下文 |
| 🧩 **22 个内置 MCP 工具** + 外部 MCP 服务器 | 每个外部服务器在 Docker 中隔离运行（`--cap-drop ALL`、非 root、网络策略） |
| 👤 **自定义智能体与技能** | 项目级人设（可为每个智能体单独指定模型）+ 自动选取的技能库 + 18 个行业智能体（100 位专家） |
| 💬 **Discord 网关机器人** | 可选工作区，把 Discord 消息转发到 OpenAI 兼容 API，支持角色/提及访问控制 |
| 🖥️ **原生客户端** | **OpenMake Companion**（SwiftUI 菜单栏应用，macOS Apple Silicon）用于本地文件夹的智能体工作、**OpenMake Code** CLI（本地桥接），以及开发中的 SwiftUI iOS 客户端——聊天本身仍留在 Web 应用中 |
| 📊 **OpenMake Bench** | [bench.openmake.cc](https://bench.openmake.cc)：盲测成对比较模型并给出硬件适配分数，通过 Web SSO 客户端登录；在此选定的模型会应用到你的模型角色 |
| 🌐 **4 种界面语言** | 한국어 · English · 日本語 · 简体中文（`next-intl`，Cookie 记录语言，浏览器自动检测） |
| 🔒 **安全优先** | JWT（HttpOnly）、Google OAuth 2.0、RBAC、按路由限流、SSRF 防护、审计 ↔ 告警 |

---

## 界面截图

> 对话标题、笔记本名称和账户邮箱已做模糊处理，其余全部是运行中的真实应用。

**聊天工作台** —— 五项工作区导航、模型选择器、响应风格，以及通过斜杠调用的技能：

<p align="center">
  <img src="assets/screenshot-chat.png" alt="Chat workspace" width="920" />
</p>

| 模式菜单 —— 讨论 / 思考 / 深度研究 / 网页 / 智能体 / 图像 / 产物 / 结构化 | NotebookLM 选择器 —— 把某个笔记本固定为对话上下文 |
|---|---|
| ![Composer mode menu](assets/screenshot-composer-modes.png) | ![NotebookLM notebook picker](assets/screenshot-notebook-picker.png) |

**智能体任务** —— 自主多轮运行，带实时进度、令牌计量、定期计划和可复用的任务模板：

<p align="center">
  <img src="assets/screenshot-agent-tasks.png" alt="Agent task management" width="920" />
</p>

| 连接器 —— 外部 MCP 服务器，每个都在 Docker 中隔离 | 模型角色管理 —— 全局的角色→模型映射 |
|---|---|
| ![Settings → Connectors](assets/screenshot-settings.png) | ![Model roles admin](assets/screenshot-model-roles.png) |

**技能库** —— 带工具绑定的可复用清单，可从 Git 导入或由模型生成：

<p align="center">
  <img src="assets/screenshot-skill-library.png" alt="Skill Library" width="920" />
</p>

**多语言界面（한국어 · English · 日本語 · 简体中文）** —— 在设置中切换界面语言，或让它跟随你的浏览器（`Accept-Language`）。AI 的响应语言则独立地跟随消息本身的语言：

<p align="center">
  <img src="assets/i18n-demo.gif" alt="Interface language switching demo (ko / en / ja / zh)" width="920" />
</p>

---

## 架构

OpenMake 把**策略**（决定*如何*回答）与**执行**（真正调用模型）分离开来——类似 SQL 的规划器/执行器分层。这两层被刻意保持相互独立。

```
                          WebSocket / REST
                                  │
                    ┌─────────────▼─────────────┐
  Query ───────────►│      message-pipeline     │  请求处理
                    │                           │  · 服务商门控
                    └─────────────┬─────────────┘  · 安全与语言策略
                                  │                · 提示词与工具组装
                                  │                · 加载已授权的自定义智能体
                    ┌─────────────▼─────────────┐
                    │ streamFromExternalProvider│  单一路径——本地与外部一视同仁
                    │   (always-on tool loop)   │  · 最多 5 轮工具调用
                    └─────────────┬─────────────┘  · 特殊模式在更早阶段拦截
                                  │
                    ┌─────────────▼─────────────┐
                    │       LLMClient.chat      │  执行——逐次调用
                    │  (context-fit safety net) │  · 令牌估算 → 裁剪 → 上限
                    └─────────────┬─────────────┘  · 溢出 → 413 + 审计 + 告警
                                  │
           vLLM serve → LiteLLM proxy (OpenAI-compatible endpoint)
```

- **单一执行路径** —— 原先按策略划分的一层（generate-verify、agent-loop、thinking、direct）已被移除：`message-pipeline` 把本地与外部模型统一送入一条 `streamFromExternalProvider` 分发路径，并带一个常开的 MCP 工具循环。`ExecutionPlanBuilder` 现在只负责加载已授权的自定义智能体。讨论（Discussion）与深度研究（Deep Research）仍是在分发前被拦截的独立模式。
- **上下文适配保护** —— 进入时会估算提示词令牌（含图像）；若超出有效的 **262K** 窗口，则先裁剪输入 → 再调低 `max_tokens` → 极端情况下抛出 `ContextOverflowError`，返回 **HTTP 413**，并附带一条审计记录和一条自动 webhook 告警。
- **用户自定义（4 个正交维度）** —— **模型**（选择器） · **风格**（Concise / Default / Verbose） · **模式**（讨论 / 思考 / 深度研究 / 网页 / 智能体任务） · **自定义指令与智能体**。系统提示词的组装顺序为：`memory + custom-instructions + style`。
- **按角色的模型编排** —— 每个会调用 LLM 的子系统都通过单一的角色注册表解析其模型，并带一条 fail-open 的回退链：按用户映射 → 管理员设置的全局值（DB） → 全局环境变量 → 本地默认。按角色的外部模型运行在用户自己的 BYOK 密钥上，或（对全局角色）运行在服务器共享的运营密钥上（带每日/每月令牌预算）。自定义智能体也可以绑定自己的模型。
- **跨对话记忆** —— 明确保存的长期记忆会被注入系统提示词；一个隐私开关允许用户在单个会话中排除它们。
- **思考展示（Claude 网页版风格）** —— 开启思考模式时，推理流会渲染为一条实时时间线；一个专门的 `summary` 角色模型生成一行标题（流式的临时版 → 最终版），推理内容与标题都会被持久化，因此重新打开对话时时间线会被还原。

---

## 主要特性

**▸ 模型与路由**
- 本地与外部模型共用带服务商门控的 `message-pipeline` 与工具循环；行为由正交的几个维度控制（模型 · 风格 · 模式 · 自定义智能体）。
- 自托管 vLLM + LiteLLM（默认 `qwen3.8-27b`），带上下文适配保护：保护输出令牌，并在溢出时优雅降级。
- 自带外部密钥 —— **OpenRouter、NVIDIA NIM、Ollama**（本地 + 云端），均为 OpenAI 兼容（Anthropic 适配器已内置于服务商抽象中）—— 静态存储使用 AES-256-GCM 加密。**访客只能使用默认本地模型**，外部服务商需要登录。
- **按角色的模型编排** —— 在设置中为每个功能角色（`agent`、`judge`、`research`、`spawn`、`review`、`summary`）指定不同模型（本地或 BYOK 外部）；管理员在管理控制台中设置组织级默认值，并注册带按密钥令牌预算的服务器共享外部密钥。解析是 fail-open 的（任何失败都回退到本地默认）。模型列表会筛减到实际可达且具备角色能力的那些。
- **外部服务商限流** —— 按服务商设置并发上限，遇到 429 时指数退避（并遵循 `Retry-After`），使得讨论或深度研究扇出的突发流量不会导致某个 BYOK 密钥被限流。界面的推理强度设置（low / medium / high）会作为 `reasoning_effort` 转发给 OpenAI 兼容的外部服务商；本地模型则针对思考开/关获得采样预设。
- **尾部路由（可选，默认关闭）** —— 一个轻量门控为每个请求评估出错概率；当它判定某请求属于*事实性尾部*（很可能被答错、且可外部验证）时，会在第一轮确定性地强制开启 `web_search`。它自带一个影子模式（`TAIL_ROUTING_SHADOW_ENABLED`），只记录门控决策而不改变行为，因此可以在真实流量上先调好阈值，再打开 `TAIL_ROUTING_STAGE2B_ENABLED`。

**▸ 智能体与研究**
- **自主智能体任务** —— 一个 Manus 风格的智能体在**持久化 Docker 沙箱**中跨多轮工具调用（shell、Python、浏览器、文件、规划工具）追求某个目标，高风险步骤需人工批准。它会记录文件附件、通过视觉通道注入图像、产出包括 **Excel（.xlsx）** 和 **PDF**（含韩文/CJK 字体）在内的交付物，并在未达成时如实上报（`[GOAL_INCOMPLETE]` 标记 + 目标评审），而不是虚假地标为“完成”。任务可保存为**可复用模板**或设为**定期计划**。
- **深度研究** —— 扇出式网页搜索 → 抓取来源 → 声明核验 → 带引用的综合。
- **报告管线** —— 对于报告类请求（“研究 X 并写一份报告”），模型**只产出数据（JSON）**；服务端通过固定设计模板把它渲染为 HTML 产物（*由渲染器掌控设计*——一致的编排式版面、KPI 卡片、表格、无依赖 SVG 图表、带引用的来源；所有模型字符串都被转义）。自成一体的研究型报告请求会自动委派给智能体任务以获得更多研究轮次，同一约定也适用于智能体任务的交付物。失败时是 fail-open 的：没有有效数据块时，回复会以普通聊天的形式流式返回。
- **自定义智能体与技能** —— 项目级智能体（相当于 claude.ai 的 Projects）可直接从输入框选择，每个都可选择性地绑定自己的模型，另有一个可自动选取的技能库和 18 个内置行业智能体（100 位专家）。

**▸ 工具与扩展**
- **MCP 工具系统** —— 22 个内置工具（网页搜索、事实核查、网页抓取/映射/爬取、图像分析、智能体任务控制、技能/智能体/MCP 的 git 摄取等）加上外部 MCP 服务器，每个都在 Docker 中隔离运行（`--cap-drop ALL`、非 root、`--memory`+`--memory-swap`、网络策略、经 realpath 守护的挂载）。在 **设置 → 连接器** 中从 MCP 目录安装服务器（已预置 Tavily、Sentry、Context7 等；`{{env.KEY}}` 形式的密钥以 shell 变量引用方式传入，绝不写死进 argv）；目录级的**工具白名单**让聊天中的自动暴露保持聚焦（一个含 39 个工具的服务器无需把 39 份 schema 塞进每个提示词），而 REST 执行和显式工具选择器仍保留完整访问权。
- **NotebookLM 接地** —— 用你自己的 Google 会话 Cookie 安装 NotebookLM 连接器（AES-256-GCM 加密，仅在启动时注入），随后在输入框中固定某个笔记本。接地前缀只走一条 LLM 专用通道，因此存储的消息和侧栏标题保持干净，且该固定只作用于单个对话。
- **产物（Artifacts）** —— 沙箱化 iframe 实时渲染、可选的 Docker 代码执行（Python / JS）、可调整大小的侧栏面板，以及一个用于发布的独立源、严格 CSP 的共享查看器。OpenAI 兼容 API 以 `message.artifacts` 扩展返回产物，`publish_artifacts: true` 会让服务端为那些自身无法发布的 API-key 客户端铸造分享链接。
- **PDF / DOCX 导出** —— 任何 HTML 产物（聊天或智能体任务交付物）都可经无头 Chromium 打印导出为 **PDF**（含 CJK 字体）；报告产物保留其结构化源数据（`artifacts.source_data`），从而可用 `python-docx` 生成高保真 **DOCX**。两种转换都在 Docker 沙箱中一次性运行（`--network none`、`--cap-drop ALL`、内存/pids 上限），位于按所有者限流的端点之后。
- **记忆与指令** —— 持久的跨对话记忆（带按会话的启用开关）以及常开的自定义指令。
- **思考展示** —— Claude 网页版风格的推理时间线，带一行实时标题（由专门的摘要模型生成），并在重新打开时持久化还原。
- **多语言界面** —— 韩语、英语、日语、简体中文，基于 `next-intl`（Cookie 记录语言、浏览器自动检测、按语言的日期/数字格式化）。

**▸ 集成**
- **Discord 网关机器人**（`apps/discord-bot`）—— 一个可选的独立工作区，把 Discord 消息转发到 `/api/v1/chat/completions`，带按用户的会话隔离（`/reset`）、角色/提及访问控制和 API-key 认证。生成的图片与产物会作为真实的 Discord 文件附件返回（并带分享链接），因为 Discord 无法渲染该 API 的相对路径或占位符。它作为自己独立的 PM2 进程运行。
- **OpenMake Bench** —— [bench.openmake.cc](https://bench.openmake.cc) 通过该 API 的 Web SSO 客户端登录，并读取实时刷新的 `/v1/models` 列表；OpenAI 兼容 API 还为基准测试客户端提供了一个 raw 模式。
- **原生客户端** —— `apps/desktop-native`（OpenMake Companion，SwiftUI 菜单栏：文件夹链接、设备状态、执行批准、任务完成通知、Web 深链）、`apps/cli`（OpenMake Code，本地桥接，在你自己的机器上而非服务器沙箱中运行智能体的工具调用），以及 `apps/ios`（SwiftUI 客户端，开发中）。三者都与 Web 应用共享 Instrument 设计令牌。
- **NotebookLM** —— `GET /api/mcp/notebooklm/notebooks` 支撑输入框中的选择器（按用户缓存，上游失败统一收敛为 `502 NOTEBOOKLM_UPSTREAM`，因此当 Google Cookie 过期时界面可以提示重新连接）。

**▸ 安全**
- HttpOnly Cookie 中的 JWT、Google OAuth 2.0、RBAC、按用户与按路由限流、SSRF 防护、Helmet 头，以及统一的审计 ↔ 告警管线。

---

## 技术栈

| 层 | 技术 |
|---|---|
| **后端** | Node.js（≥24）、Express 5、TypeScript（strict、CommonJS）、Zod、Winston |
| **前端** | Next.js 16、React 19、Zustand 5、Tailwind CSS 4、`next-intl`；Instrument 设计系统（钴蓝主色 · 青色辅色，IBM Plex Mono） |
| **数据库** | 经 `pg` 使用 PostgreSQL —— 原生、参数化 SQL（无 ORM） |
| **实时** | WebSocket（`ws`）流式聊天，支持流的分离/恢复 —— 被切到后台的标签页或应用重连后不会丢失响应 |
| **LLM 后端** | vLLM + LiteLLM（OpenAI 兼容）；外部服务商使用 `@anthropic-ai/sdk`、`openai` |
| **智能体 / 工具** | Model Context Protocol（`@modelcontextprotocol/sdk`）、Docker 隔离沙箱 |
| **集成** | Discord 网关机器人（`discord.js`）—— 可选的独立工作区；经 Web SSO 的 OpenMake Bench |
| **原生客户端** | SwiftUI（macOS Companion、iOS）、Node CLI（`apps/cli`），共用 `packages/local-bridge-core` |
| **认证 / 安全** | `jsonwebtoken`、Google OAuth 2.0、Helmet、AES-256-GCM |
| **基础设施** | PM2（API · web · Discord bot） + Docker（PostgreSQL/Redis，MCP / 智能体 / 产物沙箱） |
| **测试 / CI** | Jest/ts-jest、Playwright、ESLint、GitHub Actions（CI Gate） |

---

## 快速开始

支持平台：**Linux** 与 **macOS**（Intel 与 Apple Silicon）。

> 从中国大陆访问 GitHub 与在线演示可能较慢。推荐以自托管为主要路径；安装脚本只依赖 GitHub 与 npm。

### 安装（一条命令）

```bash
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash
```

无需克隆 —— 当安装脚本检测到自己运行在仓库之外时，会把源码拉取到 `~/openmake_llm`（用 `OMK_HOME=...` 覆盖；`OMK_REF=...` 指定分支或标签）并在那里重新进入自身。通过管道运行时仍会经由 `/dev/tty` 交互式地向你提问；在非终端环境（CI）中，提示会自动批准。更喜欢经典方式？它的用法与以前完全一致：

```bash
git clone https://github.com/openmake/openmake_llm.git
cd openmake_llm
./install.sh
```

在 **Windows** 上，请在 **WSL2**（Ubuntu）里运行同一条命令 —— 安装脚本会检测到原生 Windows shell，并转而打印 WSL2 的安装步骤。

就这样。安装脚本会检查你的工具链（Node 24、Docker、PM2 —— 缺什么装什么，并尽量不使用 `sudo`），生成一份带全新随机密钥的 `.env`，安装依赖，启动 PostgreSQL + Redis，应用全部迁移，构建两个应用，用 PM2 启动它们，并等待 `/health`。最后它会打印你的 Web 地址和生成的管理员密码。

它只问一个问题 —— 使用哪个 OpenAI 兼容的 LLM 端点（Ollama / OpenRouter / 自定义 / 稍后决定）。要跳过所有提示：

```bash
# 参数也可以直接透传给这条一键命令：
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash -s -- --yes

./install.sh --yes                                    # 先用占位 LLM，稍后在 .env 中填写
./install.sh --yes \
  --llm-base-url https://openrouter.ai/api/v1 \
  --llm-api-key  sk-or-... \
  --llm-model    qwen/qwen3-235b-a22b
```

重复运行 `./install.sh` 是安全的 —— 它会修复而不是覆盖。常用参数：`--skip-docker`（你自己运行 Postgres/Redis）、`--skip-build`、`--no-start`、`--force-env`，以及下面的端口覆盖。参见 `./install.sh --help`。

已经在默认端口上运行着 Postgres 或 Redis？把容器挪开，而不是去争抢 5432/6379 —— 这些端口会写入 `.env`，`openmake_llm.sh` 也会把它们读回来：

```bash
./install.sh --yes --postgres-port 55432 --redis-port 56379
```

在 macOS 上，安装脚本可与 Docker Desktop、OrbStack 或 **Colima**（`brew install colima docker docker-compose` —— 无界面、无 GUI）配合工作。如果 Homebrew 的 compose 插件没有向 docker CLI 注册，安装脚本会替你把 `cliPluginsExtraDirs` 加进 `~/.docker/config.json`。

### 更新已安装的实例

```bash
./openmake_llm.sh update            # git pull（仅 ff）→ 构建 → 迁移 → 重启
./openmake_llm.sh update --yes      # 跳过迁移确认（非交互）
```

`update` 会拒绝去动一个含未提交改动或本地提交已分叉的工作树 —— 它绝不覆盖你的修改。如果没有拉到任何新内容，它会跳过重新部署（用 `--force` 强制重新部署）。以 tarball 方式安装（无 git）的实例应改为重新运行 `install.sh`，它会就地修复。

要把安装固定到某个发行版而不是 `main`，在一键命令上设置 `OMK_REF`：

```bash
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh \
  | OMK_REF=v1.31.1 bash -s -- --yes
```

### 前置条件（由安装脚本处理）

- **git** —— 在全新的 macOS 上，第一次 `git clone` 会触发 Xcode Command Line Tools 的安装对话框；批准它一次即可（或者改为把源码下载为 zip）。`install.sh` 本身能容忍缺失 git（构建元数据会回退为 `unknown`）
- **Node.js** `>=24 <25` —— 通过 `mise`/`fnm`/`nvm`、Homebrew，或在都不存在时通过本地的 `~/.openmake/node` tarball 来提供
- **Docker** —— PostgreSQL/Redis 以及 MCP/智能体沙箱所必需。在 Linux 上安装脚本会提议运行官方的 `get.docker.com` 脚本；在 macOS 上你需要 Docker Desktop 或 OrbStack。注意：Docker Desktop 的**首次启动**可能会请求 GUI 批准（特权助手），并可能超出安装脚本约 60 秒的守护进程等待时间 —— 若如此，请等 Docker 完成启动，然后重新运行 `./install.sh`（可安全重复）
- 一个 OpenAI 兼容的 LLM 端点：本地的 **vLLM + LiteLLM** 栈、**Ollama**，或某个外部服务商密钥

### 手动搭建

如果你更愿意自己动手连线，`install.sh` 就是这些步骤的一份可读记录：

```bash
npm install
node scripts/setup/gen-env.mjs        # 生成含随机密钥的最小化 .env
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres redis
npx ts-node apps/api/src/data/migrations/cli.ts migrate
npm run build && pm2 start ecosystem.config.js
```

> `--env-file .env` 不是可选的：Compose 会相对于 compose 文件所在目录（`infra/`）来解析它默认的 `.env`，因此不加它，`POSTGRES_PASSWORD` 就会为空并导致启动失败。

`gen-env.mjs` 只写入启动所需的键。`.env.example` 才是完整参考 —— 需要时从中复制可选区块（OAuth、网页搜索、MCP 沙箱、Discord 机器人）：

| 变量 | 用途 |
|---|---|
| `PORT` | API 端口（默认 `52416`） |
| `DATABASE_URL` | PostgreSQL 连接字符串（密码必须与 `POSTGRES_PASSWORD` 一致） |
| `JWT_SECRET` | JWT 签名密钥（≥32 字符） |
| `API_KEY_PEPPER` | API-key 哈希 pepper —— 生产环境必需 |
| `TOKEN_ENCRYPTION_KEY` | 用于外部服务商凭据的 AES-256-GCM 密钥（恰好 64 位十六进制） |
| `ADMIN_PASSWORD` | 引导管理员账户的密码 —— 生产环境必需 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_DEFAULT_MODEL` | LiteLLM 代理端点、主密钥、默认模型 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth（可选） |

### 运行

日常运维通过 `openmake_llm.sh` 进行，它会在 Linux 和 macOS 上依次拉起三层（PostgreSQL → Redis → 应用）：

```bash
./openmake_llm.sh start     # 全部启动，然后流式输出日志
./openmake_llm.sh status    # 每一层的端口 + docker + PM2 状态
./openmake_llm.sh logs      # 实时 PM2 日志
./openmake_llm.sh health    # GET /health
./openmake_llm.sh deploy    # 构建 + 迁移 + 重启（应用代码改动）
./openmake_llm.sh stop      # 反序关停
```

或者直接驱动各个部件：

```bash
# 开发
npm run dev                 # API + 前端一起
npm run dev:api             # 仅后端（ts-node）
npm run dev:frontend-next   # 仅前端（next dev）

# 生产
npm run build               # 后端 + 前端
npm start                   # node apps/api/dist/server.js
```

要在重启后依然存活，请把 PM2 注册到你的 init 系统 —— `pm2 startup`（会打印一条待运行的命令：macOS 上是 `launchd`，Linux 上是 `systemd`），然后 `pm2 save`。

### 测试与 lint

```bash
npm test                    # Jest 单元测试（apps/api）
npm run test:e2e            # Playwright（chromium + webkit）
npm run lint                # ESLint
```

> `apps/api` 的单元测试被 git 忽略（仅本地存在），因此在全新克隆上 `npm test` 会报告 “0 matches” —— 这是预期行为，而非安装损坏。CI 也以同样的方式跳过这道关。

### 数据库迁移

`db/migrations/` 中的文件会在**启动时自动应用** —— 在 `db/init/` 基线 schema 之后，待应用的迁移会在一把 PostgreSQL advisory lock 下运行（对多实例启动进行串行化），失败则快速失败。设置 `DB_AUTO_MIGRATE=false` 可退出该行为，改用 CLI 手动运行：

```bash
npx ts-node apps/api/src/data/migrations/cli.ts status    # 显示待应用项
npx ts-node apps/api/src/data/migrations/cli.ts migrate   # 应用
```

回滚脚本位于 `db/migrations/rollbacks/`（不在正向迁移的扫描范围内）。

---

## 项目结构

```
openmake_llm/
├── apps/
│   ├── api/          # Express 5 + TypeScript API 服务器（strict、CommonJS）
│   │   └── src/
│   │       ├── routes/ controllers/ services/   # REST + 业务逻辑
│   │       ├── chat/                            # ExecutionPlanBuilder、分类器、提示词
│   │       ├── agents/                          # 18 个行业智能体、路由器、讨论引擎
│   │       ├── llm/ providers/ cluster/         # LLM 客户端、服务商抽象、节点路由
│   │       ├── mcp/                             # MCP 工具路由器、外部客户端、Docker 沙箱
│   │       ├── sockets/                         # WebSocket 聊天处理器
│   │       ├── auth/ security/ middlewares/     # JWT/OAuth、SSRF 防护、限流
│   │       └── data/                            # PostgreSQL（原生 SQL）、迁移、仓储
│   ├── web/          # Next.js + React 前端（实际操作界面）
│   ├── cli/          # OpenMake Code —— 本地桥接 CLI（在你自己的文件夹中运行智能体任务）
│   │                 # 私有工作区：从源码构建，参见 apps/cli/README.md
│   ├── desktop-native/ # OpenMake Companion —— SwiftUI 菜单栏应用（macOS Apple Silicon）
│   ├── ios/          # SwiftUI iOS 客户端（开发中）
│   ├── discord-bot/  # 可选的 Discord 网关机器人（转发到 /api/v1/chat/completions）
│   └── legacy-web/   # 静态资源宿主（例如 /generated）—— 旧版 SPA 已退役
├── db/               # init schema + migrations（+ rollbacks/）—— 运行时读取
├── packages/         # shared-types、api-contracts、config、api-client、local-bridge-core（共享工作区）
├── infra/            # Dockerfile 与 compose（mcp-runtime、task-runtime、artifact-viewer、egress-proxy）
├── scripts/          # setup/（gen-env.mjs） + LLM 后端的主机搭建 —— vLLM/LiteLLM
│                     # systemd units、serve 脚本、litellm.config.yaml、Caddyfile、诊断
├── tests/            # Playwright E2E
├── install.sh        # 一键安装脚本（Linux/macOS）：工具链 → .env → DB → 构建 → PM2
├── openmake_llm.sh   # 服务管理器：start/stop/restart/deploy/status/logs/health
└── ecosystem.config.js  # PM2 进程定义（API、Next 前端、可选 Discord 机器人）
```

**运行中的服务器实际需要什么：**构建好的 `apps/api/dist` + `apps/web/.next`、`db/`（启动路径会应用 `db/init/`，迁移 CLI 会相对工作目录解析 `db/migrations/`），以及供 Docker 隔离沙箱使用的 `infra/`。`scripts/` 和 `tests/` *不会*被任何运行时代码加载 —— 但 `scripts/vllm/` 和 `scripts/caddy/` 是你在搭建或重建推理后端时拷贝到 GPU 主机上的部署产物，所以请把它们随仓库一起保留。

构建、迁移和 CI 的入口位于别处：构建在每个工作区的 `package.json` 中，迁移在 `apps/api/src/data/migrations/cli.ts` 中，CI 在 `.github/workflows/` 中。

---

## 参与贡献

欢迎贡献。请：

- 使用 [Conventional Commits](https://www.conventionalcommits.org/) —— `feat`、`fix`、`refactor`、`docs`、`test`、`chore`。
- 在功能/修复分支上工作，并向 `main` 提交 PR。
- 遵循代码约定：TypeScript strict 模式、用 Zod 做输入校验、用 Winston 记日志、**仅使用参数化的原生 SQL**（不用 ORM），以及配置外置（不硬编码模型、魔法数字或内联提示词）。

**提交 PR 之前：**

- [ ] `npm run lint` 通过
- [ ] `npm test` 通过
- [ ] 数据库 schema 变更附带迁移文件（无序号冲突）
- [ ] 新的环境变量已记入 `.env.example`
- [ ] 界面改动附带截图；安全改动说明其影响

CI 在每次推送和 pull request 上运行单一的 **CI Gate**（Test → Build → Size → Lint）。

---

## 许可证

基于 **MIT 许可证** 发布 —— 详见 [LICENSE](LICENSE)。
