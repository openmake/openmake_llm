<p align="center">
  <img src="frontend/web/public/icons/icon-192x192.png" alt="OpenMake.AI" width="80" />
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
| **Sequential Thinking** | 단계별 논리적 추론 체인 — 복잡한 문제를 6단계로 분해하여 해결 |
| **Long-term Memory** | 사용자별 장기 기억 시스템 — 대화에서 중요 정보를 자동 추출 및 재활용 |

### Platform

| Feature | Description |
|---------|-------------|
| **MCP Integration** | Model Context Protocol 지원 — 외부 MCP 서버 연결 및 도구 라우팅 |
| **Cluster Management** | 분산 Ollama 노드 관리 — 헬스체크, 레이턴시 모니터링, 자동 로드밸런싱 |
| **API Key Service** | 외부 개발자용 API Key 발급/관리 — 사용량 추적, Rate Limiting, 모델별 접근 제어 |
| **OAuth & RBAC** | Google OAuth 2.0 소셜 로그인 + JWT 기반 역할 접근 제어 (admin/user/guest) |
| **PWA Support** | Progressive Web App — 오프라인 캐싱, 홈 화면 설치, Push 알림 |
| **Web Search** | Google Custom Search 통합 — 실시간 웹 정보를 AI 컨텍스트에 주입 |
| **Document Analysis** | PDF 파싱, OCR (Tesseract.js) — 업로드 문서를 대화 컨텍스트에 포함 |
| **Canvas** | 무한 캔버스 — 시각적 협업 및 다이어그램 작성 |

### Developer Experience

| Feature | Description |
|---------|-------------|
| **CLI Tools** | `chat`, `ask`, `review`, `generate`, `explain` — 터미널에서 직접 AI 활용 |
| **Swagger API Docs** | 자동 생성 API 문서 (`/api-docs`) |
| **Developer Portal** | API 사용법, 코드 예제, Rate Limit 안내 페이지 (`/developer.html`) |
| **Plugin System** | 확장 가능한 플러그인 아키텍처 |

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
│  │  (v1 Routes)│  │  (Streaming) │  │  JWT/OAuth/APIKey │   │
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
│  ┌───────────────────────┴───────────────────────────────┐   │
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
│ PipelineProfile  │  Brand model → 10가지 실행 전략 결정
│ (7 profiles)     │  (engine, A2A, thinking, discussion, prompt, loop...)
└────────┬─────────┘
         ▼
┌──────────────────┐
│  ModelSelector   │  질문 유형 분석 (code/math/creative/vision/chat)
│  (Auto-Routing)  │  → 최적 brand profile 선택 (auto 모드 시)
└────────┬─────────┘
         ▼
┌──────────────────┐
│ ContextEngineering│ 4-Pillar Framework로 시스템 프롬프트 구성
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
- **Ollama** ([install](https://ollama.ai))

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

# Tables are auto-created on first startup
```

### 4. Build & Run

```bash
# Build backend (TypeScript → JavaScript)
cd backend/api && npx tsc && cd ../..

# Deploy frontend
bash scripts/deploy-frontend.sh

# Start server (Cluster mode with Web UI)
node backend/api/dist/cli.js cluster --port 52416
```

### 5. Access

- **Web UI**: `http://localhost:52416`
- **API Docs**: `http://localhost:52416/api-docs`
- **Developer Portal**: `http://localhost:52416/developer.html`

### CLI Usage (Optional)

```bash
# Interactive chat
node backend/api/dist/cli.js chat

# Single question
node backend/api/dist/cli.js ask "Explain quicksort"

# Code review
node backend/api/dist/cli.js review ./src/app.ts

# Code generation
node backend/api/dist/cli.js generate "REST API with Express" -l typescript
```

---

## Configuration

### Environment Variables (`.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| **Server** | | |
| `PORT` | Server port | `52416` |
| `NODE_ENV` | Environment | `development` |
| `SERVER_HOST` | Server hostname | `localhost` |
| **Database** | | |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://openmake:...@localhost:5432/openmake_llm` |
| **Ollama** | | |
| `OLLAMA_HOST` | Ollama server URL | `http://localhost:11434` |
| `OLLAMA_MODEL` | Default model | `gemini-3-flash-preview:cloud` |
| `OLLAMA_API_KEY_1..5` | Cloud API keys (rotation) | — |
| `OLLAMA_MODEL_1..5` | Per-key model assignment (A2A) | — |
| **Auth** | | |
| `JWT_SECRET` | JWT signing key | — |
| `ADMIN_EMAILS` | Admin email addresses | — |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | — |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | — |
| **Search** | | |
| `GOOGLE_API_KEY` | Google Custom Search API key | — |
| `GOOGLE_CSE_ID` | Custom Search Engine ID | — |
| **Limits** | | |
| `OLLAMA_HOURLY_LIMIT` | Requests per hour per key | `150` |
| `RATE_LIMIT_MAX` | Global rate limit | `100` |

> See `.env.example` for the full template with all options.

---

## API Reference

### Base URL

```
http://your-server:52416/api/v1
```

### Authentication

```bash
# Header (Recommended)
X-API-Key: omk_live_sk_xxxxxxxxxxxxxxxxxxxx

# Bearer Token
Authorization: Bearer omk_live_sk_xxxxxxxxxxxxxxxxxxxx
```

### Endpoints

#### Chat

```http
POST /api/v1/chat
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | string | **Required.** User message |
| `model` | string | **Required.** Model alias (e.g., `openmake_llm`, `openmake_llm_auto`) |
| `sessionId` | string | Optional. Continue a conversation |
| `history` | array | Optional. Previous messages `[{role, content}]` |

**Response:**

```json
{
  "success": true,
  "data": {
    "response": "AI assistant's reply...",
    "sessionId": "uuid",
    "model": "openmake_llm"
  }
}
```

#### Models

```http
GET /api/v1/models
```

Returns the list of available brand models.

#### Usage

```http
GET /api/v1/usage
GET /api/v1/usage/daily?days=7
```

Returns API usage statistics.

#### API Keys

```http
POST   /api/v1/api-keys          # Create key
GET    /api/v1/api-keys          # List keys
GET    /api/v1/api-keys/:id      # Get key details
DELETE /api/v1/api-keys/:id      # Delete key
POST   /api/v1/api-keys/:id/rotate  # Rotate key
```

> Full interactive API docs available at `/api-docs` (Swagger UI).

---

## Project Structure

```
openmake_llm/
├── backend/
│   └── api/
│       └── src/
│           ├── agents/              # Agent system
│           │   ├── discussion-engine.ts   # Multi-model debate orchestration
│           │   ├── llm-router.ts          # LLM-based intent routing
│           │   ├── custom-builder.ts      # Custom agent creation
│           │   └── learning.ts            # Agent performance tracking (RLHF)
│           ├── auth/                # Authentication
│           │   ├── index.ts               # JWT verification & middleware
│           │   ├── middleware.ts           # requireAuth, optionalAuth
│           │   ├── oauth-provider.ts      # Google OAuth 2.0
│           │   └── api-key-utils.ts       # API key hashing (HMAC-SHA-256)
│           ├── chat/                # Chat Pipeline Engine
│           │   ├── pipeline-profile.ts    # 7 brand model profile definitions
│           │   ├── profile-resolver.ts    # Alias → ExecutionPlan resolution
│           │   ├── model-selector.ts      # Query analysis & auto-routing
│           │   ├── context-engineering.ts  # 4-Pillar prompt framework
│           │   ├── prompt.ts              # System prompt generation
│           │   └── prompt-enhancer.ts     # Dynamic prompt enhancement
│           ├── cluster/             # Distributed Node Management
│           │   └── manager.ts             # Health check, load balancing, failover
│           ├── config/              # Environment configuration
│           │   └── env.ts                 # Typed config from .env
│           ├── data/                # Database Layer
│           │   ├── models/
│           │   │   └── unified-database.ts  # PostgreSQL abstraction (all domains)
│           │   ├── migrations/            # Schema migrations
│           │   └── conversation-db.ts     # Conversation CRUD
│           ├── mcp/                 # Model Context Protocol
│           │   ├── server.ts              # MCP server implementation
│           │   ├── unified-client.ts      # Unified MCP client interface
│           │   ├── tool-router.ts         # Built-in + external tool routing
│           │   ├── web-search.ts          # Google search integration
│           │   ├── deep-research.ts       # Research tool interface
│           │   └── sequential-thinking.ts # Step-by-step reasoning tool
│           ├── middlewares/          # Express Middleware
│           │   ├── api-key-auth.ts        # API key authentication
│           │   ├── api-key-limiter.ts     # TPM rate limiting
│           │   ├── rate-limit-headers.ts  # OpenAI-compatible rate headers
│           │   └── validation.ts          # Zod schema validation
│           ├── ollama/              # Ollama Integration
│           │   ├── client.ts              # Ollama HTTP client
│           │   ├── agent-loop.ts          # A2A agent execution loop
│           │   ├── multi-model-client.ts  # Multi-model parallel generation
│           │   ├── api-key-manager.ts     # Cloud API key rotation
│           │   └── api-usage-tracker.ts   # Usage tracking & quota
│           ├── routes/              # REST API Endpoints
│           │   ├── v1/index.ts            # v1 API router aggregate
│           │   ├── chat.routes.ts         # Chat endpoints
│           │   ├── api-keys.routes.ts     # API key management
│           │   ├── research.routes.ts     # Deep research endpoints
│           │   ├── mcp.routes.ts          # MCP tool management
│           │   ├── agents.routes.ts       # Agent CRUD
│           │   ├── memory.routes.ts       # Long-term memory
│           │   ├── canvas.routes.ts       # Canvas documents
│           │   └── ...                    # (20+ route files)
│           ├── services/            # Business Logic
│           │   ├── ChatService.ts         # Central chat orchestration
│           │   ├── DeepResearchService.ts # Autonomous research agent
│           │   ├── MemoryService.ts       # Long-term memory management
│           │   ├── ApiKeyService.ts       # API key lifecycle
│           │   └── AuthService.ts         # User authentication
│           ├── sockets/             # WebSocket
│           │   └── handler.ts             # Real-time streaming & heartbeat
│           ├── utils/               # Utilities
│           │   ├── logger.ts              # Winston-based logging
│           │   ├── error-handler.ts       # Global error handling
│           │   └── api-response.ts        # Standardized response format
│           ├── cli.ts               # CLI entry point (Commander.js)
│           ├── server.ts            # HTTP server bootstrap
│           └── swagger.ts           # Swagger/OpenAPI config
│
├── frontend/
│   └── web/
│       └── public/
│           ├── app.js                     # Main app (WebSocket, Chat, Auth)
│           ├── js/
│           │   ├── spa-router.js          # Custom SPA router (History API)
│           │   ├── modules/
│           │   │   └── pages/             # Page modules (22 pages)
│           │   │       ├── admin.js       #   System administration
│           │   │       ├── research.js    #   Deep research UI
│           │   │       ├── canvas.js      #   Infinite canvas
│           │   │       ├── memory.js      #   Memory viewer
│           │   │       ├── mcp-tools.js   #   MCP tool manager
│           │   │       ├── settings.js    #   User settings
│           │   │       ├── developer.js   #   API documentation
│           │   │       ├── api-keys.js    #   API key management
│           │   │       ├── cluster.js     #   Cluster status
│           │   │       └── ...            #   (22 page modules)
│           │   └── components/            # Reusable UI components
│           │       ├── unified-sidebar.js #   3-state sidebar
│           │       ├── admin-panel.js     #   Admin slide-out
│           │       └── ...
│           ├── css/
│           │   ├── design-tokens.css      # CSS variables (colors, spacing)
│           │   └── light-theme.css        # Light theme overrides
│           ├── style.css                  # Global styles
│           ├── service-worker.js          # PWA offline caching
│           ├── manifest.json              # PWA metadata
│           └── index.html                 # App shell
│
├── scripts/
│   ├── deploy-frontend.sh                # Frontend build & deploy
│   └── migrate-sqlite-to-pg.py          # SQLite → PostgreSQL migration
│
├── data/                                  # Runtime data directory
├── docs/                                  # Internal documentation
├── tests/                                 # E2E & integration tests
│   ├── e2e/                               # Playwright E2E tests
│   └── unit/                              # Unit tests
│
├── .env.example                           # Environment template
├── package.json                           # Workspace root (npm workspaces)
├── playwright.config.ts                   # E2E test config
└── jest.config.js                         # Unit test config
```

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js 18+ |
| **Language** | TypeScript 5.3 |
| **Backend Framework** | Express v5.2 |
| **Database** | PostgreSQL 16 |
| **LLM Backend** | Ollama (local + cloud) |
| **WebSocket** | ws 8.18 |
| **Authentication** | JWT + Google OAuth 2.0 |
| **Validation** | Zod 4 |
| **MCP** | @modelcontextprotocol/sdk |
| **OCR** | Tesseract.js 7 |
| **PDF** | pdf-parse |
| **Logging** | Winston |
| **API Docs** | Swagger UI |
| **Frontend** | Vanilla JavaScript (No Framework) |
| **Styling** | CSS Variables + Design Tokens |
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
# Build everything
npm run build

# Build backend only
npm run build:backend

# Build frontend only
npm run build:frontend

# Development mode (concurrent backend + frontend)
npm run dev

# Run tests
npm test                  # Unit tests
npm run test:e2e          # Playwright E2E
npm run test:e2e:ui       # Playwright UI mode
```

### Coding Standards

- **TypeScript**: Strict mode. No `as any`, `@ts-ignore`, or `@ts-expect-error`.
- **Database**: All queries use `async/await` with parameterized queries (SQL injection safe).
- **Frontend**: Vanilla JS only — no React/Vue/Angular.
- **API**: Standardized response format via `success()` / `error()` helpers.

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

Access the Admin panel (`/admin`) or use the API to register additional Ollama nodes:

```bash
# The cluster auto-discovers local Ollama at startup
# Additional nodes can be added via the admin UI
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
  Built with <a href="https://ollama.ai">Ollama</a> &bull;
  Powered by open-source LLMs
</p>
