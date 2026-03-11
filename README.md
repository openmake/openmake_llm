# OpenMake LLM

Privacy-first, self-hosted AI assistant platform with multi-model orchestration.

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js >= 18, Bun (test runner) |
| Framework | Express 5, TypeScript 5.3 (strict mode) |
| Database | PostgreSQL >= 14 (raw SQL, pg) |
| Frontend | Vanilla JavaScript ES Modules SPA (21 pages, no framework) |
| WebSocket | ws (real-time chat streaming) |
| Testing | Bun Test (70 files), Playwright (E2E), Jest |
| Auth | JWT (HttpOnly cookie), Google OAuth 2.0, RBAC |
| LLM Provider | Ollama (API key pool rotation, 5-key round-robin) |
| MCP | @modelcontextprotocol/sdk |
| Vector Search | pgvector, nomic-embed-text (768d) |

## Core Systems

### Brand Model Profiles

7개 브랜드 프로필로 용도별 최적 모델을 자동 선택합니다.

| Profile | ID | Purpose |
|---|---|---|
| Default | openmake_llm | General purpose |
| Pro | openmake_llm_pro | Premium quality (creative, analysis, document, translation, korean) |
| Fast | openmake_llm_fast | Quick responses (simple chat) |
| Think | openmake_llm_think | Deep reasoning (math) |
| Code | openmake_llm_code | Code-specialized |
| Vision | openmake_llm_vision | Multimodal (images) |
| Auto | openmake_llm_auto | Smart auto-routing by query type |

### Smart Auto-Routing

쿼리를 9개 도메인(code, math, creative, analysis, document, vision, translation, korean, chat)으로 분류하여 최적 프로필로 라우팅합니다.

**Pipeline:** Query → LLM Classifier (gemini-3-flash-preview) → Semantic Cache hit check → Profile Resolution → Model Selection → Streaming Response

Regex keyword classifier가 fallback으로 동작하며, 비용 티어(economy/standard/premium)에 따라 모델 등급이 조절됩니다.

### Semantic Classification Cache

2-layer in-memory 캐시로 쿼리 분류를 가속합니다.

- **L1 (exact-match):** `Map.get()` O(1) lookup, < 1ms
- **L2 (semantic-match):** nomic-embed-text cosine similarity, 10-30ms

서버 시작 시 62개 공통 쿼리 패턴(한/영)을 pre-warming합니다. 설정: similarity threshold 0.88, TTL 30min, max 500 entries, LRU eviction.

### Chat Pipeline

```
User Message
  → Query Classification (LLM + Semantic Cache)
  → Profile Resolution (7 profiles)
  → Model Selection (cost tier aware)
  → Context Engineering (7-language locales, dynamic metadata)
  → History Summarization (10턴 초과 시 LLM 자동 압축)
  → RAG Context Injection (pgvector hybrid search)
  → Streaming Response (WebSocket)
```

### Agent System

- **17 industry agents:** 산업별 전문 에이전트 (keyword router + topic analyzer)
- **Discussion Engine:** Multi-model debate mode (다국어 로케일 지원)
- **A2A Strategy:** Agent-to-Agent 병렬 생성
- **Deep Research:** 자율 다단계 리서치 → RAG 자동 저장
- **Skill Manager:** 동적 스킬 등록/실행

### RAG (Retrieval-Augmented Generation)

- pgvector 기반 벡터 검색 + BM25 hybrid search
- nomic-embed-text 768d 임베딩 (배치 64, 52.4 chunks/s)
- Reranker로 결과 재정렬
- Deep Research 결과 자동 임베딩
- 설정: chunk 1000자, overlap 200자, top-k 5, relevance threshold 0.45

### Authentication & Security

- JWT access/refresh tokens (HttpOnly cookies)
- Google OAuth 2.0 SSO
- RBAC role enforcement + scope middleware
- API key HMAC-SHA-256 + pool rotation (5-key, 429 시 5분 cooldown)
- SSRF guard, input sanitization, rate limiting (per-route)
- Helmet, CORS

## MCP Tools

10개 built-in Model Context Protocol 도구. Firecrawl 도구는 `FIRECRAWL_API_KEY` 설정 시에만 활성화됩니다.

| Category | Tool | Free | Pro | Enterprise |
|---|---|:---:|:---:|:---:|
| Vision | vision_ocr | Y | Y | Y |
| Vision | analyze_image | Y | Y | Y |
| Web Search | web_search | Y | Y | Y |
| Web Search | fact_check | - | - | Y |
| Web Search | extract_webpage | - | - | Y |
| Web Search | research_topic | - | - | Y |
| Scraping | firecrawl_scrape | - | Y | Y |
| Scraping | firecrawl_search | - | Y | Y |
| Scraping | firecrawl_map | - | Y | Y |
| Scraping | firecrawl_crawl | - | Y | Y |

## Architecture

### Monorepo Structure (npm workspaces)

```
openmake_llm/
├── backend/api/src/          # Express 5 + TypeScript API Server
│   ├── routes/               # 25 REST API route modules
│   ├── services/             # ChatService, RAGService, DeepResearchService, MemoryService, etc.
│   ├── chat/                 # Chat pipeline: classifier, cache, context-engineering, model-selector
│   ├── agents/               # 17 industry agents, discussion engine, skill manager
│   ├── mcp/                  # MCP tool router, tiers, external client, server registry
│   ├── auth/                 # JWT, OAuth, API key, ownership, scope middleware
│   ├── data/                 # PostgreSQL (raw SQL), migrations, repositories
│   ├── sockets/              # WebSocket chat streaming handler
│   ├── cluster/              # Ollama cluster management, circuit breaker
│   ├── monitoring/           # Analytics, alerts, metrics
│   ├── middlewares/          # Rate limiters, validation, security
│   ├── config/               # Environment config, runtime limits, constants
│   ├── ollama/               # Ollama client wrapper
│   ├── workflow/             # Graph engine (experimental)
│   └── __tests__/            # 70 test files (Bun Test)
├── frontend/web/public/      # Vanilla JS SPA (ES Modules)
│   ├── js/modules/           # Core: chat, websocket, auth, state, file-upload, sanitize
│   ├── js/modules/pages/     # 21 page modules
│   └── css/                  # Design tokens, components, themes
├── scripts/                  # Build, deploy, CI, migration scripts
└── tests/                    # E2E tests (Playwright)
```

### Chat Strategies

| Strategy | Description |
|---|---|
| DirectStrategy | 단일 모델 직접 응답 |
| DiscussionStrategy | Multi-model debate/토론 |
| A2AStrategy | Agent-to-Agent 병렬 생성 |
| AgentLoopStrategy | 도구 호출 루프 (MCP) |
| DeepResearchStrategy | 자율 다단계 리서치 |

### Key Services

| Service | Purpose |
|---|---|
| ChatService | 메인 채팅 파이프라인, 히스토리 관리 |
| RAGService | 벡터 임베딩, hybrid search, context injection |
| EmbeddingService | nomic-embed-text 싱글톤 임베딩 |
| DeepResearchService | 다단계 자율 리서치 실행 |
| MemoryService | 사용자별 장기 메모리 저장 |
| Reranker | 검색 결과 재정렬 |
| OCRQualityGate | OCR 품질 평가 및 필터링 |

### Frontend Pages (21)

Main chat, settings, admin dashboard, admin metrics, agent learning, custom agents, skill library, analytics, audit logs, history, documents, memory, research, API keys, cluster, alerts, token monitoring, usage, developer docs, external, guide.

## Configuration

환경 변수는 `.env.example`을 참고하여 `.env` 파일에 설정합니다.

| Category | Key Variables |
|---|---|
| Ollama & LLM | `OLLAMA_HOST`, `OLLAMA_MODEL`, `OLLAMA_API_KEY_1..5` |
| Gemini | `GEMINI_API_KEY`, thinking/context/embedding 설정 |
| Server & Security | `PORT` (default 52416), `JWT_SECRET`, `SESSION_SECRET` |
| Google OAuth 2.0 | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Web Search | `GOOGLE_API_KEY`, `GOOGLE_CSE_ID` |
| Database | `DATABASE_URL` (PostgreSQL) |
| Cost Tier | `OMK_COST_TIER_DEFAULT`, `OMK_DOMAIN_*` |
| Firecrawl | `FIRECRAWL_API_KEY` |
| Language Policy | `DEFAULT_RESPONSE_LANGUAGE`, 동적 감지/fallback 설정 |

## Getting Started

### Prerequisites

- Node.js >= 18
- PostgreSQL >= 14
- Ollama

### Installation

```bash
git clone <repository-url>
cd openmake_llm
npm install

cp .env.example .env
# .env 파일을 편집하여 실제 값을 입력하세요

createdb openmake_llm   # 스키마는 첫 실행 시 자동 생성됩니다
npm run build
```

### Run

```bash
# Production
npm start
# 또는 클러스터 모드
node backend/api/dist/cli.js cluster --port 52416

# Development
npm run dev
```

### npm Scripts

| Script | Description |
|---|---|
| `npm run build` | Backend + Frontend 빌드 및 배포 |
| `npm run dev` | API + Frontend 동시 개발 서버 |
| `npm start` | Production 서버 시작 |
| `npm test` | Jest 테스트 실행 |
| `npm run test:bun` | Bun 테스트 실행 (backend/api, 70 files) |
| `npm run test:e2e` | Playwright E2E 테스트 |
| `npm run lint` | ESLint 실행 |
| `npm run ci` | CI 게이트 (Bun Test + Build + Lint) |
| `npm run migrate` | DB 마이그레이션 실행 |

### CLI Commands

```bash
node backend/api/dist/cli.js <command>
```

`chat`, `ask`, `review`, `generate`, `explain`, `models`, `connect`, `cluster`, `nodes`, `mcp`, `plugins`
