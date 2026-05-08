<p align="center">
  <img src="screenshot-main.png" alt="OpenMake LLM" width="800" />
</p>

<h1 align="center">OpenMake LLM</h1>

<p align="center">
  <strong>Self-hosted AI Assistant Platform with Multi-Model Orchestration</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  <img src="https://img.shields.io/badge/version-1.5.6-green.svg" alt="Version" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg" alt="Node" />
  <img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="TypeScript" />
</p>

---

OpenMake LLM is a high-performance, self-hosted AI assistant platform designed for multi-model orchestration and advanced agentic workflows. It provides a lightweight, framework-free frontend paired with a robust TypeScript backend, supporting local and cloud LLM deployments with intelligent routing and semantic caching.

## Key Features

- **6 Brand Model Profiles** — `Default`, `Pro`, `Fast`, `Think`, `Code`, `Vision`, each mapped to different LLM engines via environment configuration
- **2-Layer Semantic Cache** — Query classification with semantic cache (L1/L2) for optimized response latency
- **100+ Specialized Agents** — 18 industry categories with keyword routing, topic analysis, discussion engine, and skill management
- **Deep Research Engine** — Multi-step autonomous research with topic decomposition, web scraping, content synthesis, and report generation
- **MCP (Model Context Protocol)** — 9 built-in tools (web search, scraping, vision, filesystem, deep research, sequential thinking, firecrawl, etc.) with tier-based access, user sandbox, and external MCP client support
- **A2A (Agent-to-Agent) Multi-Model** — Parallel multi-model orchestration across different API keys and providers
- **Real-time Streaming** — Low-latency WebSocket-based chat with streaming responses
- **RAG (Retrieval-Augmented Generation)** — Upload your documents and get AI answers grounded in your own data
- **OpenAI-Compatible API** — Drop-in replacement endpoint for OpenAI API consumers
- **Ollama Cluster Management** — Multi-node cluster with load balancing and API key pool rotation (up to 5 keys)
- **External LLM Provider — OpenRouter Single Catalog (367+ models)** — Each user registers their OpenRouter API key from **Settings → AI 모델 → 기본 모델**. Keys are AES-256-GCM encrypted at rest, billed to the user's own OpenRouter account, and managed via ⋮ context menu (validate / usage / delete). The OpenRouter catalog card opens a full-screen modal with all routed models (free + paid) — search, sort by price, free-first display, and one-click selection.
  - **OpenRouter** (`openai`-compatible SDK + `defaultHeaders` attribution) — single endpoint that routes to GPT-5, Claude Opus/Sonnet/Haiku, Gemini, Llama, DeepSeek, and 360+ other models
  - **Live capability inference** — vision (`architecture.input_modalities`), tool calling (`supported_parameters: ['tools']`), thinking (`supported_parameters: ['reasoning']` or `pricing.internal_reasoning`), pricing (per-1M-token USD from `/v1/models`)
  - **Free model first-class** — `:free` suffix or pricing 0/0 detection, sorted to top with 🆓 FREE badge
  - **Dynamic pricing** — `pricing.prompt`/`pricing.completion` extracted live from each model entry; OpenRouter's `usage.cost` is used for actual billing when available, with the routing fallback ($3/$15 per 1M tokens) only as a safety net
  - 90-day usage retention with per-call cost tracking

<details>
<summary><b>View All 18 Agent Categories (100+ Agents)</b></summary>

| Category | Agents |
|----------|--------|
| 🖥️ Technology | Software Engineer, Data Scientist, Cybersecurity Expert, Cloud Architect, DevOps, AI/ML, Blockchain, Mobile, Frontend, Backend, QA |
| 💰 Finance | Financial Analyst, Investment Banker, Risk Manager, Accountant, Tax Advisor, Actuary, Quant, Crypto Analyst, Portfolio Manager |
| 🏥 Healthcare | Physician, Pharmacist, Nurse, Medical Researcher, Psychologist, Nutritionist, Biomedical Engineer |
| ⚖️ Legal | Corporate Lawyer, Criminal Lawyer, Patent Attorney, Labor Lawyer, Compliance Officer |
| 🏢 Business | Strategist, Marketing, Product, Project, HR, Operations, Supply Chain, Brand, Startup Advisor |
| 🎨 Creative | UI/UX Designer, Graphic Designer, Content Writer, Video Producer, Game Designer, Copywriter, Creative Director |
| ⚙️ Engineering | Mechanical, Electrical, Civil, Chemical, Industrial, Robotics, Automotive |
| 🔬 Science | Research Scientist, Physicist, Chemist, Biologist, Environmental, Materials, Data Analyst |
| 📚 Education | Educator, Curriculum Designer, EdTech Specialist, Academic Advisor |
| 📺 Media | Journalist, PR Specialist, Social Media Manager, Communications Strategist |
| 🤝 Social Welfare | Sociologist, Social Policy Researcher, Demographer, Labor Economist |
| 🏛️ Government | Policy Analyst, Urban Planner, Public Administrator, Diplomat |
| 🏠 Real Estate | Real Estate Analyst, Property Manager, Architecture Consultant |
| ⚡ Energy | Energy Analyst, Sustainability Consultant, Renewable Energy Engineer |
| 🚚 Logistics | Logistics Manager, Transportation Analyst, Warehouse Manager |
| 🏨 Hospitality | Hospitality Manager, Event Planner, Tourism Consultant |
| 🌾 Agriculture | Agricultural Scientist, Food Scientist, Agribusiness Consultant |
| 🌟 Special | Ethicist, Futurist, Systems Thinker, Behavioral Economist, Crisis Manager, Negotiation Expert, Fact Checker |

</details>

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Vanilla JS SPA)                 │
│              ES Modules · No Framework · Vite Dev            │
└────────────────────────┬────────────────────────────────────┘
                         │ REST + WebSocket
┌────────────────────────▼────────────────────────────────────┐
│                  Backend (Express 5 + TypeScript)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │  Routes   │ │  Auth    │ │  MCP     │ │  WebSocket    │  │
│  │  (25+)    │ │  JWT/    │ │  Tools   │ │  Streaming    │  │
│  │          │ │  OAuth   │ │  Router  │ │               │  │
│  └────┬─────┘ └──────────┘ └──────────┘ └───────────────┘  │
│       │                                                      │
│  ┌────▼──────────────────────────────────────────────────┐  │
│  │              Chat Pipeline                             │  │
│  │  Query → Classifier → Semantic Cache → Model Selector  │  │
│  │       → Domain Router → Context Engineering → Stream   │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ 100+     │ │  Deep    │ │  RAG &   │ │  Monitoring   │  │
│  │ Agents   │ │ Research │ │  Memory  │ │  & Analytics  │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │PostgreSQL│  │  Ollama  │  │  Ollama  │
    │          │  │  (Local) │  │  (Cloud) │
    └──────────┘  └──────────┘  └──────────┘
```

**Tech Stack:**
- **Backend**: Express 5, TypeScript (strict mode), CommonJS output, ES2022
- **Frontend**: Vanilla JS SPA with ES Modules — no framework, no JS build step
- **Database**: PostgreSQL via `pg` — raw parameterized SQL, auto-schema on launch, no ORM
- **Process Manager**: PM2
- **CI/CD**: GitHub Actions — 4 gates (Bun Test → TS Build → File Size Guard → ESLint)
- **Observability**: OpenTelemetry

## Quick Start

> **Overview** — Clone to first chat in 6 steps:
>
> 1. Install prerequisites (Node.js, PostgreSQL, Ollama)
> 2. Clone the repository and run `npm install`
> 3. Copy `.env.example` to `.env` and set 5 required variables
> 4. Pull the local embedding model (`ollama pull nomic-embed-text`)
> 5. Start the server (`npm run dev`)
> 6. Open `http://localhost:52416` and log in

### Prerequisites

#### Required

| Dependency | Minimum | Tested With | Notes |
|:-----------|:--------|:------------|:------|
| **Git** | v2.0+ | — | Required for cloning the repository |
| **Node.js** | v20.0+ | v25.8.0 | Runtime |
| **npm** | v10.0+ | v11.11.0 | Required for npm workspaces |
| **PostgreSQL** | v14.0+ | v16.13 | Must be running with a configured `DATABASE_URL` |
| **Ollama** | v0.1.30+ | v0.18.3 | Orchestrates local embeddings and cloud LLM engines |

#### Optional

- **PM2** — Production process manager
  ```bash
  npm install -g pm2
  ```
- **Playwright** — Required only for E2E tests
  ```bash
  npx playwright install
  ```

#### Setup Guides

<details>
<summary><b>1. Install Node.js (v20+) — macOS</b></summary>

**Option A — Homebrew:**
```bash
brew install node
node -v   # Verify v20.0+
npm -v    # Verify v10.0+
```

**Option B — nvm (recommended for managing multiple versions):**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.zshrc
nvm install 20
node -v
```

</details>

<details>
<summary><b>2. Install & Configure PostgreSQL — macOS</b></summary>

```bash
# Install
brew install postgresql@16

# Start service (auto-start on boot)
brew services start postgresql@16

# Verify status
brew services list
```

**Create database and user:**
```bash
# Connect to PostgreSQL
psql postgres

# Run the following SQL (change the password to your own)
CREATE USER openmake WITH PASSWORD 'your_password';
CREATE DATABASE openmake_llm OWNER openmake;
GRANT ALL PRIVILEGES ON DATABASE openmake_llm TO openmake;
\q
```

> **Troubleshooting:** If you get `role "yourname" does not exist`, try connecting with `psql -U postgres postgres` instead.

> **Note:** The username, password, and database name above must match the `DATABASE_URL` in your `.env` file.
> ```
> DATABASE_URL=postgresql://openmake:your_password@localhost:5432/openmake_llm
> ```

</details>

<details>
<summary><b>3. Install & Start Ollama — macOS</b></summary>

Download and install from the [Ollama official website](https://ollama.com/download).

```bash
# Verify installation
ollama --version

# Start Ollama service (or just launch the Ollama app)
ollama serve
```

> **Note:** Launching the Ollama app automatically starts the service in the background.
> Default port is `11434`, accessible at `http://localhost:11434`.

</details>

<details>
<summary><b>4. Install on Linux (Ubuntu/Debian)</b></summary>

```bash
# Node.js (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create PostgreSQL user and database
sudo -u postgres psql -c "CREATE USER openmake WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "CREATE DATABASE openmake_llm OWNER openmake;"

# Ollama
curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
```

</details>

<details>
<summary><b>5. Install on Windows</b></summary>

**Option A — WSL2 (Recommended):**

WSL2 (Windows Subsystem for Linux) provides the smoothest experience. Install it, then follow the Linux guide above.

```powershell
# In PowerShell (Run as Administrator)
wsl --install -d Ubuntu
# Restart your PC, then open "Ubuntu" from Start menu
# Follow the Linux (Ubuntu/Debian) guide above
```

**Option B — Native Windows:**

1. **Node.js**: Download the LTS installer from [nodejs.org](https://nodejs.org/) → run it → verify with `node -v` in PowerShell.
2. **PostgreSQL**: Download from [postgresql.org/download/windows](https://www.postgresql.org/download/windows/) → run the installer (remember the password you set for the `postgres` user) → use pgAdmin or `psql` from the Start menu.
3. **Ollama**: Download from [ollama.com/download](https://ollama.com/download) → run the installer → verify with `ollama --version` in PowerShell.
4. **Git**: Download from [git-scm.com](https://git-scm.com/download/win) if not already installed.

**Generating secret keys on Windows** (since `openssl` may not be available):
```powershell
# PowerShell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

</details>

### Tested Environment

| Component | Specification |
|:----------|:-------------|
| **OS** | macOS 26.3 (Tahoe) |
| **Processor** | Apple M4 |
| **Memory** | 16GB RAM |
| **Node.js** | v25.8.0 |
| **PostgreSQL** | v16.13 (Homebrew) |
| **Ollama** | v0.18.3 |
| **Playwright** | v1.58.0 |

### Installation

```bash
# Clone
git clone https://github.com/openmake/openmake_llm.git
cd openmake_llm

# Install dependencies
npm install

# Configure environment
cp .env.example .env
```

#### Configure `.env`

Open the `.env` file and set the following **5 required variables**:

```bash
# 1. DATABASE_URL — PostgreSQL connection string (use credentials from setup above)
DATABASE_URL=postgresql://openmake:your_password@localhost:5432/openmake_llm

# 2. JWT_SECRET — Auth token signing key (generate with: openssl rand -hex 32)
JWT_SECRET=paste_generated_64_char_hex_string_here

# 3. API_KEY_PEPPER — API key hashing salt (generate with: openssl rand -hex 32)
API_KEY_PEPPER=paste_generated_64_char_hex_string_here

# 4. ADMIN_PASSWORD — Initial admin account password
#    Must be 8+ chars with uppercase, lowercase, digit, and special character
ADMIN_PASSWORD=YourSecurePassword123!

# 5. OLLAMA_API_KEY_1 — Ollama Cloud API key (required for cloud models)
#    Get your key from https://ollama.com/settings
OLLAMA_API_KEY_1=your_ollama_api_key_here
```

> **Tip:** Generate secret keys from your terminal (produces a random 64-character hex string):
> ```bash
> # macOS / Linux
> openssl rand -hex 32
>
> # Windows (PowerShell) — if openssl is not available
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```
> Run the command twice — once for `JWT_SECRET` and once for `API_KEY_PEPPER`.

> **Ollama Cloud vs Local — which should I use?**
>
> | | Cloud Models (`:cloud` suffix) | Local Models |
> |---|---|---|
> | **How it works** | Requests are sent to [Ollama Cloud](https://ollama.com) servers | Models run on your own machine's CPU/GPU |
> | **API key required?** | Yes — at least one `OLLAMA_API_KEY_*` | No |
> | **Hardware needed** | Minimal (any machine) | GPU with 8GB+ VRAM recommended (varies by model) |
> | **Cost** | Free tier available — see [ollama.com/pricing](https://ollama.com) for limits | Free (uses your electricity) |
> | **Setup** | Set `OLLAMA_API_KEY_1` in `.env` | `ollama pull <model>` then update `OLLAMA_DEFAULT_MODEL` in `.env` |
>
> **Default configuration uses Cloud models.** All default models use the `:cloud` suffix (e.g., `gemini-3-flash-preview:cloud`).
> To switch to local models, change `OLLAMA_DEFAULT_MODEL` to a local model (e.g., `llama3.2:latest`) and run `ollama pull llama3.2` first.

#### Start the Server

```bash
# Pull the local embedding model
ollama pull nomic-embed-text

# Start development server
npm run dev
```

The database schema is automatically created on first launch. When the server starts successfully, you should see output similar to:

```
[Server] OpenMake LLM server listening on port 52416
[Database] Connected to PostgreSQL
[Database] Schema initialized
```

#### First Login

Open **http://localhost:52416** in your browser. You can:

- **Admin login** — Use the email from `DEFAULT_ADMIN_EMAIL` in your `.env` (default: `admin@example.com`) with the `ADMIN_PASSWORD` you set above.
- **Register** — Create a new account from the registration tab.
- **Guest mode** — Click "Continue as Guest" for limited access without an account.

#### What to Do After Login

1. **Start a chat** — Type a message in the chat input. The default model is the configured Ollama model.
2. **Switch models** — Open **Settings → AI 모델 → 기본 모델**. The unified ModelSelector dropdown shows your local Ollama model + an OpenRouter card. Click the OpenRouter card to open a full-screen modal with all 367+ routed models (free models on top, search box, click-to-select). **Pure Manual mode** — your selection is never overridden by auto-routing.
3. **Register an OpenRouter key** — In the same dropdown, click "+ 새 LLM 키 등록 → OpenRouter" → enter your `sk-or-...` API key. The model list immediately re-populates with all routed models.
4. **Try an expert agent** — Open the Agent panel to select a specialist (e.g., Software Engineer, Financial Analyst) for domain-specific conversations.
5. **Explore the Skill Library** — Browse available tools and capabilities in the Skill Library tab.
6. **Admin settings** — If logged in as admin, visit the Admin panel to manage users, models, and system configuration.

> **Note (2026-05-08+):** The model selector is now exclusively in the Settings page — the chat input area no longer hosts the dropdown, keeping the chat UI clean. The unified component (mount + key registration + ⋮ menu + search/sort modal) is the single entry point.

### Production

```bash
# Build (required — compiles TypeScript to JavaScript)
npm run build

# Start with PM2
pm2 start ecosystem.config.js

# Or start directly
npm start
```

> **Note:** You must run `npm run build` before `npm start` or `pm2 start`. The build step compiles
> TypeScript source into `backend/api/dist/`. Update the `cwd` path in `ecosystem.config.js` to match
> your project directory before using PM2.

## Configuration

All settings are managed via `.env`. See [`.env.example`](.env.example) for the full reference.

### Essential Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `52416` |
| `DATABASE_URL` | PostgreSQL connection string | **Required** |
| `OLLAMA_BASE_URL` | Ollama server URL | `http://localhost:11434` |
| `JWT_SECRET` | Auth token secret (`openssl rand -hex 32`) | **Required** |
| `API_KEY_PEPPER` | API key hashing salt (`openssl rand -hex 32`) | **Required** (production) |
| `ADMIN_PASSWORD` | Initial admin account password | **Required** |
| `DEFAULT_ADMIN_EMAIL` | Admin login email | `admin@example.com` |
| `OLLAMA_API_KEY_1..5` | Ollama Cloud API key pool ([get key](https://ollama.com/settings)) | **Required** for cloud models |
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM key for OAuth tokens + external LLM API keys (`openssl rand -hex 32`) | **Required** for production (BYO key 암호화 SSoT) |
| `EXTERNAL_MODELS_CACHE_TTL_MS` | External provider `/v1/models` 응답 cache TTL (ms) | `3600000` (1h) |
| `EXTERNAL_USAGE_RETENTION_DAYS` | `external_provider_usage` 보존 기간 (db-retention cron) | `90` |
| `EXTERNAL_PROVIDER_REQUEST_TIMEOUT_MS` | 외부 provider 호출 타임아웃 | `120000` |
| `OMK_APP_URL` | OpenRouter `HTTP-Referer` 헤더 — rankings 노출용 (선택) | (미설정 시 헤더 생략) |
| `OMK_APP_TITLE` | OpenRouter `X-OpenRouter-Title` 헤더 (선택) | (미설정 시 헤더 생략) |
| `OMK_APP_CATEGORIES` | OpenRouter `X-OpenRouter-Categories` 헤더 (선택) | (미설정 시 헤더 생략) |
| `OMK_COOP_ENABLED` | `Cross-Origin-Opener-Policy` 헤더 활성 (HTTPS 환경에서만 의미) | `false` |
| `RL_API_KEY_MGMT_READ` | `/api/api-keys` GET 요청 한도 (15분 window) | `200` |

### Supported Models & Engine Mapping

Each brand profile routes queries to a specialized cloud model via Ollama:

| Brand Profile | Engine Variable | Cloud Model | Use Case |
|:--------------|:----------------|:------------|:---------|
| **Default** | `OMK_ENGINE_LLM` | `gpt-oss:120b-cloud` | Standard conversational tasks |
| **Pro** | `OMK_ENGINE_PRO` | `qwen3.5:397b-cloud` | High-complexity, large context |
| **Fast** | `OMK_ENGINE_FAST` | `gemini-3-flash-preview:cloud` | Low-latency responses |
| **Think** | `OMK_ENGINE_THINK` | `gpt-oss:120b-cloud` | Deep reasoning, problem solving |
| **Code** | `OMK_ENGINE_CODE` | `glm-5:cloud` | Programming, debugging, logic |
| **Vision** | `OMK_ENGINE_VISION` | `qwen3.5:397b-cloud` | Image analysis, multi-modal |
| **Auto** | — | *Intelligent Router* | LLM classifier selects the optimal model per query |

<details>
<summary><b>Additional Supported Cloud Models</b></summary>

The following models are available for A2A multi-model orchestration. The first five can be assigned via `OLLAMA_MODEL_1..5` in `.env`:

| Model | Default Slot | Description |
|:------|:-------------|:------------|
| `gemini-3-flash-preview:cloud` | `OLLAMA_MODEL_1` | Google Gemini 3 Flash — fast general-purpose |
| `gpt-oss:120b-cloud` | `OLLAMA_MODEL_2` | GPT-OSS 120B — strong reasoning |
| `kimi-k2.5:cloud` | `OLLAMA_MODEL_3` | Moonshot Kimi K2.5 — creative and analysis |
| `qwen3-coder-next:cloud` | `OLLAMA_MODEL_4` | Qwen3 Coder Next — code-specialized |
| `qwen3-vl:235b-cloud` | `OLLAMA_MODEL_5` | Qwen3 VL 235B — vision-language |
| `deepseek-v3.2:cloud` | — | DeepSeek V3.2 — strong reasoning and coding |
| `minimax-m2.7:cloud` | — | MiniMax M2.7 — balanced general-purpose |
| `nemotron-3-super:cloud` | — | NVIDIA Nemotron 3 Super — instruction following |

</details>

#### Local Embedding Model

- **`nomic-embed-text:latest`** (274 MB) — Used for vector embeddings in semantic search and RAG. Runs locally to keep embedding fast and private.
  ```bash
  ollama pull nomic-embed-text
  ```

### Optional Integrations

- **Google OAuth 2.0** — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- **Google Custom Search** — `GOOGLE_API_KEY`, `GOOGLE_CSE_ID`
- **Language Policy** — `DEFAULT_RESPONSE_LANGUAGE` (20+ languages supported)

### External LLM Provider — OpenRouter (BYO Key Workflow)

External LLM is consolidated to **OpenRouter as the single catalog** (2026-05-08, migration 018). OpenRouter routes a single API key to 367+ models (GPT-5, Claude, Gemini, Llama, DeepSeek 등) — eliminates the need to register separate keys per provider. Each user manages their own key from the **Settings page**.

**Workflow:**
1. Login → **Settings → AI 모델 → 기본 모델**
2. ModelSelector dropdown opens with the OpenRouter card
3. If no key registered: "+ 새 LLM 키 등록 → OpenRouter" → key registration modal → enter `sk-or-...`
4. After registration, click the OpenRouter card → full-screen `ModelListModal` opens with:
   - 🆓 무료 (29) sub-header (free models, sorted alphabetically)
   - 💰 유료 (338) sub-header (paid models, sorted by input price ascending)
   - Top search input (auto-focus, focus + caret preserved across keystrokes)
   - Click any row → modal closes, model selected, dropdown reflects choice
5. ⋮ context menu (in the dropdown card) → validate / view usage / delete

**Supported provider:**

| Provider | SDK | Default Base URL | Models |
|---|---|---|---|
| **OpenRouter** | `openai` SDK + `defaultHeaders` (HTTP-Referer / X-OpenRouter-Title / X-OpenRouter-Categories from `OMK_APP_*` env vars) | `https://openrouter.ai/api/v1` | 367+ routed (GPT-5, Claude Opus 4.5 / Sonnet 4.6 / Haiku 4.5, Gemini 2.5 Pro/Flash, Llama 3.3 70B, DeepSeek R1/V3 ... 다수의 free 모델 포함) |

> **Defensive dead code retained:** `AnthropicProvider` class + `provider-router.ts` anthropic dispatch branch + DB CHECK constraint `sdk_type IN ('anthropic', 'openai-compatible')` are kept for future re-introduction. Currently only OpenRouter (sdkType `openai-compatible`) is registrable via UI.

**Live capability inference (per model, from `/v1/models`):**
- `vision = architecture.input_modalities.includes('image')`
- `toolCalling = supported_parameters.includes('tools')`
- `thinking = supported_parameters.includes('reasoning' | 'include_reasoning')` 또는 `pricing.internal_reasoning != null`
- `streaming = true` (OpenRouter chat completions 전체)
- `pricing.input/output` — `pricing.prompt`/`pricing.completion` × 1,000,000 (per-token USD → per-1M-token USD)

**Free model detection (dual heuristic):**
- `id.endsWith(':free')` OR `(promptUsd === 0 && completionUsd === 0)`
- 29 free models (2026-05-08 기준) sort to top of modal, marked with 🆓 FREE badge

**Pricing fallback chain:**
1. **Live**: each `ProviderModel.pricing` from `/v1/models` (per-call accuracy)
2. **Direct cost**: OpenRouter's `usage.cost` field on completion (Stage 4f, when reported)
3. **Catalog fallback**: 11 popular models pre-registered in `external-pricing.ts`
4. **Provider routing fallback**: $3/$15 per 1M (Sonnet-equivalent conservative estimate)

**Usage tracking:**
- 모든 외부 호출별 토큰/비용/지연 자동 기록 (`external_provider_usage` 테이블)
- ⋮ → 📊 사용량 모달: 직전 50건 raw 표 + **최근 30일 provider별 누계 박스**
- `GET /api/external-keys/usage/summary?days=N` REST endpoint (max 90일)
- 90일 자동 보존 (db-retention cron, 환경변수 `EXTERNAL_USAGE_RETENTION_DAYS`)

**Migration 018 (operational):**
- Removes legacy provider rows (`provider_id <> 'openrouter'`) from 3 tables: `user_external_api_keys`, `external_provider_models_cache`, `external_provider_usage`
- Idempotent (re-runnable, 0/0/0 on second pass)
- Schema preserved — DB CHECK still allows `'anthropic' | 'openai-compatible'` for future re-introduction
- Apply with: `npx ts-node backend/api/src/data/migrations/cli.ts migrate`

## Project Structure

```
backend/api/src/
├── routes/          # 25+ Express route modules (REST API)
├── services/        # Core: ChatService, DeepResearch, RAG, Memory, Embedding
├── chat/            # Pipeline: classifier, model-selector, domain-router, cache
├── agents/          # 100+ industry agents, keyword router, discussion engine
├── mcp/             # Tool router, tiers, external client, user sandbox
├── auth/            # JWT, OAuth, API keys, RBAC, scope middleware
├── data/            # PostgreSQL repositories, migrations
├── sockets/         # WebSocket streaming handler
├── config/          # Environment, constants, limits, model defaults
├── monitoring/      # Analytics, token tracking
├── ollama/          # Ollama client wrapper
└── cluster/         # Multi-node cluster management

frontend/web/public/
├── js/modules/         # Core modules (chat, auth, state, websocket, sanitize)
│   ├── pages/          # 24 page modules (admin, analytics, research, documents...)
│   │                   # Settings page hosts the unified ModelSelector mount point.
│   └── components/     # Reusable components:
│                       #  - model-selector.js (dropdown + Ollama group + OpenRouter card)
│                       #  - model-list-modal.js (full-screen 367+ model browser)
│                       #  - add-key-modal.js, usage-modal.js, model-action-menu.js
└── css/                # Design tokens, components, model-selector styles
```

**Frontend lifecycle (SPA):** ModelSelector exports `mount(target)` / `refresh()` / `unmount()`. The Settings page calls `mount` on init and `unmount` on cleanup — required to remove the document-level click handler and reset module state, preventing memory leaks across route transitions.

```
services/database/migrations/
├── 016_external_provider_integration.sql  # 3 tables: user_external_api_keys, ..._usage, ..._models_cache
├── 017_drop_uir_schema.sql                # Legacy UIR cleanup
└── 018_keep_only_openrouter.sql           # 2026-05-08: catalog reduction (DELETE non-openrouter)
```

## Development

```bash
npm run dev              # API + Frontend (concurrent)
npm run dev:api          # Backend only
npm run dev:frontend     # Frontend only (Vite)
npm run build            # Full production build
npm run lint             # ESLint
```

## Testing

```bash
npm test                 # Jest unit tests
npm run test:e2e         # Playwright E2E (Chromium)
npm run test:e2e:ui      # Playwright interactive UI mode
```

## API

OpenMake LLM provides an **OpenAI-compatible endpoint** (`/api/v1/chat/completions`), allowing it to serve as a drop-in replacement for applications using the OpenAI API.

Interactive API documentation is available at `http://localhost:52416/api/docs` when running in development mode.

### Selected Domain Endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/v1/chat/completions` | POST | API key (`X-API-Key`) | OpenAI-compatible chat (drop-in for OpenAI consumers) |
| `/api/models` | GET | optional | Available models (Ollama + 인증 시 사용자 등록 외부 LLM 합산) |
| `/api/external-keys` | GET | JWT | Provider 카탈로그 + 사용자 등록 키 메타 |
| `/api/external-keys/:providerId` | POST/DELETE | JWT | 키 등록·갱신·삭제 (AES-256-GCM 암호화) |
| `/api/external-keys/:providerId/validate` | POST | JWT | 키 즉시 검증 (latency 포함) |
| `/api/external-keys/usage/recent` | GET | JWT | 직전 50건 raw 사용량 |
| `/api/external-keys/usage/summary?days=N` | GET | JWT | N일(max 90) provider별 누계 (call/tokens/cost) |
| `/api/api-keys` | GET/POST/DELETE | JWT | OpenMake 자체 API 키 관리 (서드파티 클라이언트용) |
| `/api/usage` | GET | JWT | OpenMake 자체 사용량 통계 |

`/external-keys.html` URL 은 폐기됨 — `/?openModelSelector=1` 로 301 redirect (legacy bookmark 호환). 새 entry point 는 `/settings` 페이지.

### Skill Library

<p align="center">
  <img src="skill-library-current.png" alt="Skill Library" width="700" />
</p>

## Security

- **Authentication**: JWT (JSON Web Token) access/refresh tokens in HttpOnly cookies
- **OAuth**: Google OAuth 2.0 social login
- **API Keys**: HMAC-SHA-256 hashed, scope-based access control
- **Authorization**: RBAC (Role-Based Access Control) — admin, user, and guest roles
- **Rate Limiting**: Per-route rate limiting to prevent abuse
- **XSS Defense**: Content sanitization via `sanitize.js`
- **CORS**: Configurable origin whitelist

## Contributing

Contributions are welcome! Please ensure:

1. Strict TypeScript — no `any` types in the backend
2. Vanilla JS only — no frontend frameworks
3. Parameterized SQL — no raw string concatenation in queries
4. Tests — unit tests for new services, E2E for user-facing features
5. File size — source files must stay under 600 lines (CI enforced)

## Troubleshooting

<details>
<summary><b>Common Issues</b></summary>

| Error | Cause | Solution |
|:------|:------|:---------|
| `ECONNREFUSED ...5432` | PostgreSQL not running | `brew services start postgresql@16` (macOS) or `sudo systemctl start postgresql` (Linux) |
| `ECONNREFUSED ...11434` | Ollama not running | Launch the Ollama app or run `ollama serve` |
| `JWT_SECRET must be at least 32 characters` | Missing `.env` configuration | Run `openssl rand -hex 32` and set it in `.env` |
| Login fails: "Invalid credentials" | Wrong email or password | Check `DEFAULT_ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` |
| Chat returns no response | Missing Ollama Cloud API key | Set `OLLAMA_API_KEY_1` in `.env` (get key from [ollama.com/settings](https://ollama.com/settings)) |
| `password authentication failed` | PostgreSQL credentials mismatch | Ensure `DATABASE_URL` in `.env` matches the user/password you created in PostgreSQL |
| `API_KEY_PEPPER is required in production` | Missing pepper key | Run `openssl rand -hex 32` and set `API_KEY_PEPPER` in `.env` |
| `role "username" does not exist` | PostgreSQL auth issue | Try `psql -U postgres postgres` to connect |
| `EADDRINUSE :::52416` | Port already in use | Stop the other process using the port, or change `PORT` in `.env` |
| `npm install` fails with `node-gyp` | Missing build tools | macOS: `xcode-select --install` · Linux: `sudo apt install build-essential` · Windows: use WSL2 |
| `ollama pull` hangs or fails | Network or disk issue | Check internet connection and available disk space (`df -h`) |
| `peer authentication failed` (Linux) | PostgreSQL auth method | Edit `pg_hba.conf` to change `peer` to `md5` for local connections, then restart PostgreSQL |
| `command not found: brew` | Homebrew not installed | Install from [brew.sh](https://brew.sh): `/bin/bash -c "$(curl -fsSL ...)"` |
| Embedding error on first chat | `nomic-embed-text` not pulled | Run `ollama pull nomic-embed-text` before starting the server |
| DB password with special characters | URL encoding needed | Encode special chars in `DATABASE_URL` (e.g., `@` → `%40`, `#` → `%23`) |
| OpenRouter 키 등록 후 모델 6개만 노출 | `/api/models` 응답에 외부 모델 미합산 (`req.user.id` 미설정) | `npm run build` + PM2 재시작. 그래도 안 되면 `DELETE FROM external_provider_models_cache` 로 캐시 비우고 재등록 |
| OpenRouter 모달 클릭해도 모델 선택 안 됨 | 브라우저 캐시 — `model-list-modal.js` 옛 버전 | 하드 리로드 (Cmd+Shift+R) 또는 시크릿 창. 모달의 모델 row 클릭 시 close + setSelectedModel 동작 확인 |
| 풀스크린 모달이 작게 보임 (dropdown처럼) | `model-selector.css` 캐시 stale (`?v=` 갱신 누락) | 하드 리로드. `<link href="...?v=N">` 의 N 값이 갱신되었는지 DevTools Network 탭에서 확인 |
| Settings 페이지 진입 시 ModelSelector 안 뜸 | 3개 sibling 모달 (AddKeyModal/UsageModal/ModelActionMenu) import 실패 | DevTools Console: `[settings] ModelSelector mount 실패` 확인. settings.js init() 의 `Promise.all([... 4개 import ...])` 가 모두 성공해야 함 |
| `/api/api-keys` 429 Too Many Requests | settings 페이지 빠른 재진입 시 GET 한도 (default 200/15min) 초과 | 5분 sessionStorage 캐시가 적용되어 있음. 브라우저 캐시 갱신 또는 `RL_API_KEY_MGMT_READ` 환경변수로 한도 상향 |
| `Cross-Origin-Opener-Policy header has been ignored` 경고 | HTTP/IP origin 에서 헤더 무시 (정상) | `OMK_COOP_ENABLED=false` (기본) 시 헤더 미발송. HTTPS 도입 후 `true` 로 활성화 |
| WebSocket connection failed (외부 도메인) | 공유기/라우터 NAT 가 ws upgrade 차단 | `localhost:52416` 직접 접속 시 정상. 외부 도메인은 HTTPS (Caddy/Cloudflare Tunnel) 도입 권장 |
| `External 키 검증 실패` | 잘못된 OpenRouter 키 또는 SSRF 차단 | ⋮ → 🔍 검증 → 에러 메시지 확인. localhost/사설 IP는 SSRF 가드로 차단됨 |
| `TOKEN_ENCRYPTION_KEY 환경 변수가 설정되지 않았습니다` 경고 | 외부 LLM API 키 평문 저장 위험 | `openssl rand -hex 32` → `TOKEN_ENCRYPTION_KEY` `.env`에 설정 → PM2 재시작 |

</details>

## Glossary

<details>
<summary><b>Terms used in this document</b></summary>

| Term | Meaning |
|:-----|:--------|
| **SPA** | Single Page Application — the browser loads one HTML page and updates content dynamically |
| **MCP** | Model Context Protocol — a standard that lets AI models use external tools (web search, file access, etc.) |
| **A2A** | Agent-to-Agent — multiple AI models working together on a single query |
| **RAG** | Retrieval-Augmented Generation — AI answers grounded in your uploaded documents |
| **JWT** | JSON Web Token — a secure token format used for login sessions |
| **RBAC** | Role-Based Access Control — permissions based on user roles (admin, user, guest) |
| **WebSocket** | A protocol for real-time, two-way communication between browser and server (used for streaming chat) |
| **Semantic Cache** | Caches AI responses by meaning, so similar questions get instant answers without re-querying the model |
| **Ollama** | An open-source tool for running LLMs locally or routing to cloud models |
| **Embedding** | Converting text into numerical vectors for similarity search and RAG |

</details>

## License

[MIT](LICENSE) © 2026 OpenMake Contributors
