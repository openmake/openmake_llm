# Changelog

## v1.5.5 (2026-02-16)

### Bug Fixes

- **설정 페이지**: Light 테마에서 흰색 텍스트/흰색 배경으로 텍스트가 보이지 않던 문제 수정 (`style.css`)
- **설정 페이지**: 대화 기록 삭제 기능 구현 — DB `deleteAllSessionsByUserId()` + REST API `DELETE /api/sessions` + 프론트엔드 연동 (`conversation-db.ts`, `session.controller.ts`, `settings.js`)
- **설정 페이지**: 데이터 내보내기 버튼 클릭 시 JSON 파일 다운로드 구현 (`settings.js`)
- **설정 페이지**: API 키 카운트 비로그인 시 에러 대신 폴백 메시지 표시 (`settings.js`)
- **login.html**: 작은 뷰포트에서 하단 콘텐츠가 잘리던 문제 수정 — `overflow-y: auto` 적용 (`login.html`)
- **감사 로그**: `checkAdmin()` API 호출이 리디렉트를 유발하던 버그 수정 — `localStorage` 기반 권한 검증으로 전환 (`audit.js`)
- **클러스터 페이지**: API 응답 `data.data` 이중 래핑 미처리 및 `node.url` 대신 `host:port` 표시 수정 (`cluster.js`)
- **통합 모니터링**: `fetch()` → `window.authFetch()` 전환으로 인증 오류 해결 (`admin-metrics.js`)
- **통합 모니터링**: SPA 모드에서 Chart.js 미로딩 문제 수정 — 동적 스크립트 로딩 구현 (`admin-metrics.js`)
- **통합 모니터링**: API 실패 시 `TypeError: Cannot read properties of undefined` 방지 (`admin-metrics.js`)

### New Features

- **MCP 도구 토글 UI**: 설정 페이지에서 11개 MCP 도구를 4개 카테고리별로 활성화/비활성화 가능 — `localStorage` 저장 (`settings.js`)
- **enabledTools 백엔드 연동**: WebSocket 메시지 → `ChatRequestParams` → `ChatService.getAllowedTools()` 필터링 파이프라인 구현 (`handler.ts`, `request-handler.ts`, `ChatService.ts`)
- **티어별 MCP 접근 제어**: Free(3개), Pro(8개), Enterprise(11개) 도구 차등 적용 — 잠금 아이콘 및 업그레이드 안내 (`settings.js`)
- **티어 배지 UI**: PRO(보라색), ENTERPRISE(주황-빨간 그라디언트) 배지 표시 (`settings.js`)

### Stats

- 17 files changed, 529 insertions(+), 65 deletions(-)
- 0 regressions

---

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
