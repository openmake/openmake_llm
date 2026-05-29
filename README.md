<h1 align="center">OpenMake LLM</h1>

<p align="center">
  <strong>Self-hosted AI assistant platform with a vLLM/LiteLLM backend + OpenRouter cloud routing</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  <img src="https://img.shields.io/badge/version-1.5.6-green.svg" alt="Version" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg" alt="Node" />
  <img src="https://img.shields.io/badge/TypeScript-strict-blue.svg" alt="TypeScript" />
</p>

---

## What is OpenMake LLM?

OpenMake LLM is a **self-hosted AI assistant** you run on your own machine. It combines:

- **Self-hosted vLLM backend** behind a **LiteLLM proxy** (OpenAI-compatible) for fast, private local inference — default model `qwen3.6-35b-a3b` with 262K↔1M context routing
- **OpenRouter** as a single cloud gateway to 367+ models (GPT-5, Claude, Gemini, Llama, DeepSeek 등) — bring your own API key
- **100 specialist agents** across 18 industry categories — each with curated prompts
- **7 brand model profiles** (Default, Pro, Fast, Think, Code, Vision, Auto) routed by a regex classifier + fast-path detector
- **13 built-in tools** (web search/scrape, vision OCR, deep research, skill/agent/MCP-server import 등) via MCP, with tier-based access
- **OpenAI-compatible API** — drop-in endpoint at `/api/v1/chat/completions`

No SaaS. No telemetry to third parties. Your data stays on your hardware (or your own database).

---

## Quick Start (5 minutes)

> Goal: clone → first chat. The full path is **clone → install → set 5 env vars → start → open browser**.

### 1. Prerequisites

You need: **Node.js v22+**, **PostgreSQL v14+**, and access to a **vLLM + LiteLLM** OpenAI-compatible endpoint (local or remote — launch scripts are in `scripts/vllm/`). See the [Detailed Install](#detailed-install-by-platform) section below if you don't have these yet.

### 2. Clone & install

```bash
git clone https://github.com/openmake/openmake_llm.git
cd openmake_llm
npm install
```

### 3. Configure (5 required env vars)

```bash
cp .env.example .env
# Open .env and set these 5 values:
```

| Variable | What it is | How to get it |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://openmake:<password>@localhost:5432/openmake_llm` |
| `JWT_SECRET` | 64-char hex for auth tokens | `openssl rand -hex 32` |
| `API_KEY_PEPPER` | 64-char hex for API key hashing | `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | Initial admin password | Min 8 chars, 1 upper + 1 digit + 1 symbol |
| `LLM_BASE_URL` | vLLM/LiteLLM proxy endpoint | e.g. `http://localhost:4000` (local) or your LiteLLM URL |

> **TOKEN_ENCRYPTION_KEY** is also strongly recommended (`openssl rand -hex 32`) — encrypts external LLM keys in the DB. Required if you want users to register OpenRouter keys.

### 4. Start the LLM backend & app

```bash
# Start vLLM + LiteLLM (server PC — see scripts/vllm/ for systemd units)
bash scripts/vllm/qwen-serve.sh                                  # :8002 (default chat, 262K)
litellm --config scripts/vllm/litellm.config.yaml --port 4000    # OpenAI-compatible proxy

npm run dev                           # API + frontend (concurrent)
```

You'll see:
```
[Server] OpenMake LLM listening on port 52416
[Database] Schema initialized
```

### 5. Open the app

http://localhost:52416 → log in with `admin@example.com` (or your `DEFAULT_ADMIN_EMAIL`) and the `ADMIN_PASSWORD` you just set.

---

## First-Time User Walkthrough

After login, here's how to actually use the platform:

### A. Send your first chat (no setup needed)

Type a message in the input box and hit Enter. The default model (`qwen3.6-35b-a3b`, served by vLLM) responds in real-time over WebSocket.

### B. Switch to a more powerful model

1. Open **Settings** (sidebar) → **AI 모델** card → **기본 모델**
2. The unified ModelSelector dropdown appears with two groups:
   - 🖥️ **로컬 LLM** — models served by your vLLM/LiteLLM backend
   - 🌐 **OpenRouter** — 367+ cloud routed models (requires key registration, see C)
3. Click any local model to switch immediately

### C. Register an OpenRouter key (for cloud models)

OpenRouter is one API key → access to GPT-5, Claude, Gemini, Llama, DeepSeek, and 360+ others including 29+ free models.

1. In the same dropdown, click **"+ 새 LLM 키 등록 → OpenRouter"**
2. Get a key at https://openrouter.ai/keys (starts with `sk-or-...`)
3. Paste it → click **등록**
4. The OpenRouter card now shows `367 모델 | 🆓 무료 29 | 💰 유료 338`
5. Click the OpenRouter card → full-screen modal opens with all routed models, sorted free-first
6. Search for a model (e.g., type `claude`) and click to select

The selected model is used for all subsequent chats. Per-call usage and cost (USD) are recorded automatically.

### D. Try a specialist agent

Open the **에이전트** panel and pick one of the 100 specialists (e.g., **Software Engineer**, **Financial Analyst**, **Medical Researcher**). The agent injects domain-specific system prompts before your message.

### E. Use built-in tools

Type messages that hint at tool use, or open the **Skill Library** to see available capabilities. 13 built-in tools, tier-gated (Free / Pro / Enterprise):

- `web_search` / `fact_check` / `extract_webpage` / `research_topic` — Google CSE-backed search + research (Free)
- `vision_ocr` / `analyze_image` — image understanding (Free)
- `create_skill` / `import_skill_from_git` / `import_agent_from_git` / `import_mcp_server_from_git` — natural-language & Git draft import (Free)
- `web_scrape` / `web_map` / `web_crawl` — web scraping, no API key (free 3-tier fallback) (Pro)
- Enterprise tier unlocks all external MCP tools (PostgreSQL, Python REPL, Playwright Browser, Knowledge Graph Memory 등)

Check the Skill Library for your access level.

---

## Detailed Install (by Platform)

<details>
<summary><b>macOS</b></summary>

```bash
# Homebrew approach
brew install node postgresql@16
brew services start postgresql@16

# Create database
psql postgres <<EOF
CREATE USER openmake WITH PASSWORD 'change_me';
CREATE DATABASE openmake_llm OWNER openmake;
EOF
```

Set `DATABASE_URL=postgresql://openmake:change_me@localhost:5432/openmake_llm` in `.env`.

</details>

<details>
<summary><b>Linux (Ubuntu/Debian)</b></summary>

```bash
# Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo -u postgres psql -c "CREATE USER openmake WITH PASSWORD 'change_me';"
sudo -u postgres psql -c "CREATE DATABASE openmake_llm OWNER openmake;"
```

> The LLM backend (vLLM + LiteLLM) runs separately — typically on a GPU server. See `scripts/vllm/` for launch scripts and systemd units, and set `LLM_BASE_URL` to its proxy endpoint.

</details>

<details>
<summary><b>Windows</b></summary>

**Recommended: WSL2** (smoothest experience).

```powershell
# In PowerShell (Admin)
wsl --install -d Ubuntu
# Restart, open Ubuntu, follow Linux guide above
```

**Native Windows:**
1. Node.js LTS — https://nodejs.org/
2. PostgreSQL — https://www.postgresql.org/download/windows/ (remember the `postgres` superuser password)
3. Generate hex secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

</details>

### Tested Environment

| Component | Tested With |
|:----------|:------------|
| OS | macOS 26.3 (Tahoe) |
| Hardware | Apple M4, 16GB RAM |
| Node.js | v25.8.0 |
| PostgreSQL | v16.13 (Homebrew) |
| LLM backend | vLLM 0.22 + LiteLLM 1.86 (remote GPU server) |
| Playwright (E2E) | v1.58.0 |

---

## Production Deployment

```bash
# Build (TypeScript → JavaScript + sync frontend assets to dist)
npm run build

# Apply database migrations (idempotent — safe to re-run)
npx ts-node backend/api/src/data/migrations/cli.ts migrate

# Start with PM2
pm2 start ecosystem.config.js
# or: npm start
```

> **`npm run build` is required** before `npm start` — it compiles TypeScript to `backend/api/dist/` and copies frontend static assets. Update the `cwd` path in `ecosystem.config.js` to match your deploy location.

> **Migrations are NOT auto-applied on server start** — run `cli.ts migrate` explicitly during deploy. The runner is idempotent and tracks applied versions in `migration_versions` table.

### Health check

```bash
curl http://localhost:52416/health
# → { "status": "healthy", "version": "1.5.6", "build": { "gitHash": "..." } }
```

---

## Configuration Reference

All settings are in `.env`. Full template: [`.env.example`](.env.example) (70+ variables).

### Required (5)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | 64-hex string for JWT signing (`openssl rand -hex 32`) |
| `API_KEY_PEPPER` | 64-hex string for API key hashing |
| `ADMIN_PASSWORD` | Initial admin account password (8+ chars, mixed) |
| `LLM_BASE_URL` | vLLM/LiteLLM OpenAI-compatible proxy endpoint (e.g. `http://localhost:4000`) |

### Recommended (production)

| Variable | Description | Default |
|---|---|---|
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM key — encrypts OAuth tokens + OpenRouter API keys at rest | (warning if missing) |
| `DEFAULT_ADMIN_EMAIL` | Admin login email | `admin@example.com` |
| `OAUTH_REDIRECT_URI` | Google OAuth callback URL | (auto-derived) |
| `CORS_ORIGINS` | Comma-separated whitelist | `http://localhost:52416` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` | `info` |

### OpenRouter attribution (optional, polite-citizen)

| Variable | Description |
|---|---|
| `OMK_APP_URL` | Sent as `HTTP-Referer` to OpenRouter — appears in https://openrouter.ai/rankings |
| `OMK_APP_TITLE` | Sent as `X-OpenRouter-Title` |
| `OMK_APP_CATEGORIES` | Sent as `X-OpenRouter-Categories` |

Missing values just mean rankings won't show your app — functionality unaffected.

### External LLM (OpenRouter) tuning

| Variable | Description | Default |
|---|---|---|
| `EXTERNAL_MODELS_CACHE_TTL_MS` | OpenRouter `/v1/models` response cache TTL | `3600000` (1h) |
| `EXTERNAL_USAGE_RETENTION_DAYS` | Per-call usage log retention | `90` |
| `EXTERNAL_PROVIDER_REQUEST_TIMEOUT_MS` | Outbound HTTP timeout | `120000` |
| `RL_API_KEY_MGMT_READ` | `/api/api-keys` GET limit (15-min window) | `200` |

### Security headers

| Variable | Description | Default |
|---|---|---|
| `OMK_COOP_ENABLED` | Activates `Cross-Origin-Opener-Policy: same-origin` (HTTPS only — browser ignores on HTTP) | `false` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend — Vanilla JS SPA (no framework, no JS build step) │
│  • 23 page modules, ES module imports                        │
│  • WebSocket streaming + REST                                │
│  • XSS defense via sanitize.js                               │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│  Backend — Express 5 + TypeScript (strict mode, ES2022)     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ 32 REST  │ │  Auth    │ │ MCP Tool │ │ WebSocket      │  │
│  │ Routes   │ │  JWT/    │ │ Router   │ │ Streaming      │  │
│  │          │ │ OAuth    │ │ (13 BIs) │ │                │  │
│  └────┬─────┘ └──────────┘ └──────────┘ └────────────────┘  │
│  ┌────▼──────────────────────────────────────────────────┐  │
│  │  Chat Pipeline (2-layer)                               │  │
│  │  ExecutionPlanBuilder (regex classify + fast-path +    │  │
│  │   profile) → Strategy dispatch → LLMClient.chat        │  │
│  │   (262K↔1M model pool) → Stream                        │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ 100      │ │ Deep     │ │ Model    │ │ Monitoring +   │  │
│  │ Agents   │ │ Research │ │ Pool     │ │ Analytics      │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
              ┌───────────┼───────────┬─────────────┐
              ▼           ▼           ▼             ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
        │PostgreSQL│ │   vLLM   │ │ LiteLLM  │ │OpenRouter│
        │  (raw    │ │  (local  │ │  proxy   │ │ (BYO key)│
        │   SQL)   │ │   GPU)   │ │ (OpenAI) │ │ 367+ mdls│
        └──────────┘ └──────────┘ └──────────┘ └──────────┘
```

### Tech stack

- **Backend**: Express 5, TypeScript strict, CommonJS output, ES2022, `pg` (raw SQL, no ORM)
- **Frontend**: Vanilla JS ES Modules — no React/Vue, Vite for dev only
- **Auth**: JWT in HttpOnly cookies, Google OAuth 2.0, RBAC (admin/user/guest), 3 user tiers (Free/Pro/Enterprise)
- **Process**: PM2 (production)
- **Observability**: OpenTelemetry traces
- **Security**: helmet, CORS allowlist, AES-256-GCM for sensitive data, SSRF guard for outbound URLs

### Model role architecture

OpenMake LLM splits LLM responsibility into roles (set independently via env vars; `OMK_*_MODEL` preferred, legacy `OLLAMA_DEFAULT_MODEL` still honored as a chat fallback):

| Role | Env var | Default | Purpose |
|---|---|---|---|
| `chat` | `OMK_CHAT_MODEL` / `LLM_DEFAULT_MODEL` | `qwen3.6-35b-a3b` | Primary user-facing conversation |
| `classifier` | `OMK_CLASSIFIER_MODEL` | (chat fallback) | Optional model-assisted intent hints (routing is regex-first) |
| `router` | `OMK_ROUTER_MODEL` | (chat fallback) | Agent/skill routing decisions |

On top of roles, **7 brand model profiles** (Default, Pro, Fast, Think, Code, Vision, Auto) are resolved per request by `ExecutionPlanBuilder`. The embedding role and the vector/semantic-cache infrastructure were removed in the 2026-05 migration.

### External LLM — OpenRouter (BYO Key)

Per-user API keys stored AES-256-GCM encrypted in `user_external_api_keys`. The flow:

```
User keys (DB) → ExternalKeysRepository.decryptKey()
  → OpenAICompatProvider (with auto-attached defaultHeaders)
    → POST openrouter.ai/v1/chat/completions
      → Streaming response → WebSocket → User
```

**Live capability inference** from each model's `/v1/models` entry:
- `vision = architecture.input_modalities.includes('image')`
- `toolCalling = supported_parameters.includes('tools')`
- `thinking = supported_parameters.includes('reasoning' | 'include_reasoning')` OR `pricing.internal_reasoning != null`
- `pricing.input/output` = per-token USD × 1,000,000 (per-1M-token USD)

**Free model detection (dual heuristic):** `id.endsWith(':free')` OR `(promptUsd === 0 && completionUsd === 0)`. Free models sort to top of selector modal with 🆓 FREE badge.

**Pricing fallback chain:**
1. **Live**: each `ProviderModel.pricing` from `/v1/models` (per-call accuracy)
2. **Direct cost**: OpenRouter's `usage.cost` in completion response (when reported)
3. **Catalog fallback**: 11 popular models pre-registered in `external-pricing.ts`
4. **Routing fallback**: $3/$15 per 1M tokens (Sonnet-equivalent conservative estimate)

> **Defensive dead code:** `AnthropicProvider` class + `provider-router.ts` anthropic dispatch + DB CHECK constraint `sdk_type IN ('anthropic', 'openai-compatible')` are retained for future re-introduction. Currently only OpenRouter is registrable via UI (post-migration 018).

---

## Specialist Agents (100 agents, 18 categories)

<details>
<summary><b>Click to expand the full agent list</b></summary>

| Category | Agents (count) |
|---|---|
| 🖥️ Technology (11) | Software Engineer, Data Scientist, Cybersecurity, Cloud Architect, DevOps, AI/ML, Blockchain, Mobile, Frontend, Backend, QA |
| 💰 Finance (9) | Financial Analyst, Investment Banker, Risk Manager, Accountant, Tax Advisor, Actuary, Quant, Crypto Analyst, Portfolio Manager |
| 🏥 Healthcare (7) | Physician, Pharmacist, Nurse, Medical Researcher, Psychologist, Nutritionist, Biomedical Engineer |
| ⚖️ Legal (5) | Corporate / Criminal / Patent / Labor Lawyer, Compliance Officer |
| 🏢 Business (9) | Strategist, Marketing, Product, Project, HR, Operations, Supply Chain, Brand, Startup Advisor |
| 🎨 Creative (7) | UI/UX, Graphic, Content Writer, Video, Game Designer, Copywriter, Creative Director |
| ⚙️ Engineering (7) | Mechanical, Electrical, Civil, Chemical, Industrial, Robotics, Automotive |
| 🔬 Science (7) | Research Scientist, Physicist, Chemist, Biologist, Environmental, Materials, Data Analyst |
| 📚 Education (4) | Educator, Curriculum Designer, EdTech, Academic Advisor |
| 📺 Media (4) | Journalist, PR, Social Media, Communications Strategist |
| 🤝 Social Welfare (4) | Sociologist, Social Policy, Demographer, Labor Economist |
| 🏛️ Government (4) | Policy Analyst, Urban Planner, Public Administrator, Diplomat |
| 🏠 Real Estate (3) | Real Estate Analyst, Property Manager, Architecture Consultant |
| ⚡ Energy (3) | Energy Analyst, Sustainability Consultant, Renewable Energy Engineer |
| 🚚 Logistics (3) | Logistics Manager, Transportation, Warehouse |
| 🏨 Hospitality (3) | Hospitality Manager, Event Planner, Tourism Consultant |
| 🌾 Agriculture (3) | Agricultural Scientist, Food Scientist, Agribusiness Consultant |
| 🌟 Special (7) | Ethicist, Futurist, Systems Thinker, Behavioral Economist, Crisis Manager, Negotiation Expert, Fact Checker |

Routing combines **keyword matching** (fast path) with a **regex classifier**. Both can be bypassed by selecting an agent manually.

</details>

---

## API Reference

OpenMake LLM exposes both an **OpenAI-compatible** endpoint and **domain-specific** REST routes.

### OpenAI-compatible (drop-in)

```bash
POST /api/v1/chat/completions
Authorization: Bearer <your-openmake-api-key>   # or X-API-Key header
Content-Type: application/json

{
  "model": "openrouter:openai/gpt-5",          # any registered model
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true
}
```

Generate a key at **Settings → API 키 관리**. Use this to integrate any OpenAI-compatible client (e.g., LangChain, llamaindex, CLI tools).

### Selected domain routes

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/models` | GET | optional | List models (local vLLM + OpenRouter when authenticated) |
| `/api/external-keys` | GET | JWT | Provider catalog + user-registered key metadata |
| `/api/external-keys/:provider` | POST/DELETE | JWT | Register / delete OpenRouter key |
| `/api/external-keys/:provider/validate` | POST | JWT | Live key validation (latency reported) |
| `/api/external-keys/usage/recent` | GET | JWT | Last 50 raw call records |
| `/api/external-keys/usage/summary?days=N` | GET | JWT | N-day aggregate per provider (max 90) |
| `/api/api-keys` | GET/POST/DELETE | JWT | OpenMake's own API key management |
| `/api/research/start` | POST | JWT | Start a deep-research session |

Interactive Swagger docs: **http://localhost:52416/api/docs** (development).

---

## Project Structure

```
openmake_llm/
├── backend/api/src/
│   ├── routes/                # 32 REST routes
│   ├── services/              # ChatService, AuthService, DeepResearch, Audit, Push, ...
│   ├── chat/                  # Pipeline: execution-plan-builder, query-classifier (regex), model-selector, prompts
│   ├── agents/                # Industry agents (100), keyword router, discussion engine
│   ├── mcp/                   # Tool router, 13 built-in tools, external MCP client, sandbox
│   ├── auth/                  # JWT, OAuth, API key utilities, RBAC, scope middleware
│   ├── data/                  # PostgreSQL repositories, migration runner
│   ├── providers/             # IProvider abstractions: local-llm, Anthropic, OpenAI-compat
│   ├── sockets/               # WebSocket chat handler with auth/origin validation
│   ├── config/                # Environment schema, runtime limits, model defaults
│   ├── monitoring/            # Token usage analytics
│   ├── llm/                   # vLLM/LiteLLM client (LLMClient), agent-loop, model-pool
│   └── cluster/               # vLLM/LiteLLM node routing (health check, circuit breaker)
│
├── frontend/web/public/
│   ├── js/modules/
│   │   ├── pages/             # 23 SPA page modules (incl. 2 developer-doc helpers)
│   │   │                       # Settings hosts the unified ModelSelector
│   │   ├── components/
│   │   │   ├── model-selector.js       # Dropdown — local-LLM group + OpenRouter card
│   │   │   ├── model-list-modal.js     # Full-screen 367+ OpenRouter model browser
│   │   │   ├── add-key-modal.js        # OpenRouter key registration form
│   │   │   ├── usage-modal.js          # Per-provider usage + cost table
│   │   │   └── model-action-menu.js    # ⋮ context menu (validate/usage/delete)
│   │   └── (chat, auth, state, websocket, sanitize, ...)
│   └── css/                   # Design tokens + component styles
│
├── services/database/migrations/    # SQL migration files (34+ total)
│   ├── 016_external_provider_integration.sql  # 3 tables: keys + usage + cache
│   ├── 020_drop_memory_documents.sql          # RAG/Memory/document removal
│   └── 034_user_memories.sql                  # /remember cross-conversation memory
│
├── tests/                     # E2E (Playwright)
└── ecosystem.config.js        # PM2 production config
```

### Frontend SPA lifecycle (important for SPA contributors)

The unified ModelSelector exports `mount(target)` / `refresh()` / `unmount()`. The Settings page calls `mount` on init and `unmount` on cleanup. This **must** be respected — `unmount()` removes the document-level click listener and resets module state. Without it, navigation between routes leaks listeners.

---

## Development

```bash
# Run with hot-reload (API + frontend)
npm run dev

# Backend only (ts-node-dev)
npm run dev:api

# Frontend only (Vite)
npm run dev:frontend

# Lint
npm run lint

# Run unit tests (Jest, ts-jest preset is in backend/api/jest.config.js)
cd backend/api && npx jest

# E2E tests (Playwright, chromium + webkit)
npm run test:e2e

# Interactive E2E
npm run test:e2e:ui
```

> **Heads-up for tests:** Run Jest from `backend/api/` — the root-level `jest` lacks the ts-jest config and will fail to transform TypeScript. The CI script handles this automatically.

### File-size guard

Backend logic files must stay under **600 lines** (CI Gate 3 — fails the build on violation). Declarative files are exempt: type definitions (`types.ts`), config/limit tables (`runtime-limits.ts`), and prompt/locale/policy data (`prompt-templates.ts`, `language-policy.ts`, `*-locales.ts`, `*-guidelines.ts`, `*-data-*.ts`). Split large logic files by responsibility — see patterns in `backend/api/src/chat/` and `backend/api/src/mcp/`.

---

## Security

- **Auth**: JWT access/refresh tokens in HttpOnly cookies (CSRF protection enabled)
- **OAuth**: Google OAuth 2.0 social login
- **API keys**: HMAC-SHA-256 hashed with `API_KEY_PEPPER`, scope-based access
- **External LLM keys**: AES-256-GCM encrypted (key from `TOKEN_ENCRYPTION_KEY`)
- **RBAC**: admin / user / guest roles + Free/Pro/Enterprise tiers (gates MCP tools)
- **Rate limiting**: per-route advanced rate limiter with separate read/write limits
- **XSS defense**: content sanitization in `sanitize.js`
- **CORS**: explicit origin allowlist via `CORS_ORIGINS`
- **SSRF guard**: outbound URL validation rejects localhost/private IPs/link-local
- **CSP**: nonce-based Content Security Policy on HTML responses
- **HSTS**: 2-year max-age (production)

---

## Troubleshooting

<details>
<summary><b>Common Issues</b></summary>

| Error | Cause | Fix |
|---|---|---|
| `ECONNREFUSED ...5432` | PostgreSQL not running | `brew services start postgresql@16` (macOS) / `sudo systemctl start postgresql` (Linux) |
| `ECONNREFUSED ...4000` / `:13401` | vLLM/LiteLLM proxy unreachable | Start LiteLLM (`litellm --config scripts/vllm/litellm.config.yaml`); verify `LLM_BASE_URL` |
| `JWT_SECRET must be at least 32 characters` | Missing `.env` config | `openssl rand -hex 32` → set in `.env` |
| Login fails: "Invalid credentials" | Wrong email/password | Check `DEFAULT_ADMIN_EMAIL` + `ADMIN_PASSWORD` |
| Chat returns no response (local model) | LLM backend unreachable | Verify `LLM_BASE_URL` and that vLLM/LiteLLM is running |
| `password authentication failed` | DB credentials mismatch | `DATABASE_URL` user/pass must match what you created in PostgreSQL |
| `EADDRINUSE :::52416` | Port already in use | `lsof -i :52416` → kill or change `PORT` in `.env` |
| `npm install` fails on `node-gyp` | Missing build tools | macOS: `xcode-select --install` · Linux: `apt install build-essential` · Windows: use WSL2 |
| OpenRouter shows only 6 models | Backend cache stale or rebuild needed | `npm run build` + PM2 restart. Or `DELETE FROM external_provider_models_cache` |
| Modal too small / clipped | Browser CSS cache stale | Hard refresh (Cmd+Shift+R) or open in incognito |
| Settings page: ModelSelector won't mount | One of 4 modal modules failed to import | Check DevTools Console: `[settings] ModelSelector mount 실패` |
| `/api/api-keys` 429 Too Many Requests | Rate limit hit during fast page navigation | 5-min sessionStorage cache mitigates this; raise `RL_API_KEY_MGMT_READ` if needed |
| `Cross-Origin-Opener-Policy header has been ignored` warning | HTTP origin (browser ignores COOP) | Set `OMK_COOP_ENABLED=false` (default) — header omitted, no warning. Set to `true` only on HTTPS |
| WebSocket connection failed (external domain) | Router/NAT blocking ws upgrade | Use `localhost:52416` directly. For external domains, deploy HTTPS reverse proxy (Caddy / Cloudflare Tunnel) |
| `TOKEN_ENCRYPTION_KEY` warning | External LLM keys would be plaintext | `openssl rand -hex 32` → set in `.env` → restart |
| External key validation fails | Bad key or SSRF block | ⋮ → 🔍 검증 to see error. Localhost / private IPs are SSRF-blocked |

</details>

---

## Contributing

Contributions welcome! Project conventions:

1. **No `any` types** in TypeScript (strict mode enforced)
2. **Vanilla JS only** — no React/Vue/Angular (frontend explicitly framework-free)
3. **Parameterized SQL** — never raw string concatenation
4. **Test-driven** — unit tests for services (Jest), E2E for user flows (Playwright)
5. **File size** — under 600 lines per source file (CI-enforced)
6. **No Docker** — project policy. Use PM2 + direct deploy.
7. **No-Hardcoding Policy** — magic numbers, model names, prompts go to `.env` / `config/*.ts` / DB. See [`CLAUDE.md`](CLAUDE.md).

PR checklist:
- [ ] `cd backend/api && npx jest` passes
- [ ] `npm run lint` clean
- [ ] `bash frontend/web/scripts/validate-modules.sh` passes
- [ ] No new TypeScript `any` types
- [ ] No new files exceed 600 lines

---

## Glossary

<details>
<summary><b>Terms used in this document</b></summary>

| Term | Meaning |
|---|---|
| **SPA** | Single Page Application — the browser loads one HTML and updates content dynamically |
| **MCP** | Model Context Protocol — standard for letting AI use external tools (web, files, etc.) |
| **JWT** | JSON Web Token — secure token format for login sessions |
| **RBAC** | Role-Based Access Control — permissions by role |
| **WebSocket** | Real-time bidirectional protocol used for streaming chat |
| **vLLM** | High-throughput LLM serving engine that runs the local models |
| **LiteLLM** | OpenAI-compatible proxy in front of vLLM (and external providers) |
| **OpenRouter** | Single-key gateway to 367+ cloud LLMs (GPT-5, Claude, Gemini, Llama, ...) |
| **BYO Key** | Bring Your Own Key — users register their own provider keys, billed to their account |

</details>

---

## License

[MIT](LICENSE) © 2026 OpenMake Contributors
