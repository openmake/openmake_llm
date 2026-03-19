# System Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시스템 분석에서 발견된 안정성·관측성·코드 품질 이슈를 우선순위 순으로 보완하여 운영 안정성을 높인다.

**Architecture:** 기존 `config/timeouts.ts` (LLM_TIMEOUTS) 및 `chat-service-metrics.ts` 인프라를 확장하는 방식으로 최소 변경·최대 효과를 추구한다. 작업 큐·Redis 같은 대규모 인프라 변경 없이 현재 코드베이스 안에서 해결 가능한 이슈에 집중한다.

**Tech Stack:** TypeScript strict mode, Jest, Express 5, Winston logger, LRU-Cache, Prometheus-compatible MetricsCollector

---

## 배경 및 현황

이전 작업에서 완료된 항목:
- ✅ KeyExhaustionError: WebSocket + REST API 전역 error handler 모두 처리됨
- ✅ AbortController: WS catch/finally 양쪽에서 `extWs._abortController = null` 정리됨
- ✅ QueryType 세분화 + LLM 분류기 통합 (5개 커밋, 서버 재시작 완료)

---

## 파일 맵

| 파일 | 역할 | 변경 방향 |
|------|------|-----------|
| `backend/api/src/config/timeouts.ts` | LLM 호출 타임아웃 중앙 상수 | `MEMORY_EXTRACTION_TIMEOUT_MS`, `CLASSIFIER_TIMEOUT_MS` 추가 |
| `backend/api/src/chat/llm-classifier.ts` | LLM 기반 쿼리 분류기 | 로컬 `CLASSIFIER_TIMEOUT_MS` → `LLM_TIMEOUTS` 참조 |
| `backend/api/src/services/ChatService.ts` | 채팅 파이프라인 오케스트레이터 | `extractMemoriesAsync` 내 하드코딩 `30000` → `LLM_TIMEOUTS` |
| `backend/api/src/services/chat-service-metrics.ts` | 채팅 메트릭 기록 | `recordMemoryExtractionFailure()` 추가 |
| `backend/api/src/chat/semantic-cache.ts` | L1 분류 캐시 | `getExact()` miss 카운터 추가, `getStats()` hitRate/size 확장 |
| `backend/api/src/chat/llm-classifier.ts` | LLM 분류기 (캐시 접근자) | `getClassificationCacheStats()` 반환 타입 업데이트 |
| `backend/api/src/routes/metrics.routes.ts` | 메트릭 라우트 | 기존 `/api/metrics/cache/stats`에 분류 캐시 통계 추가 |
| `backend/api/src/__tests__/system-stabilization.test.ts` | 통합 테스트 | 각 Task 완료 후 테스트 추가 |

---

## Task 1: LLM 타임아웃 중앙 상수화 [P0 · 단기]

> **왜 중요한가:** `ChatService.ts:963`의 `30000`과 `llm-classifier.ts:44`의 `10000`이 `config/timeouts.ts`의 `LLM_TIMEOUTS`와 독립적으로 존재한다. 나중에 값을 조정할 때 한 곳만 수정하면 반영되어야 하는데, 현재는 파일마다 별도 수정이 필요하다.

**Files:**
- Modify: `backend/api/src/config/timeouts.ts:18-27`
- Modify: `backend/api/src/chat/llm-classifier.ts:44`
- Modify: `backend/api/src/services/ChatService.ts:963`
- Test: `backend/api/src/__tests__/system-stabilization.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// backend/api/src/__tests__/system-stabilization.test.ts
import { LLM_TIMEOUTS } from '../config/timeouts';

describe('LLM_TIMEOUTS 상수 완전성', () => {
    it('MEMORY_EXTRACTION_TIMEOUT_MS 상수가 존재해야 한다', () => {
        expect(LLM_TIMEOUTS.MEMORY_EXTRACTION_TIMEOUT_MS).toBeDefined();
        expect(typeof LLM_TIMEOUTS.MEMORY_EXTRACTION_TIMEOUT_MS).toBe('number');
        expect(LLM_TIMEOUTS.MEMORY_EXTRACTION_TIMEOUT_MS).toBeGreaterThan(0);
    });

    it('CLASSIFIER_TIMEOUT_MS 상수가 존재해야 한다', () => {
        expect(LLM_TIMEOUTS.CLASSIFIER_TIMEOUT_MS).toBeDefined();
        expect(typeof LLM_TIMEOUTS.CLASSIFIER_TIMEOUT_MS).toBe('number');
        expect(LLM_TIMEOUTS.CLASSIFIER_TIMEOUT_MS).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend/api && npx jest --testPathPattern="system-stabilization" --no-coverage 2>&1 | head -30
```

Expected: `TypeError: Cannot read properties of undefined` 또는 `expect(received).toBeDefined()` 실패

- [ ] **Step 3: `config/timeouts.ts`에 상수 추가**

`LLM_TIMEOUTS` 객체에 두 항목 추가:

```typescript
export const LLM_TIMEOUTS = {
    /** LLM 라우터 응답 대기 타임아웃 (ms) */
    ROUTING_TIMEOUT_MS: 5000,
    /** Deep Research 개별 스크래핑 타임아웃 (ms) */
    SCRAPE_TIMEOUT_MS: 15000,
    /** Firecrawl 기본 요청 타임아웃 (ms) */
    FIRECRAWL_TIMEOUT_MS: 30000,
    /** 키워드 라우터 LLM 호출 타임아웃 (ms) — ROUTING_TIMEOUT_MS보다 높음 */
    KEYWORD_ROUTING_TIMEOUT_MS: 10000,
    /** LLM 기반 쿼리 분류기 타임아웃 (ms) */
    CLASSIFIER_TIMEOUT_MS: 10000,
    /** fire-and-forget 메모리 추출 LLM 호출 타임아웃 (ms) */
    MEMORY_EXTRACTION_TIMEOUT_MS: 30000,
} as const;
```

- [ ] **Step 4: `llm-classifier.ts` 수정 — 로컬 상수 제거**

```typescript
// 기존 (제거):
// /** 분류 호출 타임아웃 (ms) */
// const CLASSIFIER_TIMEOUT_MS = 10000;

// 추가:
import { LLM_TIMEOUTS } from '../config/timeouts';
```

파일 하단의 `CLASSIFIER_TIMEOUT_MS` 사용 위치를 `LLM_TIMEOUTS.CLASSIFIER_TIMEOUT_MS`로 교체:

```typescript
// 기존:
timeout: CLASSIFIER_TIMEOUT_MS,
// 수정 후:
timeout: LLM_TIMEOUTS.CLASSIFIER_TIMEOUT_MS,
```

- [ ] **Step 5: `ChatService.ts` 수정 — 하드코딩 30000 제거**

`extractMemoriesAsync` 메서드에서:

```typescript
// 기존 (ChatService.ts:963):
const timeoutMs = 30000;

// 수정 후:
import { LLM_TIMEOUTS } from '../config/timeouts';
// ... (import 구역 상단에 추가)

// extractMemoriesAsync 내부:
const timeoutMs = LLM_TIMEOUTS.MEMORY_EXTRACTION_TIMEOUT_MS;
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
cd backend/api && npx jest --testPathPattern="system-stabilization" --no-coverage 2>&1
```

Expected: `PASS` — 2개 테스트 통과

- [ ] **Step 7: TypeScript 빌드 확인**

```bash
cd backend/api && npx tsc --noEmit 2>&1 | head -20
```

Expected: 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add backend/api/src/config/timeouts.ts \
        backend/api/src/chat/llm-classifier.ts \
        backend/api/src/services/ChatService.ts \
        backend/api/src/__tests__/system-stabilization.test.ts
git commit -m "refactor: LLM 타임아웃 하드코딩을 LLM_TIMEOUTS 중앙 상수로 교체"
```

---

## Task 2: Fire-and-Forget 실패 가시성 개선 [P1 · 단기]

> **왜 중요한가:** 현재 `extractMemoriesAsync` 실패는 `logger.debug()`로만 기록되어 운영 환경에서 완전히 보이지 않는다. 메모리 추출 실패율이 급증해도 탐지 불가능한 상태. MetricsCollector 인프라가 이미 있으므로 카운터 하나만 추가하면 된다.

**Files:**
- Modify: `backend/api/src/services/chat-service-metrics.ts`
- Modify: `backend/api/src/services/ChatService.ts`
- Test: `backend/api/src/__tests__/system-stabilization.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// system-stabilization.test.ts 에 추가:
describe('recordMemoryExtractionFailure 함수', () => {
    it('함수가 export되어 있어야 한다', () => {
        const { recordMemoryExtractionFailure } = require('../services/chat-service-metrics');
        expect(typeof recordMemoryExtractionFailure).toBe('function');
    });

    it('에러 없이 호출되어야 한다', () => {
        const { recordMemoryExtractionFailure } = require('../services/chat-service-metrics');
        expect(() => recordMemoryExtractionFailure('timeout')).not.toThrow();
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend/api && npx jest --testPathPattern="system-stabilization" --no-coverage 2>&1 | tail -20
```

Expected: `Cannot destructure property 'recordMemoryExtractionFailure'`

- [ ] **Step 3: `chat-service-metrics.ts`에 함수 추가**

기존 `recordChatMetrics` 함수 아래에 추가:

```typescript
/**
 * 메모리 추출 실패를 MetricsCollector에 기록합니다.
 * fire-and-forget 실패 추적에 사용됩니다.
 *
 * @param reason - 실패 이유 (예: 'timeout', 'llm_error', 'db_error')
 */
export function recordMemoryExtractionFailure(reason: string): void {
    try {
        const { getMetrics } = require('../monitoring/metrics');
        const metricsCollector = getMetrics();
        metricsCollector.incrementCounter('memory_extraction_failures_total', 1, { reason });
    } catch (e) {
        // 메트릭 기록 실패는 무시 (응답에 영향 없음)
        logger.debug('memory extraction failure metric 기록 실패:', e);
    }
}
```

- [ ] **Step 4: `ChatService.ts` catch 블록 업그레이드**

`extractMemoriesAsync`를 호출하는 라인(Step 7 fire-and-forget 구역):

```typescript
// 기존 (ChatService.ts:439):
this.extractMemoriesAsync(userId, message, fullResponse, hasExternalContext)
    .catch(e => logger.debug('메모리 추출 fire-and-forget 실패:', e?.message));

// 수정 후:
this.extractMemoriesAsync(userId, message, fullResponse, hasExternalContext)
    .catch(e => {
        const reason = e?.message?.includes('timeout') ? 'timeout' : 'unknown';
        logger.warn('메모리 추출 fire-and-forget 실패:', e?.message);
        recordMemoryExtractionFailure(reason);
    });
```

`recordMemoryExtractionFailure` import 추가:
```typescript
import { recordChatMetrics, recordMemoryExtractionFailure } from './chat-service-metrics';
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd backend/api && npx jest --testPathPattern="system-stabilization" --no-coverage 2>&1
```

Expected: `PASS` — 4개 테스트 통과

- [ ] **Step 6: 커밋**

```bash
git add backend/api/src/services/chat-service-metrics.ts \
        backend/api/src/services/ChatService.ts \
        backend/api/src/__tests__/system-stabilization.test.ts
git commit -m "feat: 메모리 추출 fire-and-forget 실패를 warn 레벨 + MetricsCollector 카운터로 추적"
```

---

## Task 3: Semantic Cache 통계 수집 완성 및 기존 엔드포인트 확장 [P2 · 중기]

> **왜 중요한가:** `SemanticClassificationCache.getStats()`가 이미 존재하지만 두 가지 결함이 있다: (1) `getExact()` miss 경로에서 `misses++`를 호출하지 않아 항상 misses=0, (2) `hitRate`/`size`/`maxSize`를 반환하지 않아 히트율 계산 불가. 또한 기존 `/api/metrics/cache/stats` 엔드포인트는 `CacheSystem`(LRU cache) 통계만 반환하고 분류 캐시 통계는 누락됨.

**Files:**
- Modify: `backend/api/src/chat/semantic-cache.ts` (getExact miss 카운터 추가, getStats 반환 타입 확장)
- Modify: `backend/api/src/chat/llm-classifier.ts` (getClassificationCacheStats 반환 타입 업데이트)
- Modify: `backend/api/src/routes/metrics.routes.ts` (기존 /cache/stats 엔드포인트에 분류 캐시 통계 추가)
- Test: `backend/api/src/__tests__/system-stabilization.test.ts`

**현재 상태 (수정 전):**
- `semantic-cache.ts:68`: `getExact()` miss 경로에 `this.stats.misses++` 없음
- `semantic-cache.ts:113`: `getStats()` 반환이 `{l1Hits, misses}`만 반환 (size/maxSize/hitRate 없음)
- `llm-classifier.ts:264`: `getClassificationCacheStats()` 반환 타입이 `{l1Hits, misses}`로 좁음
- `metrics.routes.ts:241`: `/cache/stats`가 CacheSystem만 포함, 분류 캐시 누락

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// system-stabilization.test.ts 에 추가:
import { SemanticClassificationCache } from '../chat/semantic-cache';

describe('SemanticClassificationCache 통계 수집', () => {
    let cache: SemanticClassificationCache;

    beforeEach(() => {
        cache = new SemanticClassificationCache();
    });

    it('캐시 미스 시 stats.misses가 증가해야 한다 (현재 버그: 항상 0)', () => {
        cache.getExact('없는 쿼리');
        const stats = cache.getStats();
        expect(stats.misses).toBe(1); // ← 수정 전: 0 반환 (버그)
    });

    it('getStats()가 hitRate를 반환해야 한다', () => {
        cache.set('안녕하세요', 'chat', 0.9);
        cache.getExact('안녕하세요'); // hit
        cache.getExact('없는 쿼리');  // miss
        const stats = cache.getStats();
        expect(stats).toHaveProperty('hitRate');
        expect(stats).toHaveProperty('size');
        expect(stats).toHaveProperty('maxSize');
        expect(stats.hitRate).toBe(50); // 1 hit / 2 total = 50%
    });

    it('캐시 히트 후 hitRate > 0이어야 한다', () => {
        cache.set('코드 짜줘', 'code-gen', 0.95);
        cache.getExact('코드 짜줘');
        const stats = cache.getStats();
        expect(stats.hitRate).toBeGreaterThan(0);
        expect(stats.l1Hits).toBe(1);
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd backend/api && npx jest --testPathPattern="system-stabilization" --no-coverage 2>&1 | tail -25
```

Expected: `expect(received).toBe(expected): Expected 1, received 0` (misses 버그) 및 `stats.hitRate is undefined`

- [ ] **Step 3: `semantic-cache.ts` — `getExact()` miss 카운터 추가**

`getExact()` 메서드에서 miss 반환 직전(라인 67)에 카운터 추가:

```typescript
// 기존:
return { hit: null, source: null };

// 수정 후 (miss 카운터 추가):
this.stats.misses++;
return { hit: null, source: null };
```

- [ ] **Step 4: `semantic-cache.ts` — `getStats()` 반환 타입 및 내용 확장**

```typescript
// 기존 (라인 113-115):
getStats(): Readonly<typeof this.stats> {
    return { ...this.stats };
}

// 수정 후:
getStats(): { l1Hits: number; misses: number; size: number; maxSize: number; hitRate: number } {
    const total = this.stats.l1Hits + this.stats.misses;
    const hitRate = total > 0 ? Math.round((this.stats.l1Hits / total) * 10000) / 100 : 0;
    return {
        l1Hits: this.stats.l1Hits,
        misses: this.stats.misses,
        size: this.size(),
        maxSize: this.maxSize,
        hitRate, // 소수점 2자리 % (예: 73.25)
    };
}
```

- [ ] **Step 5: `llm-classifier.ts` — `getClassificationCacheStats()` 반환 타입 업데이트**

```typescript
// 기존 (라인 264):
export function getClassificationCacheStats(): { l1Hits: number; misses: number } {
    return getClassificationCache().getStats();
}

// 수정 후 (반환 타입 확장):
export function getClassificationCacheStats(): { l1Hits: number; misses: number; size: number; maxSize: number; hitRate: number } {
    return getClassificationCache().getStats();
}
```

- [ ] **Step 6: `metrics.routes.ts` — 기존 `/cache/stats` 엔드포인트에 분류 캐시 통계 추가**

파일 상단에 import 추가:

```typescript
import { getClassificationCacheStats } from '../chat/llm-classifier';
```

기존 `/cache/stats` 라우트 핸들러 수정 (현재 `CacheSystem` 통계만 반환):

```typescript
// 기존 (라인 241-243):
router.get('/cache/stats', asyncHandler(async (req: Request, res: Response) => {
    const cache = getCacheSystem();
    res.json(success(cache.getStats()));
}));

// 수정 후 (분류 캐시 통계 추가):
router.get('/cache/stats', asyncHandler(async (_req: Request, res: Response) => {
    const cache = getCacheSystem();
    const classificationStats = getClassificationCacheStats();
    res.json(success({
        queryCache: cache.getStats(),
        classificationCache: {
            ...classificationStats,
            status: classificationStats.hitRate >= 70 ? 'healthy'
                  : classificationStats.hitRate >= 40 ? 'warming'
                  : 'cold',
        },
    }));
}));
```

- [ ] **Step 7: 테스트 통과 확인**

```bash
cd backend/api && npx jest --testPathPattern="system-stabilization" --no-coverage 2>&1
```

Expected: `PASS` — 3개 새 테스트 모두 통과

- [ ] **Step 8: TypeScript 빌드 확인**

```bash
cd backend/api && npx tsc --noEmit 2>&1 | head -20
```

Expected: 에러 없음

- [ ] **Step 9: 기존 테스트 전체 통과 확인**

```bash
cd backend/api && npx jest --no-coverage 2>&1 | tail -20
```

Expected: 모든 기존 테스트 PASS

- [ ] **Step 10: 커밋**

```bash
git add backend/api/src/chat/semantic-cache.ts \
        backend/api/src/chat/llm-classifier.ts \
        backend/api/src/routes/metrics.routes.ts \
        backend/api/src/__tests__/system-stabilization.test.ts
git commit -m "fix: SemanticCache miss 카운터 버그 수정 + getStats() hitRate/size 확장 + /metrics/cache/stats 분류 캐시 추가"
```

---

## Task 4: 히스토리 요약 실패 처리 강건성 [P2 · 중기]

> **왜 중요한가:** `chat/history-summarizer.ts`가 타임아웃(15s) 내 실패 시 어떻게 동작하는지, 원본 히스토리를 반환하는지 확인이 필요하다. 요약 실패 시 예외가 전파되면 전체 채팅 파이프라인이 중단될 수 있다.

**Files:**
- Read + Modify: `backend/api/src/chat/history-summarizer.ts`
- Test: `backend/api/src/__tests__/system-stabilization.test.ts`

- [ ] **Step 1: history-summarizer.ts 현황 파악**

```bash
cat -n backend/api/src/chat/history-summarizer.ts
```

실패 경로(catch 블록)를 확인:
- 타임아웃 발생 시 원본 히스토리 반환 여부
- 예외가 caller로 전파되는지 여부

- [ ] **Step 2: 실패 테스트 작성**

```typescript
// system-stabilization.test.ts에 추가:
describe('HistorySummarizer 실패 처리', () => {
    it('LLM 타임아웃 시 원본 히스토리를 반환해야 한다', async () => {
        // history-summarizer.ts의 실제 export 확인 후 테스트 작성
        // summarizeHistory() 함수가 실패해도 ChatMessage[] 반환 필수
        const { summarizeHistoryIfNeeded } = require('../chat/history-summarizer');

        // 긴 히스토리로 요약 트리거 (MIN_MESSAGES_TO_SUMMARIZE = 10 이상)
        const longHistory = Array.from({ length: 15 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `메시지 ${i}`,
        }));

        // LLM 클라이언트 없이 호출 시 에러 없이 원본 반환 기대
        const result = await summarizeHistoryIfNeeded(longHistory, null as any);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 3: 실패 확인 + 코드 수정**

테스트 실행 후 결과에 따라:
- 예외 전파되면 → catch 블록에서 원본 반환으로 수정
- 이미 원본 반환하면 → 테스트만 추가 (코드 변경 불필요)

현재 catch가 예외를 rethrow한다면:
```typescript
// 기존:
} catch (error) {
    throw error; // ← 전파 위험
}

// 수정 후:
} catch (error) {
    logger.warn('[HistorySummarizer] 요약 실패 — 원본 히스토리 반환:', error instanceof Error ? error.message : error);
    return history; // 원본 반환 (파이프라인 계속 진행)
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd backend/api && npx jest --testPathPattern="system-stabilization" --no-coverage 2>&1
```

Expected: `PASS`

- [ ] **Step 5: 커밋**

```bash
git add backend/api/src/chat/history-summarizer.ts \
        backend/api/src/__tests__/system-stabilization.test.ts
git commit -m "fix: HistorySummarizer 실패 시 원본 히스토리 반환으로 파이프라인 보호"
```

---

## Task 5: In-memory 캐시 TTL 및 용량 설정 검토 [P3 · 중기]

> **왜 중요한가:** `cache/index.ts`의 `CacheSystem`(LRU-cache)과 `chat/semantic-cache.ts`의 `SemanticClassificationCache` 두 캐시가 동시에 운영된다. TTL, maxSize 기본값이 코드에 산재하여 환경변수로 조정 불가능하다.

**Files:**
- Modify: `backend/api/src/cache/index.ts`
- Modify: `backend/api/src/config/runtime-limits.ts` (CACHE_CONFIG 섹션 추가)
- Modify: `backend/api/src/chat/semantic-cache.ts` (상수 → 설정 참조)
- Test: `backend/api/src/__tests__/system-stabilization.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// system-stabilization.test.ts에 추가:
describe('CACHE_CONFIG 설정', () => {
    it('CACHE_CONFIG 상수가 존재해야 한다', () => {
        const { CACHE_CONFIG } = require('../config/runtime-limits');
        expect(CACHE_CONFIG).toBeDefined();
        expect(CACHE_CONFIG.CLASSIFICATION_CACHE_TTL_MS).toBeDefined();
        expect(CACHE_CONFIG.CLASSIFICATION_CACHE_MAX_SIZE).toBeDefined();
        expect(CACHE_CONFIG.QUERY_CACHE_TTL_MS).toBeDefined();
    });
});
```

- [ ] **Step 2: `runtime-limits.ts`에 CACHE_CONFIG 추가**

기존 `RAG_CONFIG` 다음에 추가:

```typescript
// ============================================
// 캐시 설정
// ============================================

/**
 * 인메모리 캐시 TTL 및 용량 설정
 * SemanticClassificationCache, CacheSystem에서 참조
 */
export const CACHE_CONFIG = {
    /** L1 분류 캐시 TTL (ms) — 기본 30분 */
    CLASSIFICATION_CACHE_TTL_MS: 30 * 60 * 1000,
    /** L1 분류 캐시 최대 항목 수 */
    CLASSIFICATION_CACHE_MAX_SIZE: 500,
    /** 쿼리 응답 캐시 TTL (ms) — 기본 10분 */
    QUERY_CACHE_TTL_MS: 10 * 60 * 1000,
    /** 쿼리 응답 캐시 최대 항목 수 */
    QUERY_CACHE_MAX_SIZE: 200,
    /** 라우팅 캐시 TTL (ms) — 기본 5분 */
    ROUTING_CACHE_TTL_MS: 5 * 60 * 1000,
    /** 라우팅 캐시 최대 항목 수 */
    ROUTING_CACHE_MAX_SIZE: 100,
} as const;
```

- [ ] **Step 3: `semantic-cache.ts` 상수 → `CACHE_CONFIG` 참조**

```typescript
// 기존:
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SIZE = 500;

// 수정 후:
import { CACHE_CONFIG } from '../config/runtime-limits';
const DEFAULT_TTL_MS = CACHE_CONFIG.CLASSIFICATION_CACHE_TTL_MS;
const DEFAULT_MAX_SIZE = CACHE_CONFIG.CLASSIFICATION_CACHE_MAX_SIZE;
```

- [ ] **Step 4: `llm-classifier.ts` 상수도 참조로 교체**

```typescript
// 기존:
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_SIZE = 500;

// 수정 후 (이미 DEFAULT로 처리되므로 명시적 참조 제거 가능):
// → SemanticClassificationCache 기본값이 CACHE_CONFIG를 참조하므로 별도 전달 불필요
// → 생성자 호출에서 ttlMs/maxSize 제거
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd backend/api && npx jest --testPathPattern="system-stabilization" --no-coverage 2>&1
cd backend/api && npx tsc --noEmit 2>&1 | head -20
```

Expected: 모두 PASS, 타입 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add backend/api/src/config/runtime-limits.ts \
        backend/api/src/chat/semantic-cache.ts \
        backend/api/src/chat/llm-classifier.ts \
        backend/api/src/__tests__/system-stabilization.test.ts
git commit -m "refactor: 캐시 TTL/maxSize를 CACHE_CONFIG 중앙 상수로 통합"
```

---

## Task 6: CSS 변수 완전 통합 [P1 · 프론트엔드]

> **왜 중요한가:** `style.css`와 `animations.css`에 `:root` 블록이 중복 정의되어 라이트 테마 배경색이 3가지 서로 다른 값으로 충돌한다. `design-tokens.css`를 단일 진실 원본으로 확립해 테마 일관성을 보장한다.

**관련 스펙:** `docs/superpowers/specs/2026-03-20-frontend-ux-design.md` §4

**Files:**
- Modify: `frontend/web/public/css/design-tokens.css` (누락 변수 흡수)
- Modify: `frontend/web/public/style.css` (`:root` 블록 + `[data-theme="light"]` 블록 제거)
- Modify: `frontend/web/public/css/animations.css` (`:root` 블록 제거)

- [ ] **Step 1: 현재 충돌 변수 목록 확인**

```bash
grep -n "^\s*--" frontend/web/public/style.css | head -40
grep -n "^\s*--" frontend/web/public/css/animations.css | head -20
grep -n "^\s*--" frontend/web/public/css/design-tokens.css | head -40
```

`design-tokens.css`에 없고 `style.css`/`animations.css`에만 있는 변수를 식별한다.

- [ ] **Step 2: `design-tokens.css`에 누락 변수 추가**

`style.css`와 `animations.css`에만 있는 변수를 `design-tokens.css`의 적절한 섹션에 추가한다. 라이트 테마 기준값:
- `--bg-app: #fdfbf7` (`design-tokens.css` 원본 채택)

- [ ] **Step 3: `style.css` `:root` 블록 제거**

`style.css:8`의 `:root { ... }` 블록에서 모든 CSS 변수 정의를 삭제한다. 비어있으면 블록 자체 제거.

- [ ] **Step 4: `style.css` `[data-theme="light"]` 블록 처리**

`style.css:51`의 `[data-theme="light"] { ... }` 블록에서 CSS 변수 정의를 `design-tokens.css`의 `[data-theme="light"]` 섹션으로 이동 후 해당 블록 제거.

- [ ] **Step 5: `animations.css` `:root` 블록 제거**

`animations.css:12`의 `:root { ... }` 블록을 동일 방식으로 처리.

- [ ] **Step 6: 브라우저 시각 검증**

```bash
# 개발 서버 실행
npm run dev:frontend
```

브라우저에서 확인:
- 라이트 테마: 배경이 `#fdfbf7`로 통일 (DevTools → Computed → `--bg-app`)
- 다크 테마: 기존 다크 테마 시각적 회귀 없음
- 각 주요 페이지(채팅, 설정, 문서) 테마 전환 확인

- [ ] **Step 7: 커밋**

```bash
git add frontend/web/public/css/design-tokens.css \
        frontend/web/public/style.css \
        frontend/web/public/css/animations.css
git commit -m "refactor: CSS 변수를 design-tokens.css 단일 진실 원본으로 통합"
```

---

## Task 7: AI 실행 상태 플로팅 토스트 [P2 · 프론트엔드]

> **왜 중요한가:** 스트리밍 응답 중 사용자는 `생각 중...` 외에 어떤 에이전트가 왜 선택되었는지 알 수 없다. 기존 `agentBadge` 영역을 확장해 에이전트명·단계·신뢰도를 표시하는 플로팅 토스트로 업그레이드한다. 백엔드 이미 `agent_selected` 이벤트를 전송 중이므로 프론트엔드 변경만으로 완성된다.

**관련 스펙:** `docs/superpowers/specs/2026-03-20-frontend-ux-design.md` §2

**Files:**
- Modify: `frontend/web/public/js/modules/cluster.js` (`showAgentBadge()` 함수 확장)
- Modify: `frontend/web/public/js/modules/chat.js` (`finishAssistantMessage()` 말미에 숨김 코드 추가)
- Create: `frontend/web/public/css/chat-status-toast.css`
- Modify: `frontend/web/public/index.html` (CSS 링크 추가)

- [ ] **Step 1: `chat-status-toast.css` 신규 생성**

```css
/* frontend/web/public/css/chat-status-toast.css */
.agent-status-toast {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    margin: 4px 0;
    background: rgba(192, 97, 255, 0.1);
    border: 1.5px solid var(--accent-primary);
    border-radius: 6px;
    font-size: 0.85rem;
    animation: toastFadeIn 150ms ease-out;
}
.toast-agent-icon { font-size: 1rem; }
.toast-agent-name { font-weight: 700; color: var(--accent-primary); }
.toast-step { color: var(--text-secondary); }
.toast-confidence { margin-left: auto; font-size: 0.75rem; color: var(--text-muted); }
.toast-reason { font-size: 0.72rem; color: var(--text-muted); margin-top: 1px; }

@keyframes toastFadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 2: `index.html`에 CSS 링크 추가**

기존 CSS `<link>` 목록 말미에 추가:
```html
<link rel="stylesheet" href="css/chat-status-toast.css">
```

- [ ] **Step 3: `cluster.js` `showAgentBadge()` 함수 교체**

`cluster.js:174` `showAgentBadge(agent)` 함수의 `badgeContainer.innerHTML` 부분을 교체:

```javascript
const phaseLabels = { planning: '분석 중...', build: '생성 중...', optimization: '최적화 중...' };
const phaseStep = phaseLabels[agent.phase] || '처리 중...';
const confidence = agent.confidence ? `신뢰도 ${Math.round(agent.confidence * 100)}%` : '';
const reason = agent.reason || '';

badgeContainer.innerHTML = `
    <div class="agent-status-toast">
        <span class="toast-agent-icon">${escapeHtml(agent.emoji || '🤖')}</span>
        <span class="toast-agent-name">${escapeHtml(agent.name || '에이전트')}</span>
        <span class="toast-step">${escapeHtml(phaseStep)}</span>
        ${confidence ? `<span class="toast-confidence">${escapeHtml(confidence)}</span>` : ''}
        ${reason ? `<div class="toast-reason">${escapeHtml(reason)}</div>` : ''}
    </div>
`;
badgeContainer.style.display = 'block';
```

- [ ] **Step 4: `chat.js` `finishAssistantMessage()` 말미에 숨김 코드 추가**

`chat.js:352` `finishAssistantMessage()` 함수 말미(setState, hideAbortButton 정리 이후)에 추가:

```javascript
// AI 상태 토스트 숨김
const badge = document.getElementById('agentBadge');
if (badge) badge.style.display = 'none';
```

- [ ] **Step 5: 동작 확인**

개발 서버에서 채팅 요청 전송 후:
- `agentBadge` 영역에 토스트가 나타나는지 확인
- 응답 완료 후 토스트가 사라지는지 확인
- `<script>` 문자열을 에이전트명 자리에 삽입 불가한지 확인 (XSS)

- [ ] **Step 6: 커밋**

```bash
git add frontend/web/public/css/chat-status-toast.css \
        frontend/web/public/index.html \
        frontend/web/public/js/modules/cluster.js \
        frontend/web/public/js/modules/chat.js
git commit -m "feat: AI 에이전트 상태 플로팅 토스트 (agentBadge 확장)"
```

---

## Task 8: 모바일 FAB 메뉴 [P2 · 프론트엔드]

> **왜 중요한가:** 480px 이하 화면에서 햄버거 버튼 → 전체화면 사이드바 패턴은 2단계 탭이 필요하고 채팅 공간을 가린다. 우하단 FAB 버튼 + 팝업 메뉴로 새 대화·히스토리·설정에 1탭으로 접근 가능하게 한다.

**관련 스펙:** `docs/superpowers/specs/2026-03-20-frontend-ux-design.md` §3

**Files:**
- Create: `frontend/web/public/js/modules/mobile-fab.js`
- Create: `frontend/web/public/css/mobile-fab.css`
- Modify: `frontend/web/public/index.html` (CSS/JS 링크 추가)
- Modify: `frontend/web/public/js/main.js` (`initMobileFab()` 호출 추가)

- [ ] **Step 1: `mobile-fab.css` 신규 생성**

```css
/* frontend/web/public/css/mobile-fab.css */
.fab-container { display: none; position: fixed; bottom: 24px; right: 16px; z-index: 1000; }

.fab-btn {
    width: 48px; height: 48px;
    background: var(--accent-primary);
    border: 2px solid #000;
    border-radius: 50%;
    box-shadow: 3px 3px 0 #000;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.2rem; color: #fff;
    transition: transform 0.15s;
}
.fab-btn:active { transform: scale(0.95); }

.fab-menu {
    display: none;
    position: absolute; bottom: 56px; right: 0;
    background: var(--bg-sidebar);
    border: 2px solid var(--border-default);
    border-radius: 8px;
    box-shadow: 4px 4px 0 #000;
    padding: 6px;
    min-width: 140px;
    flex-direction: column; gap: 2px;
}
.fab-menu.open { display: flex; }

.fab-menu-item {
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 0.85rem;
    color: var(--text-primary);
    cursor: pointer;
    white-space: nowrap;
}
.fab-menu-item:hover { background: var(--bg-hover); }
.fab-menu-item.primary { color: var(--accent-primary); font-weight: 700; }

@media (min-width: 481px) { .fab-container { display: none !important; } }
```

- [ ] **Step 2: `mobile-fab.js` 신규 생성**

```javascript
// frontend/web/public/js/modules/mobile-fab.js
const FAB_BREAKPOINT = 480;

function applyBreakpoint(fabContainer) {
    const isMobile = window.innerWidth <= FAB_BREAKPOINT;
    fabContainer.style.display = isMobile ? 'block' : 'none';
    const menuBtn = document.getElementById('mobileMenuBtn');
    if (menuBtn) menuBtn.style.display = isMobile ? 'none' : '';
}

function createFab() {
    const container = document.createElement('div');
    container.className = 'fab-container';
    container.innerHTML = `
        <div class="fab-menu" id="fabMenu">
            <div class="fab-menu-item primary" id="fabNewChat">+ 새 대화</div>
            <div class="fab-menu-item" id="fabHistory">히스토리</div>
            <div class="fab-menu-item" id="fabSettings">설정</div>
        </div>
        <button class="fab-btn" id="fabBtn" aria-label="메뉴">≡</button>
    `;
    return container;
}

export function init() {
    const fabContainer = createFab();
    document.body.appendChild(fabContainer);

    const fabBtn = fabContainer.querySelector('#fabBtn');
    const fabMenu = fabContainer.querySelector('#fabMenu');

    // 메뉴 열기/닫기 — stopPropagation으로 document click과 충돌 방지
    fabBtn.addEventListener('click', function(event) {
        event.stopPropagation();
        const isOpen = fabMenu.classList.toggle('open');
        fabBtn.textContent = isOpen ? '✕' : '≡';
    });

    // 팝업 외부 클릭 시 닫힘
    document.addEventListener('click', function() {
        fabMenu.classList.remove('open');
        fabBtn.textContent = '≡';
    });

    // 메뉴 항목 핸들러
    fabContainer.querySelector('#fabNewChat').addEventListener('click', function(e) {
        e.stopPropagation();
        fabMenu.classList.remove('open');
        fabBtn.textContent = '≡';
        if (typeof window.newChat === 'function') window.newChat();
    });
    fabContainer.querySelector('#fabHistory').addEventListener('click', function(e) {
        e.stopPropagation();
        fabMenu.classList.remove('open');
        fabBtn.textContent = '≡';
        if (window.sidebar) window.sidebar.toggle();
    });
    fabContainer.querySelector('#fabSettings').addEventListener('click', function(e) {
        e.stopPropagation();
        fabMenu.classList.remove('open');
        fabBtn.textContent = '≡';
        if (typeof window.showSettings === 'function') window.showSettings();
    });

    // 초기 상태 즉시 적용 (ResizeObserver는 최초 콜백을 보장하지 않음)
    applyBreakpoint(fabContainer);

    const observer = new ResizeObserver(() => applyBreakpoint(fabContainer));
    observer.observe(document.body);
}
```

- [ ] **Step 3: `index.html`에 CSS/JS 링크 추가**

```html
<!-- CSS -->
<link rel="stylesheet" href="css/mobile-fab.css">

<!-- JS: 기존 <script type="module"> 목록에 import 추가 또는 별도 모듈 태그 -->
```

- [ ] **Step 4: `main.js`에서 `init()` 호출**

```javascript
// main.js 상단 import 구역:
import { init as initMobileFab } from './modules/mobile-fab.js';

// DOMContentLoaded 핸들러 내부:
initMobileFab();
```

- [ ] **Step 5: 동작 확인**

브라우저 DevTools → 반응형 모드:
- 479px: FAB 표시, `mobileMenuBtn` 숨김
- 481px: FAB 숨김, `mobileMenuBtn` 표시
- FAB 탭 → 팝업 열림
- 팝업 항목(새 대화·히스토리·설정) 각각 동작 확인
- 팝업 외부 클릭 → 닫힘

- [ ] **Step 6: 커밋**

```bash
git add frontend/web/public/css/mobile-fab.css \
        frontend/web/public/js/modules/mobile-fab.js \
        frontend/web/public/index.html \
        frontend/web/public/js/main.js
git commit -m "feat: 모바일 FAB 메뉴 (480px 이하 — 새 대화·히스토리·설정)"
```

---

## 실행 순서 및 예상 소요

| Task | 우선순위 | 영역 | 난이도 | 효과 |
|------|----------|------|--------|------|
| Task 1: LLM 타임아웃 상수화 | P0 | 백엔드 | 낮음 | 타임아웃 값 중앙 관리 |
| Task 2: Fire-and-forget 가시성 | P1 | 백엔드 | 낮음 | 메모리 추출 실패 탐지 |
| Task 3: 캐시 통계 API | P2 | 백엔드 | 낮음 | 캐시 히트율 모니터링 |
| Task 4: 히스토리 요약 강건성 | P2 | 백엔드 | 낮음 | 파이프라인 보호 |
| Task 5: 캐시 설정 중앙화 | P3 | 백엔드 | 중간 | 환경별 캐시 튜닝 |
| Task 6: CSS 변수 완전 통합 | P1 | 프론트엔드 | 낮음 | 테마 일관성 확보 |
| Task 7: AI 상태 플로팅 토스트 | P2 | 프론트엔드 | 낮음 | AI 실행 상태 가시성 |
| Task 8: 모바일 FAB 메뉴 | P2 | 프론트엔드 | 낮음 | 모바일 네비게이션 개선 |

**권장 실행 순서:** Task 1 → 2 → 6 → 3 → 4 → 7 → 8 → 5
(백엔드 기초 → 프론트엔드 CSS → 나머지 백엔드 → 프론트엔드 기능)

---

## 완료 기준

1. 모든 기존 테스트 PASS (`npx jest --no-coverage`)
2. TypeScript 타입 에러 없음 (`npx tsc --noEmit`)
3. `system-stabilization.test.ts`의 모든 테스트 PASS
4. 서버 정상 기동 확인
5. 브라우저 라이트/다크 테마 시각적 회귀 없음
6. 480px 이하 FAB 동작 확인

---

## 제외 항목 (향후 별도 플랜)

- **Redis 기반 캐시 계층**: 대규모 인프라 변경 → 별도 플랜
- **OpenTelemetry 트레이싱**: 분산 추적 인프라 필요 → 별도 플랜
- **작업 큐 도입** (Bull/BullMQ): fire-and-forget 완전 해결 → 별도 플랜
- **Welcome Screen 4열 레이아웃**: 현재 스펙 제외 → 별도 검토
