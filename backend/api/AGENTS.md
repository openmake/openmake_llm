# Backend (Express/TypeScript) — AI Skill Guide

> 이 파일은 `backend/api/src/` 작업 시 AI 에이전트가 참조하는 스킬 가이드입니다.

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

## Primary Skills (항상 참고)

| Skill | When |
|-------|------|
| `@typescript-expert` | 타입 정의, 제네릭, 유틸리티 타입 |
| `@nodejs-best-practices` | async 패턴, 에러 핸들링, 프로세스 관리 |
| `@nodejs-backend-patterns` | Express 미들웨어, 라우팅, 레이어 구조 |
| `@backend-dev-guidelines` | Express + TS 미들레이어 패턴 |
| `@backend-api-standards` | REST API 설계, HTTP 메서드, 상태 코드 |
| `@error-handling-patterns` | 커스텀 에러, 에러 전파, graceful degradation |

## API & Auth Skills

| Skill | When |
|-------|------|
| `@auth-patterns` | JWT 토큰, refresh rotation, OAuth 2.0 플로우 |
| `@auth-implementation-patterns` | 실제 인증 코드 패턴, 미들웨어 |
| `@api-security-best-practices` | Rate-limit, CORS, 입력 검증 |
| `@api-design` | REST/GraphQL API 설계 원칙 |

## Database Skills

| Skill | When |
|-------|------|
| `@backend-queries-standards` | SQL 인젝션 방지, N+1, 파라미터화 쿼리 |
| `@backend-models-standards` | 모델 정의, 제약조건, 관계 |
| `@backend-migration-standards` | 무중단 마이그레이션, 롤백 전략 |
| `@database-patterns` | SQL + TypeScript DB 패턴 |
| `@postgres-best-practices` | PostgreSQL 쿼리 최적화 |

## AI/LLM Skills (Ollama, 에이전트, MCP)

| Skill | When |
|-------|------|
| `@llm-app-patterns` | RAG, 에이전트, 프롬프트 체인 |
| `@ai-agents` | MCP 통합, 가드레일, 핸드오프 |
| `@ai-agents-architect` | 자율 에이전트 설계 |
| `@prompt-engineering` | 시스템 프롬프트 최적화 |
| `@context-window-management` | 토큰 관리, 요약, 트리밍 |
| `@context-optimization` | 토큰 비용 절감 |
| `@mcp-builder` | MCP 서버 구축 |
| `@rag-implementation` | 벡터 검색, 문서 청킹 |
| `@langchain-architecture` | LangChain 프레임워크 |
| `@memory-systems` | 장기/단기 메모리 아키텍처 |

## Testing Skills

| Skill | When |
|-------|------|
| `@testing-strategies` | 테스트 피라미드, AAA 패턴 |
| `@testing-anti-patterns` | mock 남용, 불완전 테스트 방지 |
| `@test-driven-development` | TDD Red-Green-Refactor |
| `@condition-based-waiting` | Flaky 테스트 해결 |
| `@systematic-debugging` | 4단계 체계적 디버깅 |

## Security Skills

| Skill | When |
|-------|------|
| `@software-security-appsec` | OWASP Top 10 |
| `@security-check` | 자동 보안 검사 |
| `@secrets-guardian` | .env 시크릿 유출 방지 |
| `@package-audit` | npm 의존성 취약점 |

## DevOps Skills

| Skill | When |
|-------|------|
| `@error-tracking` | Sentry v8 통합 |
| `@bunjs-architecture` | Bun.js 아키텍처 |
| `@bunjs-production` | Bun.js 프로덕션 배포 |
| `@dependency-upgrade` | 메이저 버전 업그레이드 |
| `@docker-expert` | Docker 멀티스테이지 빌드 |

## Component → Skill Mapping

| Component | File(s) | Primary Skill |
|-----------|---------|---------------|
| Express Server | `server.ts` | `@nodejs-best-practices` |
| Chat Service | `services/ChatService.ts` | `@llm-app-patterns` |
| Memory Service | `services/MemoryService.ts` | `@memory-systems` |
| Agent Router | `agents/index.ts` | `@ai-agents-architect` |
| Agent Loop | `ollama/agent-loop.ts` | `@ai-agents` |
| Ollama Client | `ollama/client.ts` | `@llm-app-patterns` |
| API Key Manager | `ollama/api-key-manager.ts` | `@api-security-best-practices` |
| 4-Pillar Prompt | `chat/context-engineering.ts` | `@prompt-engineering` |
| System Prompt | `chat/prompt.ts` | `@prompt-engineering` |
| Model Selector | `chat/model-selector.ts` | `@llm-app-patterns` |
| MCP Tools | `mcp/tools.ts` | `@mcp-builder` |
| WebSocket | `sockets/handler.ts` | `@backend-dev-guidelines` |
| Auth | `auth/` | `@auth-patterns` |
| DB Layer | `data/` | `@backend-queries-standards` |
| Tests | `__tests__/` | `@testing-strategies` |
