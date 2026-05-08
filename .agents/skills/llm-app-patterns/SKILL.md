---
name: llm-app-patterns
description: OpenMake LLM의 LLM 애플리케이션 패턴. Chat Pipeline, Agent Loop, Model Selector, Prompt Engineering, A2A Multi-model, Discussion Engine 등. chat/, ollama/, agents/ 디렉토리 작업 시 필수. Use when working with AI chat, model orchestration, prompt engineering, agent routing, or tool calling.
---

# LLM App Patterns — OpenMake LLM

이 프로젝트의 LLM 애플리케이션 아키텍처와 핵심 패턴을 정의합니다.

## 아키텍처 개요

```
User Message → PipelineProfile → ModelSelector → ContextEngineering → AgentLoop → Response
                    │                   │                │                  │
              brand alias →        query type →      4-Pillar →     tool calling
              실행 전략 결정        최적 모델 선택     시스템 프롬프트    MCP 도구 실행
```

## 핵심 모듈 맵

| 모듈 | 파일 | 역할 |
|------|------|------|
| **PipelineProfile** | `chat/pipeline-profile.ts` | 7개 brand model → 10가지 실행 전략 매핑 |
| **ProfileResolver** | `chat/profile-resolver.ts` | Alias → ExecutionPlan 변환 |
| **ModelSelector** | `chat/model-selector.ts` | QueryType 분류 → 최적 모델 선택 |
| **ContextEngineering** | `chat/context-engineering.ts` | 4-Pillar Framework 시스템 프롬프트 생성 |
| **Prompt** | `chat/prompt.ts` | 시스템 프롬프트 조립 + 에이전트 프롬프트 |
| **PromptEnhancer** | `chat/prompt-enhancer.ts` | 동적 프롬프트 보강 |
| **ChatService** | `services/ChatService.ts` | 전체 오케스트레이션 (진입점) |
| **AgentLoop** | `ollama/agent-loop.ts` | Multi-turn Tool Calling Loop |
| **OllamaClient** | `ollama/client.ts` | Ollama HTTP 통신 |
| **MultiModelClient** | `ollama/multi-model-client.ts` | A2A 병렬 생성 |
| **ApiKeyManager** | `ollama/api-key-manager.ts` | Cloud API key 로테이션 |
| **DiscussionEngine** | `agents/discussion-engine.ts` | 다중 모델 토론 시스템 |
| **LLMRouter** | `agents/llm-router.ts` | LLM 기반 에이전트 라우팅 |
| **AgentIndex** | `agents/index.ts` | 에이전트 정의 및 라우팅 |

## 1. Pipeline Profile 시스템

7개 brand model alias, 각각 10가지 파이프라인 요소 조합:

```typescript
interface PipelineProfile {
    id: string;                    // brand alias
    engineModel: string;           // 내부 엔진 모델
    a2a: 'off' | 'conditional' | 'always';
    thinking: 'off' | 'low' | 'medium' | 'high';
    discussion: boolean;
    promptStrategy: 'auto' | 'force_coder' | 'force_reasoning' | 'force_creative' | 'none';
    agentLoopMax: number;
    loopStrategy: 'parallel' | 'sequential' | 'auto';
    contextStrategy: 'full' | 'lite' | 'auto';
    timeBudgetSeconds: number;
    requiredTools: string[];
}
```

**Brand Models**: `openmake_llm`, `openmake_llm_pro`, `openmake_llm_fast`, `openmake_llm_think`, `openmake_llm_code`, `openmake_llm_vision`

**규칙**: 새 모델 추가 시 PipelineProfile + ProfileResolver + ModelSelector 3곳 모두 수정 필수.

## 2. Model Selector (QueryType → 모델 프리셋)

QueryType 분류 → 최적 모델 매칭:

```typescript
type QueryType = 'code' | 'analysis' | 'creative' | 'vision' | 'korean' | 'math' | 'chat' | 'document' | 'translation';

interface ModelSelection {
    model: string;
    options: ModelOptions;
    reason: string;
    queryType: QueryType;
    supportsToolCalling: boolean;
    supportsThinking: boolean;
    supportsVision: boolean;
}
```

**패턴**: 키워드 매칭 + 신뢰도 점수 → 모델 프리셋 선택. env 변수로 실제 모델 resolve.

## 3. Context Engineering (4-Pillar Framework)

```typescript
interface FourPillarPrompt {
    role: RoleDefinition;        // 페르소나, 전문성, 행동 특성
    constraints: Constraint[];   // 보안/언어/형식/콘텐츠/행동 제약
    goal: string;                // 달성 목표
    outputFormat: OutputFormat;  // json/markdown/plain/code/table/structured
}
```

**원칙**:
1. XML 태깅으로 구획화 (`<role>`, `<constraints>`, `<goal>`, `<output>`)
2. 메타데이터 동적 주입 (날짜, 세션ID, 언어, 모델명)
3. 위치 공학 (Position Engineering): 중요 지시는 프롬프트 시작/끝에
4. 소프트 인터락: 금지 사항은 명시적으로
5. 인식적 구배: 확실성/불확실성 수준 명시

## 4. Agent Loop (Tool Calling)

```typescript
interface AgentLoopOptions {
    model?: string;
    messages: ChatMessage[];
    tools: ToolDefinition[];
    availableFunctions: Record<string, ToolFunction>;
    think?: ThinkOption;
    stream?: boolean;
    onToken?: (token: string, thinking?: string) => void;
    onToolCall?: (name: string, args: unknown, result: unknown) => void;
    maxIterations?: number;  // 기본 5, 무한 루프 방지
}
```

**실행 플로우**:
1. LLM에 메시지 + 도구 목록 전송
2. LLM이 tool_calls 반환 시 → 도구 실행 → 결과를 메시지에 추가
3. tool_calls 없을 때까지 반복 (maxIterations 제한)
4. API Key 소진 시 → ApiKeyManager가 자동 로테이션 (429/401 감지)

**에러 처리**: getHttpStatus() → isApiKeyExhaustionError() → KeyExhaustionError throw

## 5. A2A (Agent-to-Agent) 병렬 생성

```typescript
const A2A_MODELS = {
    primary: 'gpt-oss:120b-cloud',
    secondary: 'gemini-3-flash-preview:cloud',
    synthesizer: 'gemini-3-flash-preview:cloud',
};
```

패턴: primary + secondary 병렬 생성 → synthesizer가 최종 합성.

## 6. Discussion Engine (다중 모델 토론)

`agents/discussion-engine.ts` — 교차 검토 + 팩트체킹으로 고품질 응답.

## 7. Cloud/Local 모델 라우팅 (API Key 할당 규약)

OllamaClient는 Cloud/Local 모델을 자동 감지하여 **API 키 할당과 인터셉터 설정을 분기**한다.
로컬 Ollama 및 `nomic-embed-text` 같은 임베딩 모델에 Cloud 키를 주입하면 500/404 오류를 일으킨다.

**인터셉터 처리 뉘앙스**:
- **생성자**에서 Local 모델로 초기화될 경우 → `setupInterceptors()` **미호출** (애초에 설정되지 않음)
- **런타임 `setModel()`**로 Cloud → Local 전환 시 → 인터셉터는 **유지**되고 `boundKeyIndex === -1` 가드로 런타임에 스킵

### 분기 규약

| 조건 | API 키 할당 | Authorization 헤더 | 인터셉터 | `boundKeyIndex` |
|---|---|---|---|---|
| `isCloudModel() === true` (접미사 `:cloud` 또는 `-cloud`) | O (pool rotation) | O | O (on) | `0..N-1` |
| `isCloudModel() === false` (Local) | X | X | 생성자: 미설정 / setModel 전환: 가드 스킵 | `-1` (스킵 표식) |

### 핵심 파일

| 파일 | 역할 |
|---|---|
| `ollama/client.ts` | 생성자에서 `isCloud` 분기 → keyRef 초기화. `setModel()` 런타임 전환 시 Cloud 전환이면 키 재할당 |
| `ollama/interceptors.ts` | `boundKeyIndex === -1` 이중 가드 — Authorization 주입/기록 스킵 |
| `ollama/api-key-manager.ts` | 키 풀 라운드로빈 (`OLLAMA_API_KEY_1..5`) |

### 금지/허용

- ❌ Local 모델 인스턴스에 API 키 선주입 금지 (로컬 Ollama 500 반환)
- ❌ `nomic-embed-text` 등 로컬 임베딩에 Cloud 키 할당 금지 (404, 벡터 캐시 워밍 실패)
- ❌ Cloud 모델로 초기화된 OllamaClient에서 `embed()` 직접 호출 금지 — 동일한 axios 인스턴스(`this.client`, line 387~399)를 공유하므로 로컬 임베딩 요청에도 Cloud 키 인터셉터가 주입됨. 로컬 임베딩은 **Local 전용 클라이언트 인스턴스를 별도로 생성**해 호출
- ✅ `setModel()` Local → Cloud 전환 시 `boundKeyIndex === -1`이면 `getNextAvailableKey()` + `setupInterceptors()` 재호출
- ✅ 인터셉터 실패 로그는 `logger.debug` (`info`는 반복 노이즈)

### 새 모델 추가 시

1. Cloud 모델은 모델명에 `:cloud` 또는 `-cloud` 접미사 포함 → `isCloudModel()` 자동 분기
2. `PipelineProfile.engineModel`은 env 변수로 resolve (하드코딩 금지, §1 참조)
3. 로컬 전용 모델은 키 풀 영향 없음 (자동 스킵)

**참조**: `docs/superpowers/specs/2026-04-10-local-ollama-auth-skip-design.md`

## 코딩 규칙

| 규칙 | 상세 |
|------|------|
| 모델 env 매핑 | 모델명은 항상 env 변수로 resolve (`OMK_ENGINE_*`) |
| Cloud/Local 분기 | `:cloud` 접미사로 자동 감지. Local은 키 할당·인터셉터 스킵 (`boundKeyIndex = -1`). §7 참조 |
| 스트리밍 | `onToken` 콜백으로 SSE 스트리밍 지원 필수 |
| 에러 핸들링 | API Key 소진 → `KeyExhaustionError`, 쿼터 초과 → `QuotaExceededError` |
| 타입 안전성 | `as any` 금지, 모든 인터페이스 명시적 정의 |
| 테스트 | `__tests__/context-engineering.test.ts` (796줄), `__tests__/chat-service-behavioral.test.ts` (610줄) 기존 테스트 깨뜨리지 않기 |

## 파일 수정 체크리스트

새 기능 추가 시:
- [ ] `chat/pipeline-profile.ts` — 새 프로파일 필요?
- [ ] `chat/model-selector.ts` — 새 QueryType 또는 모델 프리셋?
- [ ] `chat/context-engineering.ts` — 새 프롬프트 컴포넌트?
- [ ] `ollama/agent-loop.ts` — 새 도구 호출 패턴?
- [ ] `ollama/client.ts` — Cloud/Local 모델 분기 영향? (§7)
- [ ] `services/ChatService.ts` — 오케스트레이션 변경?
- [ ] `agents/index.ts` — 새 에이전트 라우팅?
- [ ] 기존 테스트 통과 확인
