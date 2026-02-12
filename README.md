<p align="center">
  <img src="frontend/web/public/icons/icon-192.png" alt="OpenMake.AI" width="80" />
</p>

<h1 align="center">OpenMake LLM</h1>

<p align="center">
  <strong>Self-hosted AI Assistant Platform with Multi-Model Orchestration</strong>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#configuration">Configuration</a> &bull;
  <a href="#api-reference">API Reference</a> &bull;
  <a href="#project-structure">Project Structure</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.5.0-blue" alt="Version" />
  <img src="https://img.shields.io/badge/node-%3E%3D18-green" alt="Node" />
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License" />
  <img src="https://img.shields.io/badge/typescript-5.3-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/express-5.2-lightgrey" alt="Express" />
</p>

---

## Overview

**OpenMake LLM**은 Ollama 기반의 셀프 호스팅 AI 어시스턴트 플랫폼입니다. 단일 노드부터 분산 클러스터까지 확장 가능하며, 7가지 브랜드 모델 프로파일을 통해 질문 유형에 따른 최적의 AI 응답을 제공합니다.

### Why OpenMake LLM?

- **프라이버시**: 모든 데이터가 로컬에서 처리됩니다. 외부 서비스 의존 없이 운영 가능.
- **멀티모델 오케스트레이션**: 여러 LLM을 동시에 운용하며, 질문 유형에 따라 자동 라우팅.
- **확장성**: 단일 머신의 Ollama부터 멀티 노드 GPU 클러스터까지 수평 확장.
- **개발자 API**: 외부 개발자를 위한 API Key 발급 및 사용량 관리 시스템 내장.

---

## Features

### Core AI

| Feature | Description |
|---------|-------------|
| **Smart Auto-Routing** | 질문을 분석하여 코딩/수학/창작/비전 등 최적 모델로 자동 라우팅 (`openmake_llm_auto`) |
| **7 Brand Model Profiles** | `openmake_llm`, `_pro`, `_fast`, `_think`, `_code`, `_vision`, `_auto` — 각각 고유한 파이프라인 전략 |
| **Agent-to-Agent (A2A)** | 다중 모델 병렬 생성 후 최적 응답 합성. API Key별 전용 모델 할당 지원 |
| **Deep Research** | 자율적 다단계 리서치 에이전트 — 주제 분해, 웹 검색, 소스 수집, 종합 보고서 생성 |
| **Discussion Mode** | 다중 모델 토론 시스템 — 교차 검토와 팩트체킹을 통한 고품질 응답 |
| **Sequential Thinking** | 단계별 논리적 추론 체인 — 복잡한 문제를 분해하여 해결 |
| **Long-term Memory** | 사용자별 장기 기억 시스템 — 대화에서 중요 정보를 자동 추출 및 재활용 |

### Platform

| Feature | Description |
|---------|-------------|
| **MCP Integration** | Model Context Protocol 지원 — 외부 MCP 서버 연결, 도구 라우팅, Firecrawl 웹 스크래핑 |
| **Cluster Management** | 분산 Ollama 노드 관리 — 헬스체크, 레이턴시 모니터링, 자동 로드밸런싱, 커넥션 풀링 |
| **API Key Service** | 외부 개발자용 API Key 발급/관리 — 사용량 추적, TPM Rate Limiting, 모델별 접근 제어 |
| **OAuth & RBAC** | Google OAuth 2.0 + GitHub OAuth 소셜 로그인, JWT 기반 역할 접근 제어 (admin/user/guest) |
| **PWA Support** | Progressive Web App — 오프라인 캐싱, 홈 화면 설치, Push 알림 (Web Push API) |
| **Web Search** | Google Custom Search 통합 — 실시간 웹 정보를 AI 컨텍스트에 주입 |
| **Document Analysis** | PDF 파싱 (pdf-parse), OCR (Tesseract.js) — 업로드 문서를 대화 컨텍스트에 포함 |
| **Canvas** | 공유 가능한 문서 캔버스 — 버전 관리, 공유 토큰 기반 협업 |

### Operations & Monitoring

| Feature | Description |
|---------|-------------|
| **Token Monitoring** | 실시간 토큰 사용량 추적 및 시각화 |
| **Audit System** | 시스템 활동 감사 로그 및 추적 |
| **Alerts** | 시스템 이벤트 알림 및 경고 |
| **Analytics** | 사용 패턴 분석 및 통계 대시보드 |
| **Agent Learning** | RLHF 기반 에이전트 성능 추적 및 피드백 시스템 |
| **Agent Marketplace** | 커스텀 에이전트 공유 및 설치 마켓플레이스 |

### Developer Experience

| Feature | Description |
|---------|-------------|
| **CLI Tools** | `chat`, `ask`, `review`, `generate`, `explain`, `models`, `connect`, `nodes`, `mcp`, `plugins` |
| **Swagger API Docs** | 자동 생성 API 문서 (`/api-docs`) |
| **Developer Portal** | API 사용법, 코드 예제, Rate Limit 안내 페이지 (`/developer.html`) |
| **Plugin System** | 확장 가능한 플러그인 아키텍처 — 플러그인 로더 및 레지스트리 |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Vanilla JS SPA)                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Chat UI  │ │ Research │ │  Canvas  │ │  Admin   │  ...   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │
│       └─────────────┴────────────┴────────────┘             │
│                    SPA Router (History API)                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP / WebSocket
┌──────────────────────────┴──────────────────────────────────┐
│                   Backend (Express v5 + TypeScript)          │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │  REST API   │  │  WebSocket   │  │   Auth & Middleware│   │
│  │  (Routes)   │  │  (Streaming) │  │  JWT/OAuth/APIKey │   │
│  └──────┬──────┘  └──────┬───────┘  └───────────────────┘   │
│         └────────────────┤                                   │
│  ┌───────────────────────┴───────────────────────────────┐   │
│  │                    ChatService                        │   │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌────────┐  │   │
│  │  │ Pipeline │ │  Model    │ │  Context │ │  Agent │  │   │
│  │  │ Profile  │ │ Selector  │ │ Engineer │ │  Loop  │  │   │
│  │  └──────────┘ └───────────┘ └──────────┘ └────────┘  │   │
│  └───────────────────────┬───────────────────────────────┘   │
│                          │                                   │
│  ┌───────────┐  ┌────────┴──────┐  ┌──────────────────┐     │
│  │  MCP      │  │ Cluster       │  │ Deep Research    │     │
│  │  Tools    │  │ Manager       │  │ Service          │     │
│  └───────────┘  └────────┬──────┘  └──────────────────┘     │
│                          │                                   │
│  ┌───────────┐  ┌────────┴──────┐  ┌──────────────────┐     │
│  │Monitoring │  │  Documents    │  │  Memory Service  │     │
│  │& Analytics│  │  Processor    │  │                  │     │
│  └───────────┘  └───────────────┘  └──────────────────┘     │
│                                                              │
│  ┌───────────────────────────────────────────────────────┐   │
│  │              UnifiedDatabase (PostgreSQL)              │   │
│  └───────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │   Ollama Cluster        │
              │  ┌──────┐  ┌──────┐    │
              │  │Node 1│  │Node 2│ ...│
              │  │(Local)│  │(Cloud)│   │
              │  └──────┘  └──────┘    │
              └─────────────────────────┘
```

### Chat Pipeline Flow

```
User Message
    │
    ▼
┌──────────────────┐
│ PipelineProfile  │  Brand model → 실행 전략 결정
│ (7 profiles)     │  (engine, A2A, thinking, discussion, prompt, loop...)
└────────┬─────────┘
         ▼
┌──────────────────┐
│  ModelSelector   │  질문 유형 분석 (code/math/creative/vision/chat)
│  (Auto-Routing)  │  → 최적 brand profile 선택 (auto 모드 시)
└────────┬─────────┘
         ▼
┌──────────────────┐
│ContextEngineering│ 4-Pillar Framework로 시스템 프롬프트 구성
│ (4-Pillar)       │  Role + Constraints + Goal + Output Format
└────────┬─────────┘
         ▼
┌──────────────────┐
│  Agent Loop      │  A2A 병렬 생성 + MCP 도구 실행 + Sequential Thinking
│  (Orchestration) │  최대 N회 반복 (profile별 설정)
└────────┬─────────┘
         ▼
    AI Response
```

### Brand Model Profiles

| Model Alias | Engine | Agent (A2A) | Thinking | Discussion | Use Case |
|-------------|--------|:-----------:|:--------:|:----------:|----------|
| `openmake_llm` | Flash | Conditional | Medium | — | 일반 대화, 콘텐츠 생성 |
| `openmake_llm_pro` | Pro | Always | High | Yes | 복잡한 분석, 창작 |
| `openmake_llm_fast` | Flash | — | — | — | 실시간 대화, 단순 작업 |
| `openmake_llm_think` | Pro | Always | High | — | 수학, 논리, 심층 추론 |
| `openmake_llm_code` | Code | Conditional | Medium | — | 프로그래밍, 디버깅 |
| `openmake_llm_vision` | Vision | Conditional | Medium | — | 이미지 분석, OCR |
| `openmake_llm_auto` | *Dynamic* | *Auto* | *Auto* | *Auto* | **자동 라우팅** — 질문에 따라 위 6개 중 최적 선택 |

---

## Quick Start

### Prerequisites

- **Node.js** >= 18
- **PostgreSQL** >= 14
- **Ollama** ([install](https://ollama.com))

### 1. Clone & Install

```bash
git clone https://github.com/openmake/openmake_llm.git
cd openmake_llm
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your settings (see Configuration section)
```

### 3. Setup Database

```bash
# Create PostgreSQL database
createdb openmake_llm

# Tables are auto-created on first startup via UnifiedDatabase
```

### 4. Build & Run

```bash
# Build (TypeScript compile + frontend deploy)
npm run build

# Start server (Cluster mode with Web UI)
node backend/api/dist/cli.js cluster --port 52416
```

### 5. Access

- **Web UI**: `http://localhost:52416`
- **API Docs**: `http://localhost:52416/api-docs`
- **Developer Portal**: `http://localhost:52416/developer.html`

### CLI Usage

```bash
# Interactive chat
node backend/api/dist/cli.js chat

# Single question
node backend/api/dist/cli.js ask "Explain quicksort"

# Code review
node backend/api/dist/cli.js review ./src/app.ts

# Code generation
node backend/api/dist/cli.js generate "REST API with Express" -l typescript

# Code explanation
node backend/api/dist/cli.js explain ./src/utils.ts

# List available models
node backend/api/dist/cli.js models

# Connection test
node backend/api/dist/cli.js connect

# Cluster node management
node backend/api/dist/cli.js nodes

# MCP server mode
node backend/api/dist/cli.js mcp

# Plugin management
node backend/api/dist/cli.js plugins --list
```

---

## Configuration

### Environment Variables (`.env`)

#### Server & Security

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `52416` |
| `NODE_ENV` | Environment | `development` |
| `SERVER_HOST` | Server hostname | `localhost` |
| `JWT_SECRET` | JWT signing key | — |
| `SESSION_SECRET` | Session signing key | — |
| `ADMIN_EMAILS` | Admin email addresses | — |
| `CORS_ORIGINS` | Allowed CORS origins | `localhost:52416,...` |

#### Ollama & LLM

| Variable | Description | Default |
|----------|-------------|---------|
| `OLLAMA_HOST` | Ollama server URL | `http://localhost:11434` |
| `OLLAMA_BASE_URL` | Ollama API base URL | `http://localhost:11434` |
| `OLLAMA_MODEL` | Default model | — |
| `OLLAMA_API_KEY_1..5` | Cloud API keys (rotation) | — |
| `OLLAMA_MODEL_1..5` | Per-key model assignment (A2A) | — |
| `OLLAMA_HOURLY_LIMIT` | Requests per hour per key | `150` |
| `OLLAMA_TIMEOUT` | Request timeout (ms) | `120000` |

#### Engine Mapping (Brand Model → Actual Model)

| Variable | Description | Example |
|----------|-------------|---------|
| `OMK_ENGINE_LLM` | Default engine model | — |
| `OMK_ENGINE_PRO` | Pro engine model | — |
| `OMK_ENGINE_FAST` | Fast engine model | — |
| `OMK_ENGINE_THINK` | Think engine model | — |
| `OMK_ENGINE_CODE` | Code engine model | `qwen3-coder-next:cloud` |
| `OMK_ENGINE_VISION` | Vision engine model | `qwen3-vl:235b-cloud` |

#### Gemini (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Google Gemini API key | — |
| `GEMINI_THINK_ENABLED` | Enable thinking mode | `true` |
| `GEMINI_THINK_LEVEL` | Thinking depth | `high` |
| `GEMINI_NUM_CTX` | Context window size | `32768` |

#### Database

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://openmake:...@localhost:5432/openmake_llm` |

#### OAuth

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | — |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | — |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | — |
| `OAUTH_REDIRECT_URI` | OAuth callback URL | `http://localhost:52416/api/auth/callback/google` |

#### Web Search

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_API_KEY` | Google Custom Search API key | — |
| `GOOGLE_CSE_ID` | Custom Search Engine ID | — |

#### Rate Limiting

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_WINDOW_MS` | Rate limit window | `900000` |
| `RATE_LIMIT_MAX` | Global rate limit | `100` |

> See `.env.example` for the full template with all options.

---

## API Reference

### Authentication

```bash
# API Key (Header)
X-API-Key: omk_live_sk_xxxxxxxxxxxxxxxxxxxx

# Bearer Token (JWT)
Authorization: Bearer <jwt_token>

# Cookie
auth_token=<jwt_token>  (HttpOnly)
```

### Core Endpoints

#### Chat

```http
POST /api/chat            # Non-streaming chat
POST /api/chat/stream     # SSE streaming chat
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | **Required.** User message |
| `model` | string | **Required.** Model alias (e.g., `openmake_llm`, `openmake_llm_auto`) |
| `sessionId` | string | Continue a conversation |
| `history` | array | Previous messages `[{role, content}]` |

#### Agents

```http
GET    /api/agents              # List agents
POST   /api/agents/custom       # Create custom agent
PUT    /api/agents/custom/:id   # Update custom agent
DELETE /api/agents/custom/:id   # Delete custom agent
POST   /api/agents/:id/feedback # Submit RLHF feedback
```

#### Auth

```http
POST /api/auth/login            # Email/password login
POST /api/auth/register         # Registration
GET  /api/auth/callback/google  # Google OAuth callback
GET  /api/auth/callback/github  # GitHub OAuth callback
```

#### Research

```http
POST /api/research              # Start research session
GET  /api/research/:id          # Get research results
```

#### Documents

```http
POST /api/documents/upload      # Upload document (PDF, images)
GET  /api/documents             # List documents
```

#### Canvas

```http
POST   /api/canvas                       # Create document
GET    /api/canvas                       # List documents
GET    /api/canvas/:id                   # Get document
PUT    /api/canvas/:id                   # Update document
DELETE /api/canvas/:id                   # Delete document
POST   /api/canvas/:id/share            # Share document
DELETE /api/canvas/:id/share            # Unshare document
GET    /api/canvas/:id/versions         # Version history
GET    /api/canvas/shared/:shareToken   # Access shared document
```

#### Memory

```http
GET    /api/memory              # Get user memories
DELETE /api/memory/:id          # Delete memory
```

#### MCP Tools

```http
GET  /api/mcp/tools             # List available tools
POST /api/mcp/execute           # Execute tool
```

#### API Keys

```http
POST   /api/api-keys            # Create key
GET    /api/api-keys            # List keys
GET    /api/api-keys/:id        # Get key details
DELETE /api/api-keys/:id        # Delete key
POST   /api/api-keys/:id/rotate # Rotate key
```

#### Monitoring

```http
GET /api/metrics                # System metrics
GET /api/usage                  # API usage stats
GET /api/usage/daily            # Daily usage
GET /api/token-monitoring       # Token usage tracking
GET /api/audit                  # Audit logs
```

#### Marketplace

```http
GET  /api/marketplace           # Browse agents
POST /api/marketplace           # Publish agent
```

> Full interactive API docs available at `/api-docs` (Swagger UI).

---

## Project Structure

```
openmake_llm/
├── backend/
│   ├── api/
│   │   └── src/
│   │       ├── agents/                # Agent System
│   │       │   ├── discussion-engine.ts   # Multi-model debate orchestration
│   │       │   ├── llm-router.ts          # LLM-based intent routing
│   │       │   ├── custom-builder.ts      # Custom agent creation
│   │       │   ├── learning.ts            # Agent performance tracking (RLHF)
│   │       │   ├── monitor.ts             # Agent monitoring
│   │       │   └── prompts/              # System prompt templates
│   │       ├── auth/                  # Authentication
│   │       │   ├── index.ts               # JWT verification
│   │       │   ├── middleware.ts           # requireAuth, optionalAuth, requireAdmin
│   │       │   ├── oauth-provider.ts      # Google & GitHub OAuth
│   │       │   ├── api-key-utils.ts       # API key hashing (HMAC-SHA-256)
│   │       │   └── scope-middleware.ts    # Scope-based access control
│   │       ├── cache/                 # Caching Layer (LRU)
│   │       ├── chat/                  # Chat Pipeline Engine
│   │       │   ├── pipeline-profile.ts    # 7 brand model profile definitions
│   │       │   ├── profile-resolver.ts    # Alias → ExecutionPlan resolution
│   │       │   ├── model-selector.ts      # Query analysis & auto-routing
│   │       │   ├── context-engineering.ts # 4-Pillar prompt framework
│   │       │   ├── prompt.ts              # System prompt generation
│   │       │   └── prompt-enhancer.ts     # Dynamic prompt enhancement
│   │       ├── cluster/               # Distributed Node Management
│   │       │   └── manager.ts             # Health check, load balancing, failover
│   │       ├── commands/              # CLI Command Implementations
│   │       │   ├── review.ts              # Code review command
│   │       │   ├── generate.ts            # Code generation command
│   │       │   └── explain.ts             # Code explanation command
│   │       ├── config/                # Environment Configuration
│   │       │   ├── env.ts                 # Typed config from .env
│   │       │   └── constants.ts           # Application constants
│   │       ├── controllers/           # Request Handlers
│   │       │   ├── auth.controller.ts     # Auth endpoints (login, OAuth)
│   │       │   ├── admin.controller.ts    # Admin operations
│   │       │   ├── cluster.controller.ts  # Cluster management
│   │       │   ├── metrics.controller.ts  # Metrics collection
│   │       │   ├── session.controller.ts  # Session management
│   │       │   └── health.controller.ts   # Health checks
│   │       ├── data/                  # Database Layer
│   │       │   ├── models/
│   │       │   │   └── unified-database.ts  # PostgreSQL abstraction (raw SQL)
│   │       │   ├── conversation-db.ts     # Conversation CRUD
│   │       │   ├── user-manager.ts        # User management
│   │       │   ├── retry-wrapper.ts       # DB retry logic
│   │       │   ├── migrations/            # SQL migrations
│   │       │   ├── seeds/                 # Seed data
│   │       │   └── pipelines/             # Data pipelines
│   │       ├── documents/             # Document Processing
│   │       │   ├── processor.ts           # PDF/image parsing
│   │       │   ├── store.ts               # Document storage
│   │       │   └── progress.ts            # Upload progress tracking
│   │       ├── errors/                # Custom Error Classes
│   │       │   ├── quota-exceeded.error.ts
│   │       │   └── key-exhaustion.error.ts
│   │       ├── mcp/                   # Model Context Protocol
│   │       │   ├── server.ts              # MCP server implementation
│   │       │   ├── unified-client.ts      # Unified MCP client
│   │       │   ├── tool-router.ts         # Built-in + external tool routing
│   │       │   ├── tool-tiers.ts          # Tool access tiers
│   │       │   ├── web-search.ts          # Google search integration
│   │       │   ├── deep-research.ts       # Research tool interface
│   │       │   ├── sequential-thinking.ts # Step-by-step reasoning
│   │       │   ├── firecrawl.ts           # Firecrawl web scraping
│   │       │   ├── filesystem.ts          # Filesystem access
│   │       │   ├── external-client.ts     # External MCP server client
│   │       │   ├── server-registry.ts     # MCP server registry
│   │       │   └── user-sandbox.ts        # User sandbox environment
│   │       ├── middlewares/           # Express Middleware
│   │       │   ├── api-key-auth.ts        # API key authentication
│   │       │   ├── api-key-limiter.ts     # TPM rate limiting
│   │       │   ├── chat-rate-limiter.ts   # Chat-specific rate limiting
│   │       │   ├── rate-limit-headers.ts  # OpenAI-compatible rate headers
│   │       │   ├── request-id.ts          # Request ID tracking
│   │       │   └── validation.ts          # Zod schema validation
│   │       ├── monitoring/            # Observability
│   │       │   ├── metrics.ts             # System metrics collection
│   │       │   ├── analytics.ts           # Usage analytics
│   │       │   └── alerts.ts              # Alert management
│   │       ├── ollama/                # Ollama Integration
│   │       │   ├── client.ts              # Ollama HTTP client
│   │       │   ├── agent-loop.ts          # A2A agent execution loop
│   │       │   ├── multi-model-client.ts  # Multi-model parallel generation
│   │       │   ├── api-key-manager.ts     # Cloud API key rotation (429/401 auto-swap)
│   │       │   ├── api-usage-tracker.ts   # Usage tracking & quota
│   │       │   └── connection-pool.ts     # Connection pooling
│   │       ├── plugins/               # Plugin System
│   │       │   ├── loader.ts              # Plugin loader
│   │       │   ├── registry.ts            # Plugin registry
│   │       │   └── types.ts               # Plugin type definitions
│   │       ├── routes/                # REST API Endpoints (22 route files)
│   │       │   ├── index.ts               # Route aggregator
│   │       │   ├── v1/index.ts            # v1 API router
│   │       │   ├── chat.routes.ts
│   │       │   ├── agents.routes.ts
│   │       │   ├── api-keys.routes.ts
│   │       │   ├── research.routes.ts
│   │       │   ├── documents.routes.ts
│   │       │   ├── mcp.routes.ts
│   │       │   ├── memory.routes.ts
│   │       │   ├── canvas.routes.ts
│   │       │   ├── marketplace.routes.ts
│   │       │   ├── metrics.routes.ts
│   │       │   ├── usage.routes.ts
│   │       │   ├── model.routes.ts
│   │       │   ├── nodes.routes.ts
│   │       │   ├── push.routes.ts
│   │       │   ├── web-search.routes.ts
│   │       │   ├── audit.routes.ts
│   │       │   ├── token-monitoring.routes.ts
│   │       │   ├── agents-monitoring.routes.ts
│   │       │   ├── developer-docs.routes.ts
│   │       │   └── external.routes.ts
│   │       ├── schemas/               # Zod Validation Schemas
│   │       ├── services/              # Business Logic
│   │       │   ├── ChatService.ts         # Central chat orchestration
│   │       │   ├── DeepResearchService.ts # Autonomous research agent
│   │       │   ├── MemoryService.ts       # Long-term memory management
│   │       │   ├── ApiKeyService.ts       # API key lifecycle
│   │       │   └── AuthService.ts         # User authentication
│   │       ├── sockets/               # WebSocket
│   │       │   └── handler.ts             # Real-time streaming & heartbeat
│   │       ├── types/                 # TypeScript Type Definitions
│   │       ├── ui/                    # CLI UI Components
│   │       ├── utils/                 # Utilities
│   │       │   ├── logger.ts              # Winston-based logging
│   │       │   ├── error-handler.ts       # Global error handling
│   │       │   ├── api-response.ts        # Standardized response format
│   │       │   ├── input-sanitizer.ts     # Input sanitization
│   │       │   └── token-tracker.ts       # Token counting
│   │       ├── bootstrap.ts           # Service initialization
│   │       ├── cli.ts                 # CLI entry point (Commander.js)
│   │       ├── dashboard.ts           # Dashboard server
│   │       ├── server.ts              # HTTP server bootstrap
│   │       └── swagger.ts             # Swagger/OpenAPI config
│   │
│   └── workers/                       # Background Workers (npm workspace)
│
├── frontend/
│   └── web/
│       └── public/
│           ├── app.js                     # Main app (WebSocket, Chat, Auth)
│           ├── js/
│           │   ├── spa-router.js          # Custom SPA router (History API)
│           │   ├── main.js                # Module initializer
│           │   ├── nav-items.js           # Navigation configuration
│           │   ├── modules/
│           │   │   ├── auth.js            # Authentication module
│           │   │   ├── chat.js            # Chat module
│           │   │   ├── websocket.js       # WebSocket management
│           │   │   ├── state.js           # Application state
│           │   │   ├── settings.js        # Settings module
│           │   │   ├── ui.js              # UI utilities
│           │   │   ├── utils.js           # Helper functions
│           │   │   ├── sanitize.js        # Input sanitization
│           │   │   └── pages/             # Page modules (22 pages)
│           │   │       ├── admin.js
│           │   │       ├── admin-metrics.js
│           │   │       ├── agent-learning.js
│           │   │       ├── alerts.js
│           │   │       ├── analytics.js
│           │   │       ├── api-keys.js
│           │   │       ├── audit.js
│           │   │       ├── canvas.js
│           │   │       ├── cluster.js
│           │   │       ├── custom-agents.js
│           │   │       ├── developer.js
│           │   │       ├── external.js
│           │   │       ├── guide.js
│           │   │       ├── history.js
│           │   │       ├── marketplace.js
│           │   │       ├── mcp-tools.js
│           │   │       ├── memory.js
│           │   │       ├── password-change.js
│           │   │       ├── research.js
│           │   │       ├── settings.js
│           │   │       ├── token-monitoring.js
│           │   │       └── usage.js
│           │   └── components/
│           │       ├── unified-sidebar.js
│           │       ├── sidebar.js
│           │       ├── admin-panel.js
│           │       ├── install-prompt.js
│           │       └── offline-indicator.js
│           ├── css/
│           │   ├── design-tokens.css
│           │   ├── light-theme.css
│           │   ├── glassmorphism.css
│           │   ├── animations.css
│           │   ├── components.css
│           │   ├── layout.css
│           │   ├── icons.css
│           │   ├── unified-sidebar.css
│           │   ├── dark-sidebar.css
│           │   ├── feature-cards.css
│           │   └── pages/
│           ├── style.css
│           ├── service-worker.js
│           ├── manifest.json
│           ├── index.html
│           ├── login.html
│           ├── admin.html
│           └── *.html                     # 15+ additional page shells
│
├── services/                              # Microservices Architecture (Future)
│   ├── ai-service/                        # Python (FastAPI) — AI inference
│   ├── api-gateway/                       # Go — API gateway & routing
│   ├── web-frontend/                      # Next.js/React — Modern frontend
│   └── database/                          # SQL migrations & schemas
│
├── ai/                                    # AI Configuration
│   ├── agents/                            # Agent prompt templates & learning data
│   └── models/                            # Model configuration
│
├── scripts/
│   ├── deploy-frontend.sh                 # Frontend build & deploy
│   ├── migrate-sqlite-to-pg.py            # SQLite → PostgreSQL migration
│   └── generate-spa-modules.js            # SPA module generator
│
├── data/                                  # Runtime data directory
├── design/                                # Design assets
├── docs/                                  # Internal documentation
│   ├── api/                               # API documentation
│   ├── architecture/                      # Architecture decisions
│   └── deployment/                        # Deployment guides
│
├── tests/
│   ├── e2e/                               # Playwright E2E tests
│   ├── integration/                       # Integration tests
│   ├── unit/                              # Unit tests
│   └── performance/                       # Performance benchmarks
│
├── .env.example                           # Environment template
├── package.json                           # Workspace root (npm workspaces)
├── playwright.config.ts                   # E2E test config
└── jest.config.js                         # Unit test config
---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js 18+ |
| **Language** | TypeScript 5.3 |
| **Backend Framework** | Express v5.2 |
| **Database** | PostgreSQL (pg driver, raw SQL via UnifiedDatabase) |
| **LLM Backend** | Ollama (local + cloud via API keys) |
| **WebSocket** | ws 8.18 |
| **Authentication** | JWT + Google OAuth 2.0 + GitHub OAuth |
| **Validation** | Zod 4 |
| **MCP** | @modelcontextprotocol/sdk |
| **OCR** | Tesseract.js 7 |
| **PDF** | pdf-parse |
| **Web Scraping** | Firecrawl |
| **Logging** | Winston |
| **Security** | Helmet, bcryptjs, CORS whitelist |
| **API Docs** | Swagger UI (swagger-jsdoc) |
| **Push Notifications** | web-push (VAPID) |
| **File Upload** | Multer |
| **Email** | Nodemailer |
| **Frontend** | Vanilla JavaScript (No Framework) |
| **Styling** | CSS Variables + Design Tokens + Glassmorphism |
| **PWA** | Service Worker + Web App Manifest |
| **Testing** | Jest + Playwright |
| **Package Manager** | npm (workspaces) |

---

## Development

### Workspace Structure

This project uses **npm workspaces**:

```
workspaces:
  - backend/api        # Express API server
  - backend/workers    # Background workers
  - frontend/web       # Web frontend
```

### Build Commands

```bash
# Build everything (TypeScript + frontend deploy)
npm run build

# Build backend only
npm run build:backend

# Build frontend only
npm run build:frontend

# Deploy frontend to backend dist/public
npm run deploy:frontend

# Development mode (concurrent backend + frontend)
npm run dev

# Run tests
npm test                  # Unit tests (Jest)
npm run test:e2e          # Playwright E2E
npm run test:e2e:ui       # Playwright UI mode
npm run test:integration  # Integration tests

# Lint
npm run lint

# Clean build artifacts
npm run clean
```

### Database

The database schema is managed via raw SQL in `UnifiedDatabase` class (`backend/api/src/data/models/unified-database.ts`). Tables are auto-created on first startup.

**Key Tables**: `users`, `conversation_sessions`, `conversation_messages`, `user_memories`, `research_sessions`, `research_steps`, `agent_marketplace`, `api_usage`, `canvas_documents`

### Coding Standards

- **TypeScript**: Strict mode. No `as any`, `@ts-ignore`, or `@ts-expect-error`.
- **Database**: All queries use `async/await` with parameterized queries (SQL injection safe).
- **Frontend**: Vanilla JS only — no React/Vue/Angular.
- **API**: Standardized response format via `success()` / `error()` helpers.
- **Error Handling**: Custom error classes (`QuotaExceededError`, `KeyExhaustionError`) + centralized handler.

---

## Deployment

### Production

```bash
# 1. Build
npm run build

# 2. Start (Cluster mode)
NODE_ENV=production node backend/api/dist/cli.js cluster --port 52416
```

### Adding Ollama Nodes

Access the Admin panel (`/admin`) or use the CLI to manage cluster nodes:

```bash
# View cluster nodes
node backend/api/dist/cli.js nodes
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Guidelines

- Follow existing code patterns and conventions
- Write TypeScript — no plain JavaScript in `backend/`
- Test your changes before submitting
- Keep commits atomic and descriptive

---

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built with <a href="https://ollama.com">Ollama</a> &bull;
  Powered by open-source LLMs
</p>
