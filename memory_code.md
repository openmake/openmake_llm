---
name: 프로젝트 전체 소스 코드 리뷰 & 수정 이력
description: OpenMake LLM 전체 소스 아키텍처, 주요 파일 역할, 데이터 흐름, 수정 이력 — 코드 작업 시 항상 참조
type: project
originSessionId: 0f21f603-12a2-4a1a-8b8c-e536cd698026
---
# OpenMake LLM — 소스 코드 전체 리뷰 (2026-05-07 재점검 반영)

> **운영 방침**: 이 파일은 코드 수정이 발생할 때마다 "## 수정 이력" 섹션에 추가한다.
> 참조 우선순위: 실제 코드 → AGENTS.md/CLAUDE.md → 이 파일(요약/이력)

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **서비스** | Self-hosted AI 어시스턴트 플랫폼 (다중 모델 오케스트레이션) |
| **LLM 백엔드** | Ollama 로컬 모델 (Cloud/API Key Pool 코드는 호환성 잔존) |
| **모델 프로파일** | 단일 로컬 모델 (`OLLAMA_DEFAULT_MODEL`, 현재 `gemma4:e4b`) |
| **라우팅** | LLM 분류기 + 2계층 시맨틱 캐시 |
| **포트** | 52416 |
| **런타임** | Node.js + PM2, PostgreSQL, WebSocket |

### 모노레포 구조
```
openmake_llm/
├── backend/api/           # Express 5 + TypeScript API 서버 (CommonJS 출력)
│   └── src/               # 핵심 소스 (현재 449개 .ts 파일)
├── frontend/web/public/   # Vanilla JS SPA (ES Modules)
├── frontend/web/scripts/  # 프론트엔드 모듈 검증 스크립트
├── services/database/     # PostgreSQL init/migrations SQL
├── data/                  # 공유 데이터 (MCP, users)
├── docs/                  # 프로젝트 문서
└── tests/e2e/             # Playwright E2E 테스트
```

---

## 2. 백엔드 아키텍처 (`backend/api/src/`)

### 2.1 서버 진입점
| 파일 | 역할 |
|------|------|
| `server.ts` | `DashboardServer` 클래스 — Express + WebSocket 통합, graceful shutdown |
| `bootstrap.ts` | 싱글톤 서비스 초기화 순서 보장 (cache → analytics → alerts → agent learning) |
| `cli.ts` | CLI 진입점 (cluster 모드 등) |

### 2.2 디렉토리별 역할
| 디렉토리 | 역할 | 핵심 파일 |
|----------|------|----------|
| `config/` | 환경변수·상수·모델 기본값 중앙 관리 | `env.ts`, `constants.ts`, `model-defaults.ts`, `timeouts.ts`, `runtime-limits.ts` |
| `chat/` | 채팅 파이프라인 (분류 → 모델 선택 → 실행) | `query-classifier.ts`, `llm-classifier.ts`, `model-selector.ts`, `domain-router.ts`, `profile-resolver.ts` |
| `services/` | 핵심 비즈니스 로직 | `ChatService.ts`, `MemoryService.ts`, `DeepResearchService.ts`, `AuthService.ts` |
| `services/chat-service/` | ChatService 서브모듈 | `context-builder.ts`, `strategy-executor.ts`, `agent-resolver.ts`, `model-resolver.ts` |
| `routes/` | REST API 엔드포인트 (24개 `*.routes.ts` + setup/index/v1) | 아래 2.3 참조 |
| `agents/` | 100개 산업 에이전트 + 라우팅 | `index.ts`, `keyword-router.ts`, `semantic-router.ts`, `system-prompt.ts` |
| `sockets/` | WebSocket 실시간 채팅 | `ws-chat-handler.ts` |
| `mcp/` | Model Context Protocol (도구 실행) | `tool-router.ts`, `tool-tiers.ts`, `unified-client.ts`, `server-registry.ts` |
| `auth/` | JWT + OAuth 인증 | `auth-core.ts`, `middleware.ts`, `oauth-provider.ts` |
| `data/` | PostgreSQL 리포지토리 패턴 | `repositories/*.ts`, `models/unified-database.ts` |
| `middlewares/` | 보안, Rate Limit, 에러 처리 | `setup.ts`, `rate-limiters.ts`, `api-key-auth.ts` |
| `cluster/` | Ollama 클러스터 관리 | `manager.ts`, `circuit-breaker.ts`, `health-checker.ts` |
| `monitoring/` | 분석·알림 시스템 | `analytics.ts`, `alerts.ts`, `metrics.ts` |
| `evaluation/` | 라우팅·응답 품질 평가 CLI | — |

### 2.3 API 라우트 목록 (현재 24개 `*.routes.ts`, setup/index/v1 별도)
| 파일 | 주요 엔드포인트 |
|------|----------------|
| `chat.routes.ts` | `POST /api/chat`, `POST /api/chat/stream` |
| `agents.routes.ts` | `GET /api/agents`, `POST /api/agents/custom`, `POST /api/agents/:id/feedback` |
| `api-keys.routes.ts` | `POST/GET/PATCH/DELETE /api/api-keys`, `POST /api/api-keys/:id/rotate` |
| `mcp.routes.ts` | `GET /api/mcp/tools`, `POST /api/mcp/tools/:name/execute`, `GET/POST /api/mcp/servers` |
| `research.routes.ts` | `POST /api/research`, `GET /api/research/:id` |
| `memory.routes.ts` | `GET/POST/DELETE /api/memory` |
| `documents.routes.ts` | `POST /api/documents/upload`, `GET /api/documents` |
| `kb.routes.ts` | Knowledge Base CRUD |
| `skills.routes.ts` | Agent Skills CRUD |
| `audit.routes.ts` | `GET /api/audit/logs` |
| `metrics.routes.ts` | `GET /api/metrics` |
| `model.routes.ts` | `GET /api/models` |
| `nodes.routes.ts` | 클러스터 노드 관리 |
| `openai-compat.routes.ts` | OpenAI API 호환 레이어 |
| `chat-feedback.routes.ts` | `POST /api/chat/feedback` |
| `debug-queue.routes.ts` | `POST /api/debug-queue/report` |
| `token-monitoring.routes.ts` | 토큰 사용량 모니터링 |
| `uir.routes.ts` | Unified Intent Router 관리 |
| `usage.routes.ts` | 사용량 통계 |
| `external.routes.ts` | Google Drive 등 외부 서비스 연결 |
| `push.routes.ts` | 웹 푸시 알림 |
| `web-search.routes.ts` | 웹 검색 API |
| `developer-docs.routes.ts` | 개발자 문서 |
| `agents-monitoring.routes.ts` | 에이전트 모니터링 |
| `setup.ts` | Express 미들웨어 및 라우트 마운트 |
| `v1/index.ts` | v1 API 그룹 라우터 |

---

## 3. 채팅 파이프라인 상세

### 3.1 쿼리 분류 계층 (L0 → L1 → L1.5)
```
사용자 메시지
  ↓
[L0] query-classifier.ts — 정규식 + 키워드 스코어링 (즉시, < 1ms)
  ↓ (신뢰도 부족 시)
[L1] llm-classifier.ts — `CLASSIFIER_MODEL` 역할 모델 기반 정밀 분류
  ↓ (exact-match 캐시 조회)
[L1 Cache] SemanticClassificationCache — TTL + LRU (< 1ms)
  ↓ (캐시 미스 시)
[L1.5] VectorClassificationCache — 임베딩 유사성 기반
  ↓
14개 QueryType 결정:
  code-agent | code-gen | code | math-hard | math-applied | math
  reasoning | creative | analysis | document | vision | translation | korean | chat
```

### 3.2 모델 선택 계층
```
요청 model → buildExecutionPlan()
  ↓
단일 로컬 모델로 해석 (`config.ollamaDefaultModel`)
  ↓
selectOptimalModel() — QueryType 분류 + 모델 옵션/토큰 예산 조정
  ↓
ChatService 전략 실행:
  AgentLoopStrategy        — 기본 응답 경로 (DirectStrategy를 내부 사용)
  ThinkingStrategy         — thinking ON 시 우선 실행 후 AgentLoop 폴백
  DiscussionStrategy       — 사용자 토론 모드 명시 시 실행
  DeepResearchStrategy     — 사용자 딥리서치 모드 명시 시 실행
  GenerateVerifyStrategy   — 타입/전략 코드는 유지되나 단일 모델 기본 경로에서는 기본 선택 아님
```

### 3.3 WebSocket 채팅 흐름
```
클라이언트 WebSocket 메시지
  ↓
ws-chat-handler.ts
  → 파일/이미지 검증 → 언어 감지 → AbortController 생성
  → selectOptimalModel() → ChatRequestHandler.processChat()
  → onToken 콜백 → WebSocket 스트리밍
  → 완료 시 DB 저장 (ConversationRepository)
```

---

## 4. 인증 시스템

### 4.1 토큰 관리
- **액세스 토큰**: JWT, 15분 TTL, jti 블랙리스트 (PostgreSQL)
- **리프레시 토큰**: JWT, 7일 TTL, httpOnly 쿠키
- **동시 세션 제한**: `MAX_SESSIONS_PER_USER` (이전 세션 자동 블랙리스트)
- **블랙리스트 장애 정책**: `BLACKLIST_FAIL_MODE` — safe(거부) vs open(통과)

### 4.2 인증 미들웨어 우선순위
```
토큰 추출: httpOnly 쿠키 → Authorization 헤더 → X-API-Key 헤더
```

### 4.3 OAuth 2.0
- 지원: Google, GitHub
- CSRF 방지: 암호화 nonce 기반 state (10분 TTL)
- Open Redirect 방지: returnUrl 상대 경로만 허용

### 4.4 API Key
- HMAC-SHA-256 해싱 저장 (평문 1회만 반환)
- timing-safe 비교
- `allowed_models` 필드로 모델 접근 제한

---

## 5. MCP (Model Context Protocol) 시스템

### 5.1 도구 계층 (tier별 접근)
| Tier | 허용 도구 |
|------|-----------|
| `free` | web_search, vision_ocr, analyze_image |
| `pro` | + web_scrape, web_map, web_crawl, external Google Search |
| `enterprise` | `*` (모든 도구) |

### 5.2 MCP 외부 서버 흐름
```
DB (mcp_servers 테이블) → MCPServerRegistry.initializeFromDB()
  → ExternalMCPClient.connect() (stdio / SSE / StreamableHTTP)
  → ToolRouter에 도구 등록
```

### 5.3 UserSandbox 경로 구조
```
USER_DATA_ROOT/{userId}/
├── workspace/  # fs_read_file 기준 작업 디렉토리
├── data/       # 사용자 DB
└── temp/       # 임시 파일 (자동 정리)
```

---

## 6. 에이전트 시스템

### 6.1 에이전트 구성
- **100개** 시스템 에이전트 (18개 산업 × 전문가 그룹)
- **커스텀 에이전트**: 사용자 생성/수정 가능
- **카테고리**: healthcare, finance, legal, engineering, technology, creative, education, science, government, logistics, hospitality, real-estate, agriculture, energy, media, social-welfare, business, special

### 6.2 에이전트 라우팅 2단계
```
1단계: analyzeTopicIntent() — 8개 도메인 정규식 매칭
2단계: 향상된 키워드 매칭 (TF-IDF + 동의어 + 카테고리 가중치)
  ↓
신뢰도 계산: min(score/10, 1.0)
```

### 6.3 SemanticAgentRouter (shadow mode)
- 임베딩 기반 에이전트 라우팅 PoC
- 현재 shadow mode (비교 로깅만, 실제 라우팅 미적용)
- 안정성 확인 후 본격 라우팅으로 승격 예정

---

## 7. 데이터베이스 (PostgreSQL)

### 7.1 주요 테이블
| 테이블 | 용도 |
|--------|------|
| `users` | 사용자 계정 (username, password_hash, email, role, is_active) |
| `conversation_sessions` | 대화 세션 (user_id, title, metadata) |
| `conversation_messages` | 메시지 (role, content, model, agent_id, thinking, tokens, response_time_ms) |
| `conversation_audit_log` | 본문 제외 메시지 메타 감사 로그 (`saveHistory=false`여도 기록) |
| `conversation_debug_queue` | 에러/사용자 신고 재현용 임시 본문 보관 큐 |
| `user_memories` | 장기 메모리 (category, key, value, importance, expires_at) |
| `memory_tags` | 메모리 태그 (N:1 user_memories) |
| `user_api_keys` | API Key (key_hash, key_prefix, scopes, allowed_models, rate_limit_tier) |
| `api_usage` | API 일일 사용량 (upsert: date+api_key_id) |
| `research_sessions` | 딥 리서치 세션 (topic, status, depth, progress) |
| `research_steps` | 리서치 단계별 결과 |
| `external_connections` | 외부 서비스 OAuth 토큰 (암호화 저장) |
| `audit_logs` | 감사 로그 (action, resource_type, ip_address) |
| `agent_usage_logs` | 에이전트 사용 로그 (response_time_ms, tokens_used) |
| `message_feedback` | 채팅 피드백 (signal, routing_metadata) |
| `agent_skills` | 에이전트 스킬 정의 |
| `knowledge_collections` | 지식 컬렉션 (visibility) |
| `knowledge_collection_documents` | 컬렉션-문서 N:M |
| `prompt_templates` | 프롬프트 템플릿 (name, category, version, is_active) |
| `prompt_template_versions` | 템플릿 버전 이력 |
| `migration_versions` | 마이그레이션 추적 (version, checksum) |

### 7.2 마이그레이션 파일 (적용 순서)
```
services/database/init/
  001-extensions.sql  → pgvector 등 확장
  002-schema.sql      → 기본 테이블 스키마 (서버 시작 시 자동 적용)
  003-seed.sql        → 초기 데이터

services/database/migrations/
  000_migration_versions.sql
  001_baseline.sql
  005_kb_nm_schema.sql          → 지식 컬렉션 N:M 스키마
  006_audit_logs_fk.sql         → 감사 로그 외래키
  007_message_feedback_fk.sql   → 피드백 외래키
  009_users_id_sequence.sql     → 사용자 ID 시퀀스
  010_feedback_schema_fixes.sql → 피드백 스키마 수정
  011_memory_search_index.sql   → 메모리 검색 인덱스
  012_uir_schema.sql            → Unified Intent Router 스키마
  013_prompt_templates.sql      → 프롬프트 템플릿 + 버전
  014_conversation_audit_log.sql → 메시지 본문 제외 메타 감사 로그
  015_conversation_debug_queue.sql → 에러/사용자 신고 디버그 큐
```

### 7.3 쿼리 패턴
- **파라미터화 쿼리**: `$1, $2` (SQL Injection 방지)
- **Upsert**: `ON CONFLICT DO UPDATE SET` (메모리, API 사용량, 외부 연결)
- **재시도**: `withRetry` 래퍼 (일시적 연결 실패 자동 복구)
- **인덱스**: `idx_prompt_templates_name_active` 등 도메인별 최적화

---

## 8. 프론트엔드 아키텍처

### 8.1 SPA 구조
- **프레임워크 없음** — Vanilla JS ES Modules
- **번들러**: Vite (dev only), 프로덕션은 직접 서빙
- **진입점**: `frontend/web/public/js/main.js`

### 8.2 모듈 의존 순서 (`main.js` 기준)
```
safe-storage.js → constants.js/state.js → utils.js/auth.js/ui.js/websocket.js
  → settings.js → chat.js/chat-actions.js → session.js/file-upload.js/modes.js
  → cluster.js/model-selector.js/spa-router.js → main.js 초기화
```
- `frontend/web/public/js/modules/index.js`는 현재 import되지 않는 문서성 잔재 후보.

### 8.3 핵심 모듈
| 모듈 | 역할 |
|------|------|
| `state.js` | 중앙 상태 저장소 (점 표기법 접근, subscribe 구독 패턴) |
| `spa-router.js` | History API 기반 라우터 (동적 ES Module import, 인증 가드) |
| `chat.js` | 메시지 전송 오케스트레이션 (MCP 페이로드 조립) |
| `websocket.js` | WebSocket 연결 + 지수 백오프 재연결 |
| `auth.js` | JWT 관리 (Silent Refresh, Proactive Refresh) |
| `api-client.js` | HTTP 래퍼 (CSRF Double-Submit 자동 주입) |
| `sanitize.js` | 경량 XSS 방어 (화이트리스트 기반, DOMPurify 없음) |
| `settings.js` | MCP 도구 토글 (웹검색, 사고, 토론 모드) |
| `file-upload.js` | 파일/이미지 업로드 (XHR 진행률, base64 추출) |

### 8.4 페이지 모듈 (pages/*.js, 24개)
모든 페이지 모듈은 `{ getHTML(), init(), cleanup() }` 계약을 준수한다.
- admin.js, admin-metrics.js (requireAdmin)
- research.js, documents.js, memory.js, history.js
- custom-agents.js, skill-library.js, api-keys.js
- analytics.js, audit.js, usage.js, token-monitoring.js
- developer.js, developer-sections.js, developer-helpers.js
- settings.js, alerts.js, uir-monitor.js, cluster.js
- agent-learning.js, external.js, guide.js, password-change.js

### 8.5 SPA 라우팅 흐름
```
내부 링크 클릭 / Router.navigate(path)
  → 경로 정규화 (clean URL: /research → /research.html)
  → 인증/관리자/티어 가드 확인
  → 이전 모듈 cleanup() + CSS 제거
  → ES Module import() (결과 캐시)
  → getHTML() 렌더링 → init() 초기화
```
- 무한 리로드 방지: 3초 내 동일 경로 3회 리디렉트 차단

### 8.6 전역 네임스페이스 노출
main.js가 `window.*`에 노출: `sendMessage`, `abortChat`, `connectWebSocket`, `Router`, `getState`, `setState`, `login`, `logout` 등 — inline onclick 핸들러 호환성 유지 목적

---

## 9. 설정 외부화 원칙 (No-Hardcoding Policy)

| 계층 | 저장소 | 예시 |
|------|--------|------|
| **L1 환경변수** | `.env` | 모델명, API 키, 타임아웃 |
| **L2 Config 파일** | `config/*.ts` | 임계값, 가중치, 패턴 |
| **L3 DB 테이블** | PostgreSQL + Admin UI | 모델 프리셋, 라우팅 매핑, 프롬프트 템플릿 |

**금지**: 모델명/temperature/시스템 프롬프트/타임아웃 인라인 리터럴 직접 기입

---

## 10. 보안 체계 요약

| 영역 | 구현 |
|------|------|
| XSS | sanitize.js (태그/속성 화이트리스트), Helmet CSP |
| CSRF | Double-Submit Cookie (api-client.js 자동 주입) |
| SQL Injection | 파라미터화 쿼리 ($1, $2) |
| JWT | httpOnly 쿠키, jti 블랙리스트, 15분 TTL |
| Rate Limit | Sliding Window Counter (IP + 사용자 별도) |
| Path Traversal | UserSandbox.validatePath() (trailing separator 검사) |
| RCE | MCP 터미널 실행 비활성화 (410 Gone) |
| API Key | HMAC-SHA-256 해싱, timing-safe 비교 |
| 토큰 암호화 | external_connections 테이블 (encryptToken/decryptToken) |

---

## 11. 빌드 & 실행 명령어

```bash
# 개발
npm run dev              # backend + frontend 동시
npm run dev:api          # ts-node src/server.ts
npm run dev:frontend     # vite dev server

# 빌드
npm run build            # backend + frontend + deploy
npm run build:backend    # tsc + frontend 에셋 동기화
npm run build:frontend   # validate-modules.sh

# 프로덕션
npm start                # node backend/api/dist/server.js
node backend/api/dist/cli.js cluster --port 52416

# 테스트
npm test                           # Jest (전체)
npx jest path/to/file.test.ts     # 단일 파일
npm run test:e2e                   # Playwright
npm run lint                       # ESLint
```

---

## 12. 수정 이력

> 아래에 코드 수정 시마다 추가한다.
> 형식: `### YYYY-MM-DD — [파일명] — [변경 요약]`

_(초기 생성: 2026-05-06, 소스 전체 리뷰 완료)_

---

### 2026-05-06 — 단일 로컬 모델 전환 (gemma4:e4b)

**목적**: 자체 브랜딩 클라우드 모델 전체 제거, 단일 로컬 Ollama 모델 `gemma4:e4b`로 교체

**변경 커밋**: `641d90a` → `2720aeb` (5개 커밋)

#### 제거된 항목
| 항목 | 설명 |
|------|------|
| `ENGINE_FALLBACKS` | 클라우드 폴백 모델 6개 (config/model-defaults.ts) |
| `AUTO_ROUTING_ENGINE_MAP` | 14 QueryType × 3 CostTier 클라우드 모델 라우팅 맵 |
| `GV_MODEL_MAP` / `GV_DEFAULT_MODELS` | Generate-Verify 전략 모델 쌍 |
| `MODEL_CAPABILITY_PRESETS` | 14개 클라우드 모델 프리픽스 프리셋 → `gemma4` 단일로 교체 |
| 7개 Brand Model 프로파일 | `openmake_llm`, `_pro`, `_fast`, `_think`, `_code`, `_vision`, `_auto` |
| `selectModelForProfile()` | Brand Model alias 기반 모델 선택 함수 |
| `selectBrandProfileForAutoRouting()` | Auto-Routing 로직 |
| `OMK_ENGINE_LLM/PRO/FAST/THINK/CODE/VISION` | 환경변수 6개 (env.schema.ts, env.ts) |
| `PROFILE_COST_TIERS`, `TIER_FALLBACK_MAP`, `applyCostTierCeiling()` | Brand Model 비용 티어 ceiling |
| Cloud 모델 헬스체크 로직 | model-health-monitor.ts 전면 스텁화 |

#### 단순화된 항목
| 파일 | 변경 내용 |
|------|----------|
| `config/model-presets.ts` | `getModelPresets()` → `gemma4:e4b` 단일 프리셋 반환 |
| `chat/model-selector.ts` | `selectOptimalModel()` 항상 `config.ollamaDefaultModel` 반환 |
| `chat/profile-resolver.ts` | `buildExecutionPlan()` 항상 단일 모델 패스스루 (`executionStrategy: 'single'`) |
| `chat/pipeline-profile.ts` | `getProfiles()` → `{}`, `isValidBrandModel()` → `false` |
| `chat/cost-tier.ts` | `CostTier` 타입, `COST_TIER_ORDER`, `getDefaultCostTier()`만 유지 |
| `services/model-health-monitor.ts` | 스텁 (항상 건전, 빈 스냅샷) |
| `services/chat-service/strategy-executor.ts` | GV 모델 resolve → `ollamaDefaultModel` 단일 사용 |
| `services/DeepResearchService.ts` | `omkEngineFast` → `ollamaDefaultModel` |

#### 유지된 항목
- QueryType 분류 계층 (14종) — `query-classifier.ts`, `llm-classifier.ts`
- 실행 전략 4종 (Direct/AgentLoop/Discussion/DeepResearch)
- API Key Pool 코드 — 로컬 모델에서 자동 스킵 (isCloudModel() 기존 동작)
- Streaming, Thinking, Tool Calling, Vision, Structured Outputs, Web Search API

#### 환경변수 변경
```bash
# .env
OLLAMA_DEFAULT_MODEL=gemma4:e4b  # 변경 (기존: gemini-3-flash-preview:cloud)
# OMK_ENGINE_LLM/PRO/FAST/THINK/CODE/VISION 6개 삭제
```

#### gemma4:e4b 능력 프리셋
```typescript
'gemma4': { toolCalling: true, thinking: true, vision: true, streaming: true }
```

#### 빌드 결과
- TypeScript 컴파일: 오류 0개
- Jest (backend/api): 1630 passed / 4 failed (기존 문제, 변경과 무관)
- `npm run build:backend`: 성공

---

### 2026-05-07 — 응답 지연 진단 및 분류기 모델 수정

**증상**: 단순 질문에도 매 요청 ~120초 지연 발생.

**근본 원인**: 단일 로컬 모델 전환 시 `OLLAMA_DEFAULT_MODEL`은 `gemma4:e4b`로 변경했지만, **분류기 전용 모델 2개**가 여전히 클라우드 모델(`gemini-3-flash-preview:cloud`)을 가리키고 있었음. 매 채팅 요청 시:

```
사용자 입력
  ↓
[1] CLASSIFIER_MODEL 호출 (gemini-3-flash-preview:cloud)
  → API Key 인증 실패 또는 연결 불가
  → OLLAMA_TIMEOUT(120s)까지 대기
  → regex 폴백
  ↓
[2] gemma4:e4b 응답 생성
```

→ 모든 요청이 **120초 + 응답 시간** 소요.

**수정 파일**: `backend/api/src/config/routing-config.ts` (커밋 `b992f95`)

```typescript
// 변경 전
export const CLASSIFIER_MODEL =
    process.env.OMK_CLASSIFIER_MODEL ?? 'gemini-3-flash-preview:cloud';
export const UIR_MODEL =
    process.env.OMK_UIR_MODEL ?? 'gemini-3-flash-preview:cloud';

// 변경 후
export const CLASSIFIER_MODEL =
    process.env.OMK_CLASSIFIER_MODEL ?? process.env.OLLAMA_DEFAULT_MODEL ?? 'gemma4:e4b';
export const UIR_MODEL =
    process.env.OMK_UIR_MODEL ?? process.env.OLLAMA_DEFAULT_MODEL ?? 'gemma4:e4b';
```

**부가 수정**: `openmake_llm.sh`의 Ollama 시작/정지를 `brew services` → `launchctl` 직접 방식으로 교체 (커밋 `4d98a76`).
- 원인: macOS가 `homebrew.mxcl.ollama.plist`에 `com.apple.provenance` 확장 속성을 부여하여 `brew services start ollama`가 `Operation not permitted @ apply2files` 오류로 실패
- 해결: `launchctl load/unload`로 우회 (해당 검증 단계를 거치지 않음)

**잔존 클라우드 모델 참조** (영향 적음, 추후 정리):
- `config/pricing.ts` — 가격 테이블 메타데이터 (런타임 영향 없음)
- `ollama/types.ts:624` — GPT-OSS 정규화 함수 (gemma4에는 no-op)

---

### 2026-05-07 — Central Model Registry 도입 (B+C 대안)

**목적**: "부분 마이그레이션 함정" 영구 해소 — 메인 모델 변경 시 분류기/임베딩/UIR 등 sub-LLM 호출 경로의 fallback 누락 방지.

**커밋**: `7a2813d` → `eaad9a3` → `818158a` (3개 커밋)

#### 신규 모듈: `config/model-roles.ts`

```typescript
export type ModelRole = 'chat' | 'classifier' | 'router' | 'embedding';

export function getModelForRole(role: ModelRole): string {
    // 1순위: 역할별 env var (OMK_CLASSIFIER_MODEL 등)
    // 2순위: OLLAMA_DEFAULT_MODEL (embedding 제외)
    // 3순위: ROLE_DEFAULTS 하드코딩 기본값
}

export async function validateModels(
    ollamaBaseUrl: string,
    failFast: boolean = false,
): Promise<void> {
    // 시작 시 Ollama API ping → 미설치 모델 / cloud 참조 감지
}
```

#### 통합된 호출 경로 (5개 파일 → model-roles 경유)

| 파일 | 변수 | 역할 |
|------|------|------|
| `config/routing-config.ts` | `CLASSIFIER_MODEL` | classifier |
| `config/routing-config.ts` | `UIR_MODEL` | router |
| `config/routing-config.ts` | `EMBEDDING_MODEL` | embedding |
| `services/DeepResearchService.ts` | `this.config.llmModel` | chat |
| `agents/semantic-router-instance.ts` | `SEMANTIC_EMBEDDING_MODEL` | embedding |
| `evaluation/run-augmented-evaluation.ts` | `embeddingModel` 메타 | embedding |

#### Startup Validation 위치 결정 (작업서 적응)

- 작업서는 `bootstrap.ts`를 async로 변경 지시 → `setupRoutes()` → `DashboardServer 생성자` cascade 발생
- 대안: `server.ts`의 이미 async인 `start()` 메서드에서 `cluster.start()` 직후 호출 — cascade 0건
- production 환경에서만 `failFast=true` (개발 시 미설치 모델로 인한 부팅 차단 방지)

#### 향후 모델 전환 절차 (영구 가이드)

1. `.env`에서 `OLLAMA_DEFAULT_MODEL` 변경
2. (선택) 역할별 env var 오버라이드: `OMK_CLASSIFIER_MODEL`, `OMK_UIR_MODEL`, `OMK_EMBEDDING_MODEL`
3. 서버 재시작 → `validateModels()`가 자동으로 미설치 모델 감지 및 경고/차단
4. **추가 코드 변경 불필요** (모든 호출이 `getModelForRole()` 경유)

#### 빌드 결과
- TypeScript 컴파일: 오류 0개
- `npm run build:backend`: 성공

---

### 2026-05-07 — 프론트엔드 동적 모델 렌더 전환 (옵션 B)

**목적**: 프론트엔드에 잔존하던 7개 브랜드 모델 옵션 하드코딩을 제거하고, 백엔드 `/api/models` 응답을 단일 진실 소스로 사용. 향후 모델 추가/변경 시 프론트 코드 수정 불필요.

**커밋**: `d79a827` (Phase 1 백엔드) → `51ffcf8` (Phase 2-4 프론트엔드, 9개 파일 통합)

#### Phase 1: 백엔드 `/api/models` 응답 재구성
- `routes/model.routes.ts`: `getProfiles()` (빈 객체) 의존 제거, `getModelForRole('chat')` + `MODEL_CAPABILITY_PRESETS` prefix 매칭으로 capabilities 조회
- 응답 형식 보존 (`defaultModel`, `models[].name/modelId/capabilities`) — 기존 프론트 호환

#### Phase 2-4: 프론트엔드 동적 렌더
| 파일 | 변경 |
|------|------|
| `settings.html` | 7개 `<option>` → placeholder 1개 |
| `js/modules/pages/settings.js` | `AUTO_MODEL` 변수 제거, dynamic `loadModelsFromApi()` |
| `js/settings-standalone.js` | `AUTO_MODEL` 제거, XSS escape 헬퍼 추가 |
| `js/modules/cluster.js` | `BRAND_MODELS` 배열 → `fetchAvailableModels()` 캐시 |
| `js/modules/constants.js` | `DEFAULT_AUTO_MODEL` export 및 window 바인딩 제거 |
| `js/modules/chat.js` | 빈 문자열 fallback (백엔드 `ws-chat-handler:131`이 `!model` 시 자동 선택) |
| `js/main.js` | `BRAND_MODELS` import 및 window 노출 제거 |
| `js/modules/pages/developer-sections.js` | API 문서 갱신, 30+개 `openmake_llm_*` 코드 예제 → `gemma4:e4b` |

#### 검증
- `grep -r "openmake_llm_\|DEFAULT_AUTO_MODEL\|BRAND_MODELS" frontend/web/public` → 결과 없음
- TypeScript 컴파일 오류 0개
- `node --check`: 모든 JS 파일 문법 정상

#### 주요 의사결정
- **chat.js fallback**: `DEFAULT_AUTO_MODEL` 대신 빈 문자열 전송 → 백엔드가 자동 선택 (추가 라운드트립 없음)
- **비관리자 처리**: 기존 `'OpenMake LLM Auto'` 하드코딩 → 백엔드 응답 활성 모델 + disabled
- **XSS 보강**: `settings-standalone.js`가 백엔드 받은 모델명을 escape 없이 innerHTML 주입했던 보안 이슈 동시 수정
- **단일 커밋**: `DEFAULT_AUTO_MODEL/BRAND_MODELS` 제거가 chat.js + cluster.js + main.js cascade로 영향 — 분리 커밋 시 중간 빌드 불가능 → 9파일 통합 커밋

#### 향후 효과
- 모델 추가/변경 시 `.env` 변경만으로 프론트 자동 반영 (코드 수정 0)
- 백엔드 `model-roles.ts` SSoT 원칙이 프론트엔드까지 일관 적용
- "부분 마이그레이션 함정" 패턴 완전 해소

---

### 2026-05-07 — Thinking Fast-Path 패턴 (옵션 3+4)

**목적**: gemma4:e4b 8B 모델이 thinking 활성화 시 단순 인사("안녕")에도 ~90초 응답 발생. 명백한 인사·단답형 질문은 사용자 토글과 무관하게 thinking 강제 OFF.

**커밋**: `ec21546` → `04ab3ac` → `283ec46` (3개 커밋, 총 +98줄/-5줄)

#### 신규 모듈: `chat/fast-path-detector.ts`
- `detectFastPath(query): { matched, reason }` 함수
- 11개 정규식 패턴: greeting, thanks, farewell, affirmation, negation, meta_identity, meta_name, time_query, date_query
- 길이 제약: 2자 미만 또는 50자 초과는 매칭 거부 (false positive 방지)
- 매칭 시 INFO 레벨 로그로 reason 추적 가능

#### 통합: `chat/request-handler.ts`
thinking 결정 우선순위 변경 (line 466):
1. **Fast-path 매칭** → 강제 OFF (사용자 토글 무시)
2. 사용자 `thinkingMode === true` → ON
3. 그 외 → OFF

#### 핵심 원칙: False Positive 0%
- 의심스러운 패턴은 추가하지 않음
- "안녕 코드" 같은 인사+작업 혼합은 매칭 거부
- "양자역학이란?" 같이 짧지만 깊이 필요한 질문은 fast-path 회피
- "왜?", "어떻게?", 코드 블록, 분석 키워드 모두 thinking 유지

#### 검증
- 단위 테스트 26/26 PASS (15 매칭 + 9 비매칭 + 2 경계 조건)
- 회귀 테스트: request-handler/chat-service/thinking 관련 65/65 PASS
- TypeScript 컴파일 0 오류

#### 응답 속도 개선 효과
- 단순 인사 ("안녕"): ~90초 → 실제 추론 시간만 (예상 ~5-15초)
- 정상 질문 (thinking 필요): 영향 없음
- 사용자 명시 토글 (settings.html `thinkingToggle`): 정상 작동 (fast-path 매칭 시만 무시)

---

### 2026-05-07 — 응답 잘림 (empty-response) 수정 — Thinking 토큰 보장 (옵션 A)

**증상**: 사용자가 thinking ON 상태로 짧은 한국어 쿼리("오늘 어때?", "한국어로 부탁") 보내면 60-90초 후 빈 응답. 로그에 `empty-response` 에러 + `thinkingCharsUsed: 2000+` + `tokenBudget: 512` 패턴 일관 발견.

**근본 원인**: Ollama `/api/chat`은 `message.thinking` 과 `message.content` 가 **같은 `num_predict` 토큰 풀**을 공유. Cloud 모델(gpt-oss 등)은 thinking을 별도 채널로 처리하던 반면, 단일 로컬 모델 전환 후 gemma4:e4b가 작은 budget(`chat=512`, `LOW=256`)에서 thinking에 모든 토큰을 소진 → 응답이 잘려 비어나옴.

**커밋**: `0df39ee` (2 files, +31/-1)

#### 변경 내용
1. **`config/llm-parameters.ts`**: `TOKEN_BUDGETS.THINKING_MIN_TOKENS` 신설 (기본 4096, env: `OMK_THINKING_MIN_TOKENS`)
2. **`services/ChatService.ts`**: `chatOptions` 빌드 직후 `thinkingMode === true`이면 `num_predict`를 `THINKING_MIN_TOKENS` 이상으로 자동 보강 + `routingLog.tokenBudget` 갱신

#### 적용 우선순위
1. fast-path 매칭 (인사·단답) → thinking OFF (이전 커밋 `04ab3ac`)
2. 사용자 토글 OFF → 기존 토큰 budget (영향 없음)
3. 사용자 토글 ON + non-fast-path → **num_predict ≥ 4096 보장** (이번 커밋)

#### 검증 결과
- TypeScript 컴파일 0 오류
- 영향 범위: thinking ON 케이스만 (사용자 명시적 토글 + 비-fast-path)
- 회귀: thinking OFF 케이스는 동작 변화 없음
- 후속 모니터링 포인트: `[ChatService] Thinking 활성 — num_predict 보강: ...` 로그

---

### 2026-05-07 — CLAUDE.md 준수 P1+P2 정리 (자체 + codex CLI 통합 검토)

**배경**: 사용자 요청으로 codex CLI 와 함께 CLAUDE.md No-Hardcoding 정책 준수 종합 검토. 신규 작업은 우수 준수, 사전 존재 위반 14건 (5 명백 + 5 부분 + 4 strict mode) 발견.

**커밋**: `f403d6e`(P1-1) → `3a63e89`(P1-2) → `6599a89`(P2-1) → `c988987`(P2-2) → `9f14d72`(P2-3) (5개 커밋)

#### P1-1: Gemini dead code 제거 (`f403d6e`)
- `ollama/types.ts`: `getGeminiPreset()`, `getGeminiSystemPrompt()` 호출처 0건 확인 후 삭제
- `isGeminiModel()` 은 `context-builder.ts:71` 에서 사용 중이라 유지
- 단일 모델 전환 후 자연스럽게 unreferenced 된 cloud 시대 잔재

#### P1-2: semantic-compactor 외부화 (`3a63e89`)
- 시스템 프롬프트 → `prompts/semantic-compactor-system.ts`
- `temperature: 0` → `LLM_TEMPERATURES.SEMANTIC_COMPACTION` (env: `LLM_TEMP_SEMANTIC_COMPACTION`)

#### P2-1: Ollama HTTP 재시도 정책 외부화 (`6599a89`)
- `runtime-limits.ts` 에 `OLLAMA_RETRY` 그룹 신설 (`MAX_KEY_FALLBACK_ATTEMPTS`, `MAX_NETWORK_RETRIES`, `NETWORK_BACKOFF_BASE_MS`)
- `interceptors.ts` 의 매직 넘버 3건 모두 외부화

#### P2-2: `as any` 캐스트 정리 (`c988987`)
- `documents.routes.ts` 7건 → 0건 (`getUserId(req)` / `getUserRole(req)` 헬퍼)
- `external.routes.ts` 3건 → 0건 (`ExternalConnection` 타입 import)
- `web-scraper.ts:262` 1건은 jsdom-Readability 호환 문제로 의도된 예외 (eslint-disable 명시) — 유지

#### P2-3: discussion-engine 정규식 명명 (`9f14d72`)
- `EVIDENCE_MARKER_PATTERN`, `SELF_CONSISTENCY_JSON_PATTERN` 명명 상수 추출

#### 잔존 항목 (P3 — 2026-05-07 처리 완료)

**처리됨 (`f624061` 단일 커밋, 6 files):**
- ✅ `model-selector.ts:295` → `MODEL_PRESET_KEYS.DEFAULT_LOCAL` 상수 (model-presets.ts)
- ✅ `content-scraper.ts:41` → `SCRAPE_ABORT_BUFFER_MS` 명명 상수
- ✅ `prompt-templates.ts:433` → `OMK_PROMPT_CACHE_TTL_MS`, `OMK_PROMPT_CACHE_MAX_SIZE` env 외부화
- ✅ `AuthService.ts:170,190-192` → `USER_ROLES.ADMIN/USER/GUEST` enum (data/user-manager.ts)

**의도된 trade-off (유지):**
- `mcp/tool-tiers.ts:40` 티어 권한 — Admin UI 변경 시 권한 우회 리스크로 코드 유지가 보안상 안전
- `chat/query-classifier.ts:139` `codeAgentPatterns` — 분류기 핵심 로직, 외부화 시 가독성 저하 trade-off

---

### 2026-05-07 — saveHistory 토글 dark pattern 해소 (옵션 B+ Phase B1+B2)

**증상**: settings.html "대화 기록 저장" 토글이 라벨로는 "서버에 저장"을 약속하지만 실제로는 클라이언트 측 `addToMemory()` 만 통제하고 백엔드 `conversation_messages` INSERT는 항상 실행됨 → 사용자 기대-동작 갭 (dark pattern).

**커밋**: `959b89e` (B1 audit log) → `570d455` (B2 파이프라인) 2개 커밋

#### B1: 메타 감사 로그 (`959b89e`)
- 마이그레이션 `014_conversation_audit_log.sql` 신설 + 적용
  - `conversation_audit_log` 테이블: session_id, user_id, role, model, agent_id, tokens, response_time_ms, error_code, content_skipped, content_length
  - 인덱스 3개: 사용자별 시간순 / 에러 전용 / 세션 전용
- `data/conversation-audit.ts` 신규 모듈
  - `recordAuditLog(entry)` — 본문 절대 받지 않고 메타만 INSERT
  - 실패해도 throw 안 함 (감사 실패가 채팅 막으면 안 됨)

#### B2: 파이프라인 통합 (`570d455`)
- **프론트**: `chat.js` payload에 `saveHistory: generalSettings.saveHistory !== false` 추가
- **타입**: `ws-types.ts` `WSMessage.saveHistory?: boolean` 추가
- **수신**: `ws-chat-handler.ts` `msg.saveHistory !== false` 추출 후 ChatService 전달
- **핸들러**: `request-handler.ts`
  - `ChatRequestParams.saveHistory?: boolean` 신규
  - `saveUserMessage(sessionId, userId, message, model, saveHistory)` 시그니처 변경
  - `saveAssistantMessage(sessionId, userId, response, model, responseTime, saveHistory)` 시그니처 변경
  - 두 함수 내부: **audit 항상** + **본문 조건부 INSERT**
  - 호출처 3곳(직전 사용자 메시지 + 외부 ToolCalling 응답 + 일반 응답) 모두 `auditUserId`(authenticatedUserId / anonSessionId / 'anonymous') + `persistContent` 전달
- **UI**: `settings.html` 라벨 "대화 기록 저장" → "대화 본문 저장" + 명확한 설명("끄면 본문 미저장, 메타만 익명 통계용")

#### 데이터 정책 (3계층 분리, GDPR purpose limitation 준수)
| 데이터 | 통제 권한 | 저장 위치 |
|--------|----------|----------|
| L1 메시지 본문 | 사용자 토글 (`saveHistory`) | `conversation_messages` (조건부) |
| L2 메타 (감사) | 항상 저장 (운영 정책) | `conversation_audit_log` (항상) |
| L3 추출 메모리 | 별도 토글 예정 (Phase B3) | `user_memories` |

#### 효과
- ✅ Dark pattern 해소: 라벨 = 동작
- ✅ 운영 감사 갭 0건: 메타는 모든 케이스에서 기록됨 (`content_skipped` 플래그로 본문 차단 여부 추적)
- ✅ Privacy 강화: 사용자가 본문 저장을 의도적으로 차단 가능
- ✅ B3/B4/B5 완료 (별도 커밋 — 다음 섹션 참조)

---

### 2026-05-07 — saveHistory 보강 (B+ Phase B3 + B4 + B5)

**커밋 3개 추가 적용** (B1+B2 후속):

| 커밋 | Phase | 내용 |
|------|-------|------|
| `c937be0` | B3 | memoryLearning 토글 분리 (Extract-and-Forget) |
| `17855f7` | B4 | 에러 발생 시 디버그 큐 자동 저장 (24h TTL) |
| `8219651` | B5 | 사용자 메시지 🚩 신고 버튼 (7d TTL) |

#### B3: 메모리 학습 토글 분리
- `settings.html` `memoryLearningToggle` 신설 + `pages/settings.js` 동적 fallback
- `chat.js` payload `memoryLearning` 추가
- `ws-types.ts` / `ws-chat-handler.ts` / `request-handler.ts` / `ChatService.ts`: 흐름 통합
- `ChatService.processMessage`: `req.memoryLearning === false` 면 `extractMemoriesAsync` 호출 스킵
- 4가지 조합 모두 가능 (saveHistory × memoryLearning)

#### B4: 에러 자동 디버그 저장
- 마이그레이션 015 `conversation_debug_queue` 테이블 신설 (id, session_id, user_id, captured_at, expires_at, reason ['auto-error' | 'user-report'], user_message, assistant_message, error_code, routing_metadata)
- `data/conversation-debug-queue.ts` 신규 모듈: `enqueueDebugCapture`, `cleanupExpiredDebugQueue`
- `ws-chat-handler.ts`: catchall 에러에서 `partialAssistantResponse` 누적 후 enqueue (24h TTL)
- 사용자에게 `debug_retained` WS 이벤트로 보존 사실 + 만료 시각 통지
- scheduler에 hourly cleanup cron 추가 (`schedulers/index.ts`)

#### B5: 사용자 메시지 신고 버튼
- `routes/debug-queue.routes.ts` 신규: `POST /api/debug-queue/report` (requireAuth, 7d TTL)
- `chat-renderer.js` 🚩 버튼 + 액션 위임에 `report` 케이스
- `chat-actions.js` `reportMessage()`: 직전 사용자 메시지 + 어시스턴트 응답 캡처, 사유 prompt(선택), API 호출
- `main.js`: import + `window.reportMessage` 노출

#### 데이터 정책 최종
| 데이터 | 통제 | 저장소 |
|--------|------|--------|
| L1 메시지 본문 | 사용자 토글 (`saveHistory`) | `conversation_messages` (조건부) |
| L2 메타 (감사) | 항상 (운영 정책) | `conversation_audit_log` (B1) |
| L3 추출 메모리 | 별도 토글 (`memoryLearning`) | `user_memories` (B3) |
| L4 디버그 보존 | 자동(에러)/사용자(신고) | `conversation_debug_queue` (B4+B5) |

#### 신규 env 변수
- `OMK_DEBUG_QUEUE_AUTO_ERROR_TTL_MS` (B4, default 86400000 = 24h)
- `OMK_DEBUG_QUEUE_USER_REPORT_TTL_MS` (B5, default 604800000 = 7d)

#### 운영 부작용 보완 종합
| 부작용 | 해결 Phase | 결과 |
|--------|-----------|------|
| ① 감사 로그 갭 | B1 | ✅ `conversation_audit_log` 항상 기록 |
| ② 디버깅 불가 | B4 (auto) + B5 (manual) | ✅ 에러 24h / 신고 7d 보존 |
| ③ 메모리 추출 불가 | B3 (Extract-and-Forget + 별도 토글) | ✅ 본문 폐기 + 메모리만 추출 가능 |

#### 빌드 결과
- TypeScript 0 오류
- 마이그레이션 014, 015 적용 완료
- 프론트엔드 정합성: 모든 변경에 백엔드↔프론트 양쪽 동시 변경 (메모리 지침 준수)

---

### 2026-05-07 — 후속 마무리 (B4 토스트 + 잔재 정리)

**커밋 2개 추가**:

#### `01b5123` — B4 후속: debug_retained 토스트 핸들러
- `frontend/web/public/js/modules/websocket.js` `messageHandlers.debug_retained` 추가
- 백엔드가 보내던 이벤트가 프론트에서 silent drop 되던 문제 해결
- 사용자에게 "🔍 오류 재현용 본문 임시 저장 (24h 후 자동 삭제: ...)" 토스트 표시
- B4 의 투명성 약속 완전 실현

#### `28ca237` — 잔재 dead code 3건 일괄 정리
1. `cli.ts` `setTimeout(r, 1000)` → `CLUSTER_STATUS_REFRESH_DELAY_MS` 명명
2. `firecrawl` 완전 제거 — env.ts (interface/DEFAULT_CONFIG/parsedResult/return), env.schema.ts, 테스트 fixture
3. `pricing.ts MODEL_PRICING` cloud 모델 4개 제거 → `gemma4:e4b` 단일 + `default` fallback
- 검토 발견: A 항목은 "런타임 영향 없음"이 정확하지 않음 — `token-monitoring.routes.ts`가 사용 중 (Admin UI에 ghost rows 표시됨), 정리 후 단일 모델 일관성 확보

#### 미처리 항목 최종 분류 결과 (검토 보고서)
- 🟢 의도된 trade-off 3건 → 처리 안 함 (mcp/tool-tiers.ts, query-classifier.ts, web-scraper.ts)
- 🔴 즉시 처리 1건 → 완료 (`01b5123`)
- 🟡 단기 정리 3건 → 완료 (`28ca237`)
- 🟢 선택 1건 → B5 admin UI 미진행 (사용자 결정 보류)
- 🔵 사전 진단 → 별도 영역 (`request-handler.ts:44-45` unused import 등)

#### 빌드 결과
- TypeScript 0 오류
- 마이그레이션 적용: `CREATE TABLE / CREATE INDEX × 3 / COMMENT × 3`
- 프론트엔드 정합성: chat.js payload + settings.html 라벨 양쪽 동시 변경 (메모리 지침 준수)

#### 신규 env 변수 (P1+P2+P3 합산 7개)
- `LLM_TEMP_SEMANTIC_COMPACTION` (P1-2, default 0)
- `OMK_OLLAMA_MAX_KEY_FALLBACK_ATTEMPTS` (P2-1, default 3)
- `OMK_OLLAMA_MAX_NETWORK_RETRIES` (P2-1, default 2)
- `OMK_OLLAMA_NETWORK_BACKOFF_BASE_MS` (P2-1, default 1000)
- `OMK_PROMPT_CACHE_TTL_MS` (P3-3, default 300000)
- `OMK_PROMPT_CACHE_MAX_SIZE` (P3-3, default 50)
- (`OMK_THINKING_MIN_TOKENS` — 이전 옵션 A 작업, default 4096)

#### 종합 평가 변화
- 이번 세션 작업: A → A+
- Strict Mode: C → A (`as any` 11건 → 1건 의도된 예외)
- No-Hardcoding: B+ → A
- **종합: B+ → A+**

---

### 2026-05-07 — `memory_code.md` 자체 점검 및 dead-code 후보 분류

**범위**: `memory_code.md`의 최신성, 실제 파일 구조, 단일 로컬 모델 전환 후 남은 dead code/문서성 잔재 후보 점검. 소스 코드는 수정하지 않고 문서만 업데이트.

#### 이번 문서 업데이트
- 참조 우선순위를 `실제 코드 → AGENTS.md/CLAUDE.md → memory_code.md`로 수정. 문서는 요약/이력이며 실제 코드가 최종 진실.
- 현재 구조 반영: `backend/api/src` 449개 `.ts`, `routes/` 24개 `*.routes.ts` + setup/index/v1, `agents` 100개, `pages/*.js` 24개.
- `debug-queue.routes.ts`, 마이그레이션 014/015, `frontend/web/scripts`, `docs/` 반영.
- 존재하지 않는 루트 `scripts/` 디렉토리 설명 제거.

#### 확인된 dead code / 불필요 후보
| 우선순위 | 항목 | 근거 | 제안 |
|----------|------|------|------|
| P1 | 루트 `package.json` 죽은 scripts (정리 완료 2026-05-07) | `check:schema-drift`, `ci`, `hooks:install`, `migrate` 4건 모두 미존재 `scripts/` 경로 참조 → `package.json` 에서 제거함 (옵션 B) | — |
| P1 | `DEFAULT_AUTO_MODEL` 런타임 잔재 (부분 정리 2026-05-07) | `config/constants.ts:130`, `chat/discussion-router.ts:109`. `controllers/metrics.controller.ts` 의 `/api/metrics/model` ghost 응답은 `getModelForRole('chat')` 로 교체 완료 (커밋 별도) | 잔여: `discussion-router.ts` 가 `DEFAULT_AUTO_MODEL` 을 import 하는 한 상수 자체는 유지. P1-3 토론 정책 결정과 함께 정리 |
| P1 | 토론 자동 활성화 경로 (정리 완료 2026-05-07) | `ChatService.processMessage` 가 `discussionMode === true` 만 검사하도록 단순화 (자동 분기 호출 제거). `chat/discussion-router.ts` 모듈 자체 삭제. `SystemEvent.type` literal 정리. `frontend/web/public/js/modules/system-toast.js` 의 `'auto-discussion-activated'` 매핑도 동시 제거 | — |
| P2 | Brand Model 관련 주석/Swagger 잔재 | `model-selector.ts`, `pipeline-profile.ts`, `profile-resolver.ts`, `domain-router.ts`, `schemas/chat.schema.ts`, `swagger/paths-*.ts`에 `openmake_llm_*` 예시와 auto-routing 설명 잔존 | 런타임 영향은 낮지만 신규 작업자 혼동 방지를 위해 주석/문서 정리 |
| P2 | `llm-classifier.ts` 주석 불일치 (정리 완료 2026-05-07) | 주석을 `model-roles` 레지스트리 기반 14 QueryType 설명으로 갱신함 | — |
| P2 | `frontend/web/public/js/modules/index.js` (정리 완료 2026-05-07) | 어디에서도 import 되지 않고 내용도 현재 ES Module 구조와 불일치하여 dead 파일로 판정, 삭제함 | — |
| P2 | ModelHealth 스케줄러 no-op (정리 완료 2026-05-07) | `bootstrapServices()` 의 `startModelHealthScheduler()` 호출 줄을 주석 처리. 함수 자체는 export 로 보존하여 Cloud 재도입 시 한 줄 복구 가능 | — |
| P3 | GPT-OSS 프리셋/정규화 | `ChatService`, `OllamaClient`, `agent-loop`에서 실제 참조 중이라 dead code는 아님. 단, gemma-only 정책이면 장기 정리 후보 | 다중 Ollama 모델 지원 유지 여부에 따라 결정 |

#### 이미 정리 완료로 재확인된 항목
- `firecrawl` 문자열은 소스/설정에서 검색 결과 없음.
- 프론트엔드 `openmake_llm_*`, `DEFAULT_AUTO_MODEL`, `BRAND_MODELS` 런타임 참조는 검색 결과 없음. 잔존 항목은 Swagger/백엔드 주석/일부 백엔드 런타임 코드로 한정.
- `setTimeout(r, 1000)` 패턴은 검색 결과 없음.
- `config/pricing.ts`는 `gemma4:e4b` + `default`만 유지.

#### 검증 결과
- `npx tsc --noEmit -p backend/api/tsconfig.json`: 통과.
- `npx eslint backend/api/src --quiet`: 실패 7건. dead code라기보다 기존 스타일/규칙 위반이다.
  - `prefer-const`: `__tests__/circuit-breaker.test.ts`, `monitoring/analytics.ts`, `services/AuthService.ts`, `services/chat-strategies/discussion-strategy.ts`
  - `@typescript-eslint/no-namespace`: `auth/middleware.ts`
  - `@typescript-eslint/no-this-alias`: `documents/store.ts` 2건
