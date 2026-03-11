<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# src — Backend API Source Root

## Purpose
Root source directory for the Express 5 + TypeScript API server. Contains the server entry point (`server.ts`), CLI entry point (`cli.ts`), and all feature subdirectories. The server bootstraps middleware, mounts routes, initializes the database, and starts the WebSocket handler. All business logic, data access, agents, and infrastructure live in the subdirectories below.

## Key Files
| File | Description |
|------|-------------|
| `server.ts` | Express app creation, middleware setup, route mounting, DB init, WS server start |
| `cli.ts` | CLI entry point for cluster management commands |
| `bootstrap.ts` | Application bootstrap helpers (DB migration, seed data) |
| `dashboard.ts` | Admin dashboard data aggregation helpers |
| `swagger.ts` | OpenAPI spec assembly and Swagger UI mount |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `agents/` | 96 industry-specialist agents, 2-stage routing, discussion engine (see `agents/AGENTS.md`) |
| `auth/` | JWT lifecycle, HttpOnly cookies, RBAC, OAuth providers (see `auth/AGENTS.md`) |
| `cache/` | LRU-based multi-layer in-memory cache (see `cache/AGENTS.md`) |
| `chat/` | Full chat pipeline: classification, model selection, prompt templates, semantic cache (see `chat/AGENTS.md`) |
| `cluster/` | Distributed Ollama node pool with health-checking and circuit breaker (see `cluster/AGENTS.md`) |
| `commands/` | CLI commands for LLM-powered code operations (see `commands/AGENTS.md`) |
| `config/` | Centralized type-safe application configuration (see `config/AGENTS.md`) |
| `controllers/` | Express Router HTTP controllers (see `controllers/AGENTS.md`) |
| `data/` | PostgreSQL data access layer — conversations, users, repositories (see `data/AGENTS.md`) |
| `documents/` | Document upload processing pipeline for RAG (see `documents/AGENTS.md`) |
| `errors/` | Typed custom error classes for infrastructure failures (see `errors/AGENTS.md`) |
| `i18n/` | Centralized multilingual string management (see `i18n/AGENTS.md`) |
| `mcp/` | Model Context Protocol — tools, tiers, routing, external servers (see `mcp/AGENTS.md`) |
| `middlewares/` | Express middleware stack — security, CORS, rate limiting (see `middlewares/AGENTS.md`) |
| `monitoring/` | Real-time analytics dashboard engine and alert system (see `monitoring/AGENTS.md`) |
| `observability/` | OpenTelemetry distributed tracing (see `observability/AGENTS.md`) |
| `ollama/` | Ollama HTTP client with API key pool rotation and agent loop (see `ollama/AGENTS.md`) |
| `plugins/` | Dynamic user plugin system (see `plugins/AGENTS.md`) |
| `routes/` | 23+ Express route modules mounted under /api (see `routes/AGENTS.md`) |
| `schemas/` | Zod validation schemas for request bodies (see `schemas/AGENTS.md`) |
| `security/` | SSRF protection for outbound HTTP requests (see `security/AGENTS.md`) |
| `services/` | Core business logic — ChatService, RAG, embeddings, memory (see `services/AGENTS.md`) |
| `sockets/` | WebSocket server for real-time streaming chat (see `sockets/AGENTS.md`) |
| `swagger/` | OpenAPI 3.0 path definitions (see `swagger/AGENTS.md`) |
| `types/` | Global TypeScript type declarations (see `types/AGENTS.md`) |
| `ui/` | CLI terminal presentation utilities (see `ui/AGENTS.md`) |
| `utils/` | Cross-cutting utilities — logging, API responses, error handling (see `utils/AGENTS.md`) |
| `workflow/` | Lightweight graph execution engine (see `workflow/AGENTS.md`) |

## For AI Agents
### Working In This Directory
- `server.ts` is the single composition root — avoid adding logic here directly; delegate to services/middlewares
- TypeScript strict mode is enforced (`noImplicitAny`, `strictNullChecks`); never use `as any` or `@ts-ignore`
- Module output is CommonJS; use `require`-compatible imports and `export =` patterns where needed
- The `@/` path alias maps to this directory (`backend/api/src/`)

### Testing Requirements
- Run `npm run test:bun` from `backend/api/` for unit tests
- Run `npm test` from project root for full Jest suite
- E2E tests via `npm run test:e2e` (Playwright)

### Common Patterns
- Winston logger: `import { createLogger } from '@/utils/logger'`
- API responses: `import { success, error } from '@/utils/api-response'`
- All async handlers must have try/catch or use the global error middleware

## Dependencies
### Internal
- All subdirectories are internal; `server.ts` imports from `middlewares/`, `routes/`, `data/`, `sockets/`, `config/`

### External
- `express` v5.2.1, `typescript` 5.3, `pg` 8.18.0, `ws` 8.18.3, `winston`, `zod`, `jsonwebtoken`, `axios`

<!-- MANUAL: -->
