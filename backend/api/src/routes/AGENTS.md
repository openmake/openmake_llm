<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# routes — Express Route Modules

## Purpose
Contains 23+ Express Router modules, each mounted under `/api` by `setup.ts`. Each route module applies its own authentication, rate limiting, and validation middleware before delegating to controllers or services. Key routes include chat (REST fallback), agents, OpenAI-compatible API, MCP tool endpoints, RAG document management, and deep research. Route paths and response shapes are stable API contracts — do not change them.

## Key Files
| File | Description |
|------|-------------|
| `setup.ts` | Mounts all route modules under `/api`; sets route prefixes |
| `chat.routes.ts` | REST chat endpoint (non-WebSocket fallback); streaming via SSE |
| `agents.routes.ts` | Agent listing, routing test, and skill management endpoints |
| `openai-compat.routes.ts` | OpenAI-compatible `/v1/chat/completions` endpoint |
| `mcp.routes.ts` | MCP tool listing, external server registration |
| `rag.routes.ts` | Document upload, list, delete, and search endpoints |
| `research.routes.ts` | Deep research session creation and result polling |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `v1/` | Versioned API routes under `/api/v1/` (see `v1/AGENTS.md`) |

## For AI Agents
### Working In This Directory
- **Never change existing route paths or response shapes** — frontend and external API clients depend on them
- Apply middleware at the router level, not inside route handlers: `router.use(requireAuth)`
- Each route file should import and use schemas from `schemas/` for body validation
- OpenAI-compatible routes must maintain spec compliance — test against OpenAI SDK clients

### Testing Requirements
- Route tests use supertest; mock service layer to isolate HTTP contract tests
- Test all response codes: 200, 400 (validation), 401 (unauth), 403 (forbidden), 500 (server error)
- Run `npm run test:bun`; E2E route tests via `npm run test:e2e`

### Common Patterns
- Router creation: `const router = Router(); router.get('/', requireAuth, handler); export default router`
- Mount in setup: `app.use('/api/chat', chatRoutes)`
- File upload routes use `multer` middleware configured in `middlewares/`

## Dependencies
### Internal
- `auth/middleware.ts` — `requireAuth`, `requireAdmin`, `requireRole`
- `controllers/` — Handler functions
- `services/` — Direct service calls for simple endpoints
- `schemas/` — Request validation
- `middlewares/chat-rate-limiter.ts`, `middlewares/api-key-limiter.ts`

### External
- `express` — `Router`
- `multer` — File upload handling in RAG routes

<!-- MANUAL: -->
