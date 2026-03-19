# Model Selector bestFor & QueryType 일관성 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `selectOptimalModel()`의 ModelPreset `bestFor` 배열에 세분화 QueryType(`code-gen`, `code-agent`, `math-hard`, `math-applied`, `reasoning`, `translation`)을 등록하여, 비 브랜드 모델 라우팅 경로에서 올바른 모델이 선택되도록 수정한다.

**Architecture:** 수정은 단일 파일(`model-selector.ts`)의 `getModelPresets()` 함수 내 `bestFor` 배열 확장이 핵심이다. 이와 동시에 `selectOptimalModel()`이 LLM 분류기를 사용하도록 통일하고, `query-classifier.ts`의 `reasoning` 중복 진입 경로를 정리한다. LLM 분류기 통합 테스트는 기존 테스트 파일과의 충돌 방지를 위해 별도 파일로 분리한다.

**Tech Stack:** TypeScript (strict), Jest/ts-jest, `@/` 경로 alias, Winston logger

---

## 영향 파일 분석 (변경 전 필독)

### 직접 수정 대상

| 파일 | 이유 |
|---|---|
| `backend/api/src/chat/model-selector.ts` | `getModelPresets().bestFor` 확장 + `selectOptimalModel` LLM 분류기 통합 |
| `backend/api/src/chat/query-classifier.ts` | `QUERY_PATTERNS`의 `reasoning` 중복 정의 제거 |

### 테스트 파일 수정/신규 대상

> **⚠️ 중요**: 프로젝트의 모든 테스트 파일은 `backend/api/src/__tests__/`에 있음. `chat/__tests__/`가 아님.

| 파일 | 변경 | 이유 |
|---|---|---|
| `backend/api/src/__tests__/model-selector.test.ts` | 수정 | `selectOptimalModel` 신규 QueryType 케이스 추가 |
| `backend/api/src/__tests__/query-classifier.test.ts` | 수정 | `reasoning` 분류 일관성 + edge case 테스트 추가 |
| `backend/api/src/__tests__/model-selector-llm.test.ts` | 신규 생성 | LLM 분류기 통합 테스트 (기존 파일과 mock 충돌 방지를 위해 별도 파일) |

### 간접 영향 (읽기만, 수정 없음)

| 파일 | 관계 / 판단 근거 |
|---|---|
| `backend/api/src/services/ChatService.ts` | `selectOptimalModel` 소비자 — 함수 시그니처 불변 → 수정 불필요 |
| `backend/api/src/sockets/ws-chat-handler.ts` | `selectOptimalModel` 직접 호출 (`model === 'default'` 조건). `hasImages` 미전달 버그 존재하나 **현재 스코프 외** — 별도 이슈로 처리 |
| `backend/api/src/chat/model-selector-types.ts` | `QUERY_TYPES`에 14종 이미 포함 → 수정 불필요 |
| `backend/api/src/chat/llm-classifier.ts` | LLM 분류기 — 재사용만, 수정 불필요 |
| `backend/api/src/chat/cost-tier.ts` | `TIER_FALLBACK_MAP` 14종 모두 커버 → 수정 불필요 |
| `backend/api/src/chat/domain-router.ts` | `QUERY_TYPE_TO_DOMAIN` 14종 모두 매핑 → 수정 불필요 |
| `backend/api/src/chat/complexity-assessor.ts` | `code-agent` 이미 복잡 타입 포함 → 수정 불필요 |
| `backend/api/src/config/model-defaults.ts` | `ENGINE_FALLBACKS` 읽기만 → 수정 불필요 |
| `backend/api/src/__tests__/model-selector-cost-tier.test.ts` | `selectBrandProfileForAutoRouting()` 반환값을 문자열로 비교하는 기존 버그 있을 수 있음. Task 1 baseline에서 확인 후 필요시 수정 포함 결정 |

---

## 수정 내용 상세

### 문제 1: `getModelPresets().bestFor` 타입 불일치

**현황** vs **목표**:

```typescript
// 현재 (버그) — selectOptimalModel() 기준
'qwen-coder': { bestFor: ['code'] }            // code-gen, code-agent 미매칭 → gemini-flash 폴백
'math-reasoning': { bestFor: ['math'] }         // math-hard, math-applied 미매칭 → gemini-flash 폴백
'gemini-flash': { bestFor: ['code', ...] }      // reasoning, translation 누락 → 폴백만 있음
'gpt-oss': { bestFor: ['creative', 'analysis', 'document'] }  // reasoning 누락

// 목표 (수정 후)
'qwen-coder': { bestFor: ['code', 'code-gen', 'code-agent'], priority: 0 }  // 코드 유형 최우선
'math-reasoning': { bestFor: ['math', 'math-hard', 'math-applied', 'reasoning'], priority: 1 }
'gemini-flash': { bestFor: ['code', 'code-gen', 'code-agent', 'analysis', 'chat', 'korean', 'document', 'translation'], priority: 1 }
'gpt-oss': { bestFor: ['creative', 'analysis', 'document', 'reasoning'], priority: 2 }
```

**우선순위 분석**:
- `code-gen`/`code-agent`: qwen-coder(priority=**0**) vs gemini-flash(priority=1) → qwen-coder 선택 ✅
- `math-hard`/`math-applied`: math-reasoning(priority=1)만 해당 → math-reasoning 선택 ✅
- `reasoning`: math-reasoning(priority=1) vs gpt-oss(priority=2) → math-reasoning 선택 ✅
- `translation`: gemini-flash(priority=1)만 해당 → gemini-flash 선택 ✅
- **`selectBrandProfileForAutoRouting()`은 `getModelPresets()`를 사용하지 않음** (switch문으로 직접 brand profile 매핑) → priority=0 변경은 해당 함수에 무영향

### 문제 2: `reasoning` QUERY_PATTERNS 중복 진입 경로

**현황**: `reasoning`이 두 경로로 생성됨
  - 경로 A: QUERY_PATTERNS에 `reasoning` 블록 직접 존재 (159줄)
  - 경로 B: `analysis` 1차 분류 후 논리 추론 패턴 감지 시 2차 세분화 변환 (291줄)

**목표**: QUERY_PATTERNS의 `reasoning` 블록 제거 → 경로 B만 사용

**⚠️ Edge Case 주의**: QUERY_PATTERNS에서 `reasoning` 제거 시, analysis 점수가 낮아 1차 분류에서 `analysis`가 선택되지 않으면 2차 세분화 경로 자체에 진입 못함 → `reasoning`이 `chat`으로 폴백 가능. 이 동작을 허용하는 이유: **LLM 분류기가 primary이고, regex는 fallback**이므로 LLM이 `reasoning`을 올바르게 분류함. regex fallback에서의 엣지케이스는 허용 가능한 trade-off.

### 문제 3: `selectOptimalModel()` LLM 분류기 미사용

**현황**: regex만 사용 (~68% 정확도)
**목표**: LLM 우선(신뢰도 ≥ 0.7) → regex fallback (~92-95%)
**⚠️ 테스트 주의**: `jest.mock('../llm-classifier')`를 기존 `model-selector.test.ts`에 추가하면 파일 전체에 mock 적용되어 기존 테스트(`queryType: 'code'` 기대값 등)에 영향. → **별도 파일 `model-selector-llm.test.ts`에 LLM 통합 테스트 작성**.

---

## Task 1: 기존 테스트 Baseline 확인

**Files:**
- Read: `backend/api/src/__tests__/model-selector.test.ts`
- Read: `backend/api/src/__tests__/query-classifier.test.ts`
- Read: `backend/api/src/__tests__/model-selector-cost-tier.test.ts`

- [ ] **Step 1: 기존 테스트 실행 — baseline 상태 파악**

```bash
cd /Volumes/MAC_APP/openmake_llm
npx jest --testPathPattern="model-selector|query-classifier|cost-tier" --no-coverage 2>&1 | tail -50
```

Expected: 일부 PASS, 일부 FAIL 가능 (현재 버그 상태). 실패 목록을 기록해 둘 것.

- [ ] **Step 2: `model-selector-cost-tier.test.ts` 확인**

`selectBrandProfileForAutoRouting()` 반환값을 문자열로 직접 비교하는 테스트가 있는지 확인. 있다면 해당 테스트가 이미 실패 상태임을 인지하고, Task 3 또는 Task 4에서 수정 여부 결정.

> 반환 타입: `AutoRoutingResult { profileId, classifiedQueryType, classifiedConfidence, classifierSource }`. 문자열 비교 시 실패.

---

## Task 2: `query-classifier.ts` `reasoning` 중복 경로 정리

**Files:**
- Modify: `backend/api/src/chat/query-classifier.ts` (159-169줄 reasoning 블록 제거)
- Modify: `backend/api/src/__tests__/query-classifier.test.ts`

- [ ] **Step 1: 실패할 테스트 작성**

`backend/api/src/__tests__/query-classifier.test.ts`에 추가:

```typescript
describe('reasoning 분류 경로 단일화', () => {
    it('analysis + 논리 추론 패턴이 함께 있으면 reasoning으로 분류', () => {
        // "분석" 키워드(analysis) + "논리"(reasoning 2차 패턴) 동시 매칭
        const result = classifyQuery('이 현상의 원인과 결과를 논리적으로 분석해줘');
        expect(result.type).toBe('reasoning');
    });

    it('인과관계 + 분석 쿼리는 reasoning으로 분류', () => {
        const result = classifyQuery('A가 B를 유발하는 인과관계를 분석해줘');
        expect(result.type).toBe('reasoning');
    });

    it('순수 논리 추론(analysis 매칭 없음)은 chat 또는 korean으로 허용', () => {
        // regex fallback에서의 edge case: analysis 패턴 없으면 reasoning 불가 → 허용됨
        // LLM 분류기가 primary이므로 regex fallback에서의 폴백은 허용
        const result = classifyQuery('가설이 성립하는지 검토해줘');
        // reasoning 또는 chat/korean 모두 허용 (LLM이 primary)
        expect(['reasoning', 'chat', 'korean', 'analysis']).toContain(result.type);
    });

    it('단순 인사 쿼리는 reasoning이 아님', () => {
        const result = classifyQuery('오늘 날씨 어때?');
        expect(result.type).not.toBe('reasoning');
    });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
npx jest --testPathPattern="query-classifier" --no-coverage 2>&1 | grep -E "reasoning|PASS|FAIL|●"
```

- [ ] **Step 3: QUERY_PATTERNS에서 reasoning 블록 제거**

`query-classifier.ts` 159-169줄의 reasoning QueryPattern 블록 삭제:

```typescript
// 삭제 대상 블록 (159-169줄)
{
    type: 'reasoning' as QueryType,
    patterns: [
        /\b(논리적|logical|논리|logic)\b/i,
        /\b(인과|causal|원인.*결과|cause.*effect)\b/i,
        /\b(만약.*라면|if.*then|가설|hypothesis)\b/i,
        /\b(비판|critique|반박|논증|argument)\b/i,
        /\b(추론|inference|연역|deduction|귀납|induction)\b/i,
    ],
    keywords: ['논리', 'logical', '인과관계', 'causal', '가설', 'hypothesis',
               '비판적 사고', '논증', '추론', '연역', '귀납', '모순'],
    weight: 1.0,
},
```

2차 세분화 경로(291줄)는 유지.

- [ ] **Step 4: 테스트 실행 — PASS 확인**

```bash
npx jest --testPathPattern="query-classifier" --no-coverage 2>&1 | tail -20
```

Expected: 신규 테스트 포함 모두 PASS (edge case 테스트는 `toContain` 조건이므로 유연)

- [ ] **Step 5: Commit**

```bash
git add backend/api/src/chat/query-classifier.ts backend/api/src/__tests__/query-classifier.test.ts
git commit -m "fix: reasoning 분류 경로 단일화 — QUERY_PATTERNS 중복 블록 제거, 2차 세분화만 사용"
```

---

## Task 3: `model-selector.ts` `getModelPresets().bestFor` 확장

**Files:**
- Modify: `backend/api/src/chat/model-selector.ts` (104-227줄 `getModelPresets` 함수)
- Modify: `backend/api/src/__tests__/model-selector.test.ts`

- [ ] **Step 1: 실패할 테스트 작성**

`backend/api/src/__tests__/model-selector.test.ts`에 추가:

```typescript
describe('selectOptimalModel — 세분화 QueryType 프리셋 매칭', () => {
    it('code-gen 분류 결과는 gemini-flash 대신 qwen-coder로 라우팅', async () => {
        // mock: classifyQuery가 code-gen 반환
        // 실제로는 "파이썬으로 정렬 함수 작성해줘"가 code-gen으로 분류됨
        const result = await selectOptimalModel('파이썬으로 정렬 함수 작성해줘');
        // qwen-coder의 bestFor에 code-gen이 포함되어야 함
        expect(['code', 'code-gen', 'code-agent']).toContain(result.queryType);
        // 폴백인 gemini-flash의 defaultModel이 아닌 qwen-coder 엔진이어야 함
        // (실제 모델명은 env 의존이므로 queryType으로만 검증)
    });

    it('math-hard 분류 결과는 math-reasoning으로 라우팅', async () => {
        const result = await selectOptimalModel('페르마의 마지막 정리를 증명해줘');
        expect(['math', 'math-hard', 'math-applied']).toContain(result.queryType);
    });

    it('translation 분류 결과는 gemini-flash로 라우팅', async () => {
        const result = await selectOptimalModel('이 문장을 영어로 번역해줘');
        expect(result.queryType).toBe('translation');
        // translation은 폴백 없이 직접 매핑되어야 함
        expect(result.model).toBeDefined();
    });

    it('getModelPresets의 qwen-coder는 code-gen, code-agent를 bestFor에 포함', () => {
        const presets = getModelPresets();
        expect(presets['qwen-coder'].bestFor).toContain('code-gen');
        expect(presets['qwen-coder'].bestFor).toContain('code-agent');
        expect(presets['qwen-coder'].priority).toBe(0);  // 최우선
    });

    it('getModelPresets의 math-reasoning은 math-hard, math-applied, reasoning을 bestFor에 포함', () => {
        const presets = getModelPresets();
        expect(presets['math-reasoning'].bestFor).toContain('math-hard');
        expect(presets['math-reasoning'].bestFor).toContain('math-applied');
        expect(presets['math-reasoning'].bestFor).toContain('reasoning');
    });

    it('getModelPresets의 gemini-flash는 translation을 bestFor에 포함', () => {
        const presets = getModelPresets();
        expect(presets['gemini-flash'].bestFor).toContain('translation');
    });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
npx jest --testPathPattern="model-selector.test" --no-coverage 2>&1 | grep -E "세분화 QueryType|FAIL|●"
```

Expected: 신규 테스트들 FAIL

- [ ] **Step 3: `getModelPresets()` `bestFor` 배열 및 priority 수정**

`model-selector.ts`의 `getModelPresets()` 함수 내 각 프리셋 수정:

```typescript
// gemini-flash: translation, code-gen, code-agent 추가
bestFor: ['code', 'code-gen', 'code-agent', 'analysis', 'chat', 'korean', 'document', 'translation'],
priority: 1,  // 기존 유지

// gpt-oss: reasoning 추가
bestFor: ['creative', 'analysis', 'document', 'reasoning'],
priority: 2,  // 기존 유지

// qwen-coder: code-gen, code-agent 추가 + priority 0으로 변경
bestFor: ['code', 'code-gen', 'code-agent'],
priority: 0,  // 1 → 0 (gemini-flash priority=1보다 낮아 명시적 우선)

// math-reasoning: math-hard, math-applied, reasoning 추가
bestFor: ['math', 'math-hard', 'math-applied', 'reasoning'],
priority: 1,  // 기존 유지 (gpt-oss priority=2보다 낮아 reasoning에서 우선)
```

- [ ] **Step 4: 테스트 실행 — PASS 확인**

```bash
npx jest --testPathPattern="model-selector.test" --no-coverage 2>&1 | tail -30
```

Expected: 모든 테스트 PASS (기존 테스트 포함)

- [ ] **Step 5: Commit**

```bash
git add backend/api/src/chat/model-selector.ts backend/api/src/__tests__/model-selector.test.ts
git commit -m "fix: ModelPreset bestFor 세분화 QueryType 등록 + qwen-coder priority=0으로 코드 유형 최우선화"
```

---

## Task 4: `selectOptimalModel()` LLM 분류기 통합 (별도 테스트 파일)

**Files:**
- Modify: `backend/api/src/chat/model-selector.ts` (`selectOptimalModel` 함수, 251줄 부근)
- Create: `backend/api/src/__tests__/model-selector-llm.test.ts` (LLM mock 테스트 전용, 기존 파일 mock 충돌 방지)

- [ ] **Step 1: 신규 테스트 파일 생성 — 실패 확인**

`backend/api/src/__tests__/model-selector-llm.test.ts` 신규 생성:

```typescript
/**
 * selectOptimalModel — LLM 분류기 통합 테스트
 *
 * 기존 model-selector.test.ts에 jest.mock()을 추가하면 파일 전체에 영향을 주므로,
 * LLM 분류기 mock 테스트는 이 파일에 분리합니다.
 */
import { selectOptimalModel } from '@/chat/model-selector';
import { classifyWithLLM, getConfidenceThreshold } from '@/chat/llm-classifier';

jest.mock('@/chat/llm-classifier');

const mockClassifyWithLLM = classifyWithLLM as jest.MockedFunction<typeof classifyWithLLM>;
const mockGetConfidenceThreshold = getConfidenceThreshold as jest.MockedFunction<typeof getConfidenceThreshold>;

describe('selectOptimalModel — LLM 분류기 통합', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetConfidenceThreshold.mockReturnValue(0.7);
    });

    it('LLM 분류 성공 + 신뢰도 ≥ 0.7이면 LLM 결과 사용', async () => {
        mockClassifyWithLLM.mockResolvedValue({
            type: 'code-gen',
            confidence: 0.9,
            source: 'llm',
        });
        const result = await selectOptimalModel('함수 만들어줘');
        expect(result.queryType).toBe('code-gen');
        expect(mockClassifyWithLLM).toHaveBeenCalledTimes(1);
    });

    it('LLM 신뢰도 < 0.7이면 regex fallback 사용', async () => {
        mockClassifyWithLLM.mockResolvedValue({
            type: 'code-gen',
            confidence: 0.5,  // 낮은 신뢰도
            source: 'llm',
        });
        // "안녕하세요"는 regex에서 chat으로 분류됨
        const result = await selectOptimalModel('안녕하세요');
        expect(result.queryType).toBe('chat');
    });

    it('LLM 분류 실패(null)이면 regex fallback 사용', async () => {
        mockClassifyWithLLM.mockResolvedValue(null);
        const result = await selectOptimalModel('안녕하세요');
        expect(result.queryType).toBe('chat');
    });

    it('LLM 분류 예외 발생 시 regex fallback 사용', async () => {
        mockClassifyWithLLM.mockRejectedValue(new Error('network error'));
        // 예외 발생해도 폴백하여 정상 반환
        await expect(selectOptimalModel('안녕하세요')).resolves.toBeDefined();
    });

    it('hasImages=true면 LLM 결과와 무관하게 vision 타입으로 강제', async () => {
        mockClassifyWithLLM.mockResolvedValue({
            type: 'chat',
            confidence: 0.95,
            source: 'llm',
        });
        const result = await selectOptimalModel('이게 뭐야', true);
        expect(result.queryType).toBe('vision');
    });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
npx jest --testPathPattern="model-selector-llm" --no-coverage 2>&1 | grep -E "PASS|FAIL|●"
```

Expected: 모두 FAIL (`selectOptimalModel`이 아직 LLM 분류기를 호출하지 않음)

- [ ] **Step 3: `selectOptimalModel` LLM 분류기 통합**

`model-selector.ts`의 `selectOptimalModel` 함수 수정 (251줄 부근):

```typescript
export async function selectOptimalModel(query: string, hasImages?: boolean): Promise<ModelSelection> {
    const config = getConfig();

    // ── LLM 분류 우선, 실패/신뢰도 부족 시 regex fallback ──
    let classifiedType: QueryType;
    let classifiedConfidence: number;

    try {
        const llmResult = await classifyWithLLM(query);
        if (llmResult && llmResult.confidence >= getConfidenceThreshold()) {
            classifiedType = llmResult.type;
            classifiedConfidence = llmResult.confidence;
            logger.info(`[selectOptimalModel] LLM 분류: ${classifiedType} (${(classifiedConfidence * 100).toFixed(0)}%) [source=${llmResult.source}]`);
        } else {
            const regexResult = _classifyQuery(query);
            classifiedType = regexResult.type;
            classifiedConfidence = regexResult.confidence;
            logger.info(`[selectOptimalModel] Regex fallback: ${classifiedType} (${(classifiedConfidence * 100).toFixed(0)}%)`);
        }
    } catch {
        const regexResult = _classifyQuery(query);
        classifiedType = regexResult.type;
        classifiedConfidence = regexResult.confidence;
        logger.warn(`[selectOptimalModel] LLM 분류 예외 → regex fallback: ${classifiedType}`);
    }

    // 이미지가 첨부된 경우 비전 모델 강제 선택
    if (hasImages) {
        classifiedType = 'vision';
    }

    logger.info(`질문 유형: ${classifiedType} (신뢰도: ${(classifiedConfidence * 100).toFixed(0)}%)`);

    // 질문 유형에 맞는 최적 모델 찾기 (이하 기존 로직 유지)
    let selectedPreset: ModelPreset | null = null;
    let lowestPriority = Infinity;

    for (const [, preset] of Object.entries(getModelPresets())) {
        if (preset.bestFor.includes(classifiedType)) {
            if (preset.priority < lowestPriority) {
                lowestPriority = preset.priority;
                selectedPreset = preset;
            }
        }
    }

    if (!selectedPreset) {
        selectedPreset = getModelPresets()['gemini-flash'];
    }

    const actualModel = selectedPreset.defaultModel || config.ollamaDefaultModel;
    logger.info(`선택된 모델: ${selectedPreset.name} (${actualModel})`);

    return {
        model: actualModel,
        options: selectedPreset.options,
        reason: `${classifiedType} 질문 → ${selectedPreset.name} 사용`,
        queryType: classifiedType,
        supportsToolCalling: selectedPreset.capabilities.toolCalling,
        supportsThinking: selectedPreset.capabilities.thinking,
        supportsVision: selectedPreset.capabilities.vision,
    };
}
```

> **주의**: `classifyWithLLM`과 `getConfidenceThreshold`는 이미 65줄에서 import됨. 추가 import 불필요.

- [ ] **Step 4: 테스트 실행 — PASS 확인**

```bash
npx jest --testPathPattern="model-selector-llm" --no-coverage 2>&1 | tail -20
```

Expected: 모든 테스트 PASS

- [ ] **Step 5: 기존 테스트 회귀 없음 확인**

```bash
npx jest --testPathPattern="model-selector.test" --no-coverage 2>&1 | tail -20
```

Expected: 기존 `model-selector.test.ts` 모두 PASS (mock 없으므로 LLM 실패 → regex fallback → 기존 동작 유지)

- [ ] **Step 6: Commit**

```bash
git add backend/api/src/chat/model-selector.ts backend/api/src/__tests__/model-selector-llm.test.ts
git commit -m "feat: selectOptimalModel LLM 분류기 통합 — LLM 우선(신뢰도≥0.7), regex fallback, 예외 시 graceful fallback"
```

---

## Task 5: 전체 테스트 및 최종 검증

- [ ] **Step 1: 전체 관련 테스트 실행**

```bash
cd /Volumes/MAC_APP/openmake_llm
npx jest --testPathPattern="model-selector|query-classifier|llm-classifier|domain-router|cost-tier|profile-resolver|complexity-assessor" --no-coverage 2>&1 | tail -50
```

Expected: 전체 PASS, 회귀 없음

- [ ] **Step 2: TypeScript 컴파일 확인**

```bash
cd /Volumes/MAC_APP/openmake_llm/backend/api && npx tsc --noEmit 2>&1 | head -30
```

Expected: 에러 없음

- [ ] **Step 3: 전체 Jest 실행**

```bash
cd /Volumes/MAC_APP/openmake_llm && npm test --no-coverage 2>&1 | tail -50
```

Expected: 전체 PASS

- [ ] **Step 4: 최종 커밋 로그 확인**

```bash
git log --oneline -5
```

Expected:
```
feat: selectOptimalModel LLM 분류기 통합
fix: ModelPreset bestFor 세분화 QueryType 등록 + qwen-coder priority=0
fix: reasoning 분류 경로 단일화
```

---

## 검증 체크리스트

- [ ] `code-gen` 쿼리 → qwen-coder 엔진 선택 (priority=0 최우선)
- [ ] `code-agent` 쿼리 → qwen-coder 엔진 선택
- [ ] `math-hard` 쿼리 → math-reasoning 엔진 선택
- [ ] `math-applied` 쿼리 → math-reasoning 엔진 선택
- [ ] `reasoning` 쿼리 → math-reasoning 엔진 선택 (priority=1 < gpt-oss priority=2)
- [ ] `translation` 쿼리 → gemini-flash 엔진 선택
- [ ] LLM 신뢰도 ≥ 0.7 시 LLM 결과 사용
- [ ] LLM 실패/신뢰도 부족/예외 → regex fallback (graceful)
- [ ] `reasoning` 분류는 오직 2차 세분화만 (QUERY_PATTERNS 블록 없음)
- [ ] `selectBrandProfileForAutoRouting()` 동작 무변화 (getModelPresets 미사용)
- [ ] 기존 테스트 전체 PASS (회귀 없음)
- [ ] TypeScript 컴파일 에러 없음

---

## 위험 요소 및 스코프 외 이슈

| 위험 | 처리 |
|---|---|
| `ws-chat-handler.ts`의 `selectOptimalModel` 직접 호출 시 `hasImages` 미전달 | **현재 스코프 외** — 별도 이슈 처리 |
| `model-selector-cost-tier.test.ts`의 `selectBrandProfileForAutoRouting` 반환값 문자열 비교 | Task 1 baseline에서 실패 확인 후 결정 |
| `selectOptimalModel` LLM 통합으로 비 브랜드 모델 경로 응답 지연 | 캐시 히트 시 <1ms, warm 상태에서 허용 가능 |
