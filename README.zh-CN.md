<h1 align="center">OpenMake LLM</h1>

<p align="center">
  <strong>面向开源权重模型与自带密钥（BYOK）模型的开源、本地优先、自托管 AI 工作台。</strong><br/>
  vLLM/LiteLLM 推理 · 自主 AI 智能体 · MCP 工具 · 深度研究 · Docker 沙箱
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
  <a href="README.md">English</a> ·
  <a href="https://openmake.cc/en/">官网</a> ·
  <a href="https://chat.openmake.cc">在线演示</a> ·
  <a href="https://bench.openmake.cc">模型评测（Bench）</a> ·
  <a href="https://openmake.cc/en/docs/">自托管指南</a>
</p>

> 本文是英文 [README.md](README.md) 的简体中文摘要。以英文版为准；若两者不一致，以代码为准。
> 官网与自托管指南目前提供英语、韩语、日语；应用界面已内置简体中文。

---

## 概览

**OpenMake LLM** 是一个运行在你自己硬件上的自托管 AI 助手。它通过 **vLLM** 提供本地模型，前置 **LiteLLM 代理**（OpenAI 兼容接口），并把*同一套*抽象路由到你用自己密钥注册的外部服务商（**OpenRouter、NVIDIA NIM、Ollama** 本地/云端，均为 OpenAI 兼容；同时内置 Anthropic 适配器）。默认情况下，数据不会离开你的机器。

每个请求都经过一条轻量的**消息管线**：服务商门控、安全与语言策略、提示词与工具组装，全程不需要额外的 LLM 路由往返。本地模型与外部模型共用同一条执行路径和常开的工具循环。行为只由正交的几个维度控制：**模型 · 风格 · 模式开关 · 自定义智能体**，而不是不透明的预设。进阶用户可以启用**按角色的模型编排**，为每个功能角色（智能体、评审、研究、并行子智能体、复审、思考摘要）分别指定本地或外部模型。在聊天之外，它还提供自主智能体、深度研究管线和 MCP 工具系统，全部置于 JWT 认证与基于角色的访问控制之后。

> **单机设计：**应用（API + Web）由 **PM2** 运行；有状态依赖（PostgreSQL / Redis）以及被沙箱化的智能体 / MCP / 产物进程运行在 **Docker** 中以实现隔离。

默认模型是通过 vLLM 提供的 Qwen3（`qwen3.8-27b`，上下文 262K）。任何 OpenAI 兼容端点都可以接入：Ollama、vLLM、LiteLLM，以及遵循同一接口的国内模型 API。

**一览**

| | |
|---|---|
| 🧠 **1 个本地模型，按请求路由** | `qwen3.8-27b` 经 vLLM + LiteLLM 提供，带 262K 上下文适配保护 |
| 🎛️ **按角色的模型编排** | 为每个功能角色指定不同模型（本地或 BYOK 外部）；支持按用户与管理员全局映射、带令牌预算的服务器共享密钥 |
| 🤖 **自主智能体** | Manus 风格的多轮智能体运行在持久化 Docker 沙箱中（shell · Python · 浏览器 · 文件），高风险步骤需人工批准 |
| 🔬 **深度研究** | 扇出式网页搜索 → 抓取来源 → 声明核验 → 带引用的综合 |
| 📊 **报告管线** | 报告类请求由模型只产出数据，服务端按固定设计模板渲染为 HTML 产物，可导出 **PDF/DOCX** |
| 📓 **NotebookLM 接地** | 直接在输入框中把你的 Google NotebookLM 笔记本固定为对话上下文 |
| 🧩 **22 个内置 MCP 工具** + 外部 MCP 服务器 | 每个外部服务器在 Docker 中隔离运行（`--cap-drop ALL`、非 root、网络策略） |
| 👤 **自定义智能体与技能** | 项目级人设（可为每个智能体单独指定模型）+ 自动选取的技能库 + 18 个行业智能体（100 位专家） |
| 💬 **Discord 网关机器人** | 可选工作区，把 Discord 消息转发到 OpenAI 兼容 API，支持角色/提及访问控制 |
| 🌐 **4 种界面语言** | 한국어 · English · 日本語 · 简体中文（`next-intl`，Cookie 记录语言，浏览器自动检测） |
| 🔒 **安全优先** | JWT（HttpOnly）、Google OAuth 2.0、RBAC、按路由限流、SSRF 防护、审计 ↔ 告警 |

---

## 主要特性

**▸ 模型与路由**
- 本地与外部模型共用带服务商门控的消息管线与工具循环。
- 自托管 vLLM + LiteLLM，带上下文适配保护：溢出时先裁剪输入、再降低输出上限，仍不够则返回 HTTP 413 并记录审计与告警，而不是静默截断。
- 自带外部密钥（OpenRouter、NVIDIA NIM、Ollama），静态存储使用 AES-256-GCM 加密。**访客只能使用默认本地模型**，外部服务商需要登录。
- **按角色的模型编排**：在设置中为 `agent`、`judge`、`research`、`spawn`、`review`、`summary` 分别指定模型；管理员可设置组织默认值并注册带预算的共享密钥。解析失败时回退到本地默认模型。

**▸ 智能体与研究**
- **自主智能体任务**：在持久化 Docker 沙箱中跨多轮工具调用完成目标，高风险步骤等待人工批准；可产出 Excel（.xlsx）与 PDF（含 CJK 字体）；无法完成时如实标记 `[GOAL_INCOMPLETE]`，而不是假装完成。任务可保存为模板或设为定期执行。
- **深度研究**：分解问题、抓取来源、交叉核验声明、输出带引用的报告，管线运行过程全程可见。
- **讨论模式（Discussion）**：按主题挑选两个以上专家智能体，给予相同证据并行运行后综合。默认关闭，按消息开启。
- **自定义智能体与技能**：项目级智能体可直接从输入框选择，每个可绑定自己的模型；另有自动选取的技能库和 18 个内置行业智能体。

**▸ 工具与扩展**
- **MCP 工具系统**：22 个内置工具（网页搜索、事实核查、网页抓取/映射/爬取、图像分析、智能体任务控制等）加外部 MCP 服务器，每个服务器在 Docker 中隔离运行。在 **设置 → 连接器** 中从目录安装；目录级工具白名单避免把几十个 schema 全部塞进每个提示词。
- **产物（Artifacts）**：沙箱 iframe 实时渲染、可选的 Docker 代码执行（Python / JS）、独立源且严格 CSP 的共享查看器。
- **PDF / DOCX 导出**：任何 HTML 产物可经无头 Chromium 导出 PDF（含 CJK 字体）；报告产物保留结构化数据，可用 `python-docx` 生成高保真 DOCX。转换在 `--network none` 的一次性沙箱中完成。
- **记忆与指令**、**思考过程时间线**、**多语言界面**（韩、英、日、简中）。

**▸ 集成**
- **Discord 网关机器人**（`apps/discord-bot`）：把 Discord 消息转发到 `/api/v1/chat/completions`，按用户隔离会话，生成的图片与产物作为真实附件返回。
- **NotebookLM**：输入框中的笔记本选择器，Google Cookie 过期时提示重新连接。

**▸ 安全**
- HttpOnly Cookie 中的 JWT、Google OAuth 2.0、RBAC、按用户与按路由限流、SSRF 防护、Helmet 头，以及统一的审计 ↔ 告警管线。

---

## 快速开始

支持平台：**Linux** 与 **macOS**（Intel 与 Apple Silicon）。Windows 请在 **WSL2**（Ubuntu）中运行同一条命令。

### 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash
```

无需事先克隆。安装脚本检测到自己不在仓库内时，会把源码拉取到 `~/openmake_llm`（可用 `OMK_HOME=...` 覆盖，`OMK_REF=...` 指定分支或标签）并在那里继续执行。也可以用传统方式：

```bash
git clone https://github.com/openmake/openmake_llm.git
cd openmake_llm
./install.sh
```

安装脚本会检查工具链（Node 24、Docker、PM2，缺失的会尽量在不使用 `sudo` 的情况下安装），生成带随机密钥的 `.env`，安装依赖，启动 PostgreSQL + Redis，应用全部迁移，构建两个应用，用 PM2 启动并等待 `/health`。结束时会打印 Web 地址和生成的管理员密码。

它只会问一个问题：使用哪个 OpenAI 兼容的 LLM 端点（Ollama / OpenRouter / 自定义 / 稍后决定）。要跳过全部提示：

```bash
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash -s -- --yes

./install.sh --yes                                    # 先用占位 LLM，稍后在 .env 中填写
./install.sh --yes \
  --llm-base-url https://openrouter.ai/api/v1 \
  --llm-api-key  sk-or-... \
  --llm-model    qwen/qwen3-235b-a22b
```

重复运行 `./install.sh` 是安全的，它会修复而不是覆盖。常用参数：`--skip-docker`（自行运行 Postgres/Redis）、`--skip-build`、`--no-start`、`--force-env`，以及端口覆盖：

```bash
./install.sh --yes --postgres-port 55432 --redis-port 56379
```

> 从中国大陆访问 GitHub 与在线演示可能较慢。推荐以自托管为主要路径；安装脚本只依赖 GitHub 与 npm。

### 前置条件

Node.js 24、Docker、PostgreSQL、Redis，以及一个 OpenAI 兼容的模型端点。安装脚本会处理前三项。手动安装步骤、更新已安装实例、测试与数据库迁移，请参阅英文 README 的 [Getting Started](README.md#getting-started)。

---

## 相关链接

- 在线演示：https://chat.openmake.cc（访客只能使用一个本地模型）
- 模型评测 Bench：https://bench.openmake.cc（盲测成对比较模型，并给出与你硬件的适配分数；与演示共用账号，目前仅提供托管版本，源码尚未公开）
- 自托管指南：https://openmake.cc/en/docs/
- 每周开发日志（含出问题的那几周）：https://openmake.cc/en/blog/

## 参与贡献

欢迎贡献。请使用 [Conventional Commits](https://www.conventionalcommits.org/)，在功能/修复分支上工作并向 `main` 提交 PR，遵循 TypeScript strict、Zod 输入校验、Winston 日志、**仅使用参数化原生 SQL**（不用 ORM）以及配置外置的约定。提交 PR 前请确认 `npm run lint` 与 `npm test` 通过，数据库变更附带迁移文件，新环境变量写入 `.env.example`。详见英文 README 的 [Contributing](README.md#contributing)。

## 许可证

基于 **MIT 许可证** 发布，详见 [LICENSE](LICENSE)。
