# Changelog

## v1.5.4 (2026-02-16)

### Architecture — Chat Handler DRY Abstraction

- **`ChatRequestHandler` class**: Extracted duplicated chat handling logic from 3 places (HTTP sync, HTTP stream, WebSocket) into a single unified handler with 6 static methods: `resolveUserContextFromRequest`, `resolveUserContextFromWebSocket`, `buildPlan`, `createClient`, `ensureSession`, `processChat` (`chat/request-handler.ts` — NEW, ~340 LOC)
- **HTTP Stream endpoint upgrade**: Previously a "dumb" passthrough (`client.generate()` direct call) — now routed through `ChatService` with full DB logging, Discussion, Deep Research, Agent Loop, and Memory support
- **Handler refactoring**: `chat.routes.ts` and `sockets/handler.ts` reduced by ~180 LOC combined while preserving all existing behavior (WS abort, heartbeat, rate limiting, web search context)

### Resilience — Circuit Breaker & Node Failover

- **`CircuitBreaker` class**: Full 3-state machine (CLOSED → OPEN → HALF_OPEN) with sliding window failure tracking, configurable thresholds, graceful shutdown (`setTimeout.unref()`), and metrics reporting (`cluster/circuit-breaker.ts` — NEW, ~438 LOC)
- **`CircuitBreakerRegistry` singleton**: Application-wide circuit breaker management with `getOrCreate()`, `resetAll()`, and `getAll()` for monitoring
- **`AllNodesFailedError` / `CircuitOpenError`**: Custom error classes following existing `KeyExhaustionError` / `QuotaExceededError` conventions (`errors/` — 2 NEW files)
- **`ClusterManager.getCandidateNodes()`**: Returns online nodes sorted by latency, filtered by model availability and CircuitBreaker state (OPEN nodes auto-excluded)
- **`ClusterManager.tryWithFallback<T>()`**: Sequential failover across candidate nodes — each attempt wrapped in CircuitBreaker, throws `AllNodesFailedError` only when all candidates exhausted

### Intelligence — LLM-Based Model Selection

- **`classifyQueryWithLLM()`**: Ollama Structured Output (`format: { type: 'object', properties: { category: { enum: [...] }, confidence: { type: 'number' } } }`) for query classification via Code engine model with 3-second timeout — falls back silently to regex-based `classifyQuery()` on any failure (`chat/model-selector.ts`)
- **Async conversion**: `selectOptimalModel()`, `selectBrandProfileForAutoRouting()`, `selectModelForProfile()` converted to async; all callers in `ChatService.ts` and `sockets/handler.ts` updated with `await`

### Performance — Prompt Caching Optimization

- **`ContextEngineeringBuilder.build()` reorder**: Static sections (Role → Constraints → OutputFormat → SoftInterlock → FinalReminder) moved to prompt prefix, dynamic sections (Metadata → RAG → Examples → AdditionalSections → Goal) placed after — optimizes for Gemini/Cloud implicit prefix caching (`chat/context-engineering.ts`)

### Security

- **`search_code` path traversal fix**: `process.cwd()` replaced with `UserSandbox.getWorkDir(userId)` with `os.tmpdir()` safe fallback when userId is missing (`mcp/tools.ts`)

### Configuration

- **Code engine model**: Added `OMK_ENGINE_CODE=qwen3-coder-next:cloud` to `.env` for LLM-based query classification

### Stats

- 4 files created, 12 files modified
- `npm run build` — zero errors
- 0 regressions

---

## v1.5.3 (2025-02-15)

### Security

- **OAuth state parameter hardening**: `Math.random()` replaced with `crypto.randomBytes(32).toString('base64url')` in OAuth flow to prevent CSRF state prediction attacks (`AuthService.ts`)

### Stability & Reliability

- **LLM Router JSON parsing**: 3-stage fallback parser (```json code block → greedy brace match → non-greedy fallback) handles incomplete/malformed LLM responses (`llm-router.ts`)
- **Environment validation**: Zod schema-based startup validation for all ~50 environment variables with type coercion, defaults, and production-only constraints (`env.schema.ts`, `env.ts`)
- **Schema single source of truth**: `initSchema()` now reads `002-schema.sql` directly instead of maintaining a duplicate inline TS constant (`unified-database.ts`)

### Performance

- **Discussion Engine caching**: `buildFullContext()` result memoized to avoid redundant recomputation across multi-model discussion rounds (`discussion-engine.ts`)
- **Metrics/Analytics memory overflow prevention**: Batch truncation replaces O(n) `shift()` calls, session logs capped at 5,000 with periodic cleanup of completed sessions older than 24h (`metrics.ts`, `analytics.ts`)

### Architecture & Code Quality

- **server.ts method extraction**: 565-line monolithic `setupRoutes()` split into 5 focused private methods: `setupSecurity`, `setupParsersAndLimiting`, `setupStaticFiles`, `setupApiRoutes`, `setupErrorHandling`
- **ChatService Strategy pattern**: God object (~1200 lines) refactored into thin orchestrator + 5 strategy classes: `DirectStrategy`, `A2AStrategy`, `AgentLoopStrategy`, `DiscussionStrategy`, `DeepResearchStrategy` (7 new files in `services/chat-strategies/`)
- **UnifiedDatabase Repository pattern**: ~2000-line database class decomposed into 8 domain-specific repositories: `UserRepository`, `ConversationRepository`, `MemoryRepository`, `ResearchRepository`, `ApiKeyRepository`, `CanvasRepository`, `MarketplaceRepository`, `AuditRepository` (10 new files in `data/repositories/`)

### Data Layer

- **Agent feedback DB migration**: `AgentLearningSystem` migrated from `data/agent-feedback.json` file storage to PostgreSQL `agent_feedback` table with write-through caching (`learning.ts`)
- **Custom agents DB migration**: `CustomAgentBuilder` migrated from `data/custom-agents.json` file storage to PostgreSQL `custom_agents` table with write-through caching (`custom-builder.ts`)

### Testing

- **WebSocket handler test coverage**: 22 new unit tests covering message parsing, authentication, chat handling, heartbeat, abort requests, error cases, MCP settings sync, and agent listing (`websocket-handler.test.ts`)

### Stats

- 12 files modified, 21 files created
- 575 tests passing (21 suites)
- 0 regressions

---

## v1.5.2 (2025-02-14)

- Added Our Story section and Live Demo link to README
- Community & Recognition section (RPi JAM Korea, Pi_Snap/Snap!, media coverage)
- Demo screenshot in Overview section
