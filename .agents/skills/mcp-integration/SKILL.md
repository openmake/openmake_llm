---
name: mcp-integration
description: OpenMake LLM의 Model Context Protocol 통합 패턴. ToolRouter, Tool Tiers, External MCP Client, Server Registry, User Sandbox, Built-in Tools (web-search, deep-research, sequential-thinking, firecrawl, filesystem). mcp/ 디렉토리 작업 시 필수. Use when adding MCP tools, integrating external MCP servers, modifying tool routing, or working with tool tiers.
---

# MCP Integration Patterns — OpenMake LLM

Model Context Protocol 도구 시스템의 아키텍처와 패턴.

## 디렉토리 구조 (4,463 LOC, 15 파일)

```
mcp/
├── types.ts              # MCP 타입 정의 (MCPTool, MCPToolResult, MCPToolHandler)
├── tool-router.ts        # ToolRouter 클래스 — 내장+외부 도구 통합 라우팅
├── tool-tiers.ts         # UserTier 기반 도구 접근 제어
├── tools.ts              # 내장 도구 정의 (builtInTools)
├── unified-client.ts     # UnifiedMCPClient — 통합 MCP 클라이언트
├── server.ts             # MCP 서버 구현
├── server-registry.ts    # 외부 MCP 서버 레지스트리
├── external-client.ts    # 외부 MCP 서버 클라이언트
├── user-sandbox.ts       # 사용자 컨텍스트 기반 샌드박스
├── web-search.ts         # Google Custom Search 통합
├── deep-research.ts      # 자율 다단계 리서치
├── sequential-thinking.ts # 단계별 추론 체인
├── firecrawl.ts          # Firecrawl 웹 스크래핑
├── filesystem.ts         # 파일시스템 접근 도구
└── __tests__/            # 테스트 (tool-router, tool-tiers, external-client, server-registry)
```

## 핵심 타입

```typescript
// JSON-RPC 2.0 기반
interface MCPRequest { jsonrpc: '2.0'; id: string | number; method: string; params?: Record<string, unknown>; }
interface MCPResponse { jsonrpc: '2.0'; id: string | number; result?: unknown; error?: MCPError; }

// 도구 정의
interface MCPTool {
    name: string;
    description: string;
    inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; };
}

interface MCPToolResult {
    content: Array<{ type: 'text' | 'image' | 'resource'; text?: string; data?: string; mimeType?: string; }>;
    isError?: boolean;
}

// 도구 핸들러 (제네릭, UserContext 전달 가능)
type MCPToolHandler<T> = (args: T, context?: UserContext) => Promise<MCPToolResult>;

interface MCPToolDefinition<T> { tool: MCPTool; handler: MCPToolHandler<T>; }
```

## ToolRouter — 핵심 라우팅 클래스

```typescript
class ToolRouter {
    getAllTools(): MCPTool[]                           // 내장+외부 전체 목록
    getToolsForTier(tier: UserTier): MCPTool[]        // 사용자 등급별 필터링
    executeTool(name: string, args, context?): Promise<MCPToolResult>  // 실행
    registerExternalTools(serverId, tools, executor)   // 외부 도구 등록
    toOllamaTools(tier?): OllamaTool[]                // Ollama 호환 형식 변환
}
```

**라우팅 규칙**:
1. `::` 네임스페이스 구분자 포함 → 외부 도구 (`serverId::toolName`)
2. 네임스페이스 없음 → 내장 도구 (builtInTools에서 검색)
3. `canUseTool(tier, toolName)` → Tool Tier 접근 제어

## Tool Tiers (접근 제어)

| Tier | 접근 범위 |
|------|----------|
| `free` | 기본 도구만 (web_search, calculator 등) |
| `pro` | 확장 도구 포함 (deep_research, firecrawl 등) |
| `enterprise` | 전체 도구 + 외부 MCP 서버 |

## 외부 MCP 서버 통합

```typescript
// 전송 방식
type MCPTransportType = 'stdio' | 'sse' | 'streamable-http';

// DB 저장 구조
interface MCPServerConfig {
    id: string;
    user_id: string;
    name: string;
    transport_type: MCPTransportType;
    config: Record<string, unknown>;  // command, args, env (stdio) 또는 url (sse/http)
}
```

**외부 서버 연결 플로우**:
1. `ServerRegistry`에서 사용자별 서버 설정 로드
2. `ExternalMCPClient`로 연결 (stdio: child_process, sse/http: HTTP)
3. `tools/list` 호출로 도구 목록 가져오기
4. `ToolRouter.registerExternalTools()`에 등록
5. Agent Loop에서 네임스페이스 기반 라우팅

## 내장 도구 목록

| 도구 | 파일 | 설명 |
|------|------|------|
| `web_search` | `web-search.ts` | Google Custom Search API |
| `deep_research` | `deep-research.ts` | 다단계 자율 리서치 |
| `sequential_thinking` | `sequential-thinking.ts` | 단계별 추론 |
| `firecrawl_scrape` | `firecrawl.ts` | 웹 스크래핑 |
| `read_file` / `write_file` | `filesystem.ts` | 파일 읽기/쓰기 (샌드박스 내) |

## 새 도구 추가 패턴

```typescript
// 1. tools.ts에 MCPToolDefinition 추가
export const builtInTools: MCPToolDefinition[] = [
    // 기존 도구들...
    {
        tool: {
            name: 'my_new_tool',
            description: '도구 설명',
            inputSchema: {
                type: 'object',
                properties: { query: { type: 'string', description: '검색어' } },
                required: ['query']
            }
        },
        handler: async (args, context?) => {
            // 도구 로직
            return { content: [{ type: 'text', text: '결과' }] };
        }
    }
];

// 2. tool-tiers.ts에 접근 제어 추가
// 3. 테스트 추가
```

## UserContext (샌드박스)

```typescript
interface UserContext {
    userId: string;
    tier: UserTier;
    sessionId?: string;
    // 도구 실행 시 사용자 컨텍스트 전달
}
```

## 코딩 규칙

| 규칙 | 상세 |
|------|------|
| **네임스페이스** | 외부 도구는 반드시 `serverId::toolName` 형식 |
| **Tier 체크** | 모든 도구 실행 전 `canUseTool()` 확인 |
| **에러 형식** | 실패 시 `{ content: [{ type: 'text', text: '에러' }], isError: true }` |
| **JSON-RPC** | MCP 프로토콜은 항상 JSON-RPC 2.0 준수 |
| **UserContext** | 내장 도구 handler에 context 파라미터 전달 (Phase 3) |
| **테스트** | tool-router(198줄), tool-tiers(144줄), external-client(121줄), server-registry(101줄) |
