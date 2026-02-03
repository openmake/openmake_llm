# OpenMake LLM — Gemini CLI Instructions

@./AGENTS.md

## Gemini-Specific Guidelines

### Skill System
이 프로젝트에는 621개의 Antigravity Skills가 `.gemini/skills/`에 설치되어 있습니다.
태스크에 맞는 스킬을 `@skill-name` 구문으로 로드하세요.

### Priority Skills for This Project

**TypeScript/Backend** (항상 참조):
- `@typescript-expert` — TS 타입 시스템, 고급 패턴
- `@backend-dev-guidelines` — Express/Node.js/TypeScript 가이드
- `@nodejs-best-practices` — Node.js 운영 원칙

**Database** (DB 작업 시):
- `@postgres-best-practices` — PostgreSQL 쿼리/스키마 최적화
- `@database-design` — 스키마 설계
- `@sql-pro` — SQL 쿼리 작성

**AI/LLM** (AI 기능 개발 시):
- `@llm-app-patterns` — LLM 앱 아키텍처
- `@prompt-engineering` — 프롬프트 최적화
- `@context-window-management` — 컨텍스트 관리
- `@rag-implementation` — RAG 시스템
- `@ai-agents-architect` — AI 에이전트 설계

**Security** (보안 작업 시):
- `@api-security-best-practices` — API 보안
- `@auth-implementation-patterns` — JWT/OAuth/Cookie 인증
- `@backend-security-coder` — 백엔드 보안
- `@frontend-security-coder` — XSS 방지

**Testing** (테스트 작성 시):
- `@test-driven-development` — TDD
- `@systematic-debugging` — 체계적 디버깅
- `@e2e-testing-patterns` — Playwright E2E

**Quality** (코드 리뷰/정리 시):
- `@code-review-checklist` — 코드 리뷰
- `@lint-and-validate` — 린트 검증
- `@clean-code` — 클린 코드
- `@kaizen` — 지속적 개선

### Ollama/Cloud Backend Skills Mapping

백엔드 컴포넌트별 참조해야 할 스킬:

| 작업 대상 | 스킬 | 핵심 파일 |
|-----------|------|-----------|
| Ollama Client 수정 | `@llm-app-patterns` | `ollama/client.ts`, `ollama/types.ts` |
| API Key 순환 로직 | `@api-security-best-practices` | `ollama/api-key-manager.ts` |
| Agent Loop (Tool Calling) | `@ai-agents-architect`, `@tool-using-agents` | `ollama/agent-loop.ts` |
| 에이전트 라우팅 | `@ai-agents-architect` | `agents/index.ts`, `agents/llm-router.ts` |
| 프롬프트 엔지니어링 | `@prompt-engineering`, `@context-window-management` | `chat/context-engineering.ts`, `chat/prompt.ts` |
| 모델 선택 로직 | `@llm-app-patterns` | `chat/model-selector.ts` |
| MCP 도구 추가/수정 | `@tool-using-agents` | `mcp/tools.ts`, `mcp/tool-tiers.ts` |
| ChatService 수정 | `@backend-dev-guidelines` | `services/ChatService.ts` |
| MemoryService 수정 | `@llm-app-patterns` | `services/MemoryService.ts` |
| WebSocket 핸들러 | `@backend-dev-guidelines` | `sockets/handler.ts` |
| 에이전트 프롬프트 작성 | `@prompt-engineering` | `agents/prompts/` |
| 토론 엔진 | `@ai-agents-architect` | `agents/discussion-engine.ts` |

### Workflow Rules
1. 코드 수정 전 `npx tsc --noEmit`으로 타입 체크
2. 수정 후 `bun test`로 테스트 통과 확인
3. API 변경 시 기존 라우트 경로/응답 포맷 유지
4. Frontend는 Vanilla JS만 (프레임워크 금지)
5. DB는 PostgreSQL (`pg` 패키지) — SQLite 코드 수정 금지
6. Ollama Client 수정 시 Local/Cloud 양쪽 모두 동작 확인
7. 에이전트 추가 시 `industry-agents.json` + `agents/prompts/` 동시 업데이트
