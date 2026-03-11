<!-- Parent: ../../AGENTS.md -->
# Backend (Express/TypeScript) — AI Skill Guide

> 이 파일은 `backend/api/src/` 작업 시 AI 에이전트가 참조하는 스킬 가이드입니다.
> 모든 `@skill` 참조는 `.claude/skills/` 또는 OpenCode 에 설치된 실제 스킬입니다.

## Tech Context

- **Runtime**: Node.js + Bun (테스트)
- **Framework**: Express v5.2.1 + TypeScript 5.3
- **Database**: PostgreSQL 16 (`pg@8.18.0`)
- **Auth**: JWT + HttpOnly Cookie + OAuth (Google/GitHub)
- **LLM**: Ollama Local/Cloud + API Key Rotation
- **WebSocket**: `ws@8.18.3` (실시간 스트리밍)
- **Testing**: Bun Test (205 tests)

## Coding Rules

1. `as any`, `@ts-ignore`, `@ts-expect-error` 절대 금지
2. DB 호출 모두 `async/await` (pg Pool)
3. 기존 라우트 경로와 응답 포맷 변경 금지
4. `infrastructure/security/auth/` 수정 금지
5. Docker/컨테이너화(Dockerfile, docker-compose, .dockerignore) 관련 개발 계획, 제안, 구현 금지 — 프로젝트 방침으로 영구 제외

## Installed Skills Reference

### Project Skills (`.claude/skills/`)

| Skill | Directory | Domain |
|-------|-----------|--------|
| `llm-app-patterns` | `.claude/skills/llm-app-patterns/` | LLM 에이전트, 프롬프트 체인, A2A, 파이프라인 프로파일, 모델 셀렉터 |
| `postgres-raw-sql` | `.claude/skills/postgres-raw-sql/` | UnifiedDatabase, 파라미터화 쿼리, 마이그레이션, 커넥션 풀 |
| `mcp-integration` | `.claude/skills/mcp-integration/` | MCP 서버/클라이언트, ToolRouter, 도구 티어, 외부 MCP 연동 |
| `auth-security-patterns` | `.claude/skills/auth-security-patterns/` | JWT 토큰, OAuth 2.0, API Key HMAC-SHA-256, 스코프 미들웨어 |
| `typescript-advanced` | `.claude/skills/typescript-advanced/` | 타입 정의, 제네릭, 유틸리티 타입, strict 모드 패턴 |
| `context-engineering` | `.claude/skills/context-engineering/` | 컨텍스트 윈도우 최적화, 토큰 관리 |
| `context-compactor` | `.claude/skills/context-compactor/` | 세션 요약, 컴팩션 |
| `context-state-tracker` | `.claude/skills/context-state-tracker/` | 크로스 세션 상태 추적 |
| `memory-manager` | `.claude/skills/memory-manager/` | 장기/단기 메모리, 크로스 세션 지식 |

### OpenCode Skills (Built-in & Installed)

| Skill | Domain |
|-------|--------|
| `backend-dev-guidelines` | Express + TS 미들웨어 레이어 패턴, 라우팅, 에러 핸들링 |
| `test-driven-development` | TDD Red-Green-Refactor 사이클 |
| `systematic-debugging` | 4단계 체계적 디버깅 프로세스 |
| `code-review-expert` | 코드 리뷰 (품질, 보안, 성능, 유지보수성) |
| `insecure-defaults` | 보안 감사 — 하드코딩된 시크릿, 취약한 인증, 허용적 보안 설정 탐지 |
| `verification-before-completion` | 작업 완료 전 검증 (빌드, 테스트, 린트 확인) |
| `differential-review` | PR/커밋/diff 보안 중심 차등 리뷰 |

## Skill Usage Guide

### Primary Skills (항상 참고)

| Skill | When |
|-------|------|
| `typescript-advanced` | 타입 정의, 제네릭, 유틸리티 타입, strict 모드 |
| `backend-dev-guidelines` | Express 미들웨어, 라우팅, 레이어 구조, 에러 핸들링 |

### API & Auth

| Skill | When |
|-------|------|
| `auth-security-patterns` | JWT 토큰, refresh rotation, OAuth 2.0 플로우, API Key HMAC, CORS, 입력 검증 |
| `insecure-defaults` | 보안 감사, 시크릿 유출 방지, 취약점 탐지 |

### Database

| Skill | When |
|-------|------|
| `postgres-raw-sql` | SQL 인젝션 방지, 파라미터화 쿼리, UnifiedDatabase 패턴, 마이그레이션, 쿼리 최적화 |

### AI/LLM (Ollama, 에이전트, MCP)

| Skill | When |
|-------|------|
| `llm-app-patterns` | A2A 병렬 생성, 에이전트 루프, 프롬프트 체인, 4-Pillar Framework, 파이프라인 프로파일 |
| `mcp-integration` | MCP 서버 구축, ToolRouter, 도구 티어, 외부 MCP 서버 연동 |
| `context-engineering` | 토큰 관리, 컨텍스트 윈도우 최적화 |
| `memory-manager` | 장기/단기 메모리 아키텍처, 크로스 세션 지식 |

### Testing & Debugging

| Skill | When |
|-------|------|
| `test-driven-development` | TDD Red-Green-Refactor 사이클 |
| `systematic-debugging` | 버그, 테스트 실패, 예상치 못한 동작 발생 시 |
| `verification-before-completion` | 작업 완료 선언 전 빌드/테스트/린트 확인 |

### Code Review & Security

| Skill | When |
|-------|------|
| `code-review-expert` | 코드 리뷰 — 품질, 보안, 성능, 유지보수성 |
| `differential-review` | PR/커밋 보안 중심 차등 리뷰, 블라스트 반경 분석 |
| `insecure-defaults` | 보안 감사 — 하드코딩 시크릿, fail-open 패턴 탐지 |

## Component → Skill Mapping

| Component | File(s) | Primary Skill |
|-----------|---------|---------------|
| Express Server | `server.ts` | `backend-dev-guidelines` |
| Chat Service | `services/ChatService.ts` | `llm-app-patterns` |
| Memory Service | `services/MemoryService.ts` | `memory-manager` |
| Agent Router | `agents/index.ts` | `llm-app-patterns` |
| Agent Loop | `ollama/agent-loop.ts` | `llm-app-patterns` |
| Ollama Client | `ollama/client.ts` | `llm-app-patterns` |
| API Key Manager | `ollama/api-key-manager.ts` | `auth-security-patterns` |
| 4-Pillar Prompt | `chat/context-engineering.ts` | `llm-app-patterns` |
| System Prompt | `chat/prompt.ts` | `llm-app-patterns` |
| Model Selector | `chat/model-selector.ts` | `llm-app-patterns` |
| MCP Tools | `mcp/tools.ts` | `mcp-integration` |
| MCP Server | `mcp/server.ts` | `mcp-integration` |
| MCP ToolRouter | `mcp/tool-router.ts` | `mcp-integration` |
| WebSocket | `sockets/handler.ts` | `backend-dev-guidelines` |
| Auth | `auth/` | `auth-security-patterns` |
| DB Layer | `data/` | `postgres-raw-sql` |
| Types | `types/` | `typescript-advanced` |
| Tests | `__tests__/` | `test-driven-development` |

---

## MCP (Model Context Protocol) 통합 아키텍처

> 2026-02-28 기준 정리. MCP 도구 토글 시스템 전면 정비 완료 후 확정된 아키텍처.

### 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Frontend (Vanilla JS)                         │
│                                                                       │
│  settings.js ─── MCP_TOOL_CATALOG ──┐                                 │
│       │                             ├─ localStorage 'mcpSettings'     │
│  loadMCPSettings()                  │   { thinking, webSearch, rag,   │
│  saveMCPSettings()                  │     enabledTools: {tool: bool} }│
│  toggleMCPModule()                  │                                 │
│       │                             │                                 │
│  state.js ─── AppState ─────────────┘                                 │
│       │   thinkingEnabled: bool                                       │
│       │   webSearchEnabled: bool                                      │
│       │   ragEnabled: bool                                            │
│       │   mcpToolsEnabled: {tool: bool}                               │
│       │                                                               │
│  chat.js ─── sendMessage() ─── WebSocket payload ────────────────┐    │
│       thinkingMode: getState('thinkingEnabled')                  │    │
│       webSearch:    getState('webSearchEnabled')                  │    │
│       ragEnabled:   getState('ragEnabled')                       │    │
│       enabledTools: getState('mcpToolsEnabled')                  │    │
│                                                                  │    │
│  modes.js ─── 채팅 입력창 토글 버튼 ───────────────────────┐     │    │
│       🧠 toggleThinkingMode()  → thinkingEnabled + enabledTools │    │
│       🌐 toggleWebSearch()     → webSearchEnabled + enabledTools│    │
│       🎯 toggleDiscussionMode()→ discussionMode + enabledTools  │    │
│       🔬 toggleDeepResearch()  → deepResearchMode + enabledTools│    │
└────────────────────────────────────────────────────────────┘─────┘────┘
                              │ WebSocket
                              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Backend (Express + TypeScript)                     │
│                                                                       │
│  sockets/ws-chat-handler.ts ─── handleChatMessage()                   │
│       │  msg.thinkingMode → ChatRequestHandler                        │
│       │  msg.webSearch    → pre-chat 웹 검색 (enabledTools.web_search 게이트)│
│       │  msg.enabledTools → ChatService.currentEnabledTools           │
│       │  msg.ragEnabled   → RAG 컨텍스트 검색                         │
│       │  msg.language     → 사용자 언어 감지 (detectLanguage)          │
│       ▼                                                               │
│  services/ChatService.ts ─── processMessage()                         │
│       │  getAllowedTools(tier, enabledTools)                           │
│       │  → ToolRouter.getFilteredTools()                              │
│       │  → 모델에 도구 목록 전달                                       │
│       ▼                                                               │
│  mcp/tool-router.ts ─── ToolRouter                                    │
│       │  내장 도구 (builtInTools) + 외부 도구 (ExternalMCPClient)      │
│       │  '::' 네임스페이스로 내장/외부 라우팅                           │
│       │  canUseTool(tier, toolName) 으로 접근 제어                     │
│       ▼                                                               │
│  mcp/tool-tiers.ts ─── TOOL_TIERS                                     │
│       free:       [web_search, vision_ocr, analyze_image]             │
│       pro:        [+ firecrawl_*]                                     │
│       enterprise: [* (전체)]                                          │
│       ▼                                                               │
│  mcp/unified-client.ts ─── UnifiedMCPClient (싱글톤)                  │
│       ├── MCPServer (내장 도구 JSON-RPC 2.0)                          │
│       ├── ToolRouter (내장+외부 통합 라우팅)                           │
│       └── MCPServerRegistry (외부 서버 연결 관리, DB 연동)             │
└─────────────────────────────────────────────────────────────────────────┘
```

### 도구 정의 — 3개 소스 (동기화 필수)

MCP 도구를 추가/수정할 때 아래 3곳을 **반드시 동시에** 수정해야 합니다.
`pages/settings.js`는 `window.MCP_TOOL_CATALOG`을 참조하므로 별도 수정 불필요.

| # | 위치 | 역할 | 파일 |
|---|------|------|------|
| 1 | Backend 도구 정의 | `MCPToolDefinition` 배열 (핸들러 포함) | `mcp/tools.ts` → `builtInTools` |
| 2 | Backend 티어 제어 | 등급별 접근 허용 목록 | `mcp/tool-tiers.ts` → `TOOL_TIERS` |
| 3 | Frontend 설정 UI | 마스터 도구 카탈로그 (6카테고리 15도구) | `js/modules/settings.js` → `MCP_TOOL_CATALOG` |

#### 현재 등록된 내장 도구 (10개)

| 카테고리 | 도구명 | 소스 모듈 | Free | Pro | Enterprise |
|----------|--------|-----------|:----:|:---:|:----------:|
| 비전 | `vision_ocr` | `tools.ts` | ✅ | ✅ | ✅ |
| 비전 | `analyze_image` | `tools.ts` | ✅ | ✅ | ✅ |
| 웹 검색 | `web_search` | `web-search.ts` | ✅ | ✅ | ✅ |
| 웹 검색 | `fact_check` | `web-search.ts` | ❌ | ❌ | ✅ |
| 웹 검색 | `extract_webpage` | `web-search.ts` | ❌ | ❌ | ✅ |
| 웹 검색 | `research_topic` | `web-search.ts` | ❌ | ❌ | ✅ |
| 스크래핑 | `firecrawl_scrape` | `firecrawl.ts` | ❌ | ✅ | ✅ |
| 스크래핑 | `firecrawl_search` | `firecrawl.ts` | ❌ | ✅ | ✅ |
| 스크래핑 | `firecrawl_map` | `firecrawl.ts` | ❌ | ✅ | ✅ |
| 스크래핑 | `firecrawl_crawl` | `firecrawl.ts` | ❌ | ✅ | ✅ |

> Firecrawl 도구는 `FIRECRAWL_API_KEY` 환경변수 설정 시에만 `builtInTools`에 포함됨.
> `sequential_thinking`은 도구가 아닌 프롬프트 인젝션 (`applySequentialThinking`)으로 처리됨.

### 도구 토글 데이터 흐름

```
[사용자 조작]
  설정 페이지:  toggleMCPTool('sequential_thinking') → enabledTools + AppState + 채팅 버튼 동기화
  채팅 입력창:  🧠 버튼 → toggleThinkingMode() → thinkingEnabled + enabledTools + saveMCPSettings()
  채팅 입력창:  🌐 버튼 → toggleWebSearch()    → webSearchEnabled + enabledTools + saveMCPSettings()
  채팅 입력창:  🎯 버튼 → toggleDiscussionMode() → discussionMode + enabledTools + saveMCPSettings()
  채팅 입력창:  🔬 버튼 → toggleDeepResearch()   → deepResearchMode + enabledTools + saveMCPSettings()

[저장소]
  localStorage 'mcpSettings' = {
    thinking: boolean,      ← enabledTools.sequential_thinking (레거시 호환)
    webSearch: boolean,     ← enabledTools.web_search (레거시 호환)
    rag: boolean,           ← enabledTools.rag (레거시 호환)
    enabledTools: {         ← mcpToolsEnabled (단일 진실 소스)
      sequential_thinking: true,
      discussion_mode: false,
      deep_research: false,
      web_search: false,
      rag: false,
      vision_ocr: false,
      ...
    }
  }

[WebSocket 전송]  chat.js sendMessage()
  payload = {
    thinkingMode:  getState('thinkingEnabled'),   // Boolean
    webSearch:     getState('webSearchEnabled'),   // Boolean
    ragEnabled:    getState('ragEnabled'),         // Boolean
    discussionMode: getState('discussionMode'),    // Boolean
    deepResearchMode: getState('deepResearchMode'),// Boolean
    enabledTools:  getState('mcpToolsEnabled'),    // {toolName: boolean}
    language:      generalSettings.lang || null,   // 사용자 명시 언어
  }

[백엔드 수신]  ws-chat-handler.ts
  msg.thinkingMode  → ChatRequestHandler.processChat({ thinkingMode })
  msg.webSearch     → pre-chat performWebSearch() (enabledTools.web_search 게이트)
  msg.enabledTools  → ChatService.getAllowedTools(tier, enabledTools)
  msg.ragEnabled    → RAG 컨텍스트 검색 여부
  msg.language      → userLangPreference || detectLanguage(message)
```

### MCP 모듈 디렉토리 구조

```
backend/api/src/mcp/
├── index.ts              # 배럴 내보내기 (모든 공개 API)
├── tools.ts              # 내장 도구 정의 (builtInTools 배열)
├── tool-tiers.ts         # 등급별 접근 제어 (TOOL_TIERS, canUseTool)
├── tool-router.ts        # 통합 도구 라우팅 (내장 + 외부, :: 네임스페이스)
├── unified-client.ts     # 싱글톤 MCP 클라이언트 (MCPServer + ToolRouter + Registry)
├── server.ts             # MCP JSON-RPC 2.0 서버
├── types.ts              # 타입 정의 (MCPTool, MCPToolResult 등)
├── sequential-thinking.ts# 단계별 추론 프롬프트 인젝션 (applySequentialThinking)
├── web-search.ts         # 웹 검색 도구 (web_search, fact_check 등)
├── deep-research.ts      # 심층 연구 도구
├── firecrawl.ts          # Firecrawl 스크래핑 도구 (조건부 로드)
├── filesystem.ts         # 샌드박스 파일시스템 도구
├── external-client.ts    # 외부 MCP 서버 클라이언트 (stdio/SSE 전송)
├── server-registry.ts    # 외부 서버 연결 관리 (DB 연동)
├── user-sandbox.ts       # 사용자 데이터 격리 (UserContext)
└── __tests__/            # 테스트 (tool-tiers, tool-router)
```

### 프론트엔드 MCP 관련 파일

```
frontend/web/public/
├── js/modules/
│   ├── settings.js       # MCP_TOOL_CATALOG, loadMCPSettings, saveMCPSettings, toggleMCPModule
│   ├── state.js          # AppState (thinkingEnabled, webSearchEnabled, ragEnabled, mcpToolsEnabled)
│   ├── modes.js          # 채팅 입력창 토글 (toggleThinkingMode → thinkingEnabled)
│   ├── chat.js           # sendMessage() — WebSocket 페이로드 구성
│   └── websocket.js      # WebSocket 연결 관리, 메시지 수신 핸들러
│   └── pages/
│       └── settings.js   # 설정 전용 페이지 toolCatalog (MCP_TOOL_CATALOG과 동기화 필수)
├── settings.html         # 설정 전용 페이지 (settings-standalone.js 로드)
└── js/settings-standalone.js  # settings.html용 독립 JS
```

### 삭제된 레거시 시스템 (2026-02-28 정리 완료)

아래 항목들은 사용되지 않는 코드로 확인되어 모두 제거됨.

| 삭제 항목 | 원래 위치 | 삭제 사유 |
|-----------|-----------|-----------|
| `MCPFeatureState` 인터페이스 | `unified-client.ts` | Dead code — 프론트엔드 미사용 |
| `featureState` Map + get/set | `unified-client.ts` | Dead code — REST/WS 경로 제거와 함께 삭제 |
| `GET/PUT /api/mcp/settings` | `routes/mcp.routes.ts` | Dead API — 프론트엔드 미호출 |
| `mcp_settings` WS 핸들러 | `sockets/handler.ts` | Dead handler — 프론트엔드 미호출 |
| `searchCodeTool` 정의 | `mcp/tools.ts` | 보안 패치 후 잔존하던 Dead code (125줄) |
| `run_command` 티어 항목 | `mcp/tool-tiers.ts` | 보안 패치로 도구 삭제 후 잔존 |
| `sequential_thinking` 티어 항목 | `mcp/tool-tiers.ts` | 도구가 아닌 프롬프트 인젝션이므로 티어 불필요 |
| `mcp-tools.html` 페이지 | `frontend/web/public/` | Dead page — MCP 도구 설정은 settings.html로 통합 |
| `mcp-tools.js` 모듈 | `frontend/web/public/js/modules/pages/` | Dead module — 위 페이지와 함께 삭제 |
| `syncMCPSettings()` 함수 | `error-handler.js`, `main.js` | Dead code — REST /api/mcp/settings 제거와 함께 삭제 |
| `mcp_settings_ack` WS 핸들러 | `websocket.js` | Dead handler — 서버 핸들러 제거와 함께 삭제 |
| `MCP_SETTINGS` 엔드포인트 | `api-endpoints.js` | Dead endpoint — REST 경로 제거와 함께 삭제 |
| `추론` 카테고리 (MCP_TOOL_CATALOG) | `settings.js`, `pages/settings.js` | sequential_thinking이 도구가 아닌 프롬프트 인젝션이므로 삭제 |
| `thinkingMode` 상태 키 | `state.js` | `thinkingEnabled`와 중복 — `thinkingEnabled`로 통일 |

### 수정 시 주의사항

1. **도구 추가/삭제 시 4곳 동시 수정** — 위 "4개 소스" 테이블 참조
2. **`sequential_thinking`은 도구가 아님** — `TOOL_TIERS`에 추가하지 말 것. `applySequentialThinking()`으로 프롬프트에 주입됨
3. **보안 패치로 삭제된 도구 복원 금지** — `run_command`(RCE), `read_file`/`write_file`(샌드박스 미적용). 안전한 대안은 `filesystem.ts` 참조
4. **`thinkingEnabled` 단일 키 사용** — 설정 페이지(`settings.js`)와 채팅 입력창(`modes.js`) 모두 동일한 `thinkingEnabled` 상태 키를 읽고 씀. `thinkingMode` 상태 키는 삭제됨
5. **localStorage 키는 `mcpSettings` 단일 사용** — 프론트엔드 전체에서 이 키만 MCP 토글 상태 저장에 사용

---

## Ollama Cloud API Key Pool 아키텍처

> 2026-02-28 기준 정리. 기존 Key-Model 1:1 인덱스 바인딩에서 모델 독립 Key Pool 라운드로빈으로 전환.

### 설계 원칙

1. **API 키와 모델은 완전 분리** — `OLLAMA_API_KEY_1~N`은 공유 풀, `OMK_ENGINE_*`이 모델 선택
2. **라운드로빈 순환** — 요청마다 다음 키를 자동 할당 (429 쿨다운 키 건너뛰기)
3. **5분 쿨다운** — `recordKeyFailure()` 기록 후 5분간 해당 키 스킵, 5분 후 자동 복귀
4. **싱글톤 안전** — JS 단일 스레드이므로 `roundRobinIndex` 카운터 레이스 컨디션 없음

### 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────┐
│                    .env 설정                                │
│                                                             │
│  OLLAMA_API_KEY_1 ─┐                                        │
│  OLLAMA_API_KEY_2 ─┤  Key Pool (모델 무관)                   │
│  OLLAMA_API_KEY_3 ─┤  → ApiKeyManager.keys[]                │
│  OLLAMA_API_KEY_4 ─┤                                        │
│  OLLAMA_API_KEY_5 ─┘                                        │
│                                                             │
│  OMK_ENGINE_LLM   = gpt-oss:120b-cloud    ─┐                │
│  OMK_ENGINE_PRO   = qwen3.5:397b-cloud     │ 모델 선택      │
│  OMK_ENGINE_FAST  = gemini-3-flash:cloud    │ (키와 독립)    │
│  OMK_ENGINE_THINK = gpt-oss:120b-cloud      │                │
│  OMK_ENGINE_CODE  = glm-5:cloud            ─┘                │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              ApiKeyManager (싱글톤)                          │
│                                                             │
│  keys: string[]           ← OLLAMA_API_KEY_1~N              │
│  roundRobinIndex: number  ← 순환 카운터                      │
│  keyFailures: Map<number, {lastFail, count, code}>          │
│                                                             │
│  ┌───────────────────────────────────────────────────┐      │
│  │ getNextAvailableKey(excludeIndex?)                │      │
│  │  1. roundRobinIndex부터 순회                       │      │
│  │  2. excludeIndex 스킵                             │      │
│  │  3. 쿨다운(5분) 중인 키 스킵                       │      │
│  │  4. 사용 가능한 키 인덱스 반환                      │      │
│  │  5. 모두 쿨다운이면 -1 반환                         │      │
│  └───────────────────────────────────────────────────┘      │
│                                                             │
│  getKeyByIndex(index) → 키 문자열 반환                       │
│  getAuthHeadersForIndex(index) → {Authorization: Bearer}    │
│  recordKeyFailure(index, code) → 쿨다운 등록                │
│  reportSuccess(index) → 쿨다운 해제                         │
└─────────────────────────────────────────────────────────────┘
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ OllamaClient │ │ OllamaClient │ │ OllamaClient │
│ (Chat)       │ │ (A2A-1)      │ │ (A2A-2)      │
│ boundKey: 0  │ │ boundKey: 1  │ │ boundKey: 2  │
│ model: any   │ │ model: any   │ │ model: any   │
└──────────────┘ └──────────────┘ └──────────────┘
```

### 호출 흐름

```
1. OllamaClient 생성 시:
   constructor() → getNextAvailableKey() → boundKeyIndex 할당
   → getKeyByIndex(boundKeyIndex) → this.apiKey 설정

2. 요청 시:
   chat/generate → axios interceptor → getAuthHeadersForIndex(boundKeyIndex)

3. 429 에러 시:
   interceptor catch 429 → recordKeyFailure(boundKeyIndex)
   → getNextAvailableKey(boundKeyIndex) → 새 키로 교체
   → 재시도

4. webSearch/webFetch:
   인스턴스별 boundKeyIndex 사용 → getAuthHeadersForIndex(boundKeyIndex)
```

### 삭제된 레거시 메서드 (Key-Model 1:1 바인딩)

| 삭제된 메서드/클래스 | 원래 위치 | 삭제 사유 |
|---------------------|-----------|-----------|
| `findKeyIndexForModel()` | `api-key-manager.ts` | 모델-키 1:1 바인딩 — Key Pool과 비호환 |
| `findAlternateKeyForModel()` | `api-key-manager.ts` | 동일 모델 대체 키 검색 — Key Pool 불필요 |
| `getKeyModelPair()` | `api-key-manager.ts` | 특정 인덱스의 키-모델 쌍 — 모델 분리로 불필요 |
| `getAllKeyModelPairs()` | `api-key-manager.ts` | 전체 키-모델 쌍 — 모델 분리로 불필요 |
| `MultiModelClientFactory` | `multi-model-client.ts` | 파일 전체 삭제 — Dead code |
| `createClientForIndex()` | `client.ts` | 인덱스별 클라이언트 — getNextAvailableKey로 대체 |
| `createAllClients()` | `client.ts` | 모든 키에 클라이언트 — Key Pool 패턴과 비호환 |
| `KeyModelPair` export | `index.ts` | 배럴 내보내기 정리 |

### 수정 시 주의사항

1. **API 키 추가 시** — `.env`에 `OLLAMA_API_KEY_N` 추가만 하면 자동 인식 (상한 없음)
2. **모델 변경 시** — `OMK_ENGINE_*` 환경변수만 수정, 키 설정 변경 불필요
3. **쿨다운 시간** — `api-key-manager.ts`의 `cooldownMs` (기본 5분), 필요 시 환경변수화 가능
4. **A2A 병렬 실행** — `createOllamaClient()` 순차 호출로 각 클라이언트가 서로 다른 키 할당됨
5. **webSearch/webFetch** — 반드시 `getAuthHeadersForIndex(this.boundKeyIndex)` 사용 (싱글톤 키 아님)
