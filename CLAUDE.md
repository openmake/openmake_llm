# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenMake LLM is a self-hosted AI assistant platform with multi-model orchestration. LLM backend는 **vLLM serve + LiteLLM proxy** 조합을 OpenAI 호환 API 로 호출하며 (2026-05-18 Ollama 제거 마이그레이션 완료), 외부 provider (Anthropic, OpenAI 호환 등) 도 동일 추상화로 라우팅합니다. 7 brand model profiles (Default, Pro, Fast, Think, Code, Vision, Auto) 를 지원하고, ExecutionPlanBuilder (regex + fast-path 분류) 로 쿼리를 라우팅합니다.

> **Legacy 모델 ID 입력 호환**: provider 식별자 canonical 은 `'local-llm'` 이며 `SdkType = 'local-llm' | 'anthropic' | 'openai-compatible'` 입니다. (2026-05-31 정리: `'ollama'` 를 SdkType 에서 제거 — 외부 키 DB CHECK 제약은 `('anthropic','openai-compatible')` 만 허용하고 [`016` 마이그레이션] 로컬 provider 는 외부 키 테이블에 저장되지 않으므로 `'ollama'` 가 애초에 불필요했음. 과거 "DB CHECK 호환용 유지"라는 서술은 부정확했음.) 단, 과거 저장된 `'ollama:<model>'` **model ID 입력**은 `providers/i-provider.ts` 의 `parseFullModelId` 가 `'local-llm'` 으로 자동 normalize 하여 무중단 호환하며, `provider-gate.ts` 의 `KNOWN_FULLID_PREFIXES` 도 레거시 `'ollama:'` prefix 를 입력으로 수용합니다. 응답 필드명(`prompt_eval_count`, `eval_count` 등) 도 호출자 호환 위해 `stream-parser.ts` 에서 OpenAI usage → Ollama-style 로 매핑합니다.

## Build & Run Commands

```bash
# Full build (backend + frontend + deploy)
npm run build

# Development (API + frontend concurrently)
npm run dev

# Backend only
npm run dev:api          # ts-node src/server.ts
npm run build:backend    # tsc + copy-agent-data + build-info

# Frontend only
npm run dev:frontend     # vite dev server
npm run build:frontend   # validate-modules.sh

# Production
npm start                # node backend/api/dist/server.js
node backend/api/dist/cli.js cluster --port 52416   # vLLM 노드 라우팅 cluster 서브커맨드
```

## Testing

```bash
# Unit tests (Jest, ts-jest) — root 스크립트는 backend/api workspace 로 위임
npm test                           # = npm test --workspace=backend/api

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
| `routes/` | Express route modules (REST API) |
| `controllers/` | HTTP controllers — route handler 로부터 분리된 thin layer |
| `services/` | Core business logic: ChatService, DeepResearchService, AuthService, ApiKeyService, AuditService, PushService 등. 서브디렉토리: `chat-service/` (handler/formatter/metrics), `chat-strategies/` (provider 별 dispatch), `deep-research/` (multi-step pipeline). RAG/임베딩/MemoryService/문서 처리는 모두 폐기 (2026-03 RAG, 2026-05 vector cache·semantic router·MemoryService·문서 첨부) |
| `chat/` | Chat pipeline: **`execution-plan-builder.ts`** (단일 정책 진입점, Phase B 통합), `query-classifier.ts` (regex), `fast-path-detector.ts`, `profile-resolver.ts`, `model-selector.ts` (regex+fast-path only), domain routing, prompt templates. **2026-05-26 Phase B Phase 2-A 머지로 LLM classifier · semantic cache · feedback-cache-corrector 제거** |
| `agents/` | 18 industry agents (100 specialists), keyword router, topic analyzer, discussion engine, skill manager |
| `sockets/` | WebSocket handler for real-time chat streaming (`ws-chat-handler.ts`) |
| `mcp/` | Model Context Protocol: tool router, tool tiers, external client, server registry, user sandbox |
| `auth/` | JWT auth, OAuth provider, API key utils, ownership, scope middleware |
| `security/` | SSRF guard, additional security primitives beyond `auth/` |
| `data/` | PostgreSQL via `pg` (raw SQL, parameterized queries), conversation DB, migrations, repositories |
| `storage/` | Key-Value Store 추상화 (memory/redis — OAuth state, rate limiting 등) |
| `cache/` | LRU 기반 캐시 인프라 (CacheSystem singleton) |
| `config/` | Environment config, constants, runtime limits, timeouts, pricing, model defaults, external providers |
| `schemas/` | Zod 입력 검증 스키마 (REST/WebSocket payload) |
| `middlewares/` | Security (helmet, CORS), rate limiters (per-route), static files, error handling |
| `errors/` | 도메인별 커스텀 에러 클래스 |
| `llm/` | vLLM/LiteLLM client public API: `LLMClient` (canonical, 2026-05-19 `OllamaClient` alias 제거), agent-loop, usage-tracker, reasoning-adapter, reasoning-tag-parser, stream-parser, web-search-adapter, **model-pool** (262K↔1M proactive routing) |
| `providers/` | LLM provider 추상화: `i-provider.ts` (SdkType `'local-llm' \| 'anthropic' \| 'openai-compatible'`), `local-llm-provider.ts`, `anthropic-provider.ts`, `openai-compat-provider.ts`, `provider-router.ts` |
| `cluster/` | vLLM/LiteLLM 노드 클러스터 라우팅 (health check, circuit breaker, node-selector). `server.ts` 부팅 시 `getClusterManager()` 로 활성화 |
| `monitoring/` | Analytics + alerts system |
| `observability/` | OpenTelemetry tracing/metrics |
| `evaluation/` | 모델 평가 파이프라인 |
| `schedulers/` | 비동기 작업 스케줄러 |
| `plugins/` | 플러그인 시스템 |
| `commands/` | CLI command 정의 |
| `workflow/` | 워크플로우 엔진 |
| `i18n/` | 다국어 리소스 |
| `prompts/` | 시스템/역할 프롬프트 템플릿 |
| `swagger/` | OpenAPI/Swagger 정의 |
| `ui/` | CLI 출력 포맷팅 유틸 |
| `utils/` | 공용 유틸 (logger, api-response, error-handler, token-crypto, ...) |
| `types/` | 글로벌 type 정의 |

### Frontend (`frontend/web/public/`)

SPA with vanilla JS ES Modules. No build step for JS - files are served directly.

| Path | Purpose |
|---|---|
| `js/modules/` | Core modules: chat, websocket, auth, state, settings, sanitize, api-client, models-api (`/api/models` 공유 클라이언트 SoT) |
| `js/modules/pages/` | 23 page module 파일 (admin, analytics, audit, research, agent-tasks, etc.; developer-helpers/sections 2개는 헬퍼) — `js/nav-items.js` 와 동기화 필수 (validate-modules.sh 자동 검증) |
| `css/` | CSS with design tokens |

#### Frontend 개발 패턴

- **상태 관리**: 중앙 집중식 `StateManager` (`js/modules/state.js`). 컴포넌트 간 공유 상태는 반드시 StateManager를 통해 읽고 씀 — 전역 변수 직접 사용 금지.
- **WebSocket 연결**: `js/modules/websocket.js` 가 단일 연결을 관리 (자동 재연결 포함). 채팅 메시지 전송/수신은 백엔드 `ws-chat-handler.ts` 와 페어로 동작.
- **새 페이지 추가 절차**: ① `js/modules/pages/` 에 모듈 파일 추가 → ② `js/nav-items.js` 에 네비게이션 항목 등록 → ③ `npm run build:frontend` (`validate-modules.sh`) 로 동기화 검증.
- **XSS 방어**: 모든 사용자 입력 및 LLM 출력은 `sanitize.js` 를 통해 렌더링. `innerHTML` 직접 사용 금지 — `sanitize.js` 의 안전한 렌더링 헬퍼 사용.
- **API 호출**: `js/modules/api-client.js` 를 통해서만 백엔드 REST API 호출. `fetch` 직접 호출 금지.

### Key Patterns

- **Database**: Raw SQL with `pg` Pool, parameterized queries (`$1, $2`), auto-generated schema on first launch. No ORM.
- **Auth**: JWT access tokens in HttpOnly cookies. Google OAuth 2.0. RBAC roles. **LiteLLM master key 단일 운영** (Ollama 시절 5-key pool rotation 폐기, 2026-05-19).
- **LLM Backend**: 서버 PC 에서 `vLLM serve` → `LiteLLM proxy :13401` 가 OpenAI 호환 endpoint 노출 (로컬 개발은 :4000). 클라이언트(`backend/api/src/llm/client.ts`) 는 `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_DEFAULT_MODEL` env 로 접근. `LLMClient` 는 cluster-routed **per-request** (글로벌 singleton 금지).
- **Chat Pipeline (2 Layer 구조, 2026-05-26 Phase B 머지)**: Query → **ExecutionPlanBuilder.build** (정책 — per-request 1회, regex+fast-path 분류 + profile 해석 + 옵션 조립) → strategies dispatch → **LLMClient.chat** (실행 — per-call, capacity routing 262K↔1M). 정책 ↔ 실행 계층은 SQL planner / executor 패턴 — 둘을 합치지 말 것 (per-call 동적 routing 정당).
  - **라우팅 분기 (`message-pipeline.ts`)**: 외부 provider(anthropic/openrouter) 채팅은 `streamFromExternalProvider` 직접 dispatch (6 strategies 우회, 자체 MCP tool loop 5턴 보유). **로컬(`local-llm`) 채팅은 `LOCAL_STRATEGY_PATH_ENABLED` 플래그로 게이트** — **기본 OFF: 로컬도 `streamFromExternalProvider` 로 dispatch (strategies 우회)**, ON: strategy 경로(ThinkingStrategy/GV/AgentLoop) 사용. (2026-05-19 `'ollama'→'local-llm'` normalize 가 `!== 'ollama'` 가드를 깨 로컬이 의도와 달리 strategies 를 우회하던 회귀를 플래그로 단계적 복구하는 중. 주의: 플래그 ON 시 도구 호출이 agent-loop(single·high-confidence) 경로에만 실리고 GV 는 도구 미전달 — 외부 dispatch 의 always-on tool loop 와 동작이 다름.)
- **Model Pool**: `LLMClient.chat()` 진입 시 prompt token 추정 후 262K (default) ↔ 1M (large) proactive routing. ContextOverflowError → HTTP 413 + audit + 자동 webhook 알림. `model_pool_metrics` 테이블 영속화.
- **MCP Tools**: 13 built-in tools (`mcp/tools.ts` `builtInTools`) with tier-based access (Free/Pro/Enterprise). Web scraping tools (web_scrape, web_map, web_crawl) are always active (no API key required).
- **Frontend Security**: XSS defense via `sanitize.js`. All user content must be sanitized.
- **Audit ↔ Alert 통합**: `AuditService.logAudit` 가 SoT. CRITICAL_ACTIONS whitelist 매칭 시 자동 `sendAlert` (controller 직접 호출 금지).
- **User Customization 4 축 (2026-05-26 claude.ai 패턴 정렬)**: ① **Model** (ModelSelector dropdown) ② **Style** (Concise/Default/Verbose cycle button — `chat/style.ts` + system prompt prepend) ③ **Mode** (Discussion/Thinking/DeepResearch/Web/Agent Task 토글) ④ **Custom Instructions** (Settings 영구 textarea — `users.custom_instructions`). system prompt 조립 순서: `memoryBlock + customInstructionsBlock + style(agent? + base)`. Custom Agents (claude.ai Projects 동등) 는 산업 agent 자동 라우팅 우회 + `user_agents.system_prompt` 사용. Cross-conversation Memory (claude.ai/ChatGPT Memory 동등) 는 `/remember` slash command 로 explicit 저장 → `user_memories` 영속 → system prompt 가장 앞에 prepend.
- **Brand Alias Normalizer (Phase D 2026-05-26)**: 7 legacy brand alias (`openmake_llm_pro/_fast/_think/_code/_vision/_auto`) 를 직교 축으로 자동 매핑하는 backward-compat layer. `chat/brand-alias-normalizer.ts`. Phase F (alias 410 폐기) 는 30일 운영 관찰 후.
- **에러 처리 전략**: `errors/` 디렉토리의 도메인별 커스텀 에러 클래스 사용. HTTP 상태코드 매핑은 `middlewares/error-handler.ts` 가 담당 (`ContextOverflowError` → 413, Auth 에러 → 401/403). 비즈니스 로직에서 `res.status()` 직접 호출 금지 — 에러를 throw 하여 middleware 가 처리하게 할 것. `AppError(message, statusCode, code)` 패턴 사용.

### DB 마이그레이션

마이그레이션 파일은 `services/database/migrations/` 에 관리하며, 초기 스키마는 `services/database/init/` 에 위치한다.

- **파일 네이밍**: `NNN_description.sql` 형식 (예: `001_add_user_memories.sql`). NNN은 3자리 순번, 순서 충돌 금지.
- **마이그레이션 적용**: `server.ts` 부팅은 `init/002-schema.sql`(schema-initializer)만 자동 적용하며, `migrations/` 는 **자동 적용되지 않는다**. CLI 로 수동 적용: `npx ts-node backend/api/src/data/migrations/cli.ts migrate` (`... status` 로 미적용 확인). `MigrationRunner.applyPending` 이 `migration_versions` 테이블로 이력 추적 (version = `filename.split('_')[0]`). (운영 서버 PC 엔 `psql` 미설치 — DB 진단은 node `pg` Client 사용)
- **멱등 작성 원칙**: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 등 재실행 안전하게 작성.
- **컬럼/테이블 삭제**: 즉시 DROP 금지 — 애플리케이션 코드 참조 제거 후 다음 배포에서 DROP 마이그레이션 적용 (2단계 배포).
- **롤백**: 롤백 스크립트는 **`migrations/rollbacks/NNN_xxx.sql`** 하위 디렉토리에 둔다. ⚠️ runner 의 파일 필터 정규식 `^\d+_[a-zA-Z0-9_-]+\.sql$` 이 `NNN_xxx_rollback.sql` 도 마이그레이션으로 스캔하므로, `migrations/` 루트에 두면 forward 와 **같은 version(`NNN`)으로 같은 부팅에 실행되어 방금 적용한 것을 되돌린다** (정렬상 `.sql` < `_rollback`). `rollbacks/` 하위는 비재귀 `readdirSync` 에서 제외되어 안전.

## Configuration

Environment variables loaded from `.env` at project root (see `.env.example`). Key variables:

**Core**
- `PORT` (default 52416), `DATABASE_URL` (PostgreSQL), `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY` (AES-256-GCM for external provider keys)

**LLM Backend (vLLM via LiteLLM proxy)**
- `LLM_BASE_URL` — LiteLLM proxy endpoint (e.g. `http://localhost:4000` 또는 운영 `http://localhost:13401`)
- `LLM_API_KEY` — LiteLLM master key (또는 vLLM `--api-key`)
- `LLM_DEFAULT_MODEL` — proxy 카탈로그의 default model id (e.g. `qwen3.6-35b-a3b`)
- `LLM_TIMEOUT` (chat), `LLM_FAST_FAIL_TIMEOUT_MS` (probe), `LLM_WARMUP_TIMEOUT_MS`
- `LLM_LOCAL_MODELS_JSON` — proxy 모델 카탈로그 override (optional)
- `LLM_POOL_*` — model pool routing (`LLM_POOL_ENABLED`, `LLM_POOL_DEFAULT_MODEL`, `LLM_POOL_LARGE_MODEL`, `LLM_POOL_DEFAULT_CTX=262144`, `LLM_POOL_LARGE_CTX=1048576`)
- `LLM_HOURLY_TOKEN_LIMIT`, `LLM_WEEKLY_TOKEN_LIMIT`

**External Providers / Integrations**
- `GEMINI_API_KEY` (FIRECRAWL_API_KEY 는 2026-05-26 제거 — `utils/web-scraper.ts` 가 무료 3단계 fallback 으로 대체)
- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

**운영자 배포 가이드**: GPU 운영 서버 PC의 `/home/smith/openmake_llm/docs/superpowers/plans/2026-05-20-vllm-server-setup.md` 에만 보관 (이 저장소에는 없음 — 로컬 `docs/` 디렉토리는 2026-06-10 정리됨). 
- **서버 PC 배포 절차**:
  1. 레포지토리의 `scripts/vllm/litellm.config.yaml`을 `/home/smith/vllm/litellm.config.yaml`로 복사합니다. (앱 데이터베이스 연동용 `database_url: os.environ/DATABASE_URL` 설정 포함)
  2. `/home/smith/vllm/litellm.env` 파일을 생성하여 `LITELLM_MASTER_KEY`와 `DATABASE_URL`을 설정합니다.
  3. `.service` 파일 4개를 `/etc/systemd/system/`으로 심링크 또는 복사합니다:
     - `openmake-vllm-qwen.service` (262K context, 포트 8002)
     - `openmake-vllm-qwen-1m.service` (1M context, 포트 8004)
     - `openmake-vllm-bge.service` (bge-m3 embedding, 포트 8003)
     - `openmake-litellm.service` (LiteLLM proxy, 포트 13401, 앞선 3개 서비스 시작 후 기동)
  4. `sudo systemctl daemon-reload`를 실행한 뒤, `sudo systemctl enable --now openmake-vllm-qwen openmake-vllm-qwen-1m openmake-vllm-bge openmake-litellm` 명령어로 가동합니다.
- **가상환경 (venv) 구분**:
  - Qwen (262K, 1M): `/home/smith/vllm/rebuild/vllm_env` (qwen3.6 지원 커스텀 빌드)
  - Embedding (bge-m3): `/home/smith/vllm/vllm_env` (임베딩 전용 독립 venv)
  - LiteLLM: `/home/smith/vllm/litellm_env` (LiteLLM 자체 실행용 venv)
- **LiteLLM Alias 설정**: OpenAI 호환 클라이언트를 위해 `gpt-3.5-turbo` 호출 시 `qwen3.6-35b-a3b`로 자동 라우팅되도록 설정되어 있습니다.

## Git & PR 가이드

### Commit 메시지 (Conventional Commits)

| 타입 | 설명 | 예시 |
|---|---|---|
| `feat` | 새 기능 | `feat(chat): add style cycle button` |
| `fix` | 버그 수정 | `fix(auth): handle expired JWT gracefully` |
| `refactor` | 동작 변경 없는 리팩터링 | `refactor(llm): extract pool routing to fn` |
| `docs` | 문서 변경 | `docs(claude): add DB migration guide` |
| `test` | 테스트 추가/수정 | `test(services): add ChatService unit tests` |
| `chore` | 빌드/설정 등 기타 | `chore(deps): update pg to 8.13` |

### PR 체크리스트

- [ ] `npm run lint` 통과
- [ ] `npm test` (백엔드 유닛 테스트) 통과
- [ ] 라우팅/응답 변경 시: `npm --workspace backend/api run eval:routing` + `eval:response` 실행
- [ ] DB 스키마 변경 시: 마이그레이션 파일 포함 (순번 충돌 확인)
- [ ] 환경변수 추가 시: `.env.example` 업데이트
- [ ] UI 변경 시: 스크린샷 첨부
- [ ] 보안 관련 변경 시: 영향 범위 명시

## TypeScript Conventions

- **Backend**: Strict mode (`strict: true`, `noImplicitAny`, `strictNullChecks`), CommonJS module output, `@/` path alias
- **Validation**: Zod for schema validation
- **Logging**: Winston logger (`createLogger('ModuleName')`)

## No-Hardcoding Policy

코드에 매직 넘버, 모델명, 프롬프트 텍스트 등을 직접 하드코딩하지 않는다. 모든 설정 가능한 값은 아래 3계층 중 적절한 곳에 외부화한다.

### 3계층 외부화 원칙

| 계층 | 저장소 | 적용 대상 | 변경 방식 |
|---|---|---|---|
| **L1 환경변수** | `.env` | 모델명, API 키, 호스트, 타임아웃, 캐시 TTL | 서버 재시작 |
| **L2 Config 파일** | `config/*.ts` or JSON | 임계값, 가중치, 키워드/패턴, 프롬프트 텍스트 | 핫 리로드 또는 재시작 |
| **L3 DB 테이블** | PostgreSQL + Admin UI | 모델 프리셋, 라우팅 매핑, 도구 접근 제어, 프로파일 설정 | 실시간 (Admin UI) |

### 구체적 금지 항목

1. **모델명/엔진명 직접 기입 금지** — `config/model-defaults.ts` 또는 환경변수에서 읽어올 것
2. **temperature, top_p 등 LLM 파라미터 리터럴 금지** — config 또는 DB 프리셋에서 로드
3. **시스템 프롬프트 인라인 작성 금지** — 별도 파일(`prompts/`) 또는 DB `prompt_templates`에서 로드
4. **타임아웃/임계값 매직 넘버 금지** — `config/timeouts.ts`, `config/runtime-limits.ts`에 명명된 상수로 정의하고, 환경변수 오버라이드 지원
5. **매핑 테이블 switch-case/if-else 체인 금지** — `Record<string, T>` 룩업 맵을 config에서 로드
6. **정규식 패턴/키워드 목록 인라인 금지** — JSON config 또는 DB에서 관리
7. **역할/권한/티어 목록 직접 기입 금지** — DB 또는 config에서 관리

### 새 설정값 추가 시 체크리스트

모든 리터럴 값을 작성할 때 아래 순서로 판단한다:

1. 이 값이 환경/배포마다 다를 수 있는가? → **환경변수**
2. 운영 중 관리자가 조정해야 하는가? → **DB + Admin UI**
3. 개발자가 튜닝하지만 배포 없이 바꾸고 싶은가? → **Config 파일**
4. 위 3가지 모두 아니라면 → `config/*.ts`에 **명명된 상수**로 정의 (인라인 리터럴 금지)

## Prohibited Technologies

이 프로젝트에서 **영구적으로 금지**된 기술/도구 목록. 어떤 상황에서도 도입하거나 제안하지 않는다.

### Docker / 컨테이너 (영구 금지)

- `Dockerfile`, `docker-compose.yml`, `.dockerignore` 등 Docker 관련 파일 **생성 금지**
- Docker 기반 배포, 개발 환경, CI/CD 파이프라인 **제안 금지**
- 컨테이너 런타임(Docker, Podman, containerd 등) 관련 설정/코드 **추가 금지**
- 배포 방식: **PM2 + 직접 배포**만 사용
- 근거: 프로젝트 방침에 의한 영구 제외 (CI 파이프라인에도 명시됨)

### ORM / 쿼리 빌더 (영구 금지)

- `Prisma`, `TypeORM`, `Drizzle`, `Knex`, `Sequelize` 등 ORM 및 쿼리 빌더 **도입 금지**
- 데이터베이스 접근: **Raw SQL + parameterized queries** (`$1, $2`) 만 허용
- 근거: 기존 `pg` Pool 기반 레이어와의 정합성 유지, 쿼리 투명성 보장

### SPA 프레임워크 / 대형 프론트엔드 라이브러리 (영구 금지)

- `React`, `Vue`, `Angular`, `Svelte` 등 SPA 프레임워크 **도입 금지** — Vanilla JS ES Modules 유지
- `jQuery`, `Lodash` 등 대형 유틸 라이브러리 신규 추가 금지
- 근거: 번들 없는 직접 서빙 구조 유지, 빌드 파이프라인 단순화

## Phase 용어집

개발 이력 문서에 등장하는 내부 코드명 정리.

| Phase | 내용 | 일시 |
|---|---|---|
| **Phase B** | ExecutionPlanBuilder 도입 — 정책(plan)↔실행(execute) 2-layer 분리. LLM classifier · semantic cache · feedback-cache-corrector 제거 | 2026-05-26 |
| **Phase B Phase 2-A** | Phase B 머지 완료 — query-classifier를 regex+fast-path 전용으로 단순화 | 2026-05-26 |
| **Phase D** | Brand Alias Normalizer 도입 (7 legacy alias → 직교 축 자동 매핑 backward-compat layer) | 2026-05-26 |
| **Phase F** | Legacy brand alias 410 Gone 응답 폐기 예정 (30일 운영 관찰 후 진행) | TBD |
| **Ollama 제거** | vLLM serve + LiteLLM proxy 전환 완료. (2026-05-31 후속 정리: SdkType `'ollama'`→`'local-llm'`, 프론트 ModelSelector·strategy 라우팅의 레거시 `'ollama'` 분기 제거. 레거시 `'ollama:'` model ID 입력만 `parseFullModelId` normalize 로 호환) | 2026-05-18 |
| **RAG 폐기** | RAG/임베딩/MemoryService/문서 처리 전체 제거 | 2026-03 |
| **vector cache·semantic router 폐기** | semantic cache, vector cache, MemoryService, 문서 첨부 기능 제거 | 2026-05 |
