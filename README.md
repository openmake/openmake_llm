# OpenMake LLM

Privacy-first, self-hosted AI assistant platform with multi-model orchestration.

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js >= 18, Bun (test runner) |
| Framework | Express 5.2.1, TypeScript 5.3 |
| Database | PostgreSQL >= 14 (pg 8.18.0) |
| Frontend | Vanilla JavaScript (ES Modules, SPA Router) |
| WebSocket | ws 8.18.3 |
| Testing | Bun Test, Playwright, Jest |
| Auth | JWT, bcryptjs, cookie-parser |
| LLM | Ollama, API key pool rotation |
| MCP | @modelcontextprotocol/sdk 1.25.3 |
| Utilities | swagger-jsdoc, pdf-parse, tesseract.js, zod, winston, helmet, cors, multer |

## Core Systems

### Brand Model Profiles
The platform provides seven distinct model profiles for different tasks.

| Profile | ID | Purpose |
|---|---|---|
| Default | openmake_llm | General purpose |
| Pro | openmake_llm_pro | Premium quality (creative, analysis, document, translation, korean) |
| Fast | openmake_llm_fast | Quick responses (simple chat) |
| Think | openmake_llm_think | Deep reasoning (math) |
| Code | openmake_llm_code | Code-specialized |
| Vision | openmake_llm_vision | Multimodal (images) |
| Auto | openmake_llm_auto | Smart auto-routing by query type |

### Smart Auto-Routing
Queries are classified into 9 types (code, math, creative, analysis, document, vision, translation, korean, chat) and routed to the optimal profile. The pipeline runs an LLM classifier (gemini-3-flash-preview:cloud) backed by a 2-layer semantic cache, with a regex keyword classifier as fallback.

### Semantic Classification Cache
A 2-layer in-memory cache accelerates query classification:
* L1 (exact-match): Uses Map.get for O(1) lookups under 1ms.
* L2 (semantic-match): Calculates cosine similarity with nomic-embed-text (768d) in 10 to 30ms.

On cache miss, embedding generation and LLM classification run in parallel via Promise.allSettled. The server pre-warms 30 common query patterns on startup. Configuration: similarity threshold 0.88, TTL 30 min, max 500 entries, LRU eviction.

### Agent System
17 industry-specialized agents are dispatched via a keyword router with topic analysis. The system supports multi-model discussion (debate) mode, Agent-to-Agent (A2A) parallel generation, and autonomous deep research.

### Authentication
JWT access tokens in HttpOnly cookies, Google OAuth 2.0 SSO, RBAC role enforcement, and an API key pool with round-robin rotation (5-min cooldown on 429).

## MCP Tools

The platform includes 10 built-in Model Context Protocol tools. Firecrawl tools only load when the FIRECRAWL_API_KEY environment variable is set. Note that sequential_thinking is a prompt injection rather than a standalone tool.

| Category | Tool | Free | Pro | Enterprise |
|---|---|:---:|:---:|:---:|
| Vision | vision_ocr | Y | Y | Y |
| Vision | analyze_image | Y | Y | Y |
| Web Search | web_search | Y | Y | Y |
| Web Search | fact_check | - | - | Y |
| Web Search | extract_webpage | - | - | Y |
| Web Search | research_topic | - | - | Y |
| Scraping | firecrawl_scrape | - | Y | Y |
| Scraping | firecrawl_search | - | Y | Y |
| Scraping | firecrawl_map | - | Y | Y |
| Scraping | firecrawl_crawl | - | Y | Y |

## Architecture

### Backend Services
23 route modules cover agents, chat, documents, memory, metrics, MCP, RAG, research, and more. Key services:
* ChatService: Manages the main chat pipeline.
* EmbeddingService: Handles nomic-embed-text as a singleton.
* DeepResearchService: Runs autonomous multi-step research.
* MemoryService: Stores per-user long-term memory.

### Frontend
23 pages built with Vanilla JS + ES Modules (no framework). Includes main chat, settings, admin dashboard, agent learning, skill library, analytics, audit logs, and more.

### CLI Commands
11 commands: `chat`, `ask`, `review`, `generate`, `explain`, `models`, `connect`, `cluster`, `nodes`, `mcp`, `plugins`.

## Configuration

Environment variables are grouped into nine categories.
1. Ollama & LLM (host, models, API keys, quotas)
2. Gemini (API key, thinking, context, embedding, web search)
3. Server & Security (port, JWT secret, session secret, admin)
4. Google OAuth 2.0 (client ID/secret, redirect URI)
5. Web Search (Google API key, CSE ID)
6. Infrastructure (PostgreSQL, cache, MCP, cluster, CORS, Swagger, rate limiting)
7. Cost Tier & Domain Routing (economy/standard/premium, domain-specific models)
8. Firecrawl (API key, optional API URL)
9. Language Policy (dynamic detection, default language, confidence threshold, fallback)

## Development & Deployment

### Hardware Specs (Test Environment)
* Mac mini (M4)
* 10 cores
* 16 GB RAM

### Ollama Models (Test Environment)
* nomic-embed-text:latest
* qwen3.5:397b-cloud
* glm-5:cloud
* gpt-oss:120b-cloud
* gemini-3-flash-preview:cloud

### Prerequisites
* Node.js >= 18
* PostgreSQL >= 14
* Ollama

### Installation
1. Clone the repository and run `npm install`.
2. Copy `.env.example` to `.env` and configure your variables.
3. Create the database with `createdb openmake_llm`. The schema generates automatically on first launch.
4. Build the project using `npm run build`.
5. Start the cluster with `node backend/api/dist/cli.js cluster --port 52416`.

### npm Scripts
* `build`: Compiles backend and frontend, then deploys frontend.
* `dev`: Runs API and frontend concurrently.
* `start` / `start:api`: Starts the production server.
* `test` / `test:unit` / `test:integration` / `test:e2e` / `test:e2e:ui`: Executes the test suites.
* `lint` / `clean` / `check:schema-drift`: Code quality and maintenance tasks.

## Screenshots

![Settings Full Page](./settings-full-page.png)
![Settings Tier Cards](./settings-tier-cards.png)

## External Links

* http://rasplay.tplinkdns.com:33000/
* http://rasplay.tplinkdns.com:33000/docs/