# OpenMake LLM - 소스 전체 분석 보고서

> 분석일: 2026-03-03  
> 버전: 1.6.0 (13주 개선·고도화 완료)  
> 분석 범위: 프론트엔드, 백엔드, DBA 설계 구조 전체

---

## 1. 프로젝트 개요

**OpenMake LLM**은 프라이버시 우선, 셀프 호스팅 AI 어시스턴트 플랫폼이다. 멀티 모델 오케스트레이션을 통해 7개 브랜드 프로파일(Default, Pro, Fast, Think, Code, Vision, Auto)로 사용자 쿼리를 분류·라우팅하여 최적의 LLM에 전달한다.

### 기술 스택 요약

| 계층 | 기술 |
|------|------|
| 런타임 | Node.js >= 18, Bun (테스트) |
| 백엔드 프레임워크 | Express 5.2.1 + TypeScript 5.3 |
| 데이터베이스 | PostgreSQL >= 14 (pg 8.18.0, pgvector) |
| 프론트엔드 | Vanilla JavaScript (ES Modules, SPA Router) |
| WebSocket | ws 8.18.3 (실시간 스트리밍) |
| 인증 | JWT (HttpOnly Cookie) + Google OAuth 2.0 + API Key HMAC-SHA-256 |
| LLM 연동 | Ollama (로컬/클라우드) + API Key Pool 라운드로빈 |
| MCP | @modelcontextprotocol/sdk 1.25.3 |
| 테스트 | Bun Test (69 유닛), Playwright (E2E) |

### 코드베이스 규모

| 구분 | 파일 수 | 라인 수 |
|------|---------|---------|
| 백엔드 소스 (TypeScript) | 241 | ~59,300 |
| 백엔드 테스트 | 69 | ~21,575 (69 test suites) |
| 프론트엔드 JS (커스텀) | 48 | ~14,850 |
| 프론트엔드 HTML 페이지 | 23 | - |
| 프론트엔드 CSS | 13 | ~6,622 |
| DB 스키마 (SQL) | 9 | ~1,097 |
| 에이전트 프롬프트 (MD) | 115 | - |
| **합계** | **~520+** | **~103,000+** |

---

## 2. 디렉토리 구조

```
openmake_llm/
├── backend/
│   ├── api/                          # Express + TypeScript API 서버
│   │   ├── src/                      # 소스 코드 (35개 하위 디렉토리)
│   │   │   ├── agents/               # 에이전트 시스템 (17개 산업별 에이전트)
│   │   │   ├── auth/                 # 인증/인가 (JWT, OAuth, API Key, BOLA ownership)
│   │   │   ├── cache/                # 인메모리 캐시
│   │   │   ├── chat/                 # 채팅 파이프라인 (분류, 라우팅, 프롬프트)
│   │   │   ├── cli.ts                # CLI 엔트리포인트 (11개 커맨드)
│   │   │   ├── cluster/              # 멀티 프로세스 클러스터 관리
│   │   │   ├── commands/             # CLI 커맨드 (explain, generate, review)
│   │   │   ├── config/               # 환경 설정, 모델 기본값, 가격, 타임아웃
│   │   │   ├── controllers/          # HTTP 컨트롤러 (7개)
│   │   │   ├── data/                 # 데이터 계층 (모델, 리포지토리, 마이그레이션)
│   │   │   ├── documents/            # 문서 처리 (청킹, OCR, 진행률)
│   │   │   ├── errors/               # 커스텀 에러 클래스 (4개)
│   │   │   ├── i18n/                 # 국제화 (검색 로케일)
│   │   │   ├── mcp/                  # Model Context Protocol (10개 내장 도구)
│   │   │   ├── middlewares/          # 미들웨어 (인증, 레이트 리밋, 밸리데이션)
│   │   │   ├── monitoring/           # 모니터링 (알림, 분석, 메트릭)
│   │   │   ├── ollama/               # Ollama 클라이언트 (API Key Pool, 에이전트 루프)
│   │   │   ├── plugins/              # 플러그인 시스템 (로더, 레지스트리)
│   │   │   ├── routes/               # 라우트 모듈 (26개)
│   │   │   ├── schemas/              # Zod 밸리데이션 스키마 (16개)
│   │   │   ├── server.ts             # Express 서버 엔트리포인트
│   │   │   ├── services/             # 비즈니스 서비스 (Chat, RAG, Reranker, OCR, OpenAI Compat 등)
│   │   │   ├── sockets/              # WebSocket 핸들러 (채팅 스트리밍)
│   │   │   ├── types/                # TypeScript 타입 정의
│   │   │   ├── ui/                   # CLI UI (배너, 하이라이트, 스피너)
│   │   │   ├── utils/                # 유틸리티 (로거, 에러 핸들러, 새니타이저)
│   │   │   ├── security/             # 보안 (SSRF Guard)
│   │   │   ├── observability/        # 관측성 (OpenTelemetry)
│   │   │   └── __tests__/            # 유닛 테스트 (69개 파일)
│   │   ├── dist/                     # 컴파일된 프로덕션 코드
│   │   ├── package.json              # 백엔드 의존성 (57개 패키지, @opentelemetry 8개 포함)
│   │   └── tsconfig.json             # TypeScript 설정
│   ├── uploads/                      # 파일 업로드 저장소
│   └── workers/
│       └── scheduled-jobs/           # 예약 작업 (미구현 예약)
│
├── frontend/
│   └── web/
│       ├── public/                   # 정적 프론트엔드 자산
│       │   ├── index.html            # 메인 SPA 엔트리
│       │   ├── *.html                # 23개 페이지 HTML
│       │   ├── css/                  # 스타일시트 (13개 파일)
│       │   ├── js/                   # JavaScript 모듈
│       │   │   ├── main.js           # 앱 초기화
│       │   │   ├── spa-router.js     # SPA 라우터
│       │   │   ├── components/       # 재사용 컴포넌트 (3개)
│       │   │   ├── modules/          # 핵심 모듈 (20개)
│       │   │   └── modules/pages/    # 페이지별 모듈 (21개)
│       │   ├── icons/                # PWA 아이콘 (10개 해상도)
│       │   ├── images/               # 이미지 자산
│       │   ├── vendor/               # 서드파티 라이브러리 (Mermaid, KaTeX, DOMPurify, Marked, hljs, Iconify, Pretendard)
│       │   └── docs/                 # 사용자 가이드
│       ├── scripts/                  # 빌드 스크립트
│       └── package.json              # 프론트엔드 의존성
│
├── services/
│   └── database/
│       ├── init/                     # DB 초기화 SQL
│       │   ├── 001-extensions.sql    # PostgreSQL 확장 (pgvector, pg_trgm)
│       │   ├── 002-schema.sql        # 전체 스키마 정의 (712줄)
│       │   ├── 003-seed.sql          # 시드 데이터
│       │   └── SCHEMA_SOURCE_OF_TRUTH.md
│       └── migrations/               # DB 마이그레이션 (6개)
│           ├── 000_migration_versions.sql  # 마이그레이션 버전 테이블
│           ├── 001_baseline.sql            # 베이스라인
│           ├── 002_vector_type_migration.sql  # TEXT → vector(768) 전환
│           ├── 003_hybrid_search_fts.sql   # BM25/FTS tsvector 추가
│           ├── 004_hnsw_index.sql          # IVFFlat → HNSW 인덱스 전환
│           └── 005_kb_nm_schema.sql        # N:M Knowledge Base 스키마
│
├── data/                             # 런타임 데이터 디렉토리
├── scripts/                          # 운영 스크립트
│   ├── ci-test.sh                    # CI 게이트 스크립트 (Test→Build→Lint)
│   ├── run-migrations.ts             # DB 마이그레이션 자동 실행기
│   ├── eval-rag.ts                   # RAGAs 평가 루프 스크립트
│   ├── deploy-frontend.sh            # 프론트엔드 배포
│   ├── check-schema-drift.sh         # 스키마 드리프트 검사
│   ├── install-hooks.sh              # Git 훅 설치
│   └── hooks/pre-push                # pre-push Git 훅 (CI 게이트 실행)
├── tests/
│   └── e2e/                          # E2E 테스트
│       └── main-flow.spec.ts
│
├── .github/
│   └── workflows/
│       └── ci.yml                    # GitHub Actions CI (3게이트: Test→Build→Lint)
│
├── ecosystem.config.js               # PM2 프로세스 관리
├── package.json                      # 루트 워크스페이스 설정
├── playwright.config.ts              # E2E 테스트 설정
└── jest.config.js                    # 유닛 테스트 설정
```

---

## 3. 백엔드 아키텍처 분석

### 3.1 계층 구조 (Layered Architecture)

```
┌─────────────────────────────────────────────────────────┐
│                  CLI (cli.ts, commands/)                 │
│         11개 커맨드: chat, ask, review, generate 등       │
├─────────────────────────────────────────────────────────┤
│              Routes (26개 라우트 모듈)                    │
│  chat, agents, auth, documents, memory, mcp, research,  │
│  kb, openai-compat, rag, skills, web-search 등          │
├─────────────────────────────────────────────────────────┤
│            Controllers (7개 컨트롤러)                    │
│   admin, auth, cluster, health, metrics, session        │
├─────────────────────────────────────────────────────────┤
│         Middlewares (8개 미들웨어)                        │
│   api-key-auth, rate-limiter, validation, request-id    │
├─────────────────────────────────────────────────────────┤
│               Schemas (Zod 밸리데이션)                   │
│       16개 스키마: chat, auth, agents, mcp 등             │
├─────────────────────────────────────────────────────────┤
│            Services (비즈니스 로직)                       │
│  ChatService, DeepResearchService, MemoryService,       │
│  EmbeddingService, RAGService, Reranker, OCRQualityGate,│
│  OpenAICompatService, ApiKeyService, PushService        │
├─────────────────────────────────────────────────────────┤
│          Data Layer (Repository 패턴)                    │
│   13개 리포지토리 + UnifiedDatabase 싱글턴               │
├─────────────────────────────────────────────────────────┤
│               PostgreSQL (pg Pool)                       │
└─────────────────────────────────────────────────────────┘
```

### 3.2 엔트리포인트

| 파일 | 용도 | 실행 방법 |
|------|------|-----------|
| `server.ts` | Express HTTP 서버 시작 | `npm start` |
| `cli.ts` | CLI 인터페이스 + 클러스터 모드 | `node dist/cli.js cluster --port 52416` |
| `bootstrap.ts` | 앱 초기화 (DB, 미들웨어, 라우트) | server.ts에서 호출 |

### 3.3 라우트 모듈 (26개)

| 라우트 파일 | 경로 | 기능 |
|-------------|------|------|
| `chat.routes.ts` | `/api/chat/*` | 채팅 메시지 CRUD, 세션 관리 |
| `agents.routes.ts` | `/api/agents/*` | 에이전트 목록, 커스텀 에이전트 CRUD |
| `agents-monitoring.routes.ts` | `/api/agents/monitoring/*` | 에이전트 성능 모니터링 |
| `api-keys.routes.ts` | `/api/api-keys/*` | API 키 발급, 관리, 폐기 |
| `audit.routes.ts` | `/api/audit/*` | 감사 로그 조회 |
| `chat-feedback.routes.ts` | `/api/feedback/*` | 채팅 피드백 (thumbs up/down) |
| `developer-docs.routes.ts` | `/docs/*` | Swagger API 문서 |
| `documents.routes.ts` | `/api/documents/*` | 문서 업로드, 처리, RAG |
| `external.routes.ts` | `/api/external/*` | 외부 서비스 연동 (Google Drive, Notion 등) |
| `mcp.routes.ts` | `/api/mcp/*` | MCP 도구 관리 |
| `memory.routes.ts` | `/api/memory/*` | 장기 메모리 CRUD |
| `metrics.routes.ts` | `/api/metrics/*` | 시스템 메트릭 |
| `model.routes.ts` | `/api/models/*` | 모델 목록, 선택 |
| `nodes.routes.ts` | `/api/nodes/*` | 클러스터 노드 관리 |
| `push.routes.ts` | `/api/push/*` | 웹 푸시 알림 |
| `rag.routes.ts` | `/api/rag/*` | RAG (Retrieval Augmented Generation) |
| `research.routes.ts` | `/api/research/*` | 심층 연구 세션 |
| `skills.routes.ts` | `/api/skills/*` | 에이전트 스킬 라이브러리 |
| `token-monitoring.routes.ts` | `/api/tokens/*` | 토큰 사용량 모니터링 |
| `usage.routes.ts` | `/api/usage/*` | API 사용량 통계 |
| `web-search.routes.ts` | `/api/search/*` | 웹 검색 |
| `v1/index.ts` | `/api/v1/*` | API v1 버전 라우트 |
| `openai-compat.routes.ts` | `/v1/chat/completions` | OpenAI Compatible API |
| `kb.routes.ts` | `/api/kb/*` | N:M Knowledge Base 컨렉션 관리 |
| `setup.ts` | `/docs/*` | Swagger UI 설정 |

### 3.4 핵심 서비스

#### ChatService (채팅 파이프라인)

```
사용자 메시지 → QueryClassifier(9타입) → ProfileResolver → ModelSelector
                                                              ↓
                                  ChatStrategy 선택 (5가지 전략)
                                  ├── DirectStrategy        (일반 채팅)
                                  ├── AgentLoopStrategy     (도구 호출 루프)
                                  ├── DiscussionStrategy    (멀티 모델 토론)
                                  ├── A2AStrategy           (에이전트 간 병렬 생성)
                                  └── DeepResearchStrategy  (자율 심층 연구)
                                              ↓
                                  OllamaClient → LLM 응답 스트리밍
```

- **쿼리 분류**: 9개 타입 (code, math, creative, analysis, document, vision, translation, korean, chat)
- **시맨틱 캐시**: 2계층 — L1 정확 매칭 (O(1)), L2 코사인 유사도 (nomic-embed-text 768d)
- **프로파일**: 7개 브랜드 프로파일 (Default, Pro, Fast, Think, Code, Vision, Auto)

#### DeepResearchService (자율 심층 연구)

다단계 자율 연구를 수행한다. 사용자 토픽을 받아 하위 질문 생성 → 웹 검색 → 요약 → 핵심 발견 도출의 루프를 실행한다. 진행률은 WebSocket을 통해 실시간 스트리밍된다.

#### MemoryService (장기 메모리)

사용자별 장기 메모리를 6개 카테고리(preference, fact, project, relationship, skill, context)로 저장·검색한다. 중요도 점수와 접근 빈도로 관련 메모리를 검색하여 컨텍스트에 주입한다.

#### EmbeddingService (임베딩)

nomic-embed-text 모델을 사용하여 768차원 벡터 임베딩을 생성한다. 싱글톤 패턴으로 운영되며, RAG와 시맨틱 캐시의 핵심 의존성이다.

#### RAGService (RAG 파이프라인)

하이브리드 검색 파이프라인: 벡터 유사도 검색 + BM25/FTS 렉시컬 검색 → RRF(Reciprocal Rank Fusion) 병합 → Cross-encoder Reranking → 컨텍스트 주입. OCR Quality Gate로 문서 품질 검증 후 처리한다.

- **Hybrid Search**: 벡터 검색(pgvector cosine) + BM25/FTS(tsvector ts_rank) 병행 → RRF 점수 통합
- **Reranker**: Cross-encoder 모델 기반 재순위화 (Top-K 선별 후 정밀 재랜킹)
- **OCR Quality Gate**: OCR 추출 텍스트 품질 점수화 → 임계값 미달 시 거부
- **Batch INSERT**: 대량 청크 일괄 삽입 (INSERT 성능 최적화)
- **RAGAs 평가**: `scripts/eval-rag.ts` — faithfulness, context_recall, answer_relevancy 메트릭

#### OpenAICompatService (OpenAI Compatible API)

OpenAI 호환 REST API (`/v1/chat/completions`)를 제공하여 외부 클라이언트(Cursor, Continue 등)와 호환된다. 스트리밍/비스트리밍 모드 모두 지원.

### 3.5 에이전트 시스템

**17개 산업별 에이전트**가 키워드 라우터 + 토픽 분석기로 디스패치된다.

| 분류 | 산업 에이전트 |
|------|---------------|
| 일반 | assistant, coder, researcher, writer, translator, explainer, reviewer, generator, reasoning |
| 기술 | frontend, backend, db, devops, security, uiux, data-science |
| 산업 | 농업, 의료, 교육, 금융, 법률, 물류, 에너지, 부동산, 미디어, 엔지니어링, 과학, 정부, 기술, 호텔, 비즈니스, 특수, 크리에이티브 |

**에이전트 기능:**
- **커스텀 에이전트 빌더**: 사용자가 직접 에이전트 생성 (시스템 프롬프트, 키워드, 온도 설정)
- **토론 모드(Discussion Engine)**: 멀티 모델 토론 (추천자가 참여 모델 선정)
- **A2A 병렬 생성**: 여러 에이전트가 동시 응답 생성
- **스킬 시스템**: 에이전트에 스킬 할당·관리 (스킬 라이브러리)
- **학습(Learning)**: 에이전트 성능 메트릭 기반 자동 튜닝

### 3.7 보안 계층 (Security Layer)

#### SSRF Guard (`security/ssrf-guard.ts`)

서버사이드 요청 위조(SSRF) 방어. 내부 IP 대역(10.x, 172.16-31.x, 192.168.x, 127.x, ::1)을 차단하고, URL 유효성 검증 후에만 외부 HTTP 요청을 허용한다.

- **적용 대상**: `mcp/web-search.ts`, `mcp/firecrawl.ts`, `utils/firecrawl-client.ts`
- **방어 방식**: Private IP 범위 검사, URL 파싱 검증, DNS Rebinding 방어

#### BOLA (Broken Object Level Authorization) (`auth/ownership.ts`)

객체 수준 접근 제어. 리소스 소유자 또는 관리자만 해당 리소스에 접근 가능하도록 2계층 방어를 적용한다.

- **Route-level**: 5개 라우트 (research, kb, skills, external, memory)에서 `assertResourceOwnerOrAdmin()` 호출
- **Repository-level**: feedback, audit, skill 리포지토리에서 `userId` 필터링
- **예외**: 시스템 스킬(createdBy=null)은 ownership 검사 대상 제외

### 3.8 관측성 (Observability)

#### OpenTelemetry (`observability/otel.ts`)

- **패키지**: 8개 @opentelemetry 의존성 (api, sdk-node, exporter-trace-otlp-http, instrumentation-express, instrumentation-http, resources, sdk-trace-node, semantic-conventions)
- **샘플링**: 10% 비율 (M4 16GB 리소스 고려)
- **내보내기**: stdout/file + OTLP HTTP (Jaeger 선택적)
- **자동 계측**: HTTP, Express 미들웨어 자동 계측 (auto-instrumentation)
- **커스텀 Span**: DB, WebSocket, LLM 호출에 대한 커스텀 span 헬퍼
### 3.9 MCP (Model Context Protocol) 도구

10개 내장 도구를 3등급(Free/Pro/Enterprise)으로 접근 제어한다.

| 카테고리 | 도구명 | Free | Pro | Enterprise |
|----------|--------|:----:|:---:|:----------:|
| 비전 | `vision_ocr` | O | O | O |
| 비전 | `analyze_image` | O | O | O |
| 웹 검색 | `web_search` | O | O | O |
| 웹 검색 | `fact_check` | - | - | O |
| 웹 검색 | `extract_webpage` | - | - | O |
| 웹 검색 | `research_topic` | - | - | O |
| 스크래핑 | `firecrawl_scrape` | - | O | O |
| 스크래핑 | `firecrawl_search` | - | O | O |
| 스크래핑 | `firecrawl_map` | - | O | O |
| 스크래핑 | `firecrawl_crawl` | - | O | O |

**MCP 아키텍처:**
- `ToolRouter`: 내장 도구 + 외부 도구 통합 라우팅 (`::` 네임스페이스)
- `UnifiedMCPClient`: 싱글톤 — MCPServer + ToolRouter + ServerRegistry 통합
- `ExternalMCPClient`: 외부 MCP 서버 연결 (stdio/SSE 전송)
- `UserSandbox`: 사용자 데이터 격리
- `sequential_thinking`: 도구가 아닌 프롬프트 인젝션으로 구현

### 3.10 인증 시스템

```
┌─────────────────────────────────────────────┐
│               인증 계층                      │
│                                             │
│  JWT Access Token (HttpOnly Cookie)         │
│  ├── Access Token: 15분 만료               │
│  ├── Refresh Token: 7일 만료               │
│  └── Token Blacklist (DB 영속화)           │
│                                             │
│  Google OAuth 2.0 SSO                       │
│  ├── CSRF 방어 (oauth_states 테이블)       │
│  └── 자동 사용자 생성/연결                  │
│                                             │
│  API Key (HMAC-SHA-256)                     │
│  ├── Scope 기반 접근 제어 (["*"])          │
│  ├── Rate Limit Tier (free~enterprise)     │
│  └── 모델 제한 (allowed_models)            │
│                                             │
│  RBAC: admin / user / guest                 │
└─────────────────────────────────────────────┘
```

### 3.11 Ollama Cloud API Key Pool

```
OLLAMA_API_KEY_1~N (공유 풀) → ApiKeyManager (싱글톤)
                                 ├── 라운드로빈 순환
                                 ├── 429 에러 시 5분 쿨다운
                                 └── 자동 키 교체

OMK_ENGINE_LLM   = gpt-oss:120b-cloud     ─┐
OMK_ENGINE_PRO   = qwen3.5:397b-cloud      │ 모델 선택 (키와 독립)
OMK_ENGINE_FAST  = gemini-3-flash:cloud     │
OMK_ENGINE_THINK = gpt-oss:120b-cloud       │
OMK_ENGINE_CODE  = glm-5:cloud             ─┘
```

### 3.12 실시간 통신 (WebSocket)

- `ws-chat-handler.ts`: 채팅 메시지 수신 → ChatService 호출 → 스트리밍 응답
- `ws-auth.ts`: WebSocket 연결 시 JWT 인증
- `handler.ts`: WebSocket 이벤트 라우팅 (ping, chat, status)
- 지원 이벤트: `chat_message`, `chat_stream`, `typing_indicator`, `connection_status`

### 3.13 클러스터 관리

- `ClusterManager`: 멀티 프로세스 클러스터 관리 (master/worker)
- `CircuitBreaker`: 장애 감지 및 자동 차단
- `MultiClient`: 멀티 노드 Ollama 클라이언트 관리
- 설정: `ecosystem.config.js`로 PM2 프로세스 관리

### 3.14 에러 처리

4개 커스텀 에러 클래스:

| 에러 | 용도 |
|------|------|
| `AllNodesFailedError` | 모든 클러스터 노드 장애 |
| `CircuitOpenError` | 서킷 브레이커 Open 상태 |
| `KeyExhaustionError` | API 키 풀 소진 |
| `QuotaExceededError` | 사용량 할당 초과 |

---

## 4. 프론트엔드 아키텍처 분석

### 4.1 기술 스택

- **프레임워크 없음**: Vanilla JavaScript + ES Modules
- **번들러 없음**: `<script type="module">` 직접 로드
- **SPA Router**: 커스텀 라우터 (`spa-router.js`)
- **스타일링**: CSS 변수 (Design Tokens) + 다크/라이트 테마
- **빌드 검증**: `scripts/validate-modules.sh` (ES Module 정합성 자동 검증)
- **의존성**: axios (HTTP), Vite (개발 서버)

### 4.2 페이지 구성 (23개)

| 페이지 | HTML | JS 모듈 | 기능 |
|--------|------|---------|------|
| 메인 채팅 | `index.html` | `main.js` | AI 채팅 인터페이스 |
| 로그인 | `login.html` | `auth.js` | 인증 |
| 설정 | `settings.html` | `settings-standalone.js` | MCP 도구, AI 모델 설정 |
| 관리자 대시보드 | `admin.html` | `pages/admin.js` | 사용자/시스템 관리 |
| 관리자 메트릭 | `admin-metrics.html` | `pages/admin-metrics.js` | 시스템 성능 메트릭 |
| 에이전트 학습 | `agent-learning.html` | `pages/agent-learning.js` | 에이전트 성능 모니터링 |
| 알림 | `alerts.html` | `pages/alerts.js` | 시스템 알림 |
| 분석 | `analytics.html` | `pages/analytics.js` | 사용 분석 대시보드 |
| API 키 관리 | `api-keys.html` | `pages/api-keys.js` | API 키 발급/관리 |
| 감사 로그 | `audit.html` | `pages/audit.js` | 감사 기록 조회 |
| 클러스터 | `cluster.html` | `pages/cluster.js` | 클러스터 노드 관리 |
| 커스텀 에이전트 | `custom-agents.html` | `pages/custom-agents.js` | 에이전트 생성/편집 |
| 개발자 | `developer.html` | `pages/developer.js` | API 문서/테스트 |
| 문서 | `documents.html` | `pages/documents.js` | 문서 업로드/관리 |
| 외부 연동 | `external.html` | `pages/external.js` | 외부 서비스 연결 |
| 가이드 | `guide.html` | `pages/guide.js` | 사용자 가이드 |
| 히스토리 | `history.html` | `pages/history.js` | 대화 기록 |
| 메모리 | `memory.html` | `pages/memory.js` | 장기 메모리 관리 |
| 비밀번호 변경 | `password-change.html` | `pages/password-change.js` | 비밀번호 변경 |
| 연구 | `research.html` | `pages/research.js` | 심층 연구 |
| 스킬 라이브러리 | `skill-library.html` | `pages/skill-library.js` | 에이전트 스킬 관리 |
| 토큰 모니터링 | `token-monitoring.html` | - | 리다이렉트 → `admin-metrics.html` |
| 사용량 | `usage.html` | `pages/usage.js` | API 사용량 통계 |

### 4.3 ES Module 아키텍처

```
index.html
├── <script type="module" src="js/main.js">
│   ├── import modules/state.js          # 중앙 상태 관리 (AppState)
│   ├── import modules/auth.js           # 인증 관리
│   ├── import modules/websocket.js      # WebSocket 연결
│   ├── import modules/chat.js           # 채팅 로직
│   ├── import modules/modes.js          # 토글 모드 (🧠🌐🎯🔬)
│   ├── import modules/settings.js       # MCP 설정 관리
│   ├── import modules/ui.js             # UI 헬퍼
│   ├── import modules/file-upload.js    # 파일 업로드
│   ├── import modules/session.js        # 세션 관리
│   ├── import modules/error-handler.js  # 에러 핸들링
│   └── import modules/utils.js          # 유틸리티
│
├── <script type="module" src="js/spa-router.js">
│   └── import() → modules/pages/*.js    # 동적 페이지 로딩
│
└── <script type="module" src="js/components/*.js">
    ├── unified-sidebar.js               # 통합 사이드바
    ├── sidebar.js                       # 사이드바
    └── admin-panel.js                   # 관리자 패널
```

### 4.4 핵심 모듈

| 모듈 | 역할 |
|------|------|
| `state.js` | 중앙 상태 관리 (AppState 싱글톤, getState/setState) |
| `auth.js` | JWT 인증, 로그인/로그아웃, OAuth 연동 |
| `websocket.js` | WebSocket 연결 관리, 메시지 수신 라우팅 |
| `chat.js` | 채팅 메시지 전송, 스트리밍 응답 렌더링 |
| `modes.js` | 채팅 입력창 토글 버튼 (Thinking, Web Search, Discussion, Research) |
| `settings.js` | MCP_TOOL_CATALOG 마스터 정의, 양방향 동기화 |
| `sanitize.js` | XSS 방어 (sanitizeHTML), SVG/math 태그 허용목록 (Mermaid/KaTeX 지원) |
| `api-client.js` | Axios 기반 API 클라이언트 |
| `api-endpoints.js` | API 엔드포인트 상수 |
| `safe-storage.js` | localStorage 안전 래퍼 |

### 4.5 MCP 토글 데이터 흐름

```
설정 페이지 / 채팅 입력 토글 버튼
         ↓
AppState (state.js)
  thinkingEnabled, webSearchEnabled, ragEnabled,
  discussionMode, deepResearchMode, mcpToolsEnabled
         ↓
localStorage 'mcpSettings' (영속화)
         ↓
WebSocket 페이로드 (chat.js → sendMessage)
  { thinkingMode, webSearch, ragEnabled, enabledTools }
         ↓
백엔드 ws-chat-handler.ts → ChatService
```

### 4.6 CSS 아키텍처

| CSS 파일 | 역할 |
|----------|------|
| `design-tokens.css` | CSS 변수 (색상, 폰트, 간격) — 단일 진실 소스 |
| ~~`style.css`~~ | (삭제됨 — `design-tokens.css` + `components.css`로 통합) |
| `light-theme.css` | 라이트 테마 오버라이드 |
| `layout.css` | 레이아웃 그리드 |
| `components.css` | 공통 컴포넌트 스타일 |
| `animations.css` | CSS 애니메이션 |
| `icons.css` | 아이콘 스타일 |
| `unified-sidebar.css` | 사이드바 |
| `dark-sidebar.css` | 다크 모드 사이드바 |
| `feature-cards.css` | 피처 카드 UI |
| `settings.css` | 설정 페이지 |
| `skill-library.css` | 스킬 라이브러리 |
| `pages/agents.css` | 에이전트 페이지 |
| `pages/dashboard.css` | 대시보드 페이지 |

### 4.7 Vendor 라이브러리

| 라이브러리 | 파일 | 용도 |
|------------|------|------|
| Highlight.js | `vendor/hljs/highlight.min.js` | 코드 구문 강조 |
| Chart.js | `js/vendor/chart.umd.min.js` | 차트 렌더링 |
| Marked | `vendor/marked.min.js` | Markdown → HTML 변환 |
| DOMPurify | `vendor/purify.min.js` | HTML 새니타이제이션 |
| Iconify | `vendor/iconify-icon.min.js` | 아이콘 시스템 |
| Pretendard | `vendor/pretendard/` | 한글 웹 폰트 |
| Mermaid.js | `vendor/mermaid.min.js` | 다이어그램 렌더링 (Flowchart, Sequence, Gantt 등) |
| KaTeX | `vendor/katex.min.js` + `vendor/katex.min.css` + 20개 폰트 | 수식 렌더링 (LaTeX 문법) |

---

## 5. DBA (데이터베이스 설계) 분석

### 5.1 데이터베이스 기술

- **DBMS**: PostgreSQL >= 14
- **드라이버**: pg 8.18.0 (raw SQL, ORM 없음)
- **확장**: pgvector (벡터 유사도 검색), pg_trgm (트라이그램 텍스트 검색)
- **접근 패턴**: UnifiedDatabase 싱글톤 → pg Pool → Repository 패턴

### 5.2 스키마 관리 전략

```
services/database/
├── init/
│   ├── 001-extensions.sql       # PostgreSQL 확장 활성화
│   ├── 002-schema.sql           # 전체 스키마 정의 (단일 진실 소스)
│   ├── 003-seed.sql             # 초기 데이터
│   └── SCHEMA_SOURCE_OF_TRUTH.md
├── migrations/                     # DB 마이그레이션 (6개)
│   ├── 000_migration_versions.sql  # 마이그레이션 버전 테이블
│   ├── 001_baseline.sql            # 베이스라인
│   ├── 002_vector_type_migration.sql  # TEXT → vector(768)
│   ├── 003_hybrid_search_fts.sql   # BM25/FTS tsvector
│   ├── 004_hnsw_index.sql          # HNSW 벡터 인덱스
│   └── 005_kb_nm_schema.sql        # N:M Knowledge Base
```

- **자동 스키마 생성**: 첫 실행 시 `002-schema.sql`이 전체 스키마를 생성
- **마이그레이션 시스템**: 6개 SQL 마이그레이션 (000-005) + `scripts/run-migrations.ts` 자동 실행기 (트랜잭션 기반, 롤백 지원, 중복 방지)
- **pgvector 필수**: embedding 컨럼은 `vector(768)` 타입 고정 (TEXT 폴백 제거됨)

### 5.3 테이블 설계 (24개 테이블)

#### 핵심 테이블

| 테이블 | 역할 | 주요 컬럼 |
|--------|------|-----------|
| `users` | 사용자 | id, username, password_hash, email, role, tier |
| `conversation_sessions` | 대화 세션 | id, user_id(FK), anon_session_id, title, metadata(JSONB) |
| `conversation_messages` | 대화 메시지 | id, session_id(FK), role, content, model, thinking, tokens |
| `api_usage` | API 사용량 | date, api_key_id, requests, tokens, errors, models(JSONB) |

#### 에이전트 테이블

| 테이블 | 역할 |
|--------|------|
| `agent_usage_logs` | 에이전트 사용 기록 (쿼리, 응답 시간, 토큰) |
| `agent_feedback` | 에이전트 평점 피드백 (1~5점) |
| `agent_metrics` | 에이전트 성능 메트릭 집계 |
| `custom_agents` | 사용자 커스텀 에이전트 정의 |
| `agent_skills` | 에이전트 스킬 정의 |
| `agent_skill_assignments` | 에이전트-스킬 연결 (M:N) |

#### 메모리/연구 테이블

| 테이블 | 역할 |
|--------|------|
| `user_memories` | 사용자별 장기 메모리 (6개 카테고리) |
| `memory_tags` | 메모리 태그 |
| `research_sessions` | 심층 연구 세션 |
| `research_steps` | 연구 단계별 결과 |

#### 외부 연동 테이블

| 테이블 | 역할 |
|--------|------|
| `external_connections` | 외부 서비스 연결 (Google Drive, Notion, GitHub 등) |
| `external_files` | 외부 파일 캐시 |
| `mcp_servers` | MCP 외부 서버 설정 |

#### Knowledge Base 테이블 (Phase 2 W4 추가)

| 테이블 | 역할 |
|--------|------|
| `knowledge_collections` | 지식 컨렉션 (owner_user_id, name, description, visibility) |
| `knowledge_collection_documents` | 컨렉션 ↔ 문서 N:M 연결 (컨렉션 삭제 시 매핑만 CASCADE, 문서 보존) |
| `migration_versions` | 마이그레이션 버전 추적 (version, filename, applied_at) |

#### 인증/보안 테이블

| 테이블 | 역할 |
|--------|------|
| `user_api_keys` | API 키 (HMAC, Scope, Rate Limit Tier) |
| `oauth_states` | OAuth CSRF 방어 State |
| `token_blacklist` | JWT 블랙리스트 |
| `chat_rate_limits` | 채팅 레이트 리밋 |

#### 인프라 테이블

| 테이블 | 역할 |
|--------|------|
| `audit_logs` | 시스템 감사 로그 |
| `alert_history` | 알림 히스토리 |
| `push_subscriptions` | 웹 푸시 구독 |
| `push_subscriptions_store` | 푸시 구독 DB 영속화 |
| `api_key_failures` | API 키 실패 추적 |
| `vector_embeddings` | 벡터 임베딩 (pgvector vector(768), content_tsv tsvector) |
| `uploaded_documents` | 업로드 문서 (write-through cache) |
| `token_daily_stats` | 토큰 일별 통계 |
| `message_feedback` | 메시지 피드백 (signal 기반) |

### 5.4 ER 다이어그램 (핵심 관계)

```
users (1) ─────── (N) conversation_sessions
  │                       │
  │                       └──── (N) conversation_messages
  │
  ├── (N) user_memories ──── (N) memory_tags
  ├── (N) user_api_keys
  ├── (N) custom_agents
  ├── (N) agent_skills
  ├── (N) external_connections ──── (N) external_files
  └── (N) research_sessions ──── (N) research_steps

agent_skills (M) ──── (N) agent_skill_assignments ──── (M) agents

vector_embeddings ←── 독립 (source_type으로 다형성 참조)

knowledge_collections (1) ──── (N) knowledge_collection_documents ──── (N) vector_embeddings
  │
  └── owner_user_id → users(id) ON DELETE CASCADE

migration_versions ←── 독립 (마이그레이션 버전 추적)
```

### 5.5 인덱스 전략

총 **55개+ 인덱스**가 정의되어 있다.

| 인덱스 유형 | 수량 | 대상 |
|-------------|------|------|
| 단일 컬럼 B-Tree | ~30 | FK, 조회 필터 (user_id, session_id, agent_id 등) |
| 복합 인덱스 | ~10 | 복합 쿼리 패턴 (user_id + updated_at DESC 등) |
| Unique 인덱스 | ~5 | anon_session_id (WHERE NOT NULL), key_hash 등 |
| GIN 인덱스 | 3 | 트라이그램 텍스트 검색 (content, value) + FTS (content_tsv) |
| HNSW 인덱스 | 1 | 벡터 코사인 유사도 (pgvector, m=16, ef_construction=64) |
| KB 인덱스 | 4 | knowledge_collections(owner, visibility) + knowledge_collection_documents(collection, document) |

**인덱스 전환 이력:**
- Migration 002: TEXT → vector(768) 타입 전환 (IVFFlat 인덱스 유지)
- Migration 003: tsvector 컨럼 + GIN FTS 인덱스 추가
- Migration 004: IVFFlat → HNSW 인덱스 전환 (검색 정확도 향상, 사후 재빌드 불필요)
- Migration 005: Knowledge Base N:M 스키마 + 4개 인덱스

### 5.6 Repository 패턴 (13개 리포지토리)

```
backend/api/src/data/
├── models/
│   ├── unified-database.ts    # UnifiedDatabase 싱글톤 (pg Pool 관리)
│   ├── user.ts                # User 모델
│   ├── conversation.ts        # Conversation 모델
│   └── token-blacklist.ts     # Token Blacklist 모델
├── repositories/
│   ├── base-repository.ts     # 공통 CRUD (BaseRepository)
│   ├── user-repository.ts     # 사용자 CRUD
│   ├── conversation-repository.ts  # 대화 CRUD
│   ├── api-key-repository.ts  # API 키 CRUD
│   ├── audit-repository.ts    # 감사 로그
│   ├── external-repository.ts # 외부 연동
│   ├── feedback-repository.ts # 피드백
│   ├── memory-repository.ts   # 메모리
│   ├── research-repository.ts # 연구
│   ├── skill-repository.ts    # 스킬 (BOLA ownership 검증 포함)
│   ├── vector-repository.ts   # 벡터 임베딩 (hybrid search, batch insert)
│   └── kb-repository.ts       # Knowledge Base (N:M 컨렉션)
├── migrations/
│   ├── cli.ts                 # 마이그레이션 CLI
│   └── runner.ts              # 마이그레이션 실행기
└── retry-wrapper.ts           # DB 재시도 래퍼
```

---

## 6. 보안 분석

### 6.1 인증 계층

| 계층 | 메커니즘 | 구현 |
|------|----------|------|
| 세션 인증 | JWT HttpOnly Cookie | `auth/middleware.ts` |
| API 인증 | HMAC-SHA-256 API Key | `middlewares/api-key-auth.ts` |
| OAuth | Google OAuth 2.0 | `auth/oauth-provider.ts` |
| Scope | 기능별 접근 제어 | `auth/scope-middleware.ts` |
| BOLA | 객체 수준 접근 제어 | `auth/ownership.ts` |

### 6.2 보안 미들웨어

| 미들웨어 | 기능 |
|----------|------|
| `helmet` | HTTP 보안 헤더 |
| `cors` | CORS 정책 |
| `rate-limit` | API 레이트 리밋 |
| `chat-rate-limiter` | 채팅 전용 레이트 리밋 (DB 기반) |
| `api-key-limiter` | API 키별 레이트 리밋 |
| `input-sanitizer` | 입력 새니타이제이션 |
| `validation` | Zod 스키마 밸리데이션 |

### 6.3 보안 포인트

- **XSS 방어**: 프론트엔드 `sanitize.js` + DOMPurify, 백엔드 `input-sanitizer.ts`
- **SQL 인젝션 방어**: pg 파라미터화 쿼리 (raw SQL이지만 `$1, $2` 바인딩)
- **CSRF 방어**: OAuth state 테이블, SameSite Cookie
- **토큰 관리**: JWT 블랙리스트, 자동 만료
- **파일 접근**: UserSandbox로 사용자 데이터 격리
- **RCE 방지**: `run_command`, `read_file`, `write_file` MCP 도구 삭제 완료
- **SSRF 방어**: `security/ssrf-guard.ts` — Private IP 차단, DNS Rebinding 방어, URL 검증
- **BOLA 방어**: `auth/ownership.ts` — 2계층 (Route-level + Repository-level) 소유권 검증

---

## 7. 빌드 및 배포

### 7.1 npm 스크립트

| 스크립트 | 명령 | 기능 |
|----------|------|------|
| `build` | `tsc + sync-frontend + deploy` | 전체 빌드 |
| `build:backend` | `cd backend/api && npm run build` | 백엔드 TypeScript 컴파일 |
| `build:frontend` | `cd frontend/web && npm run build` | 프론트엔드 모듈 검증 |
| `deploy:frontend` | `bash scripts/deploy-frontend.sh` | 프론트엔드 → dist/public 복사 |
| `dev` | `concurrently api + frontend` | 개발 모드 (동시 실행) |
| `start` | `node backend/api/dist/server.js` | 프로덕션 서버 |
| `test` | `jest` | 유닛 테스트 |
| `test:e2e` | `npx playwright test` | E2E 테스트 |
| `lint` | `eslint . --ext .ts,.tsx,.js,.jsx` | 코드 린트 |
| `check:schema-drift` | `bash scripts/check-schema-drift.sh` | 스키마 드리프트 검사 |
| `ci` | `bash scripts/ci-test.sh` | CI 게이트 (Test→Build→Lint) |
| `migrate` | `bun run scripts/run-migrations.ts` | DB 마이그레이션 실행 |

### 7.2 프로덕션 배포

```bash
# 빌드
npm run build

# PM2로 프로세스 관리
pm2 start ecosystem.config.js

# 또는 직접 실행
node backend/api/dist/cli.js cluster --port 52416
```

### 7.3 워크스페이스 구조

```json
{
  "workspaces": [
    "backend/api",    // Express + TypeScript API
    "frontend/web"    // Vanilla JS Frontend
  ]
}
```

### 7.4 CI/CD 파이프라인

```
Git Push -> pre-push Hook (scripts/hooks/pre-push)
           |
           +-> scripts/ci-test.sh (3 게이트)
               +-- Gate 1: Bun Test (69개 파일, 개별 독립 실행)
               +-- Gate 2: TypeScript Build (tsc --noEmit)
               +-- Gate 3: ESLint (오류 0건 기준)

GitHub Push -> .github/workflows/ci.yml (GitHub Actions)
           |
           +-> 동일 3 게이트 미러링 (ci-test.sh 동일 구조)
               +-- ubuntu-latest, Node.js 20, Bun latest
               +-- concurrency: 동일 브랜치 중복 실행 취소
               +-- Docker 미사용 (프로젝트 방침 영구 제외)
```

### 7.5 Git Hooks

- `scripts/install-hooks.sh`: Git hooks 자동 설치 스크립트
- `scripts/hooks/pre-push`: push 전 CI 게이트 실행 (3게이트 전부 통과 시만 push 허용)

---

## 8. 삭제된 파일 목록

실행과 무관한 다음 파일/디렉토리를 삭제하였다.

### 루트 레벨 분석/임시 파일

| 파일 | 설명 |
|------|------|
| `analyze_scripts.js` | HTML 인라인 스크립트 분석 도구 (일회성) |
| `analyze_scripts_v2.js` | 위 도구 v2 |
| `extract_for_eslint.js` | ESLint용 스크립트 추출 도구 |
| `extract_scripts.js` | 스크립트 추출 도구 |
| `parse_eslint.js` | ESLint 결과 파싱 도구 |
| `eslint_results.json` | ESLint 분석 결과 출력물 |
| `final_analysis.json` | 분석 최종 결과 출력물 |
| `script_analysis.json` | 스크립트 분석 결과 출력물 |
| `network-requests.txt` | Playwright 네트워크 캡처 |
| `settings-full-page.png` | 스크린샷 (UI 캡처) |
| `settings-tier-cards.png` | 스크린샷 (UI 캡처) |
| `tmp_scripts/` | 임시 추출 스크립트 디렉토리 (21개 파일) |
| `.jest-cache/` | Jest 캐시 (자동 재생성) |

### 백엔드 개발/디버그 파일

| 파일 | 설명 |
|------|------|
| `backend/api/debug-start.js` | 디버그 서버 시작 스크립트 |
| `backend/api/start-direct.js` | CLI 우회 직접 시작 스크립트 |
| `backend/api/test-dotenv.ts` | dotenv 로딩 테스트 |
| `backend/api/.env.test` | 테스트 환경 변수 |
| `backend/api/server.log` | 런타임 로그 |
| `backend/api/logs/*.log` | 런타임 로그 파일들 (4개) |
| `backend/api/tsconfig.tsbuildinfo` | TypeScript 빌드 정보 (재생성) |
| `backend/api/src/test-dotenv.ts` | dotenv 테스트 (소스 내부) |
| `backend/api/src/test-preload.ts` | 테스트 프리로드 |
| `backend/api/src/scripts/embedding-ab-test.ts` | 임베딩 AB 테스트 |
| `backend/api/src/scripts/keyword-accuracy-test.ts` | 키워드 정확도 테스트 |

### 데이터 파일

| 파일 | 설명 |
|------|------|
| `data/api-usage.json` | 런타임 사용량 데이터 (앱이 재생성) |
| `data/users/test_user_123/` | 테스트 사용자 샌드박스 데이터 |

### 빈 미사용 디렉토리

| 디렉토리 | 설명 |
|-----------|------|
| `src/agents/prompts/` | 빈 디렉토리 (실제 프롬프트는 backend/api/src/agents/prompts/) |
| `backend/api/src/scripts/` | 테스트 스크립트 삭제 후 빈 디렉토리 |
| `backend/api/logs/` | 로그 삭제 후 빈 디렉토리 |

---

## 9. 아키텍처 평가

### 9.1 강점

1. **모듈화**: 명확한 계층 분리 (Routes → Controllers → Services → Repositories → DB)
2. **확장성**: 플러그인 시스템, 에이전트 스킬 시스템으로 기능 확장 용이
3. **보안**: 다계층 인증, SSRF Guard, BOLA ownership, API Key Scope 제어, XSS/SQL 인젝션 방어
4. **성능**: 2계층 시맨틱 캐시, HNSW 벡터 인덱스, BM25/FTS 하이브리드 검색, API Key Pool 라운드로빈, 클러스터 모드
5. **자율성**: 자율 심층 연구, 에이전트 자동 라우팅, 멀티 모델 토론
6. **테스트**: 69개 유닛 테스트 + E2E 스모크 테스트 + CI 3게이트 파이프라인 (GitHub Actions + pre-push Hook)
7. **타입 안전**: TypeScript strict 모드, Zod 밸리데이션, 금지 패턴 정책 (as any, @ts-ignore 금지)
8. **관측성**: OpenTelemetry 계측 (HTTP/Express 자동, DB/WS/LLM 커스텀 span)
9. **RAG 파이프라인**: Hybrid Search(Vector+BM25) + RRF + Cross-encoder Reranking + OCR Quality Gate

### 9.2 아키텍처 특징

- **Vanilla JS 프론트엔드**: React/Vue 없이 ES Module + SPA Router로 구현. 번들러 의존성 제거.
- **ORM 없이 Raw SQL**: pg 드라이버로 직접 쿼리. 성능 제어와 PostgreSQL 고유 기능(pgvector, pg_trgm) 활용.
- **Strategy 패턴**: ChatService가 5가지 전략(Direct, AgentLoop, Discussion, A2A, DeepResearch)을 동적 선택.
- **MCP 프로토콜**: Model Context Protocol로 도구 호출을 표준화. 내장/외부 도구를 통합 라우팅.
- **싱글톤 중심**: UnifiedDatabase, EmbeddingService, ApiKeyManager, UnifiedMCPClient 모두 싱글톤.
- **CI/CD 파이프라인**: pre-push Hook + GitHub Actions 3게이트 (Test/Build/Lint). Docker 없이 운영.
- **마이그레이션 시스템**: 6개 순차 SQL 마이그레이션 + 트랜잭션 기반 자동 실행기 (rollback, 중복 방지).
- **N:M Knowledge Base**: 컨렉션 ↔ 문서 다대다 관계. 컨렉션 삭제 시 매핑만 CASCADE, 문서/임베딩 보존.
- **OpenAI Compatible API**: `/v1/chat/completions` 엔드포인트로 외부 클라이언트 호환.

---

## 10. 결론

OpenMake LLM은 520+ 파일, 103,000+ 라인 규모의 풀스택 AI 플랫폼으로, Express + TypeScript 백엔드와 Vanilla JS 프론트엔드, PostgreSQL 데이터 계층으로 구성된다. 17개 산업별 에이전트, 10개 MCP 도구, 7개 모델 프로파일, 2계층 시맨틱 캐시, Hybrid Search + RRF + Cross-encoder RAG 파이프라인, 자율 심층 연구, OpenTelemetry 관측성, SSRF/BOLA 보안 방어, CI/CD 3게이트 파이프라인 등 고도화된 AI 오케스트레이션 시스템을 갖추고 있다. 셀프 호스팅 환경에서 프라이버시를 보장하면서 다양한 LLM을 통합 운영할 수 있도록 설계되었다.
