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
