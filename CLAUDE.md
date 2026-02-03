# OpenMake LLM — Claude Code Instructions

@./AGENTS.md

## Claude-Specific Guidelines

### Dual Skill System

이 프로젝트는 두 개의 스킬 시스템을 사용합니다:

#### 1. Antigravity Skills (621 SKILL.md files)
- 경로: `.agent/skills/skills/[skill-name]/SKILL.md`
- 사용: `@skill-name` 구문으로 참조
- 형식: Markdown — 프롬프트 가이드

#### 2. Vibeship Spawner Skills (462 YAML skills)
- 경로: `.spawner/skills/[category]/[skill-name]/`
- 사용: 아래처럼 YAML 파일을 직접 읽기
- 형식: 4-file YAML — 아키텍처 가드레일

```
# Vibeship 스킬 로드 예시
Read: .spawner/skills/backend/backend/skill.yaml
Read: .spawner/skills/backend/backend/sharp-edges.yaml
```

### When to Use Which

| 상황 | Antigravity | Vibeship |
|------|------------|---------|
| 코드 패턴/가이드 필요 | `@skill-name` | |
| 프로덕션 함정/gotcha 확인 | | `sharp-edges.yaml` |
| 코드 검증 규칙 | | `validations.yaml` |
| 스킬 간 협업 패턴 | | `collaboration.yaml` |
| 빠른 참조 | (단일 파일) | |
| 깊은 가드레일 | | (4-file 시스템) |

### Priority Vibeship Skills

| Category/Skill | Purpose |
|---------------|---------|
| `backend/backend` | Express/Node.js 아키텍처 가드레일 |
| `frontend/frontend` | 프론트엔드 베스트 프랙티스 |
| `security/auth-specialist` | 인증/보안 전문가 |
| `data/postgres-wizard` | PostgreSQL 최적화/쿼리 |
| `ai/llm-architect` | LLM 통합 아키텍처 |
| `ai-agents/autonomous-agents` | AI 에이전트 패턴 |
| `backend/api-design` | API 디자인 패턴 |

### Ollama/Cloud Backend — Skill Mapping

백엔드 컴포넌트별 참조해야 할 스킬 (Antigravity + Vibeship):

| 작업 대상 | Antigravity | Vibeship | 핵심 파일 |
|-----------|------------|---------|-----------|
| Ollama Client | `@llm-app-patterns` | `ai/llm-architect` | `ollama/client.ts` |
| API Key 순환 | `@api-security-best-practices` | `security/auth-specialist` | `ollama/api-key-manager.ts` |
| Agent Loop | `@ai-agents-architect` | `ai-agents/autonomous-agents` | `ollama/agent-loop.ts` |
| 에이전트 라우팅 | `@ai-agents-architect` | `ai-agents/autonomous-agents` | `agents/index.ts` |
| 프롬프트 시스템 | `@prompt-engineering` | — | `chat/context-engineering.ts`, `chat/prompt.ts` |
| MCP 도구 | `@tool-using-agents` | — | `mcp/tools.ts` |
| ChatService | `@backend-dev-guidelines` | `backend/backend` | `services/ChatService.ts` |
| MemoryService | `@llm-app-patterns` | — | `services/MemoryService.ts` |
| WebSocket | `@backend-dev-guidelines` | `backend/backend` | `sockets/handler.ts` |
| PostgreSQL | `@postgres-best-practices` | `data/postgres-wizard` | `data/models/unified-database.ts` |
| Auth | `@auth-implementation-patterns` | `security/auth-specialist` | `auth/` |
| 에이전트 프롬프트 | `@prompt-engineering` | — | `agents/prompts/` |

### 4-Pillar Prompt System Quick Reference

프롬프트 관련 작업 시 반드시 참조:
- **FourPillarPrompt**: `chat/context-engineering.ts` — 역할(Role), 제약(Constraints), 목표(Goal), 출력형식(OutputFormat)
- **SystemPrompt**: `chat/prompt.ts` — 메타데이터 주입, 인식적 구배(Epistemic Gradient), 안전 가드레일
- **PromptEnhancer**: `chat/prompt-enhancer.ts` — 프롬프트 최적화
- 6대 원칙: 4-Pillar, XML Tagging, Dynamic Metadata, Position Engineering, Soft Interlock, Epistemic Gradient

### Workflow Rules
1. 코드 수정 전 `npx tsc --noEmit`으로 타입 체크
2. 수정 후 `cd backend/api && bun test`로 테스트 통과 확인
3. API 변경 시 기존 라우트 경로/응답 포맷 유지
4. Frontend는 Vanilla JS만 (프레임워크 금지)
5. DB는 PostgreSQL (`pg` 패키지) — SQLite 코드 수정 금지
6. `as any`, `@ts-ignore` 절대 사용 금지
7. 빈 catch 블록 금지: `catch(e) {}`
8. 테스트 삭제로 빌드 통과시키기 금지
9. Ollama Client 수정 시 Local/Cloud 양쪽 모두 동작 확인
10. 에이전트 추가 시 `industry-agents.json` + `agents/prompts/` 동시 업데이트
