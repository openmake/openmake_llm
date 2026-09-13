<h1 align="center">OpenMake LLM</h1>

<p align="center">
  <strong>面向开源权重模型与自带密钥（BYOK）模型的开源、本地优先、自托管 AI 工作台。</strong><br/>
  vLLM/LiteLLM 推理 · 多模态编排 · 自主智能体 · MCP 工具 · 深度研究 · Docker 沙箱。
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

**OpenMake LLM** 是一款运行在你自己硬件上的自托管 AI 助手。它用 **vLLM** 提供本地模型，并在前面放置 **LiteLLM 网关**（兼容 OpenAI）；你用自己的密钥登记的外部提供商 —— **OpenRouter、NVIDIA NIM、Ollama Cloud、Open AI Service Hub（hasa）、B.AI** —— 也走*同一个*网关，此外还支持 **ChatGPT 订阅登录**。默认情况下数据不会离开你的机器。

每一轮对话都会经过轻量的**消息管线**（提供商网关、安全与语言策略、提示词与工具组装），进入本地和外部模型共用的单一执行路径。当请求需要的不只是文字 —— *画出来、读出来、把这段视频转成文字、做一段短视频* —— **Planner** 会写出一份小计划，对应的 **capability** 任务在你分配的模型上并行运行，然后由你选择的对话模型结合结果写出最终回答。行为只由相互独立的维度控制 —— **模型 · 回答风格 · 模式开关 · 自定义智能体** —— 而不是不透明的预设。

除了对话，它还提供在 Docker 沙箱中（或通过本地桥接在你自己的电脑上）运行的自主智能体任务、深度研究、带一键目录的 MCP 工具系统，以及可安装 Claude Code 风格插件和技能的扩展系统，全部位于 JWT 认证和基于角色的访问控制之后。

> **单主机设计：** 应用（API + Web）由 **PM2** 运行；有状态依赖（PostgreSQL / Redis）以及沙箱化的智能体、MCP、构件进程在 **Docker** 中运行以实现隔离。

**一览**

| | |
|---|---|
| 🧠 **本地模型 + BYOK 网关** | 由 vLLM + LiteLLM 提供的 `qwen3.8-27b`，带 262K 上下文安全网；外部提供商用你自己的密钥走同一网关 |
| 🎨 **多模态编排器** | Planner 把请求拆成图像生成/编辑、语音转文字、文字转语音、视频、视觉/OCR 任务并行运行，再由对话模型汇总回答 |
| 🎛️ **模型角色与 capability** | 按角色（智能体、判定、研究、子智能体、评审、摘要、规划器）和按 capability 选择模型；用户设置 + 管理员全局默认值 |
| 🤖 **自主智能体** | 在持久化 Docker 沙箱（Shell · Python · 浏览器 · 文件）或通过 **OpenMake Companion** / **OpenMake Code** CLI 连接的本地文件夹中执行多轮任务，带人工审批 |
| 🔬 **深度研究与报告** | 并行网页搜索 → 抓取来源 → 带引用的综合；报告请求渲染为可导出 **PDF/DOCX** 的 HTML 构件 |
| 🧩 **23 个内置工具 + MCP** | 网页搜索、抓取、视觉、规划、代码/安全评审、技能加载等；外部 MCP 服务器各自在 Docker 中隔离，远程服务器支持 OAuth 登录 |
| 📦 **扩展与技能** | 从 Git 或市场安装插件、技能、智能体和 MCP 服务器 —— 安装时自动适配 Claude Code 惯例 —— 并在统一的**审批**页面确认 |
| ⚖️ **对比模式** | 向两个模型提出同一个问题，并排比较回答 |
| 🖥️ **原生客户端** | OpenMake Companion（SwiftUI 菜单栏应用，macOS）、OpenMake Code CLI，以及开发中的 SwiftUI iOS 客户端 —— 对话本身留在 Web 应用中 |
| 🌐 **4 语言界面** | 한국어 · English · 日本語 · 简体中文（`next-intl`，浏览器自动检测）；回答跟随你输入的语言 |
| 🔒 **安全优先** | JWT（HttpOnly）、Google OAuth 2.0、RBAC、按路由限流、SSRF 防护、AES-256-GCM 密钥存储、Audit ↔ Alert |

---

## 演示

> 录制自正在运行的应用，标签会自动切换。最近的对话标题和账户名称已隐藏。

<table>
  <tr>
    <td align="center">
      <img src="assets/demo-tour.gif" alt="演示导览：对话、多模态、智能体任务、设置、语言" width="860" />
    </td>
  </tr>
  <tr>
    <td>
      <b>Chat</b> — 提问后回答以流式呈现，模型、回答风格和推理强度都可在输入框中直接切换<br/>
      <b>Multimodal</b> — “生成一张……的图片” 会成为图像生成任务，在分配给该 capability 的模型上运行并直接显示在对话中<br/>
      <b>Agent tasks</b> — 选好审批策略的 Agent 模式在沙箱中执行目标，实时显示进度并返回结果<br/>
      <b>Settings</b> — 模型角色、按 capability 分配模型、MCP 目录、技能库<br/>
      <b>Languages</b> — 界面跟随浏览器语言或设置中选择的语言
    </td>
  </tr>
</table>

---

## 架构

OpenMake 把**决定运行什么**与**调用模型**分开。特殊模式会先被拦截，其余请求都走同一条路径。

```
                             WebSocket / REST
                                     │
                       ┌─────────────▼─────────────┐
   Query ─────────────►│     message-pipeline      │  provider gate · security & language policy
                       └─────────────┬─────────────┘  prompt & tool assembly · custom agent
                                     │
                       ┌─────────────▼─────────────┐
                       │          Planner          │  one small JSON plan per turn
                       └──────┬──────────────┬─────┘
                        simple│              │multi
                              │   ┌──────────▼──────────┐
                              │   │  capability tasks   │  image · speech · video · vision
                              │   │  (run in parallel)  │  on the models you assigned
                              │   └──────────┬──────────┘
                       ┌──────▼──────────────▼─────┐
                       │ streamFromExternalProvider│  one path for local & external models
                       │   (always-on tool loop)   │  chat model writes the final answer
                       └─────────────┬─────────────┘
                                     │
                       ┌─────────────▼─────────────┐
                       │       LLMClient.chat      │  context-fit safety net
                       └─────────────┬─────────────┘  truncate → cap → 413 + audit
                                     │
                  LiteLLM gateway → vLLM (local) · BYOK external providers
```

- **单一执行路径** —— 本地和外部模型共用 `streamFromExternalProvider` 及其 MCP 工具循环。讨论和深度研究是在分发前被拦截的独立模式。
- **Planner → capability → 汇总** —— `simple` 计划不会增加模型调用。`multi` 计划在执行前检查分配、密钥状态、网关支持和配额，按依赖层级并行运行，只把成功生成的媒体附到回答中。未完成的视频任务会被保留，在你下一条消息时接着处理而不是重新提交。
- **模型解析** —— 所有调用模型的子系统都通过角色或 capability 注册表确定模型：用户设置 → 管理员全局默认值 → 内置默认值，失败时回退到本地模型。
- **上下文安全网** —— 入口处估算提示词 token（含图像）；若超出有效的 **262K** 窗口，会裁剪输入、降低 `max_tokens`，最后手段是返回 **HTTP 413** 并记录审计、发送告警。
- **用户定制** —— **模型** · **回答风格**（简洁 / 默认 / 详细） · **模式**（讨论 / Thinking / 回答校验 / 深度研究 / 智能体） · **自定义指令与智能体**，以及可选开启的跨对话记忆。
- **断线也能续上的流式输出** —— 标签页转入后台或应用的连接断开时生成仍会继续，重新连接后回到同一个回答。

---

## 主要特性

**▸ 模型与路由**
- 自托管 vLLM + LiteLLM（默认 `qwen3.8-27b`），配合保护输出 token、逐级降级的上下文安全网。
- 为 OpenRouter、NVIDIA NIM、Ollama Cloud、Open AI Service Hub（hasa）、B.AI **使用自己的密钥（BYOK）** —— 全部经过 LiteLLM 网关，密钥以 AES-256-GCM 加密存储 —— 另支持 ChatGPT 订阅登录。访客只能使用本地模型。
- **模型角色** —— 为 `agent`、`judge`、`research`、`spawn`、`review`、`summary`、`planner` 分别指定模型；管理员可设置组织级默认值，并登记带每日/每月 token 预算的服务器共享密钥。
- **按 capability 选择模型** —— 在设置中按分组为文本、代码、视觉/OCR、图像生成/编辑、语音转文字、文字转语音、视频选择模型，也可以逐项单独指定。
- **明确的失败原因** —— 限流、额度不足、受限模型、不支持的工具定义都会如实提示，而不是笼统的上游错误；每个提供商的并发上限在遇到 `429` 时会退避。
- **对比模式** —— 用两个模型并排运行同一个提示词。

**▸ 多模态**
- **由 Planner 驱动的编排** —— 图像生成与编辑（可参考上一张图）、音频/视频附件的语音转文字、文字转语音、视频生成、视觉描述与 OCR，都作为可并行运行的 capability 任务处理。
- 如果对话模型无法看图，会先由视觉模型描述图像，对话模型再依据这些记录回答。
- 生成的媒体通过 `/generated` 提供并按保留期限自动清理；用量和计划耗时会被记录，供成本评估使用。

**▸ 智能体与研究**
- **自主智能体任务** —— 在**持久化 Docker 沙箱**（Shell、Python、浏览器、文件、规划、代码导航）中跨多轮工具调用追求目标，审批策略可选 **Manual / Auto / Skip**。可附加文件和图片，产出 **Excel**、**PDF** 等交付物；未达成目标时如实展示目标判定结果，而不是虚假的“完成”。任务可保存为**模板**、按**计划**定时运行，或**分享**运行结果。
- **本地执行** —— 通过 **OpenMake Companion**（macOS 菜单栏应用）或 **OpenMake Code** CLI 连接你电脑上的文件夹，工具调用就在该文件夹内执行，带路径限制、命令确认闸门和 git worktree 隔离。
- **并行子智能体** —— 把相互独立的子任务分给多个子智能体，再合并结果。
- **深度研究** —— 主题拆解、并行网页搜索（SearXNG、Naver、Daum 等）、分块摘要，以及带引用的报告。
- **报告管线** —— 报告请求生成结构化数据，服务器用固定模板渲染为 HTML 构件，可导出为 **PDF** 和 **DOCX**。
- **自定义智能体** —— 可在输入框中选择的项目式角色，每个智能体可固定自己的模型，并内置 18 个行业智能体（100 位专家）。

**▸ 工具与扩展**
- **23 个内置工具** —— 网页搜索、事实核查、页面提取、抓取/站点地图/爬取、图像分析与 OCR、智能体任务查询、规划、代码与安全评审、技能创建与加载、从 Git 导入技能/智能体/MCP 服务器/扩展、MCP 元工具，以及仅管理员可用的运维指标工具。为保持提示词精简，工具只在需要的轮次暴露。
- **外部 MCP 服务器** —— 启用沙箱后（生成的配置默认开启），stdio 服务器在 Docker 中运行：`--cap-drop ALL`、非 root、内存与网络限制，以及可选的只读根文件系统。可从 **MCP 目录**（Tavily、Context7、Notion、NotebookLM、Kakao Map、OpenDART、韩国公共数据 API 等）安装；远程服务器可通过 **OAuth** 登录。
- **扩展** —— 从 Git、zip 或市场安装插件、技能、自定义智能体或 MCP 服务器。Claude Code 惯例（工具名称、`$ARGUMENTS`、`commands/`、`agents/`、随附脚本）会在安装时适配，需要审核的内容都会汇集到**审批**页面。
- **技能** —— 带工具绑定的可复用清单，通过 `/skill-name` 调用，或在相关问题中由模型自动选用。
- **构件** —— 沙箱化实时预览、可选的 Docker 代码执行，以及用于发布的独立源查看器。
- **NotebookLM 知识锚定** —— 在输入框中把你的某个笔记本固定为对话上下文。
- **记忆、指令与通知** —— 可选开启的跨对话记忆、始终生效的自定义指令，以及智能体任务等待审批或完成时的 Web 推送通知。

**▸ 集成**
- 使用 API 密钥和权限范围的 **OpenAI 兼容 API**（`/api/v1/chat/completions`）。
- **Discord 网关机器人**（`apps/discord-bot`），把消息转发到 API，支持按用户隔离的会话和文件附件。
- **OpenMake Bench** —— [bench.openmake.cc](https://bench.openmake.cc) 通过 Web SSO 登录，在那里选定的模型可应用到你的模型角色。

**▸ 安全**
- HttpOnly Cookie 中的 JWT、Google OAuth 2.0、RBAC、按用户和按路由限流、SSRF 防护、Helmet 头、智能体工具的凭据文件保护，以及统一的 Audit ↔ Alert 管线。

---

## 技术栈

| 层级 | 技术 |
|---|---|
| **后端** | Node.js (≥24), Express 5, TypeScript (strict, CommonJS), Zod 4, Winston |
| **前端** | Next.js 16, React 19, Zustand 5, Tailwind CSS 4, `next-intl`；Instrument 设计系统 |
| **数据库** | 基于 `pg` 的 PostgreSQL —— 参数化原生 SQL（无 ORM） |
| **实时** | 支持断开后续接（detach/resume）的 WebSocket（`ws`）流式传输 |
| **LLM 后端** | vLLM + LiteLLM 网关（兼容 OpenAI）；外部提供商使用 `openai` SDK |
| **智能体 / 工具** | Model Context Protocol (`@modelcontextprotocol/client` v2)，Docker 隔离沙箱 |
| **原生客户端** | SwiftUI（macOS Companion、iOS），共享 `packages/local-bridge-core` 的 Node CLI (`apps/cli`) |
| **集成** | Discord 网关机器人 (`discord.js`)；通过 Web SSO 连接的 OpenMake Bench |
| **认证 / 安全** | `jsonwebtoken`, Google OAuth 2.0, Helmet, AES-256-GCM |
| **基础设施** | PM2（API · Web · Discord 机器人）+ Docker（PostgreSQL/Redis，MCP / 智能体 / 构件沙箱） |
| **测试 / CI** | Jest/ts-jest, Playwright, ESLint, GitHub Actions（CI Gate） |

---

## 快速开始

支持的平台：**Linux** 与 **macOS**（Intel 和 Apple Silicon）。

### 安装（一条命令）

```bash
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash
```

无需克隆。安装脚本检测到自己在仓库之外运行时，会把源码拉取到 `~/.openmake/chat`（可用 `OMK_HOME=...`
改变位置，用 `OMK_REF=...` 选择分支或标签）并在那里重新运行自身。若要在同一台主机上再运行一份，加上
`--instance NAME`（`... | bash -s -- --instance NAME`）：它会安装到 `~/.openmake/chat-NAME`，使用独立的端口
（52417/3010）、数据库、Redis 和 PM2 名称（`openmake-llm-NAME`）。`--public-url https://chat.example.com`
会把公网地址写入 `.env`，若为 HTTPS 则切换为 secure Cookie。即使通过管道运行，也会经 `/dev/tty` 交互提问；
在无终端环境（CI）中会自动确认。更喜欢传统方式？照样可用：

```bash
git clone https://github.com/openmake/openmake_llm.git
cd openmake_llm
./install.sh
```

在 **Windows** 上，请在 **WSL2**（Ubuntu）中运行同一条命令 —— 安装脚本检测到原生 Windows Shell 时，会改为输出
WSL2 的设置步骤。

就这么简单。安装脚本会检查工具链（Node 24、Docker、PM2 —— 缺什么就装什么，尽量不用 `sudo`），用随机密钥生成
`.env`，安装依赖，启动 PostgreSQL + Redis，应用全部迁移，构建两个应用，用 PM2 启动并等待 `/health`。结束时会输出
Web 地址和生成的管理员密码。

它只问一个问题 —— 使用哪个兼容 OpenAI 的 LLM 端点（Ollama / OpenRouter / 自定义 / 稍后再定）。要跳过所有提问：

```bash
# 参数也可以直接透传给这条一键命令：
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash -s -- --yes

./install.sh --yes                                    # 占位 LLM 配置，稍后再填 .env
./install.sh --yes \
  --llm-base-url https://openrouter.ai/api/v1 \
  --llm-api-key  sk-or-... \
  --llm-model    qwen/qwen3-235b-a22b
```

重复运行 `./install.sh` 是安全的 —— 它会修复而不是覆盖。常用参数：`--skip-docker`（自行运行 Postgres/Redis）、
`--skip-build`、`--no-start`、`--force-env`，以及下面的端口设置。详见 `./install.sh --help`。

默认端口上已经有 Postgres 或 Redis？别去抢 5432/6379，把容器端口挪开即可 —— 端口会写入 `.env`，
`openmake_llm.sh` 会读回来：

```bash
./install.sh --yes --postgres-port 55432 --redis-port 56379
```

在 macOS 上，安装脚本支持 Docker Desktop、OrbStack 或 **Colima**（`brew install colima docker docker-compose`
—— 无界面运行）。如果 Homebrew 的 compose 插件没有注册到 docker CLI，安装脚本会替你在 `~/.docker/config.json`
中加入 `cliPluginsExtraDirs`。

如果还没有管理员账户，Web 应用会打开一次性的**设置页面**，你可以在那里创建管理员，并按需配置 LLM 网关。

### 更新已安装的实例

```bash
./openmake_llm.sh update            # git pull (ff-only) → 构建 → 迁移 → 重启
./openmake_llm.sh update --yes      # 跳过迁移确认（非交互）
```

若工作树有未提交的改动或已分叉的本地提交，`update` 不会动它 —— 绝不会覆盖你的修改。如果没有拉取到新内容，会跳过
重新部署（加 `--force` 强制部署）。通过 tarball（无 git）安装的实例请改为重新运行 `install.sh`，它会就地修复。

若要把安装固定到某个发布版本而不是 `main`，在一键命令中设置 `OMK_REF`：

```bash
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh \
  | OMK_REF=v1.62.3 bash -s -- --yes
```

### 前置条件（由安装脚本处理）

- **git** —— 在全新的 macOS 上，第一次 `git clone` 会弹出 Xcode Command Line Tools 安装对话框；确认一次即可
  （或改为下载源码 zip）。`install.sh` 本身在没有 git 时也能运行（构建元数据回退为 `unknown`）
- **Node.js** `>=24 <25` —— 通过 `mise`/`fnm`/`nvm`、Homebrew 提供，若都没有则使用本地 `~/.openmake/node` tarball
- **Docker** —— PostgreSQL/Redis 以及 MCP/智能体沙箱都需要它。在 Linux 上安装脚本会提议运行官方 `get.docker.com`
  脚本；在 macOS 上需要 Docker Desktop、OrbStack 或 Colima。注意：Docker Desktop **首次启动**可能需要在图形界面中
  授权（特权辅助程序），耗时可能超过安装脚本约 60 秒的等待 —— 此时请等 Docker 启动完成后重新运行 `./install.sh`
  （可以安全重复）
- 一个兼容 OpenAI 的 LLM 端点：本地 **vLLM + LiteLLM** 栈、**Ollama**，或外部提供商的密钥

### 手动搭建

如果你想自己组装，`install.sh` 就是这些步骤的可读记录：

```bash
npm install
node scripts/setup/gen-env.mjs        # 生成含密钥的最小 .env
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres redis
npm run build && pm2 start ecosystem.config.js   # 迁移会在启动时自动应用
```

> `--env-file .env` 不能省略：Compose 会以 compose 文件所在目录（`infra/`）为基准查找默认的 `.env`，不指定的话
> `POSTGRES_PASSWORD` 为空，启动会失败。

`gen-env.mjs` 只写入启动所需的键（服务器首次启动时也会生成缺失的 `JWT_SECRET` / `API_KEY_PEPPER` /
`TOKEN_ENCRYPTION_KEY`）。`.env.example` 是完整参考 —— 按需从中复制可选配置块（OAuth、网页搜索、MCP 沙箱、
Discord 机器人）：

| 变量 | 用途 |
|---|---|
| `PORT` | API 端口（默认 `52416`） |
| `DATABASE_URL` | PostgreSQL 连接串（密码须与 `POSTGRES_PASSWORD` 一致） |
| `JWT_SECRET` | JWT 签名密钥（≥32 个字符） |
| `API_KEY_PEPPER` | API 密钥哈希用 pepper |
| `TOKEN_ENCRYPTION_KEY` | 外部提供商凭据的 AES-256-GCM 密钥（正好 64 位十六进制） |
| `ADMIN_PASSWORD` | 可选：引导管理员密码 —— 留空则在设置页面创建管理员 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_DEFAULT_MODEL` | LiteLLM 网关端点、主密钥、默认模型 |
| `LLM_GATEWAY_PROVIDERS` | 经网关路由的外部提供商 id（逗号分隔） |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth（可选） |

许多运维设置也可以在 **管理 → 系统设置** 中运行时修改（数据库中的值优先于 `.env`）。

### 运行

日常运维通过 `openmake_llm.sh` 完成，它会按 PostgreSQL → Redis → 应用的顺序管理三层（Linux 与 macOS 通用）：

```bash
./openmake_llm.sh start     # 启动全部并输出日志
./openmake_llm.sh status    # 各层的端口 + docker + PM2 状态
./openmake_llm.sh logs      # 实时 PM2 日志
./openmake_llm.sh health    # GET /health
./openmake_llm.sh deploy    # 构建 + 迁移 + 重启（应用代码变更）
./openmake_llm.sh stop      # 逆序停止
```

或者直接分别运行：

```bash
# 开发
npm run dev                 # 同时运行 API + 前端
npm run dev:api             # 仅后端 (ts-node)
npm run dev:frontend-next   # 仅前端 (next dev)

# 生产
npm run build               # 共享包 + 后端 + 前端
npm start                   # node apps/api/dist/server.js
```

若要在重启后继续运行，把 PM2 注册到 init 系统 —— 先运行 `pm2 startup`（会输出需要执行的命令：macOS 为 `launchd`，
Linux 为 `systemd`），再运行 `pm2 save`。

### 测试与 lint

```bash
npm test                    # 先构建共享包，再运行 Jest 单元测试 (apps/api)
npm run test:e2e            # Playwright (chromium + webkit)
npm run lint                # ESLint
```

### 数据库迁移

`db/migrations/` 中的文件会**在启动时自动应用** —— 在 `db/init/` 基线模式之后，待执行的迁移在 PostgreSQL advisory lock（串行化多实例同时启动）下运行，失败即立刻停止。若要关闭，设置 `DB_AUTO_MIGRATE=false` 并用 CLI 手动执行：

```bash
npx ts-node apps/api/src/data/migrations/cli.ts status    # 显示待执行项
npx ts-node apps/api/src/data/migrations/cli.ts migrate   # 应用
```

回滚脚本位于 `db/migrations/rollbacks/`（不在正向迁移扫描范围内）。

---

## 项目结构

```
openmake_llm/
├── apps/
│   ├── api/          # Express 5 + TypeScript API 服务器 (strict, CommonJS)
│   │   └── src/
│   │       ├── routes/ controllers/ services/   # REST + 业务逻辑
│   │       ├── services/orchestrator/           # Planner、capability 执行器、预检
│   │       ├── chat/                            # 管线辅助、分类器、提示词
│   │       ├── agents/                          # 行业智能体、讨论引擎、技能、git 导入
│   │       ├── llm/ providers/ cluster/         # LLM 客户端、提供商抽象、节点路由
│   │       ├── mcp/                             # MCP 工具路由、外部客户端、Docker 沙箱
│   │       ├── sockets/                         # WebSocket 对话与本地桥接处理器
│   │       ├── auth/ security/ middlewares/     # JWT/OAuth、SSRF 防护、限流
│   │       └── data/                            # PostgreSQL（原生 SQL）、迁移、仓储
│   ├── web/          # Next.js + React 前端（运营界面）
│   ├── cli/          # OpenMake Code —— 本地桥接 CLI（从源码构建，见 apps/cli/README.md）
│   ├── desktop-native/ # OpenMake Companion —— SwiftUI 菜单栏应用 (macOS)
│   ├── ios/          # SwiftUI iOS 客户端（开发中）
│   ├── discord-bot/  # 可选：Discord 网关机器人（转发到 /api/v1/chat/completions）
│   └── legacy-web/   # /generated 媒体的静态资源主机
├── db/               # 初始模式 + 迁移（+ rollbacks/）—— 运行时读取
├── packages/         # shared-types, api-contracts, config, api-client, local-bridge-core
├── infra/            # Dockerfile 与 compose (mcp-runtime, task-runtime, artifact-viewer, egress-proxy)
├── scripts/          # setup/ (gen-env.mjs)、LLM 后端主机配置 (vLLM/LiteLLM)、Caddy、诊断
├── tests/            # Playwright E2E
├── assets/           # README 演示 GIF
├── install.sh        # 一键安装脚本 (Linux/macOS)：工具链 → .env → DB → 构建 → PM2
├── openmake_llm.sh   # 服务管理：start/stop/restart/deploy/update/status/logs/health
└── ecosystem.config.js  # PM2 进程定义（API、Next 前端、可选 Discord 机器人）
```

**运行中的服务器真正需要的：** 构建好的 `apps/api/dist` + `apps/web/.next`、`db/`（启动路径会应用 `db/init/` 和待执行的 `db/migrations/`），以及供 Docker 隔离沙箱使用的 `infra/`。`scripts/` 和 `tests/` *不会*被任何运行时代码加载 —— 但 `scripts/vllm/` 与 `scripts/caddy/` 是推理后端和反向代理的部署产物，请与仓库一起保留。

---

## 参与贡献

欢迎贡献。请注意：

- 使用 [Conventional Commits](https://www.conventionalcommits.org/) —— `feat`、`fix`、`refactor`、`docs`、`test`、`chore`。
- 在功能/修复分支上工作，并向 `main` 发起 PR。
- 遵循代码约定：TypeScript strict 模式、用 Zod 做输入校验、用 Winston 记录日志、**只用参数化原生 SQL**（无 ORM），以及配置外置（不硬编码模型名、魔法数字或内联提示词）。

**发起 PR 之前：**

- [ ] `npm run lint` 通过
- [ ] `npm test` 通过
- [ ] 数据库模式变更附带迁移文件（序号不冲突）
- [ ] 新增环境变量已写入 `.env.example`
- [ ] UI 变更附截图或简短 GIF；安全相关变更说明影响范围

CI 会在每次 push 和 pull request 时运行统一的 **CI Gate**（Test → Build → Size → Lint）。

---

## 联系我们

| | |
|---|---|
| 一般问题与自托管帮助 | support@openmake.cc |
| 维护者 | riskpw@openmake.cc · rockyhan@openmake.cc |

---

## 许可证

基于 **MIT 许可证** 发布 —— 详见 [LICENSE](LICENSE)。
