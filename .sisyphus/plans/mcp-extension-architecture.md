# MCP Extension Architecture — External Server Connection Infrastructure

## TL;DR

> **Quick Summary**: OpenMake LLM의 MCP 시스템을 확장하여 외부 MCP 서버(stdio/SSE/HTTP)에 연결하고, 내장+외부 도구를 통합 관리하는 인프라를 구축합니다. Phase 1(외부 서버 연결 기반)을 상세 구현하고, Phase 2-4는 이 기반 위에 순차 확장합니다.
> 
> **Deliverables**:
> - `@modelcontextprotocol/sdk` 기반 외부 MCP 클라이언트 (`ExternalMCPClient`)
> - PostgreSQL에 영속화된 서버 레지스트리 (`MCPServerRegistry` + `mcp_servers` 테이블)
> - 내장+외부 도구 통합 라우터 (`ToolRouter`, 네임스페이스 `::` 접두사)
> - ChatService, Agent Loop, Socket Handler 통합
> - 서버 CRUD REST API 엔드포인트
> - 프론트엔드 서버 관리 UI (Vanilla JS)
> - 프로세스 정리 핸들러 (좀비 방지)
> - Jest 테스트
> 
> **Estimated Effort**: Large (14 tasks across 6 waves)
> **Parallel Execution**: YES — 6 waves, max 4 parallel tasks per wave
> **Critical Path**: Task 1 → Task 3 → Task 5 → Task 6 → Task 8

---

## Context

### Original Request
사용자가 OpenMake LLM 프로젝트(`/Volumes/MAC_APP/openmake_llm`)에 MCP 확장 아키텍처를 구현하려 합니다. 현재 내장 도구만 실행 가능한 MCP 시스템을 외부 MCP 서버에도 연결하여, 도구 생태계를 확장하는 것이 목표입니다.

### Key Decisions Made During Research

**1. ChatService 우회 문제 → ToolRouter 패턴으로 해결**
- `ChatService.ts:358`에서 `builtInTools.map()`으로 직접 도구 목록 생성
- `ChatService.ts:888`에서 `builtInTools.find()`로 직접 도구 실행
- 해결: `ToolRouter`를 만들어 내장+외부 도구를 통합 제공. ChatService가 ToolRouter를 통해 도구 목록 조회+실행

**2. 네임스페이스 구분자 → `::` 채택**
- `__` (더블 언더스코어)는 기존 `canUseTool`의 와일드카드 매칭과 충돌 (`"postgres__query".startsWith("postgres_")` === true)
- `::` 는 C++/Ruby 네임스페이스 관례와 일치하며, URL 경로에서도 안전
- 예: `postgres::list_tables`, `playwright::browser_navigate`

**3. 보안 모델 → 서버 자체 설정 신뢰 + pro/enterprise 등급 제한**
- 외부 MCP 서버는 별도 프로세스로 실행되어 UserSandbox 우회 불가피
- 외부 서버 사용은 `pro` 이상 등급으로 제한
- 서버별 설정(allowed-directories 등)으로 접근 범위 제어

**4. SDK 버전 → `@modelcontextprotocol/sdk@^1.25.0`**
- v1.25.x가 안정 프로덕션, v2는 프리알파 단계 (2026년 2월 기준)

**5. 연결 공유 → 서버별 싱글톤 (공유 연결)**
- 외부 서버당 하나의 프로세스/연결, 모든 사용자가 공유
- 기존 `MCPServer` 싱글톤 패턴과 일치

**6. 데이터베이스 → `backend/api/src/data/models/unified-database.ts` (PostgreSQL)**
- `Pool` from `pg` 사용, async 메서드
- `SCHEMA` 상수에 `CREATE TABLE IF NOT EXISTS` 패턴으로 추가

### Metis Review — Identified Gaps (All Addressed)

| Gap | Severity | Resolution |
|-----|----------|------------|
| ChatService가 UnifiedMCPClient를 우회하여 builtInTools 직접 참조 | 🔴 Critical | ToolRouter 패턴으로 ChatService의 도구 조회/실행 경로 수정 (Task 8) |
| `@modelcontextprotocol/sdk` 미설치 | 🔴 Critical | Task 1에서 첫 번째로 설치 |
| 프로세스 정리 핸들러 없음 (좀비 위험) | 🔴 Critical | Task 13에서 SIGTERM/SIGINT 핸들러 추가 |
| `__` 네임스페이스가 `_` 와일드카드와 충돌 | 🟠 High | `::` 구분자 채택으로 해결 |
| 외부 서버가 UserSandbox 우회 | 🟠 High | pro/enterprise 등급 제한 + 서버 자체 설정 신뢰 |
| `mcp/index.ts` 배럴 익스포트 업데이트 필요 | 🟡 Medium | Task 6에서 함께 업데이트 |
| Socket handler `request_agents`에 외부 도구 포함 필요 | 🟡 Medium | Task 11에서 `mcp://` URI 스킴 추가 |
| MCPFeatureState가 하드코딩된 두 필드만 지원 | 🟡 Medium | 외부 서버 on/off는 별도 DB 기반 관리 (Task 5) |

---

## Work Objectives

### Core Objective
기존 `UnifiedMCPClient` → `MCPServer` → `builtInTools` 단방향 흐름에, 외부 MCP 서버 연결과 통합 도구 라우팅을 추가하여 **모든 도구(내장+외부)가 하나의 인터페이스로 관리되고, LLM 대화에서 투명하게 사용**되도록 합니다.

### Concrete Deliverables
- `backend/api/src/mcp/external-client.ts` — 새 파일
- `backend/api/src/mcp/server-registry.ts` — 새 파일
- `backend/api/src/mcp/tool-router.ts` — 새 파일
- `backend/api/src/mcp/types.ts` — 확장 (새 인터페이스 추가)
- `backend/api/src/mcp/unified-client.ts` — 리팩터
- `backend/api/src/mcp/tool-tiers.ts` — 확장
- `backend/api/src/mcp/index.ts` — 배럴 익스포트 업데이트
- `backend/api/src/routes/mcp.routes.ts` — 서버 CRUD 엔드포인트 추가
- `backend/api/src/data/models/unified-database.ts` — mcp_servers 테이블 + CRUD
- `backend/api/src/services/ChatService.ts` — ToolRouter 통합
- `backend/api/src/ollama/agent-loop.ts` — 외부 도구 포함
- `backend/api/src/sockets/handler.ts` — 외부 도구 에이전트 목록
- `frontend/web/public/js/modules/pages/mcp-tools.js` — 서버 관리 UI
- `backend/api/src/mcp/__tests__/external-client.test.ts` — 새 테스트
- `backend/api/src/mcp/__tests__/tool-router.test.ts` — 새 테스트
- `backend/api/src/mcp/__tests__/server-registry.test.ts` — 새 테스트

### Definition of Done
- [x] `npx tsc --noEmit` 컴파일 에러 0개 (backend/api 디렉토리)
- [x] `npx jest` 기존 6개 테스트 + 새 3개 테스트 모두 PASS
- [x] 외부 MCP 서버(stdio) 등록 → 연결 → 도구 목록 조회 → 도구 실행 가능
- [x] LLM 대화에서 외부 도구가 자동으로 사용 가능 (ChatService 통합)
- [x] `curl /api/mcp/servers` 에서 등록된 서버 목록 반환
- [x] 프론트엔드에서 외부 서버 추가/삭제/상태 확인 가능
- [x] 앱 종료 시 모든 외부 서버 프로세스 정리됨

### Must Have
- stdio와 SSE/HTTP 두 가지 transport 지원
- 네임스페이스 `::` 접두사로 도구 이름 충돌 방지
- 기존 builtInTools 동작 완전 호환 (regression 없음)
- pro/enterprise 등급에서만 외부 서버 사용 가능
- 서버 설정 DB 영속화 (앱 재시작 후에도 유지)

### Must NOT Have (Guardrails)
- ❌ OAuth/인증 프로바이더 (외부 서버용)
- ❌ 서버 자동 발견 또는 마켓플레이스
- ❌ 도구 인자 변환/적응 레이어
- ❌ 자동 재연결 (무한 재시도 로직)
- ❌ 마이그레이션 프레임워크 (CREATE TABLE IF NOT EXISTS면 충분)
- ❌ 드래그앤드롭 리오더링, 리치 설정 에디터
- ❌ 외부 도구 결과 캐싱
- ❌ 사용자별 외부 서버 설정 (전역 관리자 설정)
- ❌ `as any` 또는 `@ts-ignore` 새로 추가 (기존 코드의 것은 방치)
- ❌ 프론트엔드 프레임워크 추가

---

## Verification Strategy

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks in this plan MUST be verifiable WITHOUT any human action.
> Every criterion is executed by the agent using tools (Bash, Playwright, curl, etc.).

### Test Decision
- **Infrastructure exists**: YES (Jest + ts-jest, `backend/api/jest.config.js`)
- **Automated tests**: YES (Tests-after)
- **Framework**: Jest with ts-jest
- **Test command**: `npx jest --no-coverage` (from `backend/api/`)

### Agent-Executed QA Scenarios (MANDATORY — ALL tasks)

Every task includes concrete QA scenarios. The executing agent DIRECTLY verifies each deliverable.

**Verification Tool by Deliverable Type:**

| Type | Tool | How Agent Verifies |
|------|------|-------------------|
| TypeScript compilation | Bash | `npx tsc --noEmit` from backend/api/ |
| Unit tests | Bash | `npx jest --testPathPattern="<pattern>" --no-coverage` |
| API endpoints | Bash (curl) | Send requests, parse JSON, assert fields |
| Frontend UI | Playwright | Navigate, interact, assert DOM, screenshot |
| Process cleanup | Bash | Start/stop app, verify child processes terminated |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — Foundation):
├── Task 1: SDK 설치 + 타입 확장
└── Task 2: DB 스키마 (mcp_servers 테이블)

Wave 2 (After Wave 1 — Core Modules):
├── Task 3: ExternalMCPClient (needs SDK from T1)
└── Task 4: ToolRouter (needs types from T1)

Wave 3 (After T2+T3 — Registry):
└── Task 5: MCPServerRegistry (needs DB from T2 + client from T3)

Wave 4 (After T4+T5 — Integration Layer):
├── Task 6: UnifiedMCPClient refactor (needs ToolRouter T4 + Registry T5)
└── Task 7: Tool tier updates (needs ToolRouter T4)

Wave 5 (After T6 — Consumer Integration):
├── Task 8:  ChatService integration (needs unified client T6)
├── Task 9:  Agent Loop integration (needs ToolRouter T4)
├── Task 10: API routes — server CRUD (needs Registry T5)
└── Task 11: Socket handler updates (needs ToolRouter T4 + Registry T5)

Wave 6 (After Wave 5 — Frontend + Cleanup + Tests):
├── Task 12: Frontend server management UI (needs routes T10)
├── Task 13: Graceful shutdown handler (needs Registry T5)
└── Task 14: Tests (needs all code)

Critical Path: T1 → T3 → T5 → T6 → T8
Parallel Speedup: ~45% faster than fully sequential
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 | None | 3, 4 | 2 |
| 2 | None | 5 | 1 |
| 3 | 1 | 5 | 4 |
| 4 | 1 | 5, 6, 7, 9, 11 | 3 |
| 5 | 2, 3 | 6, 10, 11, 13 | None |
| 6 | 4, 5 | 8 | 7 |
| 7 | 4 | None | 6 |
| 8 | 6 | 14 | 9, 10, 11 |
| 9 | 4 | 14 | 8, 10, 11 |
| 10 | 5 | 12 | 8, 9, 11 |
| 11 | 4, 5 | 12 | 8, 9, 10 |
| 12 | 10, 11 | 14 | 13 |
| 13 | 5 | 14 | 12 |
| 14 | 8, 9, 12, 13 | None | None (final) |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Category |
|------|-------|---------------------|
| 1 | T1, T2 | `quick` (simple file modifications) |
| 2 | T3, T4 | `unspecified-high` (new module creation) |
| 3 | T5 | `unspecified-high` (DB + connection management) |
| 4 | T6, T7 | `deep` (refactor existing module with many integration points) |
| 5 | T8-T11 | `deep` (integration requiring careful analysis) |
| 6 | T12, T13, T14 | T12: `visual-engineering`, T13: `quick`, T14: `unspecified-high` |

---

## TODOs

---

### - [x] 1. SDK 설치 및 타입 정의 확장

**What to do**:
- `backend/api/` 디렉토리에서 `npm install @modelcontextprotocol/sdk@^1.25.0 zod` 실행
- `backend/api/src/mcp/types.ts`에 다음 인터페이스 추가 (파일 끝, line 72 이후):

```typescript
// ===== 외부 MCP 서버 관련 타입 =====

/** MCP 서버 전송 방식 */
export type MCPTransportType = 'stdio' | 'sse' | 'streamable-http';

/** DB에 저장되는 외부 MCP 서버 설정 */
export interface MCPServerConfig {
    id: string;
    name: string;                          // 고유 이름 (네임스페이스로 사용)
    transport_type: MCPTransportType;
    command?: string;                      // stdio: 실행 명령어
    args?: string[];                       // stdio: 명령어 인자
    env?: Record<string, string>;          // stdio: 환경변수
    url?: string;                          // sse/http: 서버 URL
    enabled: boolean;
    created_at: string;
    updated_at: string;
}

/** 외부 서버 연결 상태 */
export interface MCPConnectionStatus {
    serverId: string;
    serverName: string;
    status: 'disconnected' | 'connecting' | 'connected' | 'error';
    toolCount: number;
    lastPing?: string;
    error?: string;
}

/** 네임스페이스가 적용된 외부 도구 엔트리 */
export interface ExternalToolEntry {
    serverId: string;
    serverName: string;
    originalName: string;
    namespacedName: string;                // "serverName::originalName"
    tool: MCPTool;
}

/** 네임스페이스 구분자 상수 */
export const MCP_NAMESPACE_SEPARATOR = '::';
```

**Must NOT do**:
- 기존 인터페이스(MCPRequest, MCPResponse, MCPTool 등)를 수정하지 않음
- 기존 export를 변경하지 않음 (추가만)

**Recommended Agent Profile**:
- **Category**: `quick`
  - Reason: npm install + 파일 하단에 타입 추가하는 단순 작업
- **Skills**: [`git-master`]
  - `git-master`: 패키지 설치 후 package.json/lock 파일 변경 커밋

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 1 (with Task 2)
- **Blocks**: Task 3, Task 4
- **Blocked By**: None

**References**:
- `backend/api/src/mcp/types.ts:1-72` — 기존 타입 정의. 파일 끝(line 72)에 새 인터페이스 추가
- `backend/api/package.json` — 현재 의존성 목록. `@modelcontextprotocol/server-filesystem`은 이미 있음
- MCP SDK 공식 문서: `Client`, `StdioClientTransport`, `StreamableHTTPClientTransport` 클래스 구조

**Acceptance Criteria**:
- [ ] `node -e "require('@modelcontextprotocol/sdk/client/index.js'); console.log('OK')"` → "OK" 출력
- [ ] `npx tsc --noEmit` → 에러 0개
- [ ] `grep "MCPTransportType\|MCPServerConfig\|MCPConnectionStatus\|ExternalToolEntry\|MCP_NAMESPACE_SEPARATOR" backend/api/src/mcp/types.ts` → 5개 매칭

**Agent-Executed QA Scenarios**:

```
Scenario: SDK가 올바르게 설치되었는지 확인
  Tool: Bash
  Preconditions: backend/api/ 디렉토리에 package.json 존재
  Steps:
    1. cd /Volumes/MAC_APP/openmake_llm/backend/api && node -e "const { Client } = require('@modelcontextprotocol/sdk/client/index.js'); console.log('Client:', typeof Client)"
    2. Assert: stdout contains "Client: function"
  Expected Result: SDK Client 클래스가 import 가능
  Evidence: stdout 캡처

Scenario: 새 타입이 TypeScript 컴파일에 포함되는지 확인
  Tool: Bash
  Preconditions: types.ts에 새 인터페이스 추가 완료
  Steps:
    1. cd /Volumes/MAC_APP/openmake_llm/backend/api && npx tsc --noEmit
    2. Assert: exit code 0
  Expected Result: 컴파일 에러 없음
  Evidence: exit code 캡처
```

**Commit**: YES
- Message: `feat(mcp): install SDK and add external server type definitions`
- Files: `backend/api/package.json`, `backend/api/package-lock.json`, `backend/api/src/mcp/types.ts`
- Pre-commit: `cd backend/api && npx tsc --noEmit`

---

### - [x] 2. Database 스키마 — mcp_servers 테이블

**What to do**:
- `backend/api/src/data/models/unified-database.ts`의 `SCHEMA` 상수(line 350-352의 마지막 CREATE INDEX 뒤, 닫는 백틱 직전)에 mcp_servers 테이블 SQL 추가:

```sql
-- MCP 외부 서버 설정 테이블
CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    transport_type TEXT NOT NULL CHECK(transport_type IN ('stdio', 'sse', 'streamable-http')),
    command TEXT,
    args JSONB,
    env JSONB,
    url TEXT,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);
```

- 같은 파일에 TypeScript 인터페이스 추가 (기존 인터페이스 블록 뒤):

```typescript
export interface MCPServerRow {
    id: string;
    name: string;
    transport_type: string;
    command: string | null;
    args: string[] | null;
    env: Record<string, string> | null;
    url: string | null;
    enabled: boolean;
    created_at: string;
    updated_at: string;
}
```

- `UnifiedDatabase` 클래스에 CRUD 메서드 추가:

```typescript
async getMcpServers(): Promise<MCPServerRow[]>
async getMcpServerById(id: string): Promise<MCPServerRow | null>
async createMcpServer(server: Omit<MCPServerRow, 'created_at' | 'updated_at'>): Promise<MCPServerRow>
async updateMcpServer(id: string, updates: Partial<MCPServerRow>): Promise<MCPServerRow | null>
async deleteMcpServer(id: string): Promise<boolean>
```

**Must NOT do**:
- 기존 테이블 스키마를 수정하지 않음
- 마이그레이션 프레임워크 도입하지 않음
- `as any` 사용하지 않음 — JSONB 파싱에는 적절한 타입 가드 사용

**Recommended Agent Profile**:
- **Category**: `quick`
  - Reason: SQL 추가 + TypeScript CRUD 메서드 — 패턴이 기존 코드에 충분히 있음
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 1 (with Task 1)
- **Blocks**: Task 5
- **Blocked By**: None

**References**:
- `backend/api/src/data/models/unified-database.ts:9-352` — 기존 SCHEMA 상수. Line 350-352에 마지막 CREATE INDEX 문이 있고, Line 352에 닫는 백틱이 있음. 여기 직전에 새 테이블 추가
- `backend/api/src/data/models/unified-database.ts:354-380` — 기존 TypeScript 인터페이스 패턴 (User, ConversationSession 등)
- `backend/api/src/data/models/unified-database.ts:320-332` — `external_connections` 테이블. JSONB 컬럼 패턴 참조
- `backend/api/src/data/models/unified-database.ts:6` — `import { Pool, QueryResult } from 'pg'` — PostgreSQL async 패턴

**Acceptance Criteria**:
- [ ] `npx tsc --noEmit` → 에러 0개
- [ ] 앱 시작 시 `mcp_servers` 테이블 자동 생성 (CREATE TABLE IF NOT EXISTS)
- [ ] `grep "mcp_servers" backend/api/src/data/models/unified-database.ts` → SQL + 인터페이스 + CRUD 메서드 매칭

**Agent-Executed QA Scenarios**:

```
Scenario: 새 테이블 SQL이 스키마에 포함되는지 확인
  Tool: Bash
  Preconditions: unified-database.ts 수정 완료
  Steps:
    1. grep -c "CREATE TABLE IF NOT EXISTS mcp_servers" /Volumes/MAC_APP/openmake_llm/backend/api/src/data/models/unified-database.ts
    2. Assert: output is "1"
  Expected Result: mcp_servers 테이블 DDL이 정확히 1회 존재
  Evidence: grep 출력

Scenario: TypeScript 컴파일 성공
  Tool: Bash
  Preconditions: MCPServerRow 인터페이스 및 CRUD 메서드 추가
  Steps:
    1. cd /Volumes/MAC_APP/openmake_llm/backend/api && npx tsc --noEmit
    2. Assert: exit code 0
  Expected Result: 타입 에러 없음
  Evidence: exit code
```

**Commit**: YES
- Message: `feat(db): add mcp_servers table schema and CRUD methods`
- Files: `backend/api/src/data/models/unified-database.ts`
- Pre-commit: `cd backend/api && npx tsc --noEmit`

---

### - [x] 3. ExternalMCPClient — SDK Client 래퍼

**What to do**:
- `backend/api/src/mcp/external-client.ts` 새 파일 생성
- `@modelcontextprotocol/sdk`의 `Client`를 래핑하여 stdio 및 SSE/HTTP transport를 지원하는 클라이언트 구현
- 핵심 클래스 설계:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCPServerConfig, MCPConnectionStatus, MCPTool, MCPToolResult, MCPTransportType } from './types';

export class ExternalMCPClient {
    private client: Client | null = null;
    private transport: StdioClientTransport | StreamableHTTPClientTransport | null = null;
    private config: MCPServerConfig;
    private status: MCPConnectionStatus['status'] = 'disconnected';
    private discoveredTools: MCPTool[] = [];
    private lastError: string | undefined;

    constructor(config: MCPServerConfig) { ... }

    /** 서버에 연결하고 도구 목록을 자동 검색 */
    async connect(): Promise<void> {
        // 1. transport 타입에 따라 생성
        // 2. Client 생성 및 connect
        // 3. listTools()로 도구 검색
        // 4. 상태 업데이트
    }

    /** 연결 해제 및 프로세스 정리 */
    async disconnect(): Promise<void> {
        // client.close() → transport 정리
    }

    /** 검색된 도구 목록 반환 */
    getTools(): MCPTool[] { return [...this.discoveredTools]; }

    /** 도구 실행 (원본 이름 사용 — 네임스페이싱은 ToolRouter가 처리) */
    async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
        // client.callTool({ name, arguments: args })
        // SDK 결과를 MCPToolResult 형태로 변환
    }

    /** 연결 상태 확인 (ping) */
    async ping(): Promise<boolean> {
        // client.ping() try/catch
    }

    /** 현재 연결 상태 */
    getStatus(): MCPConnectionStatus { ... }

    /** transport 생성 헬퍼 */
    private createTransport(): StdioClientTransport | StreamableHTTPClientTransport {
        // config.transport_type에 따라 분기
        // stdio: new StdioClientTransport({ command, args, env, stderr: 'pipe' })
        // sse/streamable-http: new StreamableHTTPClientTransport(new URL(config.url))
    }
}
```

- SDK 타입과 기존 `MCPToolResult` 간 변환 로직 구현
- 연결 실패 시 적절한 에러 메시지와 상태 업데이트

**Must NOT do**:
- 자동 재연결 로직 구현하지 않음 (Phase 1 범위 밖)
- `as any` 사용하지 않음 — SDK 타입과 기존 타입 간 명시적 변환 함수 작성

**Recommended Agent Profile**:
- **Category**: `unspecified-high`
  - Reason: SDK 통합, transport 분기, 에러 핸들링 등 복합 로직
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 2 (with Task 4)
- **Blocks**: Task 5
- **Blocked By**: Task 1

**References**:
- `backend/api/src/mcp/types.ts` — MCPServerConfig, MCPConnectionStatus, MCPTool, MCPToolResult 타입 (Task 1에서 추가)
- MCP SDK 패턴:
  - `Client` 생성: `new Client({ name: "openmake-llm", version: "1.0.0" }, { capabilities: {} })`
  - `StdioClientTransport`: `new StdioClientTransport({ command, args, env, stderr: 'pipe' })` — 자식 프로세스 생성
  - `StreamableHTTPClientTransport`: `new StreamableHTTPClientTransport(new URL(url))` — HTTP/SSE 연결
  - `client.connect(transport)` → `client.listTools()` → `{ tools: Tool[] }`
  - `client.callTool({ name, arguments })` → `CallToolResult` with content/isError
  - `client.ping()` → 연결 상태 확인
  - `client.close()` → transport 정리, SIGTERM to child process
- `backend/api/src/mcp/unified-client.ts:88-102` — 기존 executeTool 패턴 (MCPToolResult 반환 형태 참조)

**Acceptance Criteria**:
- [ ] `npx tsc --noEmit` → 에러 0개
- [ ] ExternalMCPClient가 MCPServerConfig를 받아 생성 가능
- [ ] connect/disconnect/callTool/getTools/getStatus/ping 메서드 존재

**Agent-Executed QA Scenarios**:

```
Scenario: ExternalMCPClient 클래스 구조 검증
  Tool: Bash
  Preconditions: external-client.ts 파일 생성 완료
  Steps:
    1. cd /Volumes/MAC_APP/openmake_llm/backend/api && npx tsc --noEmit
    2. Assert: exit code 0
    3. grep -c "class ExternalMCPClient" src/mcp/external-client.ts
    4. Assert: output is "1"
    5. grep -c "async connect\|async disconnect\|async callTool\|getTools\|async ping\|getStatus" src/mcp/external-client.ts
    6. Assert: output >= "6"
  Expected Result: 모든 메서드가 정의되고 컴파일 성공
  Evidence: tsc 출력 + grep 결과
```

**Commit**: YES (groups with Task 4)
- Message: `feat(mcp): add ExternalMCPClient and ToolRouter core modules`
- Files: `backend/api/src/mcp/external-client.ts`, `backend/api/src/mcp/tool-router.ts`
- Pre-commit: `cd backend/api && npx tsc --noEmit`

---

### - [x] 4. ToolRouter — 통합 도구 레지스트리

**What to do**:
- `backend/api/src/mcp/tool-router.ts` 새 파일 생성
- 내장 도구(`builtInTools`)와 외부 도구를 하나의 인터페이스로 통합하는 라우터 구현
- 핵심 클래스 설계:

```typescript
import { MCPTool, MCPToolResult, MCPToolDefinition, ExternalToolEntry, MCP_NAMESPACE_SEPARATOR } from './types';
import { builtInTools } from './tools';
import { UserTier } from '../data/user-manager';
import { canUseTool } from './tool-tiers';

export class ToolRouter {
    /** 외부 도구 레지스트리: namespacedName → ExternalToolEntry */
    private externalTools: Map<string, ExternalToolEntry> = new Map();
    
    /** 외부 도구 실행기 — ExternalMCPClient.callTool 참조를 저장 */
    private externalExecutors: Map<string, (name: string, args: Record<string, unknown>) => Promise<MCPToolResult>> = new Map();

    /** 모든 도구(내장+외부) MCPTool 목록 반환 */
    getAllTools(): MCPTool[] { ... }

    /** 사용자 등급별 필터링된 도구 목록 */
    getToolsForTier(tier: UserTier): MCPTool[] { ... }

    /** 도구 실행 — 내장이면 직접 handler, 외부면 ExternalMCPClient로 라우팅 */
    async executeTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> { ... }

    /** Ollama 호환 도구 형식으로 변환 */
    getOllamaTools(tier: UserTier): Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> { ... }

    /** 외부 서버의 도구 일괄 등록 */
    registerExternalTools(
        serverId: string, serverName: string, tools: MCPTool[],
        executor: (name: string, args: Record<string, unknown>) => Promise<MCPToolResult>
    ): void { ... }

    /** 외부 서버의 도구 일괄 해제 */
    unregisterExternalTools(serverId: string): void { ... }

    /** 등록된 외부 도구 수 */
    getExternalToolCount(): number { ... }
}
```

**Must NOT do**:
- builtInTools 배열 자체를 수정하지 않음 (읽기만)
- 도구 인자 변환/적응 로직 추가하지 않음

**Recommended Agent Profile**:
- **Category**: `unspecified-high`
  - Reason: 핵심 아키텍처 컴포넌트, 내장/외부 도구 라우팅 로직 복잡
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 2 (with Task 3)
- **Blocks**: Task 5, Task 6, Task 7, Task 9, Task 11
- **Blocked By**: Task 1

**References**:
- `backend/api/src/mcp/tools.ts:282-299` — builtInTools 배열 정의. 이 배열을 import해서 읽기 전용으로 사용
- `backend/api/src/mcp/types.ts` — MCPTool, MCPToolResult, MCPToolDefinition, ExternalToolEntry, MCP_NAMESPACE_SEPARATOR
- `backend/api/src/mcp/tool-tiers.ts:42-65` — canUseTool 함수. ToolRouter가 tier 필터링에 사용
- `backend/api/src/services/ChatService.ts:358-365` — 현재 Ollama 도구 변환 패턴. ToolRouter.getOllamaTools()가 이 패턴을 대체할 것

**Acceptance Criteria**:
- [ ] `npx tsc --noEmit` → 에러 0개
- [ ] ToolRouter.getAllTools()가 builtInTools를 포함
- [ ] registerExternalTools/unregisterExternalTools 메서드 존재
- [ ] executeTool()이 내장/외부 도구 모두 라우팅 가능

**Commit**: YES (groups with Task 3)
- Message: `feat(mcp): add ExternalMCPClient and ToolRouter core modules`
- Files: `backend/api/src/mcp/external-client.ts`, `backend/api/src/mcp/tool-router.ts`
- Pre-commit: `cd backend/api && npx tsc --noEmit`

---

### - [x] 5. MCPServerRegistry — 서버 연결 관리자

**What to do**:
- `backend/api/src/mcp/server-registry.ts` 새 파일 생성
- DB에서 서버 설정을 로드하고, ExternalMCPClient 인스턴스를 관리하며, ToolRouter에 도구를 등록/해제하는 레지스트리 구현

```typescript
export class MCPServerRegistry {
    private connections: Map<string, ExternalMCPClient> = new Map();
    private toolRouter: ToolRouter;

    constructor(toolRouter: ToolRouter) { ... }

    async initializeFromDB(db: UnifiedDatabase): Promise<void> { ... }
    async registerServer(config: MCPServerConfig, db: UnifiedDatabase): Promise<MCPConnectionStatus> { ... }
    async unregisterServer(serverId: string, db: UnifiedDatabase): Promise<void> { ... }
    async connectServer(serverId: string, config: MCPServerConfig): Promise<void> { ... }
    async disconnectServer(serverId: string): Promise<void> { ... }
    async disconnectAll(): Promise<void> { ... }
    getAllStatuses(): MCPConnectionStatus[] { ... }
    getServerStatus(serverId: string): MCPConnectionStatus | undefined { ... }
    async pingServer(serverId: string): Promise<boolean> { ... }
}
```

**Must NOT do**:
- UnifiedDatabase를 직접 import하지 않음 (순환 참조 방지, 함수 파라미터로 전달)
- 자동 재연결/재시작 로직 구현하지 않음

**Recommended Agent Profile**:
- **Category**: `unspecified-high`
  - Reason: DB + ExternalMCPClient + ToolRouter 세 모듈 연동, 비동기 연결 관리
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: NO
- **Parallel Group**: Wave 3 (single task)
- **Blocks**: Task 6, Task 10, Task 11, Task 13
- **Blocked By**: Task 2, Task 3

**References**:
- `backend/api/src/mcp/external-client.ts` — ExternalMCPClient 클래스 (Task 3)
- `backend/api/src/mcp/tool-router.ts` — ToolRouter 클래스 (Task 4). registerExternalTools/unregisterExternalTools
- `backend/api/src/data/models/unified-database.ts` — getMcpServers, createMcpServer, deleteMcpServer (Task 2)
- `backend/api/src/mcp/types.ts` — MCPServerConfig, MCPConnectionStatus 타입

**Acceptance Criteria**:
- [ ] `npx tsc --noEmit` → 에러 0개
- [ ] MCPServerRegistry.connectServer()가 ExternalMCPClient를 생성하고 ToolRouter에 도구 등록
- [ ] MCPServerRegistry.disconnectAll()이 모든 연결 정리

**Commit**: YES
- Message: `feat(mcp): add MCPServerRegistry for external server connection management`
- Files: `backend/api/src/mcp/server-registry.ts`
- Pre-commit: `cd backend/api && npx tsc --noEmit`

---

### - [x] 6. UnifiedMCPClient 리팩터 — ToolRouter + Registry 통합

**What to do**:
- `backend/api/src/mcp/unified-client.ts` 수정:
  1. `ToolRouter`와 `MCPServerRegistry` 인스턴스를 프로퍼티로 추가
  2. 생성자에서 `ToolRouter` 생성, `MCPServerRegistry` 생성
  3. 기존 `executeTool` → `ToolRouter.executeTool` 위임
  4. 기존 `getToolList` → `ToolRouter.getAllTools` 위임
  5. `executeToolWithContext`에서 tier 체크 후 `ToolRouter.executeTool` 호출
  6. 새 메서드 추가: `getToolRouter()`, `getServerRegistry()`, `initializeExternalServers(db)`
- `backend/api/src/mcp/index.ts` 배럴 익스포트 업데이트:
  - ExternalMCPClient, ToolRouter, MCPServerRegistry export 추가
  - MCPServerConfig, MCPConnectionStatus, ExternalToolEntry, MCPTransportType, MCP_NAMESPACE_SEPARATOR export 추가

**Must NOT do**:
- 기존 `MCPServer` 내부 동작을 변경하지 않음
- 기존 public 메서드 시그니처를 변경하지 않음 (추가만)
- `executeTool`, `executeToolWithContext`의 기존 동작을 깨뜨리지 않음

**Recommended Agent Profile**:
- **Category**: `deep`
  - Reason: 기존 싱글톤 리팩터, 여러 모듈 간 의존성 연결, regression 위험
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 4 (with Task 7)
- **Blocks**: Task 8
- **Blocked By**: Task 4, Task 5

**References**:
- `backend/api/src/mcp/unified-client.ts:1-238` — 전체 파일. 특히:
  - Line 23-30: constructor → ToolRouter/Registry 초기화 추가
  - Line 88-102: `executeTool` → ToolRouter.executeTool로 위임
  - Line 130-155: `executeToolWithContext` → tier 체크 후 ToolRouter.executeTool
  - Line 56-72: `getToolList`, `getToolsByCategory` → ToolRouter.getAllTools 활용
- `backend/api/src/mcp/index.ts:1-89` — 배럴 익스포트. 새 모듈 export 추가

**Acceptance Criteria**:
- [ ] `npx tsc --noEmit` → 에러 0개
- [ ] `npx jest --no-coverage` → 기존 테스트 모두 PASS
- [ ] `getUnifiedMCPClient().getToolRouter()` 가 ToolRouter 인스턴스 반환
- [ ] `getUnifiedMCPClient().getServerRegistry()` 가 MCPServerRegistry 인스턴스 반환

**Commit**: YES
- Message: `refactor(mcp): integrate ToolRouter and ServerRegistry into UnifiedMCPClient`
- Files: `backend/api/src/mcp/unified-client.ts`, `backend/api/src/mcp/index.ts`
- Pre-commit: `cd backend/api && npx jest --no-coverage`

---

### - [x] 7. Tool Tier 업데이트 — 외부 도구 접근 제어

**What to do**:
- `backend/api/src/mcp/tool-tiers.ts` 수정:
  1. `canUseTool`에서 `::` 네임스페이스를 인식하도록 로직 추가:
     - 네임스페이스된 외부 도구는 최소 pro 이상 필요
  2. 새 함수 추가: `allowExternalServer(tier, serverName)`, `disallowExternalServer(tier, serverName)`
     - `serverName::*` 와일드카드 패턴을 TOOL_TIERS에 추가/제거

**Must NOT do**:
- 기존 `canUseTool` 시그니처를 변경하지 않음
- enterprise `'*'` 패턴을 제거하지 않음
- free 등급에 외부 도구를 추가하지 않음

**Recommended Agent Profile**:
- **Category**: `quick`
  - Reason: 기존 패턴에 몇 줄 추가하는 단순 작업
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 4 (with Task 6)
- **Blocks**: None
- **Blocked By**: Task 4

**References**:
- `backend/api/src/mcp/tool-tiers.ts:1-91` — 전체 파일. 특히:
  - Line 14-31: TOOL_TIERS 정의
  - Line 36-56: canUseTool 함수 — `::` 인식 추가
- `backend/api/src/mcp/types.ts` — MCP_NAMESPACE_SEPARATOR 상수

**Acceptance Criteria**:
- [ ] `npx tsc --noEmit` → 에러 0개
- [ ] 외부 도구(`::` 포함)는 free 등급에서 접근 불가
- [ ] enterprise는 모든 도구 접근 가능 (기존 동작 유지)

**Commit**: YES (groups with Task 6)
- Message: `refactor(mcp): integrate ToolRouter and ServerRegistry into UnifiedMCPClient`
- Files: `backend/api/src/mcp/tool-tiers.ts`
- Pre-commit: `cd backend/api && npx tsc --noEmit`

---

### - [x] 8. ChatService 통합 — ToolRouter 사용

**What to do**:
- `backend/api/src/services/ChatService.ts` 수정:
  1. **Line 358**: `builtInTools.map()` → `toolRouter.getOllamaTools(userTier)` 사용
  2. **Line 888**: `builtInTools.find()` → `toolRouter.executeTool(toolName, toolArgs)` 사용
  3. import 수정: `getUnifiedMCPClient` import 확인, builtInTools 직접 사용 제거
  4. **Line 381의 `as any[]`**: ToolRouter.getOllamaTools()가 올바른 타입 반환하도록 제거

**Must NOT do**:
- web_search, web_fetch, vision_ocr, analyze_image 특수 핸들러(line 759-885) 변경하지 않음
- executeToolCall 메서드 공개 시그니처 변경하지 않음
- 기존 에러 핸들링 패턴 변경하지 않음

**Recommended Agent Profile**:
- **Category**: `deep`
  - Reason: ChatService는 핵심 비즈니스 로직. 기존 동작 완벽 보존 필요
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 5 (with Tasks 9, 10, 11)
- **Blocks**: Task 14
- **Blocked By**: Task 6

**References**:
- `backend/api/src/services/ChatService.ts:356-365` — builtInTools.map() (도구 목록 생성). **핵심 수정 #1**
- `backend/api/src/services/ChatService.ts:381` — `tools: allowedTools as any[]` — as any 제거 대상
- `backend/api/src/services/ChatService.ts:887-903` — builtInTools.find() (도구 실행). **핵심 수정 #2**
- `backend/api/src/services/ChatService.ts:735-754` — executeToolCall 메서드 시작부 (tier 체크). 유지
- `backend/api/src/services/ChatService.ts:758-885` — 특수 도구 핸들러. **수정하지 않음**
- `backend/api/src/mcp/tool-router.ts` — ToolRouter.getOllamaTools(), ToolRouter.executeTool()

**Acceptance Criteria**:
- [ ] `npx tsc --noEmit` → 에러 0개
- [ ] `npx jest --no-coverage` → 모든 테스트 PASS (특히 ChatService.test.ts)
- [ ] `grep "builtInTools.map\|builtInTools.find" ChatService.ts` → 0개 매칭
- [ ] `grep "toolRouter\|getToolRouter" ChatService.ts` → 2개 이상 매칭

**Commit**: YES
- Message: `refactor(chat): use ToolRouter instead of direct builtInTools access`
- Files: `backend/api/src/services/ChatService.ts`
- Pre-commit: `cd backend/api && npx jest --no-coverage`

---

### - [x] 9. Agent Loop 통합 — 외부 도구 포함

**What to do**:
- `backend/api/src/ollama/agent-loop.ts` 수정:
  1. `mcpToolToOllamaTool` 함수가 ToolRouter의 도구 목록을 사용하도록 변경
  2. 도구 실행 시 ToolRouter.executeTool()을 통해 라우팅
  3. 외부 도구의 네임스페이스 이름(`server::tool`)이 LLM에 그대로 전달되도록 확인

**Must NOT do**:
- agent-loop의 while 루프 구조 변경하지 않음
- maxIterations 로직 변경하지 않음

**Recommended Agent Profile**:
- **Category**: `unspecified-high`
  - Reason: LLM 도구 호출 루프는 정확한 형식 매핑이 중요
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 5 (with Tasks 8, 10, 11)
- **Blocks**: Task 14
- **Blocked By**: Task 4

**References**:
- `backend/api/src/ollama/agent-loop.ts:121` — toOllamaTool() 함수
- `backend/api/src/ollama/agent-loop.ts:167-343` — runAgentLoop 메인 루프
- `backend/api/src/ollama/agent-loop.ts:300-340` — tool_calls 처리
- `backend/api/src/ollama/agent-loop.ts:404` — mcpToolToOllamaTool 변환 함수

**Acceptance Criteria**:
- [ ] `npx tsc --noEmit` → 에러 0개
- [ ] Agent Loop가 ToolRouter를 참조하는지 grep으로 확인

**Commit**: YES (groups with Tasks 8, 10, 11)
- Message: `feat(mcp): integrate external tools into ChatService, agent loop, routes, and socket handler`

---

### - [x] 10. API Routes — 외부 서버 CRUD 엔드포인트

**What to do**:
- `backend/api/src/routes/mcp.routes.ts`에 새 엔드포인트 추가:
  - `GET /api/mcp/servers` — 등록된 외부 서버 목록 + 연결 상태
  - `POST /api/mcp/servers` — 새 외부 서버 등록 (admin 전용)
  - `DELETE /api/mcp/servers/:id` — 서버 제거 (admin 전용)
  - `POST /api/mcp/servers/:id/connect` — 서버 수동 연결
  - `POST /api/mcp/servers/:id/disconnect` — 서버 수동 연결 해제
  - `GET /api/mcp/servers/:id/status` — 서버 상태 조회

**Must NOT do**:
- 기존 라우트(settings, tools, terminal) 수정하지 않음
- 응답 형식 변경하지 않음 — `success()`, `badRequest()`, `internalError()` 래퍼 사용

**Recommended Agent Profile**:
- **Category**: `unspecified-high`
  - Reason: REST API CRUD + 검증 + DB/Registry 양쪽 연동
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 5 (with Tasks 8, 9, 11)
- **Blocks**: Task 12
- **Blocked By**: Task 5

**References**:
- `backend/api/src/routes/mcp.routes.ts:1-130` — 기존 라우트. 특히:
  - Line 14-16: import 패턴
  - Line 21-30: GET /settings 핸들러 패턴
  - Line 91-130: GET /tools, POST /tools/:name/execute 패턴
- `backend/api/src/mcp/server-registry.ts` — MCPServerRegistry (Task 5)
- `backend/api/src/utils/api-response.ts` — success(), badRequest(), internalError()

**Acceptance Criteria**:
- [ ] `npx tsc --noEmit` → 에러 0개
- [ ] 6개 이상의 서버 관련 라우트 핸들러 존재

**Agent-Executed QA Scenarios**:

```
Scenario: 서버 CRUD API 응답 확인 (앱 실행 후)
  Tool: Bash (curl)
  Preconditions: 앱이 localhost:3000에서 실행 중, admin 인증 토큰 보유
  Steps:
    1. curl -s -w "%{http_code}" http://localhost:3000/api/mcp/servers -H "Authorization: Bearer ${TOKEN}"
    2. Assert: HTTP status is 200
    3. Assert: response contains "success" field
  Expected Result: CRUD 엔드포인트 정상 응답
  Evidence: curl 응답 본문
```

**Commit**: YES (groups with Tasks 8, 9, 11)
- Message: `feat(mcp): integrate external tools into ChatService, agent loop, routes, and socket handler`

---

### - [x] 11. Socket Handler 업데이트 — 외부 도구 에이전트 목록

**What to do**:
- `backend/api/src/sockets/handler.ts` 수정:
  1. `request_agents` 이벤트 핸들러에서 외부 도구도 에이전트 목록에 포함
  2. 내장 도구: `local://toolName` URI 유지
  3. 외부 도구: `mcp://serverName/toolName` URI 추가

**Must NOT do**:
- 기존 `local://` URI 스킴 변경하지 않음
- WebSocket 이벤트 이름 변경하지 않음

**Recommended Agent Profile**:
- **Category**: `quick`
  - Reason: 기존 map 로직에 외부 도구 추가하는 단순 작업
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 5 (with Tasks 8, 9, 10)
- **Blocks**: Task 12
- **Blocked By**: Task 4, Task 5

**References**:
- `backend/api/src/sockets/handler.ts:135-154` — `request_agents` 이벤트 핸들러
- `backend/api/src/sockets/handler.ts:88-116` — `init` 이벤트
- `backend/api/src/sockets/handler.ts:118-133` — `mcp_settings` 이벤트

**Acceptance Criteria**:
- [ ] `npx tsc --noEmit` → 에러 0개
- [ ] `grep "mcp://" handler.ts` → 1개 이상 매칭

**Commit**: YES (groups with Tasks 8, 9, 10)

---

### - [x] 12. Frontend — 외부 서버 관리 UI

**What to do**:
- `frontend/web/public/js/modules/pages/mcp-tools.js` 수정:
  1. 기존 도구 토글 카드 섹션 아래에 "외부 MCP 서버" 관리 섹션 추가
  2. UI 요소: 서버 목록 테이블, "서버 추가" 버튼/폼, 연결/해제/삭제 버튼, 상태 표시
  3. API 연동: GET/POST/DELETE /api/mcp/servers

**Must NOT do**:
- 프론트엔드 프레임워크 추가하지 않음 — 순수 Vanilla JS
- 기존 도구 토글 UI 변경하지 않음
- 드래그앤드롭, 리치 에디터 구현하지 않음

**Recommended Agent Profile**:
- **Category**: `visual-engineering`
  - Reason: Vanilla JS에서 모달/폼/테이블 등 UI 구현
- **Skills**: [`frontend-ui-ux`]
  - `frontend-ui-ux`: 기존 디자인 시스템(CSS 변수)에 맞는 UI 생성

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 6 (with Tasks 13, 14)
- **Blocks**: Task 14
- **Blocked By**: Task 10, Task 11

**References**:
- `frontend/web/public/js/modules/pages/mcp-tools.js:1-303` — 전체 파일. 특히:
  - Line 12-18: getHTML() 메서드 패턴
  - Line 124-150: fetchServerSettings() — API 호출 패턴
  - Line 193-227: saveMCPToolSettings() — fetch POST 패턴
  - Line 241-256: showToast() — UI 피드백 패턴
- CSS 변수: `var(--bg-card)`, `var(--border-light)`, `var(--accent-primary)`, `var(--radius-lg)`, `var(--space-6)`

**Acceptance Criteria**:
- [ ] 페이지에 "외부 MCP 서버" 섹션이 렌더링됨
- [ ] 서버 추가 폼이 name, transport_type, command/URL 입력 필드를 가짐
- [ ] 서버 목록이 API에서 로드됨

**Agent-Executed QA Scenarios**:

```
Scenario: 외부 서버 관리 UI 렌더링 확인
  Tool: Playwright (playwright skill)
  Preconditions: 앱이 localhost:3000에서 실행 중
  Steps:
    1. Navigate to: http://localhost:3000/#mcp-tools
    2. Wait for: ".page-mcp-tools" visible (timeout: 5s)
    3. Assert: text "외부 MCP 서버" exists on page
    4. Assert: button or element with text "서버 추가" exists
    5. Screenshot: .sisyphus/evidence/task-12-mcp-ui.png
  Expected Result: 외부 서버 관리 섹션이 표시됨
  Evidence: .sisyphus/evidence/task-12-mcp-ui.png
```

**Commit**: YES
- Message: `feat(frontend): add external MCP server management UI`
- Files: `frontend/web/public/js/modules/pages/mcp-tools.js`

---

### - [x] 13. Graceful Shutdown — 프로세스 정리 핸들러

**What to do**:
- 앱의 메인 서버 파일(Express app 초기화 위치, `this.app.use('/api/mcp', mcpRouter)` line 319 근처 파일)에 shutdown 핸들러 추가:

```typescript
async function gracefulShutdown(signal: string): Promise<void> {
    console.log(`[Shutdown] ${signal} received. Cleaning up...`);
    try {
        const client = getUnifiedMCPClient();
        const registry = client.getServerRegistry();
        await registry.disconnectAll();
        console.log('[Shutdown] All external MCP servers disconnected.');
    } catch (error) {
        console.error('[Shutdown] Error during cleanup:', error);
    }
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

**Must NOT do**:
- 기존 서버 초기화 로직 변경하지 않음
- 자동 재시작 로직 추가하지 않음

**Recommended Agent Profile**:
- **Category**: `quick`
  - Reason: 10줄 미만의 shutdown 핸들러 추가
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: YES
- **Parallel Group**: Wave 6 (with Tasks 12, 14)
- **Blocks**: Task 14
- **Blocked By**: Task 5

**References**:
- Express 서버 메인 파일 — `this.app.use('/api/mcp', mcpRouter)` 가 있는 파일
- `backend/api/src/mcp/unified-client.ts` — getUnifiedMCPClient()
- `backend/api/src/mcp/server-registry.ts` — MCPServerRegistry.disconnectAll()

**Acceptance Criteria**:
- [ ] `grep "SIGTERM\|SIGINT\|disconnectAll" <서버메인파일>` → 매칭

**Commit**: YES
- Message: `feat(mcp): add graceful shutdown handler for external server cleanup`

---

### - [x] 14. 테스트 작성

**What to do**:
- 3개 새 테스트 파일 작성:
  1. `backend/api/src/mcp/__tests__/external-client.test.ts`:
     - ExternalMCPClient 생성, connect 실패 시 status 확인, SDK mocking
  2. `backend/api/src/mcp/__tests__/tool-router.test.ts`:
     - getAllTools()이 builtInTools 포함 확인
     - registerExternalTools/unregisterExternalTools 동작 확인
     - executeTool()이 내장/외부 라우팅 확인
     - getToolsForTier('free')가 외부 도구 제외 확인
     - 네임스페이스 `::` 접두사 확인
  3. `backend/api/src/mcp/__tests__/server-registry.test.ts`:
     - connectServer/disconnectServer 흐름 (mocking)
     - disconnectAll() 정리 확인

**Must NOT do**:
- 실제 외부 MCP 서버 연결하는 integration test 작성하지 않음
- 기존 테스트 파일 수정하지 않음

**Recommended Agent Profile**:
- **Category**: `unspecified-high`
  - Reason: 3개 테스트 파일, jest.mock 활용, 비동기 테스트 패턴
- **Skills**: []

**Parallelization**:
- **Can Run In Parallel**: NO
- **Parallel Group**: Wave 6 (final)
- **Blocks**: None (final task)
- **Blocked By**: Tasks 8, 9, 12, 13

**References**:
- `backend/api/src/__tests__/ChatService.test.ts` — 기존 테스트 패턴 (jest.mock, describe/it)
- `backend/api/src/__tests__/mcp-filesystem.test.ts` — MCP 관련 기존 테스트
- `backend/api/jest.config.js` — Jest 설정
- `backend/api/src/mcp/external-client.ts`, `tool-router.ts`, `server-registry.ts` — 테스트 대상

**Acceptance Criteria**:
- [ ] `npx jest --testPathPattern="external-client|tool-router|server-registry" --no-coverage` → 모든 PASS
- [ ] `npx jest --no-coverage` → 기존 + 새 테스트 모두 PASS

**Commit**: YES
- Message: `test(mcp): add unit tests for ExternalMCPClient, ToolRouter, and ServerRegistry`
- Files: 3 test files
- Pre-commit: `cd backend/api && npx jest --no-coverage`

---

## Phase 2-4 상위 계획 (Phase 1 완료 후 순차)

### Phase 2: 데이터 접근 (PostgreSQL MCP + Memory + Qdrant)

**목표**: AI가 DB 쿼리, 기억 저장/검색, 벡터 검색 가능

**Tasks (예상 5개)**:
1. PostgreSQL MCP 서버 등록: `@modelcontextprotocol/server-postgres`를 ServerRegistry에 stdio로 등록. 읽기 전용 DB 유저 생성
2. Memory MCP 도구 추가: 기존 MemoryService를 내장 MCP 도구로 노출 (`memory_store`, `memory_recall`, `memory_search`)
3. Qdrant Docker 추가: docker-compose.yml에 Qdrant 서비스 추가, `mcp-server-qdrant` stdio 등록
4. 프론트엔드 업데이트: 메모리/DB 도구 토글 추가
5. 통합 테스트

### Phase 3: 웹 인터랙션 (Playwright)

**목표**: AI가 동적 웹페이지를 탐색/조작 가능

**Tasks (예상 3개)**:
1. Playwright MCP 서버 등록: `@playwright/mcp`를 ServerRegistry에 stdio로 등록
2. 브라우저 도구 tier 설정: enterprise만 또는 pro+
3. 통합 테스트

### Phase 4: 코드 샌드박스 + PDF + Google Drive

**목표**: 안전한 코드 실행, PDF 생성, Drive 연동

**Tasks (예상 5개)**:
1. Piston Docker 추가: docker-compose.yml에 Piston 서비스 추가
2. code-sandbox 내장 도구: `code_execute`, `code_list_languages`
3. PDF MCP 서버 등록
4. Google Drive 연동: 기존 external_connections 테이블 활용
5. 통합 테스트

---

## Commit Strategy

| After Task(s) | Message | Key Files | Verification |
|----------------|---------|-----------|--------------|
| 1 | `feat(mcp): install SDK and add external server type definitions` | types.ts, package.json | `npx tsc --noEmit` |
| 2 | `feat(db): add mcp_servers table schema and CRUD methods` | unified-database.ts | `npx tsc --noEmit` |
| 3, 4 | `feat(mcp): add ExternalMCPClient and ToolRouter core modules` | external-client.ts, tool-router.ts | `npx tsc --noEmit` |
| 5 | `feat(mcp): add MCPServerRegistry for external server connection management` | server-registry.ts | `npx tsc --noEmit` |
| 6, 7 | `refactor(mcp): integrate ToolRouter and ServerRegistry into UnifiedMCPClient` | unified-client.ts, index.ts, tool-tiers.ts | `npx jest --no-coverage` |
| 8 | `refactor(chat): use ToolRouter instead of direct builtInTools access` | ChatService.ts | `npx jest --no-coverage` |
| 9, 10, 11 | `feat(mcp): integrate external tools into agent loop, routes, and socket handler` | agent-loop.ts, mcp.routes.ts, handler.ts | `npx tsc --noEmit` |
| 12 | `feat(frontend): add external MCP server management UI` | mcp-tools.js | Playwright |
| 13 | `feat(mcp): add graceful shutdown handler for external server cleanup` | server main file | `npx tsc --noEmit` |
| 14 | `test(mcp): add unit tests for ExternalMCPClient, ToolRouter, and ServerRegistry` | 3 test files | `npx jest --no-coverage` |

---

## Success Criteria

### Verification Commands

```bash
# 1. TypeScript 컴파일
cd /Volumes/MAC_APP/openmake_llm/backend/api && npx tsc --noEmit
# Expected: 에러 0개

# 2. 전체 테스트
cd /Volumes/MAC_APP/openmake_llm/backend/api && npx jest --no-coverage
# Expected: 9+ test files, 0 failures

# 3. 서버 CRUD API
curl -s http://localhost:3000/api/mcp/servers -H "Authorization: Bearer ${TOKEN}" | jq '.success'
# Expected: true

# 4. 외부 서버 등록 테스트
curl -s -X POST http://localhost:3000/api/mcp/servers \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{"name":"fs-test","transport_type":"stdio","command":"npx","args":["@modelcontextprotocol/server-filesystem","/tmp"],"enabled":true}' | jq '.data'

# 5. 통합 도구 목록에 외부 도구 포함 확인
curl -s http://localhost:3000/api/mcp/tools -H "Authorization: Bearer ${TOKEN}" | jq '.data.tools[]' | grep '::'

# 6. builtInTools 직접 참조 제거 확인
grep -r "builtInTools.map\|builtInTools.find" /Volumes/MAC_APP/openmake_llm/backend/api/src/services/ChatService.ts
# Expected: 0 matches
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass (`npx jest --no-coverage`)
- [ ] TypeScript compiles clean (`npx tsc --noEmit`)
- [ ] External server register → connect → list tools → execute tool works end-to-end
- [ ] LLM conversation uses external tools (ChatService integration)
- [ ] Frontend shows external server management UI
- [ ] App shutdown cleans up all child processes
