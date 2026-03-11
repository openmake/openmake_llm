# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenMake LLM is a self-hosted AI assistant platform with multi-model orchestration. It uses Ollama as the LLM provider with API key pool rotation, supports 7 brand model profiles (Default, Pro, Fast, Think, Code, Vision, Auto), and routes queries via an LLM classifier backed by a 2-layer semantic cache.

## Build & Run Commands

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
```

## Testing

```bash
# Unit tests (Jest, ts-jest)
npm test                           # root jest with all test patterns
npm run test:bun                   # bun test in backend/api (timeout 15s)

# Single test file
npx jest path/to/file.test.ts
npx jest --testPathPattern="pattern"

# E2E tests (Playwright - chromium + webkit)
npm run test:e2e                   # npx playwright test
npm run test:e2e:ui                # interactive UI mode

# Lint
npm run lint                       # eslint .ts,.tsx,.js,.jsx
```

Jest config: test files in `backend/api/src/**/__tests__/**/*.test.ts`, `backend/api/src/**/*.test.ts`, and `tests/unit/**/*.test.ts`. Module alias `@/` maps to `backend/api/src/`. Playwright tests are in `tests/e2e/`.

## Architecture

### Monorepo Structure (npm workspaces)

- **`backend/api/`** - Express 5 + TypeScript API server (CommonJS output, ES2022 target, strict mode)
- **`frontend/web/`** - Vanilla JS SPA with ES Modules (no framework, Vite for dev)
- **`data/`** - Shared data layer (referenced from backend)
- **`scripts/`** - Build, deploy, migration, and CI scripts
- **`tests/`** - E2E tests (Playwright)

### Backend (`backend/api/src/`)

The server entry point is `server.ts`. Key directories:

| Directory | Purpose |
|---|---|
| `routes/` | 23+ Express route modules (REST API) |
| `services/` | Core business logic: ChatService, EmbeddingService, DeepResearchService, MemoryService, RAGService, etc. |
| `chat/` | Chat pipeline: query classification, model selection, semantic cache, LLM classifier, domain routing, prompt templates |
| `agents/` | 17 industry agents, keyword router, topic analyzer, discussion engine, skill manager |
| `sockets/` | WebSocket handler for real-time chat streaming (`ws-chat-handler.ts`) |
| `mcp/` | Model Context Protocol: tool router, tool tiers, external client, server registry, user sandbox |
| `auth/` | JWT auth, OAuth provider, API key utils, ownership, scope middleware |
| `data/` | PostgreSQL via `pg` (raw SQL, parameterized queries), conversation DB, migrations, repositories |
| `config/` | Environment config, constants, runtime limits, timeouts, pricing, model defaults |
| `middlewares/` | Security (helmet, CORS), rate limiters (per-route), static files, error handling |
| `ollama/` | Ollama client wrapper |
| `cluster/` | Ollama cluster management |
| `monitoring/` | Analytics system |

### Frontend (`frontend/web/public/`)

SPA with vanilla JS ES Modules. No build step for JS - files are served directly.

| Path | Purpose |
|---|---|
| `js/modules/` | Core modules: chat, websocket, auth, state, settings, file-upload, sanitize, api-client |
| `js/modules/pages/` | 21 page modules (admin, analytics, audit, documents, research, etc.) |
| `css/` | CSS with design tokens |

### Key Patterns

- **Database**: Raw SQL with `pg` Pool, parameterized queries (`$1, $2`), auto-generated schema on first launch. No ORM.
- **Auth**: JWT access tokens in HttpOnly cookies. Google OAuth 2.0. RBAC roles. API key pool with round-robin rotation.
- **Chat Pipeline**: Query -> Classification (LLM classifier + semantic cache L1/L2) -> Profile Resolution -> Model Selection -> Streaming Response via WebSocket.
- **MCP Tools**: 10 built-in tools with tier-based access (Free/Pro/Enterprise). Firecrawl tools load conditionally on `FIRECRAWL_API_KEY`.
- **Frontend Security**: XSS defense via `sanitize.js`. All user content must be sanitized.

## Configuration

Environment variables loaded from `.env` at project root (see `.env.example`). Key variables:
- `PORT` (default 52416), `DATABASE_URL` (PostgreSQL), `OLLAMA_HOST`, `JWT_SECRET`
- API keys: `OLLAMA_API_KEY_1..5` (pool rotation), `GEMINI_API_KEY`, `FIRECRAWL_API_KEY`
- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

## TypeScript Conventions

- **Backend**: Strict mode (`strict: true`, `noImplicitAny`, `strictNullChecks`), CommonJS module output, `@/` path alias
- **Validation**: Zod for schema validation
- **Logging**: Winston logger (`createLogger('ModuleName')`)
