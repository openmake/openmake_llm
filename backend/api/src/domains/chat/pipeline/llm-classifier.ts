/**
 * ============================================================
 * LLM Classifier - LLM 기반 쿼리 분류기
 * ============================================================
 * 
 * gemini-3-flash-preview:cloud 모델을 사용하여 사용자 질문을
 * 9가지 QueryType으로 분류합니다.
 * 
 * 기존 regex 기반 classifyQuery()의 정확도 ~68%를 ~92-95%로 개선하기 위한 모듈입니다.
 * 에러 발생 시 기존 regex classifier로 graceful fallback 합니다.
 * 
 * 캐시 아키텍처 (2-Layer + 병렬 최적화):
 *   L1 (exact-match)    → cache.getExact() — 동기, <1ms
 *   L1 미스 시           → 임베딩 생성 + LLM 분류를 Promise.allSettled()로 병렬 실행
 *   L2 (semantic-match)  → cache.searchSemantic(embedding) — ~10-30ms (병렬 중 확인)
 *   L2 히트 시           → LLM 결과 무시, L2 결과 반환
 *   L2 미스 시           → LLM 결과 사용 + 캐시 저장
 * 
 * 캐시 워밍:
 *   warmClassificationCache() — 서버 시작 시 공통 쿼리 패턴으로 사전 캐시
 *   비동기 실행 (서버 시작 차단 안 함)
 * 
 * @module chat/llm-classifier
 * @see chat/semantic-cache - 시맨틱 캐시 모듈
 * @see chat/query-classifier - regex 기반 분류기 (fallback)
 * @see chat/model-selector - selectBrandProfileForAutoRouting()에서 사용
 */

import { OllamaClient } from '../../../ollama/client';
import { createLogger } from '../../../utils/logger';
import type { QueryType, QueryClassification } from './model-selector-types';
import type { FormatOption } from '../../../ollama/types';
import { SemanticClassificationCache } from './semantic-cache';
import type { EmbedFunction } from './semantic-cache';

const logger = createLogger('LLMClassifier');

// ============================================================
// 설정
// ============================================================

/** 분류용 모델 (Fast 프로파일 엔진) */
const CLASSIFIER_MODEL = 'gemini-3-flash-preview:cloud';

/** 분류 호출 타임아웃 (ms) */
const CLASSIFIER_TIMEOUT_MS = 10000;

/** 캐시 TTL (ms) — 30분 */
const CACHE_TTL_MS = 30 * 60 * 1000;

/** 캐시 최대 크기 */
const CACHE_MAX_SIZE = 500;

/** 시맨틱 유사도 임계값 */
const SEMANTIC_SIMILARITY_THRESHOLD = 0.88;

/** 최소 신뢰도 임계값 — 이 값 미만이면 regex fallback */
const CONFIDENCE_THRESHOLD = 0.7;

// ============================================================
// 시맨틱 캐시 인스턴스 (Lazy 초기화)
// ============================================================

/** 임베딩 함수 — EmbeddingService 싱글톤을 lazy로 가져옴 */
const embedFunction: EmbedFunction = async (text: string): Promise<number[] | null> => {
    try {
        // Lazy import to avoid circular dependency and startup overhead
        const { getEmbeddingService } = await import('../../../services/EmbeddingService');
        const service = getEmbeddingService();
        return await service.embedText(text);
    } catch (error) {
        logger.debug('임베딩 서비스 사용 불가 — L2 캐시 비활성');
        return null;
    }
};

/** 시맨틱 분류 캐시 (싱글톤) */
let semanticCache: SemanticClassificationCache | null = null;

function getSemanticCache(): SemanticClassificationCache {
    if (!semanticCache) {
        semanticCache = new SemanticClassificationCache(embedFunction, {
            ttlMs: CACHE_TTL_MS,
            maxSize: CACHE_MAX_SIZE,
            similarityThreshold: SEMANTIC_SIMILARITY_THRESHOLD,
        });
    }
    return semanticCache;
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
            enum: ['code', 'math', 'creative', 'analysis', 'document', 'vision', 'translation', 'korean', 'chat'],
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
Analyze the user's query and categorize it into EXACTLY ONE of the following 9 categories.

DEFINITIONS (mutually exclusive, collectively exhaustive):
1. code: Writing, debugging, explaining, or reviewing programming code. Includes implicit debugging ("이거 왜 안돼?", "에러 나요", "서버가 느려요").
2. math: Solving equations, logic puzzles, calculations, statistics, or scientific computations.
3. creative: Writing stories, poems, marketing copy, brainstorming ideas, or any creative content generation.
4. analysis: Extracting insights from data, summarizing trends, comparing options, strategic thinking, or business analysis.
5. document: Questions specifically referencing an uploaded file, PDF, or text block for summarization/extraction.
6. vision: Questions about an image, screenshot, diagram, or any visual content (only when image is explicitly referenced).
7. translation: Converting text from one language to another. Includes "translate", "번역해줘", or explicit language conversion requests.
8. korean: General Korean-language queries that don't fit other specialized categories. Everyday Korean conversation, cultural questions, Korean-specific topics.
9. chat: General conversation, greetings, small talk, or queries that genuinely don't fit any above category.

PRIORITY RULES (when multiple categories could apply):
- If the query involves code/debugging AND another domain → choose 'code'
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
    source: 'llm' | 'cache' | 'semantic-cache' | 'fallback';
}

/** 내부 LLM 분류 호출 (병렬 실행용으로 분리) */
interface RawLLMResult {
    type: QueryType;
    confidence: number;
    evalDuration: string;
}

/**
 * LLM 분류 호출만 수행합니다 (캐시 로직 없음).
 * classifyWithLLM()에서 병렬 실행을 위해 분리된 내부 함수입니다.
 */
async function callLLMClassifier(query: string): Promise<RawLLMResult | null> {
    const classifier = new OllamaClient({
        model: CLASSIFIER_MODEL,
        timeout: CLASSIFIER_TIMEOUT_MS,
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
    const validTypes: QueryType[] = ['code', 'math', 'creative', 'analysis', 'document', 'vision', 'translation', 'korean', 'chat'];

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
 * 실행 흐름 (병렬 최적화):
 * 1. L1 캐시 히트 (exact-match) → 즉시 반환 (<1ms)
 * 2. L1 미스 → 임베딩 생성 + LLM 분류를 병렬 실행 (Promise.allSettled)
 * 3. 임베딩 성공 → L2 시맨틱 매칭 시도 → 히트 시 반환 (~10-30ms)
 * 4. L2 미스 → LLM 결과 사용 + 캐시 저장
 * 5. 모두 실패 → null 반환 (caller가 regex fallback 처리)
 * 
 * @param query - 사용자 질문 텍스트
 * @returns 분류 결과 또는 null (실패 시)
 */
export async function classifyWithLLM(query: string): Promise<LLMClassificationResult | null> {
    // 빈 쿼리 방어
    if (!query || query.trim().length === 0) {
        return null;
    }

    const cache = getSemanticCache();

    // ── 1. L1 exact-match (동기, 임베딩 불필요) ──
    const l1Result = cache.getExact(query);
    if (l1Result.hit && l1Result.source) {
        logger.debug(
            `LLM 분류 L1 캐시 히트: "${query.substring(0, 30)}..." → ${l1Result.hit.type} ` +
            `(${(l1Result.hit.confidence * 100).toFixed(0)}%)`
        );
        return {
            type: l1Result.hit.type,
            confidence: l1Result.hit.confidence,
            source: l1Result.source,
        };
    }

    // ── 2. L1 미스 → 임베딩 + LLM 병렬 실행 ──
    const normalizedQuery = query.trim().toLowerCase();
    const [embedSettled, llmSettled] = await Promise.allSettled([
        embedFunction(normalizedQuery),
        callLLMClassifier(query),
    ]);

    const embedding = embedSettled.status === 'fulfilled' ? embedSettled.value : null;
    const llmRaw = llmSettled.status === 'fulfilled' ? llmSettled.value : null;

    // ── 3. 임베딩 성공 → L2 시맨틱 매칭 ──
    if (embedding && embedding.length > 0) {
        const l2Result = cache.searchSemantic(embedding);
        if (l2Result.hit && l2Result.source) {
            logger.debug(
                `LLM 분류 L2 캐시 히트 (병렬): "${query.substring(0, 30)}..." → ${l2Result.hit.type} ` +
                `(${(l2Result.hit.confidence * 100).toFixed(0)}%)`
            );
            return {
                type: l2Result.hit.type,
                confidence: l2Result.hit.confidence,
                source: l2Result.source,
            };
        }
    }

    // ── 4. L2 미스 → LLM 결과 사용 ──
    if (llmRaw) {
        cache.set(query, llmRaw.type, llmRaw.confidence, embedding);
        logger.info(
            `LLM 분류: "${query.substring(0, 30)}..." → ${llmRaw.type} ` +
            `(${(llmRaw.confidence * 100).toFixed(0)}%) [${llmRaw.evalDuration}]`
        );
        return { type: llmRaw.type, confidence: llmRaw.confidence, source: 'llm' };
    }

    // ── 5. 모두 실패 ──
    if (llmSettled.status === 'rejected') {
        const errorMsg = llmSettled.reason instanceof Error
            ? llmSettled.reason.message
            : String(llmSettled.reason);
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
    return getSemanticCache().size();
}

/** 캐시를 초기화합니다 (테스트용) */
export function clearClassificationCache(): void {
    getSemanticCache().clear();
}

/** 캐시 통계를 반환합니다 (모니터링용) */
export function getClassificationCacheStats(): { l1Hits: number; l2Hits: number; misses: number; embedFailures: number } {
    return getSemanticCache().getStats();
}

/**
 * 테스트용: 시맨틱 캐시 인스턴스를 교체합니다.
 * 프로덕션에서는 사용하지 마세요.
 */
export function _setSemanticCacheForTest(cache: SemanticClassificationCache): void {
    semanticCache = cache;
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
    // code (10)
    { query: '코드 작성해줘', type: 'code', confidence: 0.95 },
    { query: '코드 리뷰해줘', type: 'code', confidence: 0.95 },
    { query: '버그 수정해줘', type: 'code', confidence: 0.95 },
    { query: '이 에러 해결해줘', type: 'code', confidence: 0.90 },
    { query: '파이썬으로 작성해줘', type: 'code', confidence: 0.90 },
    { query: 'write a function', type: 'code', confidence: 0.90 },
    { query: 'fix this bug', type: 'code', confidence: 0.90 },
    { query: 'API 만들어줘', type: 'code', confidence: 0.90 },
    { query: '자바스크립트 코드 설명해줘', type: 'code', confidence: 0.90 },
    { query: '리팩토링해줘', type: 'code', confidence: 0.90 },
    // math (6)
    { query: '수학 문제 풀어줘', type: 'math', confidence: 0.95 },
    { query: '이 방정식 풀어줘', type: 'math', confidence: 0.95 },
    { query: '계산해줘', type: 'math', confidence: 0.90 },
    { query: '확률 계산해줘', type: 'math', confidence: 0.90 },
    { query: 'solve this equation', type: 'math', confidence: 0.90 },
    { query: '통계 분석해줘', type: 'math', confidence: 0.85 },
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
 * 공통 쿼리 패턴으로 시맨틱 캐시를 사전 워밍합니다.
 * 
 * 서버 시작 시 백그라운드에서 비동기 실행됩니다.
 * 임베딩 생성이 포함되므로 서버 시작을 차단하지 않도록 주의합니다.
 * 
 * @returns 워밍된 엔트리 수 (임베딩 성공한 것만 카운트)
 */
export async function warmClassificationCache(): Promise<number> {
    if (warmingInProgress) {
        logger.debug('캐시 워밍 이미 진행 중 — 스킵');
        return 0;
    }

    warmingInProgress = true;
    const cache = getSemanticCache();
    let warmedCount = 0;

    try {
        logger.info(`캐시 워밍 시작: ${WARM_QUERIES.length}개 공통 쿼리`);

        for (const warm of WARM_QUERIES) {
            try {
                // 임베딩 생성 (L2 캐시용)
                const embedding = await embedFunction(warm.query.trim().toLowerCase());
                cache.set(warm.query, warm.type, warm.confidence, embedding);
                if (embedding) warmedCount++;
            } catch {
                // 개별 실패는 무시 (나머지 계속 진행)
                cache.set(warm.query, warm.type, warm.confidence, null);
            }
        }

        logger.info(`캐시 워밍 완료: ${warmedCount}/${WARM_QUERIES.length}개 (임베딩 포함: ${warmedCount})`);
    } finally {
        warmingInProgress = false;
    }

    return warmedCount;
}
