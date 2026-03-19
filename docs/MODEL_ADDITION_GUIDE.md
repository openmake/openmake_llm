# 새 LLM 모델 추가 가이드

현재 시스템(OpenMake LLM)에 새 모델을 추가하는 방법을 케이스별로 정리합니다.

---

## 케이스 A — 기존 엔진 슬롯의 모델 교체 (가장 간단)

예: `OMK_ENGINE_CODE`를 `glm-5:cloud` → `minimax-m2.5:1t-cloud`로 교체

### 수정 파일: 최소 1개

**1. `.env`**
```
OMK_ENGINE_CODE=minimax-m2.5:1t-cloud
```

### 새 모델의 capability가 기존과 다를 때 추가 수정

**2. `backend/api/src/config/model-defaults.ts` (L42~79)**

`MODEL_CAPABILITY_PRESETS`에 새 모델의 prefix를 추가합니다.

```typescript
export const MODEL_CAPABILITY_PRESETS: Readonly<Record<string, ModelCapabilities>> = {
    // ... 기존 항목들 ...
    'minimax-m2.5': {
        toolCalling: true,
        thinking: false,
        vision: false,
        streaming: true,
    },
};
```

> prefix는 모델명에서 콜론(`:`) 앞 부분입니다. (`minimax-m2.5:1t-cloud` → `minimax-m2.5`)

---

## 케이스 B — 새 엔진 슬롯 추가 (새 Brand Profile 없이)

예: Auto-Routing의 특정 QueryType에 전용 모델을 할당하고 싶을 때

### 수정 파일: 3~4개

**1. `backend/api/src/config/env.schema.ts` (L121~128 근처)**

Zod 스키마에 새 환경변수를 정의합니다.

```typescript
OMK_ENGINE_RESEARCH: z.string().min(1).default('qwen3.5:397b-cloud'),
```

**2. `backend/api/src/config/env.ts` (L103~124 근처)**

`EnvConfig` 인터페이스에 새 필드를 추가하고, 파싱 로직을 추가합니다.

```typescript
// EnvConfig 인터페이스
omkEngineResearch: string;

// DEFAULT_CONFIG
omkEngineResearch: 'qwen3.5:397b-cloud',

// getConfig() 파싱
omkEngineResearch: parsed.OMK_ENGINE_RESEARCH,
```

**3. `backend/api/src/config/model-defaults.ts` (L21~34)**

`ENGINE_FALLBACKS`에 새 키를 추가합니다.

```typescript
export const ENGINE_FALLBACKS = {
    // ... 기존 항목들 ...
    RESEARCH: 'qwen3.5:397b-cloud',
} as const;
```

**4. `backend/api/src/config/model-defaults.ts` (L42~79)** (필요시)

새 모델 prefix의 capability를 정의합니다. (케이스 A 참조)

---

## 케이스 C — 새 Brand Profile 추가

예: `openmake_llm_research` 프로파일 신설

### 수정 파일: 6~7개

**1. 환경변수 추가** — 케이스 B의 1~2번 단계와 동일

**2. `backend/api/src/chat/pipeline-profile.ts` (L153~283)**

`getProfiles()` 반환 객체에 새 프로파일을 추가합니다. 10가지 파이프라인 요소를 모두 정의해야 합니다.

```typescript
'openmake_llm_research': {
    id: 'openmake_llm_research',
    displayName: 'OpenMake LLM Research',
    description: '심층 리서치 — 논문, 시장조사, 인사이트 도출',
    engineModel: config.omkEngineResearch,   // env.ts에 추가한 필드
    a2a: 'always',
    thinking: 'high',
    discussion: true,
    promptStrategy: 'force_reasoning',
    agentLoopMax: 10,
    loopStrategy: 'sequential',
    contextStrategy: 'full',
    timeBudgetSeconds: 0,
    requiredTools: [],
    costTier: 'premium',
},
```

**3. `backend/api/src/chat/cost-tier.ts` (L35~43)**

`PROFILE_COST_TIERS`에 새 프로파일을 추가합니다.

```typescript
export const PROFILE_COST_TIERS: Record<string, CostTier> = {
    // ... 기존 항목들 ...
    openmake_llm_research: 'premium',
};
```

**4. `backend/api/src/chat/cost-tier.ts` (L55~101)**

`TIER_FALLBACK_MAP`의 관련 QueryType에 새 프로파일을 매핑합니다.

```typescript
analysis: {
    economy: 'openmake_llm_fast',
    standard: 'openmake_llm',
    premium: 'openmake_llm_research',  // 기존 pro → research로 교체
},
```

**5. `backend/api/src/chat/model-selector.ts` (L534~564)**

`selectBrandProfileForAutoRouting()` 스위치에 새 프로파일 분기를 추가합니다.

```typescript
case 'analysis':
    targetProfile = 'openmake_llm_research';  // 기존 pro → research
    break;
```

**6. GET /api/models** — `getProfiles()`를 기반으로 자동 노출되므로 별도 수정 불필요

**7. `frontend/web/public/js/modules/pages/settings.js`** (필요시)

UI 모델 드롭다운에 새 옵션을 추가합니다.

---

## 케이스 D — 새 QueryType 추가 (PRD 핵심)

예: `research` / `science` / `legal` 등 신규 유형 추가

### 수정 파일: 9개 소스 + 테스트

#### 소스 파일

**1. `backend/api/src/chat/model-selector-types.ts` — `QUERY_TYPES` 배열에 추가**

`QUERY_TYPES` const 배열에 새 값을 추가합니다. `QueryType` 타입은 배열에서 자동 파생됩니다.

```typescript
export const QUERY_TYPES = [
    'code', 'analysis', 'creative', 'vision',
    'korean', 'math', 'chat', 'document',
    'translation',
    'research',   // ← 신규 추가
] as const;

// QueryType은 자동으로 파생됨 — 직접 수정 불필요
export type QueryType = typeof QUERY_TYPES[number];
```

> `Record<QueryType, ...>` 패턴 파일(cost-tier.ts, domain-router.ts, a2a-strategy.ts)은 즉시 컴파일 에러 발생 → 누락 위치 자동 감지됨

**2. `backend/api/src/chat/query-classifier.ts` (L35~176)**

`QUERY_PATTERNS` 배열에 새 분류 패턴을 추가합니다.

```typescript
{
    type: 'research',
    patterns: [
        /\b(논문|리서치|research|literature\s+review)\b/i,
        /\b(조사|탐구|인사이트|인용|레퍼런스)\b/i,
    ],
    keywords: [
        '논문', '리서치', '문헌 조사', '인사이트', '레퍼런스',
        'research', 'literature review', 'citation', 'study',
    ],
    weight: 1.0,
},
```

**3. `backend/api/src/chat/llm-classifier.ts` — 프롬프트만 수동 수정**

JSON Schema enum과 `validTypes`는 `QUERY_TYPES`에서 자동 파생되므로 **수정 불필요**.

`CLASSIFICATION_SYSTEM_PROMPT` 카테고리 정의만 수동으로 추가합니다.

```
10. research: 논문, 시장조사, 문헌 리뷰, 인사이트 도출 등 심층 리서치 작업.
```
→ "9 categories" → "10 categories"로 숫자도 수정

**4. `backend/api/src/chat/llm-classifier.ts` (L325~397)**

`WARM_QUERIES`에 새 QueryType에 대한 캐시 워밍 쿼리 5~10개를 추가합니다.

```typescript
// research (6)
{ query: '논문 리뷰해줘', type: 'research', confidence: 0.95 },
{ query: '시장 조사해줘', type: 'research', confidence: 0.90 },
{ query: '리서치해줘', type: 'research', confidence: 0.90 },
{ query: '참고 문헌 찾아줘', type: 'research', confidence: 0.90 },
{ query: 'literature review', type: 'research', confidence: 0.90 },
{ query: '관련 연구 찾아줘', type: 'research', confidence: 0.85 },
```

**5. `backend/api/src/chat/cost-tier.ts` (L55~101)**

`TIER_FALLBACK_MAP`에 새 QueryType 행을 추가합니다.

```typescript
research: {
    economy: 'openmake_llm_fast',
    standard: 'openmake_llm',
    premium: 'openmake_llm_pro',
},
```

**6. `backend/api/src/chat/domain-router.ts` (L28~38)**

`QUERY_TYPE_TO_DOMAIN`에 새 QueryType을 매핑합니다.

```typescript
export const QUERY_TYPE_TO_DOMAIN: Record<QueryType, DomainKey> = {
    // ... 기존 항목들 ...
    research: 'analysis',   // analysis 도메인에 매핑
};
```

**7. `backend/api/src/chat/model-selector.ts` (L534~564)**

`selectBrandProfileForAutoRouting()` 스위치에 케이스를 추가합니다.

```typescript
case 'research':
    targetProfile = 'openmake_llm_pro';
    break;
```

**8. `backend/api/src/services/chat-strategies/a2a-strategy.ts` — `getA2AModelMap()` 맵에 추가**

`switch` 대신 `Record<QueryType, A2AModelSelection>` 맵을 사용하므로 새 항목을 추가합니다.
누락 시 컴파일 에러 발생.

```typescript
research: {
    primary: config.omkEnginePro,
    secondary: config.omkEngineLlm,
    synthesizer: config.omkEngineFast,
},
```

**9. `backend/api/src/chat/complexity-assessor.ts` (L96)**

복잡 유형 배열에 새 타입을 추가합니다.

```typescript
if (['analysis', 'math', 'document', 'research'].includes(ctx.classification.type)) {
```

---

## 핵심 파일 경로 요약

```
backend/api/src/
├── config/
│   ├── env.ts                  # EnvConfig, getConfig(), OMK_ENGINE_* 파싱
│   ├── env.schema.ts           # Zod 스키마, 환경변수 검증
│   └── model-defaults.ts       # ENGINE_FALLBACKS, MODEL_CAPABILITY_PRESETS
├── chat/
│   ├── model-selector-types.ts # QUERY_TYPES 배열 + QueryType 파생  ← 타입 추가 시 시작점
│   ├── query-classifier.ts     # Regex 분류기 (QUERY_PATTERNS)
│   ├── llm-classifier.ts       # LLM 분류기 (프롬프트 + WARM_QUERIES / enum·validTypes 자동파생)
│   ├── model-selector.ts       # 핵심 라우팅 (selectBrandProfileForAutoRouting)
│   ├── pipeline-profile.ts     # 7개 Brand Profile 정의 (getProfiles)
│   ├── cost-tier.ts            # PROFILE_COST_TIERS, TIER_FALLBACK_MAP
│   ├── domain-router.ts        # QUERY_TYPE_TO_DOMAIN
│   └── complexity-assessor.ts  # A2A 게이팅용 복잡도 평가
└── services/
    └── chat-strategies/
        └── a2a-strategy.ts     # A2A 모델 선택 (resolveA2AModels)
```

---

## 검증 방법

### 1. 타입 체크 (가장 빠른 누락 감지)

```bash
npx tsc --noEmit
```

`Record<QueryType, ...>` 패턴 파일(domain-router.ts, cost-tier.ts, a2a-strategy.ts)에서 새 QueryType 누락 시 즉시 컴파일 에러 발생.

### 2. 단위 테스트

```bash
npm test
# 개별 파일
npx jest --testPathPattern="query-classifier"
npx jest --testPathPattern="routing-eval"
```

라우팅 평가 기준:
- Strict 정확도 >= 60%
- Lenient 정확도 >= 75%
- 새 QueryType별 정확도 >= 50%

### 3. API 검증

```bash
curl http://localhost:52416/api/models | jq
```

---

## 체크리스트

### 케이스 A (엔진 모델 교체)
- [ ] `.env` 수정
- [ ] `model-defaults.ts` — `MODEL_CAPABILITY_PRESETS` (capability가 다를 때)

### 케이스 B (새 엔진 슬롯)
- [ ] `env.schema.ts` — Zod 스키마 추가
- [ ] `env.ts` — `EnvConfig` 인터페이스 + `DEFAULT_CONFIG` + `getConfig()` 파싱
- [ ] `model-defaults.ts` — `ENGINE_FALLBACKS` + `MODEL_CAPABILITY_PRESETS`

### 케이스 C (새 Brand Profile)
- [ ] 케이스 B 전체
- [ ] `pipeline-profile.ts` — `getProfiles()` 새 프로파일 추가 (10개 요소)
- [ ] `cost-tier.ts` — `PROFILE_COST_TIERS` 추가
- [ ] `cost-tier.ts` — `TIER_FALLBACK_MAP` 관련 QueryType 수정
- [ ] `model-selector.ts` — `selectBrandProfileForAutoRouting()` switch case

### 케이스 D (새 QueryType)
- [ ] `model-selector-types.ts` — `QUERY_TYPES` 배열에 값 추가
- [ ] `query-classifier.ts` — `QUERY_PATTERNS` 추가
- [ ] `llm-classifier.ts` — 프롬프트 카테고리 추가 (enum/validTypes는 자동)
- [ ] `llm-classifier.ts` — `WARM_QUERIES` 5~10개 추가
- [ ] `cost-tier.ts` — `TIER_FALLBACK_MAP` 새 행 추가 *(컴파일 에러로 감지)*
- [ ] `domain-router.ts` — `QUERY_TYPE_TO_DOMAIN` 추가 *(컴파일 에러로 감지)*
- [ ] `model-selector.ts` — `selectBrandProfileForAutoRouting()` switch case
- [ ] `a2a-strategy.ts` — `getA2AModelMap()` 맵에 항목 추가 *(컴파일 에러로 감지)*
- [ ] `complexity-assessor.ts` — 복잡 유형 배열 확장 (필요시)
- [ ] `npx tsc --noEmit` 통과 확인
- [ ] 관련 테스트 파일 업데이트

---

## PRD 구현 시 추가 고려사항

1. **`ChatService.ts` lossy 역추론 제거**: `AutoRoutingResult` 반환값 확장 필요
2. **`AUTO_ROUTING_ENGINE_MAP` 신설**: 12 QueryType × 3 CostTier 2차원 매핑 테이블
3. **하위호환 alias**: 기존 `code`/`math` 캐시 결과 30분 TTL 대응
