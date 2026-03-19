/**
 * ============================================================
 * LLM Classifier - LLM 기반 쿼리 분류기
 * ============================================================
 *
 * gemini-3-flash-preview:cloud 모델을 사용하여 사용자 질문을
 * 12가지 QueryType으로 분류합니다.
 *
 * 기존 regex 기반 classifyQuery()의 정확도 ~68%를 ~92-95%로 개선하기 위한 모듈입니다.
 * 에러 발생 시 기존 regex classifier로 graceful fallback 합니다.
 *
 * 캐시 아키텍처:
 *   L1 (exact-match) → cache.getExact() — 동기, <1ms
 *   L1 미스 시       → LLM 분류
 *   LLM 성공 시      → 캐시 저장
 *
 * 캐시 워밍:
 *   warmClassificationCache() — 서버 시작 시 공통 쿼리 패턴으로 사전 캐시
 *   비동기 실행 (서버 시작 차단 안 함)
 *
 * @module chat/llm-classifier
 * @see chat/semantic-cache - 분류 캐시 모듈
 * @see chat/query-classifier - regex 기반 분류기 (fallback)
 * @see chat/model-selector - selectBrandProfileForAutoRouting()에서 사용
 */

import { OllamaClient } from '../ollama/client';
import { createLogger } from '../utils/logger';
import { QUERY_TYPES } from './model-selector-types';
import type { QueryType } from './model-selector-types';
import type { FormatOption } from '../ollama/types';
import { SemanticClassificationCache } from './semantic-cache';
import { LLM_TIMEOUTS } from '../config/timeouts';

const logger = createLogger('LLMClassifier');

// ============================================================
// 설정
// ============================================================

/** 분류용 모델 (Fast 프로파일 엔진) */
const CLASSIFIER_MODEL = 'gemini-3-flash-preview:cloud';

/** 캐시 TTL (ms) — 30분 */
const CACHE_TTL_MS = 30 * 60 * 1000;

/** 캐시 최대 크기 */
const CACHE_MAX_SIZE = 500;

/** 최소 신뢰도 임계값 — 이 값 미만이면 regex fallback */
const CONFIDENCE_THRESHOLD = 0.7;

// ============================================================
// 분류 캐시 인스턴스 (Lazy 초기화)
// ============================================================

let classificationCache: SemanticClassificationCache | null = null;

function getClassificationCache(): SemanticClassificationCache {
    if (!classificationCache) {
        classificationCache = new SemanticClassificationCache({
            ttlMs: CACHE_TTL_MS,
            maxSize: CACHE_MAX_SIZE,
        });
    }
    return classificationCache;
}

// ============================================================
// JSON Schema 구조화 출력
// ============================================================

/** LLM 분류 응답 JSON Schema — Ollama structured output */
const CLASSIFICATION_FORMAT: FormatOption = {
    type: 'object',
    properties: {
        type: {
            type: 'string',
            enum: [...QUERY_TYPES],
        },
        confidence: {
            type: 'number',
        },
    },
    required: ['type', 'confidence'],
} as FormatOption;

// ============================================================
// 분류 프롬프트
// ============================================================

const CLASSIFICATION_SYSTEM_PROMPT = `You are a high-speed, highly accurate intent classification engine.
Analyze the user's query and categorize it into EXACTLY ONE of the following 12 categories.

DEFINITIONS (mutually exclusive, collectively exhaustive):
1. code-agent: 기존 코드 분석/수정 (리팩토링, 디버깅, 아키텍처, 코드리뷰)
2. code-gen: 새 코드 생성 (함수 작성, API 구현, 스니펫)
3. math-hard: 이론 수학 (증명, 올림피아드, 정수론, 순수수학)
4. math-applied: 응용 수학 (통계, 확률, 공학 계산, 데이터 분석)
5. reasoning: 논리 추론 (인과분석, 가설검증, 비판적 사고, 논증)
6. creative: 창작 (글쓰기, 브레인스토밍, 시나리오)
7. analysis: 데이터 분석 (비교, 평가, 트렌드 분석)
8. document: 문서 처리 (요약, 정리, 리포트)
9. vision: 이미지 분석 (OCR, 차트, 사진 설명)
10. translation: 번역
11. korean: 한국어 특화 (한국어 비율 높은 일반 질문)
12. chat: 일반 대화 (인사, 추천, 잡담)

PRIORITY RULES (when multiple categories could apply):
- 기존 코드 수정/리팩토링 → code-agent, 새 코드 생성 → code-gen
- 증명/이론 → math-hard, 계산/통계 → math-applied
- 논리 추론/인과 → reasoning (analysis와 구분)
- If the query is a translation request → choose 'translation' (not 'korean')
- If the query is in Korean but asks for code/math/analysis → choose the specialized category, NOT 'korean'
- 'korean' is ONLY for general Korean conversation that doesn't fit specialized categories
- 'chat' is the LAST resort — only when no other category fits at all

CONFIDENCE SCORING:
- 0.9-1.0: Very clear intent, single obvious category
- 0.7-0.89: Clear intent with minor ambiguity
- 0.5-0.69: Ambiguous, could be multiple categories
- Below 0.5: Very uncertain

Respond with JSON only. No explanation.`;

// ============================================================
// LLM 분류 함수
// ============================================================

/** LLM 분류 결과 인터페이스 */
export interface LLMClassificationResult {
    type: QueryType;
    confidence: number;
    source: 'llm' | 'cache' | 'fallback';
}

/** 내부 LLM 분류 호출 결과 */
interface RawLLMResult {
    type: QueryType;
    confidence: number;
    evalDuration: string;
}

/**
 * LLM 분류 호출만 수행합니다 (캐시 로직 없음).
 */
async function callLLMClassifier(query: string): Promise<RawLLMResult | null> {
    const classifier = new OllamaClient({
        model: CLASSIFIER_MODEL,
        timeout: LLM_TIMEOUTS.CLASSIFIER_TIMEOUT_MS,
    });

    const result = await classifier.chat(
        [
            { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
            { role: 'user', content: query },
        ],
        {
            temperature: 0.1,
            num_ctx: 1024,
        },
        undefined,
        {
            format: CLASSIFICATION_FORMAT,
        }
    );

    const content = result.content?.trim();
    if (!content) {
        logger.warn('LLM 분류: 빈 응답');
        return null;
    }

    const parsed = JSON.parse(content);
    const validTypes: readonly QueryType[] = QUERY_TYPES;

    if (!parsed.type || !validTypes.includes(parsed.type)) {
        logger.warn(`LLM 분류: 유효하지 않은 type="${parsed.type}"`);
        return null;
    }

    const confidence = typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5;

    const evalDuration = result.metrics?.eval_duration
        ? Math.round(Number(result.metrics.eval_duration) / 1e6) + 'ms'
        : 'N/A';

    return { type: parsed.type, confidence, evalDuration };
}

/**
 * gemini-3-flash-preview:cloud를 사용하여 사용자 질문을 분류합니다.
 *
 * 실행 흐름:
 * 1. L1 캐시 히트 (exact-match) → 즉시 반환 (<1ms)
 * 2. L1 미스 → LLM 분류 호출
 * 3. LLM 성공 → 캐시 저장 후 반환
 * 4. LLM 실패 → null 반환 (caller가 regex fallback 처리)
 *
 * @param query - 사용자 질문 텍스트
 * @returns 분류 결과 또는 null (실패 시)
 */
export async function classifyWithLLM(query: string): Promise<LLMClassificationResult | null> {
    if (!query || query.trim().length === 0) {
        return null;
    }

    const cache = getClassificationCache();

    // ── 1. L1 exact-match ──
    const l1Result = cache.getExact(query);
    if (l1Result.hit && l1Result.source) {
        logger.debug(
            `LLM 분류 캐시 히트: "${query.substring(0, 30)}..." → ${l1Result.hit.type} ` +
            `(${(l1Result.hit.confidence * 100).toFixed(0)}%)`
        );
        return {
            type: l1Result.hit.type,
            confidence: l1Result.hit.confidence,
            source: 'cache',
        };
    }

    // ── 2. LLM 분류 호출 ──
    try {
        const llmRaw = await callLLMClassifier(query);

        if (llmRaw) {
            cache.set(query, llmRaw.type, llmRaw.confidence);
            logger.info(
                `LLM 분류: "${query.substring(0, 30)}..." → ${llmRaw.type} ` +
                `(${(llmRaw.confidence * 100).toFixed(0)}%) [${llmRaw.evalDuration}]`
            );
            return { type: llmRaw.type, confidence: llmRaw.confidence, source: 'llm' };
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn(`LLM 분류 실패 (regex fallback 사용): ${errorMsg}`);
    }

    return null;
}

/** 신뢰도 임계값을 반환합니다 (테스트/외부 참조용) */
export function getConfidenceThreshold(): number {
    return CONFIDENCE_THRESHOLD;
}

/** 캐시 크기를 반환합니다 (모니터링/디버깅용) */
export function getClassificationCacheSize(): number {
    return getClassificationCache().size();
}

/** 캐시를 초기화합니다 (테스트용) */
export function clearClassificationCache(): void {
    getClassificationCache().clear();
}

/** 캐시 통계를 반환합니다 (모니터링용) */
export function getClassificationCacheStats(): { l1Hits: number; misses: number; size: number; maxSize: number; hitRate: number } {
    return getClassificationCache().getStats();
}

/**
 * 테스트용: 캐시 인스턴스를 교체합니다.
 * 프로덕션에서는 사용하지 마세요.
 */
export function _setSemanticCacheForTest(cache: SemanticClassificationCache): void {
    classificationCache = cache;
}

// ============================================================
// 캐시 워밍 (Pre-warming)
// ============================================================

/** 사전 캐시할 공통 쿼리 패턴 */
const WARM_QUERIES: Array<{ query: string; type: QueryType; confidence: number }> = [
    // chat (8)
    { query: '안녕하세요', type: 'chat', confidence: 0.95 },
    { query: '안녕', type: 'chat', confidence: 0.95 },
    { query: 'hello', type: 'chat', confidence: 0.95 },
    { query: '반가워', type: 'chat', confidence: 0.90 },
    { query: '뭐해?', type: 'chat', confidence: 0.90 },
    { query: 'hi there', type: 'chat', confidence: 0.90 },
    { query: '고마워', type: 'chat', confidence: 0.90 },
    { query: '넌 누구야?', type: 'chat', confidence: 0.90 },
    // code-gen (6)
    { query: '코드 작성해줘', type: 'code-gen', confidence: 0.95 },
    { query: '파이썬으로 작성해줘', type: 'code-gen', confidence: 0.90 },
    { query: 'write a function', type: 'code-gen', confidence: 0.90 },
    { query: 'API 만들어줘', type: 'code-gen', confidence: 0.90 },
    { query: '함수 만들어줘', type: 'code-gen', confidence: 0.90 },
    { query: '스크립트 작성해줘', type: 'code-gen', confidence: 0.90 },
    // code-agent (4)
    { query: '코드 리뷰해줘', type: 'code-agent', confidence: 0.95 },
    { query: '버그 수정해줘', type: 'code-agent', confidence: 0.95 },
    { query: '이 에러 해결해줘', type: 'code-agent', confidence: 0.90 },
    { query: '리팩토링해줘', type: 'code-agent', confidence: 0.90 },
    // math-applied (4)
    { query: '계산해줘', type: 'math-applied', confidence: 0.90 },
    { query: '확률 계산해줘', type: 'math-applied', confidence: 0.90 },
    { query: '통계 분석해줘', type: 'math-applied', confidence: 0.85 },
    { query: '이 방정식 풀어줘', type: 'math-applied', confidence: 0.90 },
    // math-hard (3)
    { query: '수학 문제 풀어줘', type: 'math-hard', confidence: 0.85 },
    { query: 'solve this equation', type: 'math-hard', confidence: 0.85 },
    { query: '증명해줘', type: 'math-hard', confidence: 0.95 },
    // creative (7)
    { query: '시 써줘', type: 'creative', confidence: 0.95 },
    { query: '이야기 만들어줘', type: 'creative', confidence: 0.95 },
    { query: '마케팅 문구 작성해줘', type: 'creative', confidence: 0.90 },
    { query: '블로그 글 써줘', type: 'creative', confidence: 0.90 },
    { query: '소설 써줘', type: 'creative', confidence: 0.95 },
    { query: 'write a poem', type: 'creative', confidence: 0.90 },
    { query: '아이디어 좀 내줘', type: 'creative', confidence: 0.85 },
    // analysis (8)
    { query: '데이터 분석해줘', type: 'analysis', confidence: 0.95 },
    { query: '비교 분석해줘', type: 'analysis', confidence: 0.90 },
    { query: '장단점 분석해줘', type: 'analysis', confidence: 0.90 },
    { query: '시장 분석해줘', type: 'analysis', confidence: 0.90 },
    { query: 'SWOT 분석해줘', type: 'analysis', confidence: 0.95 },
    { query: '트렌드 분석해줘', type: 'analysis', confidence: 0.90 },
    { query: 'analyze this data', type: 'analysis', confidence: 0.90 },
    { query: '전략 세워줘', type: 'analysis', confidence: 0.85 },
    // translation (6)
    { query: '번역해줘', type: 'translation', confidence: 0.95 },
    { query: '영어로 번역해줘', type: 'translation', confidence: 0.95 },
    { query: 'translate this', type: 'translation', confidence: 0.95 },
    { query: '일본어로 번역해줘', type: 'translation', confidence: 0.95 },
    { query: '한국어로 번역해줘', type: 'translation', confidence: 0.95 },
    { query: 'translate to English', type: 'translation', confidence: 0.95 },
    // vision (5)
    { query: '이 이미지 분석해줘', type: 'vision', confidence: 0.95 },
    { query: '사진 설명해줘', type: 'vision', confidence: 0.90 },
    { query: '이 스크린샷 봐줘', type: 'vision', confidence: 0.90 },
    { query: '그림 분석해줘', type: 'vision', confidence: 0.90 },
    { query: 'describe this image', type: 'vision', confidence: 0.90 },
    // document (6)
    { query: '이 문서 요약해줘', type: 'document', confidence: 0.95 },
    { query: 'PDF 분석해줘', type: 'document', confidence: 0.90 },
    { query: '파일 내용 정리해줘', type: 'document', confidence: 0.90 },
    { query: '문서에서 핵심 내용 추출해줘', type: 'document', confidence: 0.90 },
    { query: 'summarize this document', type: 'document', confidence: 0.90 },
    { query: '보고서 요약해줘', type: 'document', confidence: 0.90 },
    // korean (6)
    { query: '오늘 날씨 어때?', type: 'korean', confidence: 0.85 },
    { query: '한국어로 설명해줘', type: 'korean', confidence: 0.85 },
    { query: '맛집 추천해줘', type: 'korean', confidence: 0.85 },
    { query: '여행지 추천해줘', type: 'korean', confidence: 0.85 },
    { query: '요즘 뭐가 유행이야?', type: 'korean', confidence: 0.85 },
    { query: '좋은 책 추천해줘', type: 'korean', confidence: 0.85 },
];

/** 캐시 워밍 실행 상태 (중복 방지) */
let warmingInProgress = false;

/**
 * 공통 쿼리 패턴으로 분류 캐시를 사전 워밍합니다.
 *
 * 서버 시작 시 백그라운드에서 비동기 실행됩니다.
 *
 * @returns 워밍된 엔트리 수
 */
export async function warmClassificationCache(): Promise<number> {
    if (warmingInProgress) {
        logger.debug('캐시 워밍 이미 진행 중 — 스킵');
        return 0;
    }

    warmingInProgress = true;
    const cache = getClassificationCache();

    try {
        for (const warm of WARM_QUERIES) {
            cache.set(warm.query, warm.type, warm.confidence);
        }
        logger.info(`캐시 워밍 완료: ${WARM_QUERIES.length}/${WARM_QUERIES.length}개`);
    } finally {
        warmingInProgress = false;
    }

    return WARM_QUERIES.length;
}
