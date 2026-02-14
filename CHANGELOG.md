# Changelog

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
