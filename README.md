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

- **7 Brand Model Profiles** — `Default`, `Pro`, `Fast`, `Think`, `Code`, `Vision`, `Auto`, each mapped to different LLM engines via environment configuration
- **Intelligent Auto-Routing** — LLM classifier + 2-layer semantic cache for optimized query handling via `openmake_llm_auto`
- **100+ Specialized Agents** — 18 industry categories with keyword routing, topic analysis, discussion engine, and skill management
- **Deep Research Engine** — Multi-step autonomous research with topic decomposition, web scraping, content synthesis, and report generation
- **MCP (Model Context Protocol)** — 9 built-in tools (web search, scraping, vision, etc.) with tier-based access, user sandbox, and external MCP client support
- **A2A (Agent-to-Agent) Multi-Model** — Parallel multi-model orchestration across different API keys and providers
- **Real-time Streaming** — Low-latency WebSocket-based chat with streaming responses
- **RAG (Retrieval-Augmented Generation)** — Upload your documents and get AI answers grounded in your own data
- **OpenAI-Compatible API** — Drop-in replacement endpoint for OpenAI API consumers
- **Ollama Cluster Management** — Multi-node cluster with load balancing and API key pool rotation (up to 5 keys)

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

1. **Start a chat** — Type a message in the chat input. The default model profile is `Default`.
2. **Switch model profiles** — Click the model selector (bottom of the chat) to try `Fast` (quick replies), `Think` (deep reasoning), `Code` (programming), or `Auto` (intelligent routing).
3. **Try an expert agent** — Open the Agent panel to select a specialist (e.g., Software Engineer, Financial Analyst) for domain-specific conversations.
4. **Explore the Skill Library** — Browse available tools and capabilities in the Skill Library tab.
5. **Admin settings** — If logged in as admin, visit the Admin panel to manage users, models, and system configuration.

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
├── js/modules/      # 23 core modules (chat, auth, state, websocket, sanitize)
│   └── pages/       # 24 page modules (admin, analytics, research, documents)
└── css/             # Design tokens and styles
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
