<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# openmake_llm

## Purpose

OpenMake LLM is a privacy-first, self-hosted AI assistant platform with multi-model orchestration. This is a monorepo with npm workspaces combining Express 5 + TypeScript backend, Vanilla JavaScript ES Modules SPA frontend, PostgreSQL database layer, and integrated MCP (Model Context Protocol) tools. This document is for AI agents working across the entire project.

## Key Files

| File | Description |
|------|-------------|
| `package.json` | Root monorepo orchestration (workspaces: `backend/api`, `frontend/web`) |
| `CLAUDE.md` | Project conventions & rules (Database, Auth, Routing, No Docker policy) |
| `backend/api/AGENTS.md` | Express/TypeScript backend skill guide (MCP architecture, Key Pool, detailed component mapping) |
| `frontend/web/AGENTS.md` | Vanilla JS SPA skill guide (ES Module architecture, MCP toggle system, state management) |
| `jest.config.js` | Jest config (test patterns: `**/__tests__/**/*.test.ts`, `**/*.test.ts`, `tests/unit/**/*.test.ts`) |
| `playwright.config.ts` | E2E test configuration (Playwright, chromium + webkit) |
| `ecosystem.config.js` | PM2 app cluster config |
| `README.md` | Product overview (Tech stack, Core systems, RAG, MCP tools, Authentication) |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `backend/api/` | Express 5 + TypeScript API server (23+ routes, chat/embedding/research services, MCP integration, Ollama client, JWT auth, WebSocket streaming) |
| `frontend/web/` | Vanilla JS ES Modules SPA (21 pages, no framework, design tokens, MCP toggle UI, WebSocket client) |
| `data/` | Shared data layer (PostgreSQL migrations, connection pool, repositories) |
| `services/database/` | Database initialization and migration scripts |
| `scripts/` | Build, deploy, migration, and CI scripts (validate-modules.sh, ci-test.sh, deploy-frontend.sh, etc.) |
| `tests/` | E2E tests with Playwright, integration tests, unit test setup |
| `.claude/` | Claude Code skills and state (local to development, not committed) |
| `node_modules/` | Root npm dependencies (shared workspaces) |

## For AI Agents

### Working In This Directory

1. **Monorepo Commands**
   - Root `npm run` commands orchestrate both workspaces (build, dev, test, lint)
   - Backend-only: `npm run dev:api`, `npm run build:backend`
   - Frontend-only: `npm run dev:frontend`, `npm run build:frontend`
   - Full build: `npm run build` (backend + frontend + deploy)

2. **Absolute Paths Required**
   - Shell commands in bash tools must use absolute paths: `/Users/tom/projects/development/openmake_llm/backend/api/src/...`
   - Relative paths do NOT persist between bash calls (CWD resets)

3. **Workspace Dependencies**
   - `backend/api` depends on `data/` (PostgreSQL layer, symlinked or via npm)
   - Both workspaces share root `node_modules/`
   - Install deps at root: `npm install` (affects all workspaces)

4. **Configuration**
   - Root `.env` file (not committed, .env.example provided)
   - Key env vars: `PORT`, `DATABASE_URL`, `OLLAMA_HOST`, `JWT_SECRET`, `OLLAMA_API_KEY_1~5`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FIRECRAWL_API_KEY`

### Testing Requirements

1. **Unit Tests** (Jest)
   - `npm test` runs all Jest tests (root + backend/api + tests/unit)
   - Test files: `**/__tests__/**/*.test.ts`, `**/*.test.ts`, `tests/unit/**/*.test.ts`
   - Module alias `@/` maps to `backend/api/src/`
   - Run single file: `npx jest path/to/file.test.ts`

2. **Backend Unit Tests** (Bun)
   - `npm run test:bun` runs Bun test runner (faster, 15s timeout)
   - Located in `backend/api/src/**/__tests__/`
   - 205+ tests covering services, routes, auth, MCP, database

3. **E2E Tests** (Playwright)
   - `npm run test:e2e` runs all Playwright tests
   - `npm run test:e2e:ui` opens interactive UI mode
   - Tests in `tests/e2e/`, browsers: chromium + webkit
   - Requires running backend (see npm run dev)

4. **Linting**
   - `npm run lint` runs ESLint on all .ts, .tsx, .js, .jsx files
   - Config: `.eslintrc.json`, ignore: `.eslintignore`

5. **Verification Before Completion**
   - Build: `npm run build` → `backend/api/dist/`, frontend assets
   - All tests pass locally before claiming done
   - Linting clean (no errors, warnings acceptable if documented)

### Common Patterns

1. **Backend Architecture**
   - Entry: `backend/api/src/server.ts` (Express 5)
   - Routes: `backend/api/src/routes/` (23+ modules, REST API)
   - Services: `backend/api/src/services/` (ChatService, EmbeddingService, RAGService, MemoryService, etc.)
   - Chat Pipeline: `backend/api/src/chat/` (query classification, model selection, semantic cache, prompt templates)
   - Agents: `backend/api/src/agents/` (17 industry agents, keyword router, discussion engine)
   - MCP: `backend/api/src/mcp/` (tools, tool-router, unified-client, server registry)
   - Auth: `backend/api/src/auth/` (JWT, OAuth, API key manager, ownership, scope middleware) **DO NOT MODIFY**
   - Database: `backend/api/src/data/` (raw SQL via `pg` Pool, parameterized queries `$1, $2`, repositories)
   - WebSocket: `backend/api/src/sockets/ws-chat-handler.ts` (real-time streaming)

2. **Frontend Architecture**
   - Entry: `frontend/web/public/index.html` + `app.js` (Vanilla JS ES Module)
   - Router: `frontend/web/public/js/spa-router.js` (dynamic `import()` page loading)
   - Modules: `frontend/web/public/js/modules/` (state.js, chat.js, websocket.js, sanitize.js, settings.js, api-client.js, file-upload.js)
   - Pages: `frontend/web/public/js/modules/pages/` (21 pages: admin, analytics, audit, documents, research, settings, etc.)
   - Components: `frontend/web/public/js/components/` (unified-sidebar.js, unified-navbar.js)
   - Styling: `frontend/web/public/css/` (design-tokens.css, style.css, light-theme.css)
   - Vendor: `frontend/web/public/js/vendor/` (UMD libraries, no module transforms)

3. **State Management**
   - Central `AppState` in `frontend/web/public/js/modules/state.js`
   - Keys: `thinkingEnabled`, `webSearchEnabled`, `ragEnabled`, `discussionMode`, `deepResearchMode`, `mcpToolsEnabled`
   - localStorage key: `mcpSettings` (single source for MCP toggle persistence)
   - Sync: `modes.js` (chat buttons) ↔ `state.js` ↔ `settings.js` (settings page) ↔ `chat.js` (WebSocket payload)

4. **MCP Tool System**
   - **Backend definitions** → `backend/api/src/mcp/tools.ts` (MCPToolDefinition array)
   - **Backend tiers** → `backend/api/src/mcp/tool-tiers.ts` (TOOL_TIERS: free/pro/enterprise access control)
   - **Frontend catalog** → `frontend/web/public/js/modules/settings.js` (MCP_TOOL_CATALOG: 6 categories, 15 tools)
   - **Tool toggle flow**: Frontend toggles → AppState + enabledTools → localStorage → WS payload → Backend ChatService.getAllowedTools() → ToolRouter.getFilteredTools()
   - **10 built-in tools**: vision_ocr, analyze_image, web_search, fact_check, extract_webpage, research_topic, firecrawl_scrape, firecrawl_search, firecrawl_map, firecrawl_crawl (last 4 conditional on FIRECRAWL_API_KEY)
   - **Modify tools**: Sync changes across `mcp/tools.ts`, `mcp/tool-tiers.ts`, `frontend/web/public/js/modules/settings.js`, and `frontend/web/public/js/modules/pages/settings.js`

5. **API Key Pool & Ollama**
   - `.env` defines `OLLAMA_API_KEY_1~5` (unlimited count, auto-detected)
   - `backend/api/src/ollama/api-key-manager.ts` manages pool round-robin + 5min cooldown on 429 errors
   - `OMK_ENGINE_*` environment variables select models (LLM, PRO, FAST, THINK, CODE, VISION, AUTO)
   - API keys and models are completely decoupled (models not 1:1 bound to keys)

6. **Database**
   - PostgreSQL via `pg` (raw SQL, no ORM)
   - Parameterized queries only: `$1, $2, $3` (SQL injection prevention)
   - Connection pool in `backend/api/src/data/`
   - Migrations: `services/database/migrations/`
   - Auto-create schema on first launch
   - All DB calls use `async/await` (non-blocking)

7. **Auth & Security**
   - JWT access tokens in HttpOnly cookies
   - Google OAuth 2.0 flow
   - API key HMAC-SHA-256 authentication
   - RBAC roles (Free/Pro/Enterprise tiers)
   - Scope middleware enforcement
   - **RULES:** No `@ts-ignore`, `as any`, `@ts-expect-error` | Strict TypeScript | No Docker | No auth module changes

8. **Frontend Security**
   - XSS defense via `sanitizeHTML()` in `sanitize.js`
   - All user content must be sanitized before innerHTML
   - No inline event listeners (bind dynamically in JS modules)
   - cache buster `?v=N` must sync between HTML and JS

9. **Chat Pipeline**
   - User message → LLM classifier (Gemini 3-flash) + semantic cache hit check → 7 brand profiles → model selection (cost tier aware) → context engineering → history summarization (auto-compress >10 turns) → RAG context injection (pgvector) → streaming response (WebSocket)

10. **RAG System**
    - pgvector + BM25 hybrid search
    - nomic-embed-text 768d embeddings (batch 64, 52.4 chunks/s)
    - Chunk size: 1000 chars, overlap: 200 chars
    - Deep Research auto-embeddings into vector DB
    - Relevance threshold: 0.45

11. **Code Conventions**
    - **Backend:** Express 5 + TypeScript (strict), CommonJS output, ES2022 target
    - **Frontend:** Vanilla JS (no React/Vue/Angular), ES Modules only, Vite dev server
    - **Module pattern:** `export default { getHTML, init, cleanup }` for pages
    - **Component pattern:** IIFE + `window.*` registration for onclick handlers
    - **Logging:** Winston logger (`createLogger('ModuleName')`)
    - **Validation:** Zod schema validation
    - **Testing:** Jest (backend unit), Bun (fast backend tests), Playwright (E2E)

## Dependencies

### External

| Dependency | Version | Purpose |
|---|---|---|
| Express | 5.x | HTTP server, routing, middleware |
| TypeScript | 5.3 | Type checking, strict mode |
| PostgreSQL / pg | 16 / 8.18 | Database, parameterized queries |
| Ollama | (external) | Local/Cloud LLM provider, API key rotation |
| Zod | latest | Schema validation |
| Winston | latest | Structured logging |
| ws | 8.18 | WebSocket (real-time chat streaming) |
| Vite | latest | Frontend dev server, module validation |
| Jest | 29.7 | Unit testing (backend + root) |
| Bun | latest | Fast test runner (backend tests) |
| Playwright | 1.58 | E2E testing (chromium + webkit) |
| Helmet | latest | Security headers (CORS, CSP, etc.) |
| @modelcontextprotocol/sdk | latest | MCP server/client integration |
| pgvector | latest | Vector search (RAG embeddings) |
| nomic-embed-text | latest | 768d embedding model (RAG) |

### Project Skills (`.claude/skills/`)

Refer to `backend/api/AGENTS.md` and `frontend/web/AGENTS.md` for detailed skill mappings. Common skills include:

- `llm-app-patterns` (LLM agents, prompt chains, A2A, pipeline profiles, model selection)
- `postgres-raw-sql` (Database, parameterized queries, migrations)
- `mcp-integration` (MCP servers, tool routing, external integration)
- `auth-security-patterns` (JWT, OAuth, API key HMAC, scope middleware)
- `typescript-advanced` (Type definitions, generics, strict mode)
- `vanilla-js-frontend` (IIFE, AppState, sanitizeHTML, ES Modules)
- `context-engineering` (Token management, semantic cache, history summarization)

## Root-Level Build Targets

```bash
# Full build (backend + frontend + deploy)
npm run build

# Development (API + frontend concurrently)
npm run dev

# Backend only
npm run dev:api          # ts-node src/server.ts
npm run build:backend    # tsc + sync frontend assets

# Frontend only
npm run dev:frontend     # vite dev server
npm run build:frontend   # validate-modules.sh

# Production
npm start                # node backend/api/dist/server.js
node backend/api/dist/cli.js cluster --port 52416

# Testing
npm test                 # Jest (all workspaces)
npm run test:bun         # Bun (backend fast tests, 15s timeout)
npm run test:e2e         # Playwright (chromium + webkit)
npm run test:e2e:ui      # Interactive Playwright UI

# Linting
npm run lint             # ESLint .ts, .tsx, .js, .jsx

# Migrations
npm run migrate          # Run database migrations

# CI
npm run ci               # bash scripts/ci-test.sh
```

## Rules

**Immutable per CLAUDE.md:**
- No Docker/containerization (Dockerfile, docker-compose, .dockerignore) — project policy, permanent exclusion
- No `as any`, `@ts-ignore`, `@ts-expect-error`
- All database calls use `async/await`
- No route path/response format changes
- No auth module modifications (`infrastructure/security/auth/`)
- Vanilla JS only (no React, Vue, Angular)
- TypeScript strict mode enabled

<!-- MANUAL: -->
