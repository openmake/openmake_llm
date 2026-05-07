---
name: typescript-advanced
description: OpenMake LLM의 고급 TypeScript 패턴. Strict mode, 제네릭, 유틸리티 타입, 타입 가드, Discriminated Union, Declaration merging, 금지 패턴 (as any, @ts-ignore). backend/api/src/ TypeScript 작업 시 참고. Use when writing complex types, generics, type guards, or ensuring type safety.
---

# Advanced TypeScript Patterns — OpenMake LLM

TypeScript strict mode 환경에서의 고급 타입 패턴.

## tsconfig.json (Strict Mode)

```json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "CommonJS",
        "strict": true,
        "noImplicitAny": true,
        "strictNullChecks": true,
        "forceConsistentCasingInFileNames": true,
        "declaration": true,
        "declarationMap": true,
        "sourceMap": true
    }
}
```

## ⚠️ 절대 금지 패턴

```typescript
// ❌ 절대 금지 — 코딩 규칙 위반
value as any
// @ts-ignore
// @ts-expect-error
```

**대안**: 적절한 타입 정의, 타입 가드, 타입 단언 (as 구체타입)

## 패턴 1: 제네릭 (102개 파일에서 사용)

### 기본 제네릭 함수
```typescript
// retry-wrapper.ts
async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
        try { return await fn(); } catch (e) { /* retry logic */ }
    }
    throw new Error('Max retries exceeded');
}
```

### 제네릭 인터페이스
```typescript
// mcp/types.ts — 도구 핸들러의 인자 타입을 제네릭으로
type MCPToolHandler<T extends Record<string, unknown> = Record<string, unknown>> = 
    (args: T, context?: UserContext) => Promise<MCPToolResult>;

interface MCPToolDefinition<T extends Record<string, unknown> = Record<string, unknown>> {
    tool: MCPTool;
    handler: MCPToolHandler<T>;
}
```

## 패턴 2: Discriminated Union

```typescript
// chat/pipeline-profile.ts
type A2AStrategy = 'off' | 'conditional' | 'always';
type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';
type PromptStrategy = 'auto' | 'force_coder' | 'force_reasoning' | 'force_creative' | 'none';

// chat/model-selector.ts
type QueryType = 'code' | 'analysis' | 'creative' | 'vision' | 'korean' | 'math' | 'chat' | 'document' | 'translation';
```

## 패턴 3: 타입 가드

```typescript
// auth/index.ts
function isValidJWTPayload(obj: unknown): obj is JWTPayload {
    if (!obj || typeof obj !== 'object') return false;
    const record = obj as Record<string, unknown>;
    return typeof record.userId === 'string' || typeof record.userId === 'number';
}

// ollama/agent-loop.ts
function isApiKeyExhaustionError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const err = error as OllamaLikeError;
    const text = `${err.name || ''} ${err.message || ''}`.toLowerCase();
    return text.includes('keyexhaustion');
}
```

## 패턴 4: Declaration Merging (Express Request 확장)

```typescript
// auth/middleware.ts
declare global {
    namespace Express {
        interface Request {
            user?: PublicUser | AuthUser;
            token?: string;
            authMethod?: 'jwt' | 'api-key';
            apiKeyId?: string;
            apiKeyRecord?: UserApiKey;
            requestId?: string;
        }
    }
}
```

## 패턴 5: 유틸리티 타입 활용

```typescript
// Record로 동적 키 타입
type QueryParam = string | number | boolean | null | undefined;
type DbRow = Record<string, unknown>;

// Omit으로 설정 부분 제외
type OAuthProviderConfig = Omit<FullConfig, 'clientId' | 'clientSecret' | 'redirectUri'>;

// const assertion
const A2A_MODELS = { primary: '...', secondary: '...', synthesizer: '...' } as const;
```

## 패턴 6: 인터페이스 계층 설계

```typescript
// 기본 → 확장 → 특화
interface Message { role: string; content: string; }
interface MessageWithThinking extends Message { thinking?: string; }

interface ModelPreset {
    name: string;
    capabilities: {
        toolCalling: boolean;
        thinking: boolean;
        vision: boolean;
        streaming: boolean;
        contextLength: number;
    };
    bestFor: QueryType[];
}
```

## 패턴 7: 안전한 타입 단언

```typescript
// ✅ 구체적 타입으로 단언 (unknown → 알려진 타입)
const err = error as OllamaLikeError;

// ✅ Record로 안전하게 접근
const record = obj as Record<string, unknown>;

// ❌ any 사용 금지
const x = something as any;
```

## 프로젝트 타입 파일 위치

| 파일 | 정의하는 타입 |
|------|-------------|
| `ollama/types.ts` | ChatMessage, ToolDefinition, ModelOptions, ThinkOption, UsageMetrics |
| `mcp/types.ts` | MCPTool, MCPToolResult, MCPToolHandler, MCPServerConfig |
| `auth/types.ts` | JWTPayload, AuthUser |
| `data/user-manager.ts` | PublicUser, UserRole, UserTier |
| `chat/context-engineering.ts` | FourPillarPrompt, RoleDefinition, Constraint, OutputFormat |
| `chat/model-selector.ts` | QueryType, QueryClassification, ModelSelection |
| `chat/pipeline-profile.ts` | PipelineProfile, A2AStrategy, ThinkingLevel |
| `types/` | 공유 타입 정의 |

## 체크리스트

TypeScript 코드 작성 시:
- [ ] `as any`, `@ts-ignore`, `@ts-expect-error` 사용하지 않기
- [ ] 새 인터페이스/타입은 해당 도메인 파일 또는 types/ 에 정의
- [ ] unknown → 구체 타입 변환 시 타입 가드 사용
- [ ] 제네릭 활용으로 코드 재사용성 확보
- [ ] strictNullChecks 준수 (optional chaining, nullish coalescing)
- [ ] `npm run build` (tsc 컴파일) 에러 없음 확인
