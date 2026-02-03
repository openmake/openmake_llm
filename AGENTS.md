# OpenMake LLM — AI Agent Context

## Project Overview

OpenMake는 AI 어시스턴트 플랫폼으로, 다중 LLM 모델과 96개 이상의 산업별 에이전트 기반 대화를 제공합니다.
Ollama Local/Cloud 통합 클라이언트, 4-Pillar 프롬프트 프레임워크, Multi-turn Tool Calling, 멀티 에이전트 토론 등 고급 기능을 포함합니다.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Runtime** | Node.js + Bun (테스트) |
| **Backend** | Express v5.2.1 + TypeScript 5.3 |
| **Database** | PostgreSQL 16 (`pg@8.18.0`) — `openmake_llm` DB |
| **Auth** | JWT (`jsonwebtoken`) + HttpOnly Cookie (`cookie-parser`) + OAuth (Google/GitHub) |
| **LLM** | Ollama Local (`localhost:11434`) + Cloud Proxy (`ollama.com`) |
| **WebSocket** | `ws@8.18.3` — 실시간 채팅 스트리밍 |
| **Frontend** | Vanilla JavaScript (프레임워크 없음) |
| **Testing** | Bun Test (8 suites, 205 tests) |
| **E2E** | Playwright |

## Project Structure

```
openmake_llm/
├── backend/api/src/        # Express 서버 (TypeScript)
│   ├── server.ts           # 메인 서버 (502줄)
│   ├── controllers/        # 라우트 컨트롤러 (session, etc.)
│   ├── routes/             # Express 라우트 (model, metrics, etc.)
│   ├── auth/               # JWT 인증, token-blacklist
│   ├── agents/             # AI 에이전트 (96개 산업별 + 커스텀)
│   ├── services/           # ChatService, MemoryService 등
│   ├── ollama/             # Ollama Local/Cloud 클라이언트
│   ├── chat/               # 프롬프트 엔지니어링, 모델 선택
│   ├── mcp/                # MCP 도구 (web_search, vision_ocr 등)
│   ├── sockets/            # WebSocket 핸들러
│   ├── middlewares/        # Auth, rate-limit 미들웨어
│   ├── config/             # 상수, 설정
│   ├── data/               # 통합 DB 모듈 (PostgreSQL)
│   └── __tests__/          # Bun 테스트 (205개)
├── frontend/web/           # Vanilla JS 프론트엔드
├── ai/                     # AI 에이전트/모델 설정
├── database/               # DB 스키마, 마이그레이션
├── infrastructure/         # 인프라 설정
├── scripts/                # 유틸리티 스크립트
└── data/                   # 데이터 파일 (unified.db 백업 포함)
```

## Backend Architecture — Chat Flow

사용자 메시지가 응답으로 변환되는 전체 파이프라인:

```
Client (WebSocket/SSE)
  → sockets/handler.ts          # WebSocket 메시지 수신 및 디스패치
  → services/ChatService.ts     # 핵심 채팅 오케스트레이터
    → agents/index.ts           # 에이전트 스마트 라우팅 (키워드 + LLM)
    → chat/prompt.ts            # 시스템 프롬프트 빌드 (메타데이터, 가드레일)
    → chat/context-engineering.ts # 4-Pillar 프롬프트 구성
    → ollama/client.ts          # Ollama Local/Cloud 요청
    → ollama/agent-loop.ts      # Multi-turn Tool Calling (최대 5회)
    → mcp/tools.ts              # MCP 도구 실행 (web_search 등)
  → SSE 스트리밍 응답            # res.write('data: {...}\n\n')
```

## Ollama/Cloud Architecture

### Local vs Cloud 라우팅
- **Local Ollama**: `http://localhost:11434` — REST API (`/api/chat`, `/api/generate`)
- **Cloud Proxy**: 모델명이 `:cloud` 접미사를 가지면 (예: `gemini-3-flash-preview:cloud`) → `https://ollama.com`으로 라우팅
- `OllamaClient` 생성자에서 `isCloudModel()` 체크 → baseUrl 자동 전환

### API Key Rotation (Auto-failover)
- `.env` 파일에서 `OLLAMA_API_KEY_1`, `OLLAMA_API_KEY_2`, ... `OLLAMA_API_KEY_N` 순서로 로드
- 레거시 지원: `OLLAMA_API_KEY_PRIMARY`, `OLLAMA_API_KEY_SECONDARY`
- Axios 요청 인터셉터(interceptor)로 동적 API 키 주입
- 응답 인터셉터에서 401/403/429 에러 시 다음 키로 자동 순환
- 키당 최대 2회 실패 시 스와핑 (`maxFailures = 2`)

### Model Selector (`chat/model-selector.ts`)
- 한국어 비율 30% 이상 → `OLLAMA_KOREAN_MODEL` (기본: `gemini-3-flash-preview:cloud`)
- 코딩/기술 키워드 감지 → `OLLAMA_MODEL` (기본: `gemini-3-flash-preview:cloud`)
- 환경변수로 모델 오버라이드 가능

## 4-Pillar Prompt System

`chat/context-engineering.ts`에 구현된 프롬프트 아키텍처:

### FourPillarPrompt 구조
```typescript
interface FourPillarPrompt {
  role: RoleDefinition;       // 역할 및 페르소나 (persona, expertise, tone)
  constraints: Constraint[];  // 제약 조건 (priority: critical~low, category: security~behavior)
  goal: string;               // 목표
  outputFormat: OutputFormat;  // 출력 형식 (json/markdown/plain/code/table)
}
```

### 6대 원칙
1. **4-Pillar Framework**: 역할, 제약, 목표, 출력형식 분리
2. **XML Tagging**: `<metadata>`, `<system_rules>`, `<instruction>` 태그로 구획화
3. **Dynamic Metadata**: 현재 날짜, 지식 기준일, 세션 ID 자동 주입
4. **Position Engineering**: 프롬프트 내 배치 위치 최적화
5. **Soft Interlock**: 답변 전 5단계 사고 프로세스 (의도분석→정보호출→안전검토→논리설계→최종검토)
6. **Epistemic Gradient**: 확실성 5단계 ([확실]~[모름/한계]) 명시적 표현

### System Prompt (`chat/prompt.ts`)
`getEnhancedBasePrompt()` → 다음을 포함한 시스템 프롬프트 생성:
- 지식 기준 시점 및 환각 방지 (Knowledge Cutoff)
- 인식적 구배 (Epistemic Gradient)
- 언어 규칙 (한국어 질문 → 한국어 답변)
- 안전 가드레일 (유해 콘텐츠 거부, Jailbreak 방어, PII 보호)
- 마크다운 형식 지침

## Agent System (96+ Industry Agents)

### 에이전트 데이터
- **정의**: `agents/industry-agents.json` — 96개 산업별 전문가 에이전트
- **프롬프트**: `agents/prompts/` — 36+ `.md` 프롬프트 파일, 16개 산업 카테고리
  - 루트: agent, assistant, coder, consultant, researcher, writer 등
  - 하위: agriculture(3), business(9), creative(7), education(4), finance(9), healthcare(7), legal(5), technology(11) 등

### Smart Routing (Intent-based)
- **키워드 매칭**: `agents/index.ts` — `TOPIC_CATEGORIES[]` 배열로 일상 언어 → 에이전트 매핑
  - 예: "앱 만들어줘" → `software-engineer`, "주식 투자" → `financial-advisor`
- **LLM Routing**: `agents/llm-router.ts` — 키워드 매칭 실패 시 LLM에게 최적 에이전트 선택 요청
- **기본 에이전트**: `general` — 매핑 불가 시 범용 AI 어시스턴트

### 확장 기능
- **Discussion Engine** (`agents/discussion-engine.ts`): 여러 에이전트가 참여하는 멀티 에이전트 토론
- **Custom Builder** (`agents/custom-builder.ts`): 사용자 정의 에이전트 생성

## Agent Loop and MCP Tools

### Multi-turn Tool Calling (`ollama/agent-loop.ts`)
- Ollama의 Tool Calling 기능 활용한 자동 도구 실행 루프
- 최대 반복: `maxIterations` (기본 5회) — 무한 루프 방지
- 스트리밍 지원: `onToken` (토큰 콜백), `onToolCall` (도구 호출 콜백)
- 도구 결과를 자동으로 대화 히스토리에 추가 후 LLM 재호출

### MCP Tools (`mcp/` 디렉토리)
| Tool | Purpose |
|------|---------|
| `web_search` | 웹 검색 |
| `web_fetch` | 웹 페이지 가져오기 |
| `vision_ocr` | 이미지 OCR |
| `firecrawl` | 웹 크롤링 |
| `sequential-thinking` | 순차적 사고 서버 |
| `filesystem` | 파일 시스템 접근 |

### Tool Tier System (`mcp/tool-tiers.ts`)
- `UserTier` 등급별 도구 접근 제한
- `canUseTool(tier, toolName)` → 사용 가능 여부 확인

## Key Services

| Service | File | Purpose |
|---------|------|---------|
| **ChatService** | `services/ChatService.ts` | 핵심 채팅 오케스트레이터 — 에이전트 라우팅, 문서 컨텍스트, MCP 도구, 토론 모드, API 사용량 추적 |
| **MemoryService** | `services/MemoryService.ts` | 장기 사용자 메모리 — 대화에서 중요 정보 자동 추출, 관련 메모리 컨텍스트 주입 |
| **WebSocketHandler** | `sockets/handler.ts` | WebSocket 진입점 — 메시지 디스패치, 클러스터 이벤트, MCP 초기 데이터 |
| **OllamaClient** | `ollama/client.ts` | 통합 LLM 클라이언트 — Local/Cloud 라우팅, API 키 순환, Axios 인터셉터 |
| **ApiKeyManager** | `ollama/api-key-manager.ts` | N개 API 키 자동 순환 — OLLAMA_API_KEY_1..N, 401/403/429 자동 폴백 |
| **AgentLoop** | `ollama/agent-loop.ts` | Multi-turn Tool Calling — 스트리밍, 최대 반복 제한 |
| **ContextEngineering** | `chat/context-engineering.ts` | 4-Pillar 프롬프트 프레임워크 — 역할, 제약, 목표, 출력형식 |
| **PromptBuilder** | `chat/prompt.ts` | 시스템 프롬프트 — 메타데이터, 인식적 구배, 안전 가드레일 |
| **ModelSelector** | `chat/model-selector.ts` | 모델 자동 선택 — 한국어 비율, 코딩 키워드 감지 |
| **AgentRouter** | `agents/index.ts` | 의도 기반 스마트 라우팅 — 키워드 + LLM 에이전트 선택 |
| **DiscussionEngine** | `agents/discussion-engine.ts` | 멀티 에이전트 토론 모드 |

## Key Backend File Map

```
backend/api/src/
├── server.ts                    # Express 서버 진입점 (502줄)
├── services/
│   ├── ChatService.ts           # AI 채팅 핵심 서비스
│   └── MemoryService.ts         # 장기 메모리 관리
├── ollama/
│   ├── client.ts                # Ollama Local/Cloud 통합 클라이언트
│   ├── agent-loop.ts            # Multi-turn Tool Calling 루프
│   ├── api-key-manager.ts       # N개 API 키 자동 순환
│   ├── api-usage-tracker.ts     # API 사용량 추적
│   ├── connection-pool.ts       # 커넥션 풀
│   └── types.ts                 # 타입 정의
├── chat/
│   ├── context-engineering.ts   # 4-Pillar 프롬프트 프레임워크
│   ├── prompt.ts                # 시스템 프롬프트 빌더
│   ├── prompt-enhancer.ts       # 프롬프트 최적화
│   └── model-selector.ts        # 모델 자동 선택
├── agents/
│   ├── index.ts                 # 에이전트 라우터 (23KB)
│   ├── industry-agents.json     # 96개 산업별 에이전트 정의
│   ├── llm-router.ts            # LLM 기반 에이전트 선택
│   ├── discussion-engine.ts     # 멀티 에이전트 토론
│   ├── custom-builder.ts        # 커스텀 에이전트 빌더
│   ├── types.ts                 # 에이전트 타입
│   ├── monitor.ts               # 에이전트 모니터링
│   └── prompts/                 # 36+ 산업별 프롬프트 (16 카테고리)
├── mcp/
│   ├── tools.ts                 # MCP 도구 정의
│   ├── tool-tiers.ts            # 도구 티어 (사용자 등급별)
│   ├── sequential-thinking.ts   # Sequential Thinking 서버
│   └── user-sandbox.ts          # 사용자 샌드박스
├── sockets/
│   └── handler.ts               # WebSocket 핸들러
├── auth/                        # JWT/Cookie/OAuth 인증
├── documents/                   # 문서 업로드/처리/분석
├── data/                        # 통합 DB 모듈 (PostgreSQL)
├── controllers/                 # 라우트 컨트롤러
├── routes/                      # Express 라우트
├── middlewares/                 # Auth, rate-limit 미들웨어
├── plugins/                     # 동적 플러그인 (~/.ollama-coder/plugins)
├── cluster/                     # 클러스터 매니저
├── errors/                      # 커스텀 에러 (QuotaExceededError 등)
├── utils/                       # 유틸리티 (logger 등)
├── config/                      # 설정 상수
└── __tests__/                   # Bun 테스트 (205개)
```

## Key Commands

```bash
# Dev server (port 52416)
npm run dev

# TypeScript check
cd backend/api && npx tsc --noEmit

# Run tests (205 tests)
cd backend/api && bun test

# PostgreSQL
/opt/homebrew/Cellar/postgresql@16/16.11_1/bin/psql -d openmake_llm
```

## Coding Guidelines

1. **TypeScript**: 절대 `as any`, `@ts-ignore`, `@ts-expect-error` 사용 금지
2. **Async**: DB 호출은 모두 `async/await` (pg Pool 사용)
3. **Auth**: Authorization header와 Cookie 인증 모두 지원 (하위 호환)
4. **Frontend**: Vanilla JS만 사용 — React, Vue 등 프레임워크 추가 금지
5. **API**: 기존 라우트 경로와 응답 포맷 변경 금지
6. **DB**: `./data/unified.db` SQLite 파일 삭제 금지 (백업)
7. **Dead Code**: `infrastructure/security/auth/` 수정 금지
8. **Tests**: 테스트 삭제로 빌드 통과시키기 금지 — 코드를 수정할 것

## AI Skills Available

### Antigravity Skills (621 SKILL.md files)
- **Gemini CLI**: `.gemini/skills/skills/[skill-name]/SKILL.md`
- **Antigravity IDE**: `.agent/skills/skills/[skill-name]/SKILL.md`
- **Invoke**: `@skill-name` 또는 `Use skill-name`

### Vibeship Spawner Skills (462 YAML skills)
- **Location**: `.spawner/skills/[category]/[skill-name]/`
- **Format**: `skill.yaml`, `sharp-edges.yaml`, `validations.yaml`, `collaboration.yaml`
- **Invoke**: `Read: .spawner/skills/[category]/[skill-name]/skill.yaml`

### Most Relevant Skills for This Project

| Skill | Source | Why |
|-------|--------|-----|
| `typescript-expert` | Antigravity | 백엔드 전체 TypeScript |
| `backend-dev-guidelines` | Antigravity | Express/Node.js/TS 패턴 |
| `postgres-best-practices` | Antigravity | PostgreSQL 최적화 |
| `llm-app-patterns` | Antigravity | LLM 앱 아키텍처 |
| `api-security-best-practices` | Antigravity | API 보안 |
| `auth-implementation-patterns` | Antigravity | JWT/OAuth/Cookie 인증 |
| `prompt-engineering` | Antigravity | AI 프롬프트 최적화 |
| `context-window-management` | Antigravity | LLM 컨텍스트 관리 |
| `nodejs-best-practices` | Antigravity | Node.js 운영 |
| `systematic-debugging` | Antigravity | 체계적 디버깅 |
| `backend/backend` | Vibeship | 백엔드 아키텍처 가드레일 |
| `data/postgres-wizard` | Vibeship | PostgreSQL 전문가 |
| `ai/llm-architect` | Vibeship | LLM 통합 |
| `ai-agents/autonomous-agents` | Vibeship | AI 에이전트 설계 |
| `security/auth-specialist` | Vibeship | 인증 전문가 |
| `frontend/frontend` | Vibeship | 프론트엔드 가드레일 |

### Skill to Backend Component Mapping

| Backend Component | Antigravity Skill | Vibeship Skill |
|-------------------|-------------------|----------------|
| Ollama Client/Cloud | `@llm-app-patterns` | `ai/llm-architect` |
| Agent System (96+) | `@ai-agents-architect` | `ai-agents/autonomous-agents` |
| 4-Pillar Prompt | `@prompt-engineering`, `@context-window-management` | — |
| MCP Tools | `@tool-using-agents` | — |
| API Key Manager | `@api-security-best-practices` | `security/auth-specialist` |
| PostgreSQL | `@postgres-best-practices` | `data/postgres-wizard` |
| WebSocket/SSE | `@backend-dev-guidelines` | `backend/backend` |
| Express Server | `@nodejs-best-practices` | `backend/api-design` |
| Auth (JWT/Cookie) | `@auth-implementation-patterns` | `security/auth-specialist` |
