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
import { VectorClassificationCache } from './vector-cache';
import { LLM_TIMEOUTS } from '../config/timeouts';
import { CACHE_CONFIG, CONTEXTUAL_CLASSIFICATION } from '../config/runtime-limits';
import { CLASSIFIER_MODEL, CONFIDENCE_THRESHOLD, CLASSIFIER_TEMPERATURE, CLASSIFIER_NUM_CTX, VECTOR_CACHE_ENABLED, EMBEDDING_MODEL } from '../config/routing-config';
import warmQueriesRaw from '../config/data/warm-queries.json';
import { CLASSIFICATION_SYSTEM_PROMPT } from '../prompts/classifier-system';

const logger = createLogger('LLMClassifier');

// ============================================================
// 설정
// ============================================================

/** 캐시 TTL (ms) — CACHE_CONFIG에서 참조 */
const CACHE_TTL_MS = CACHE_CONFIG.CLASSIFICATION_CACHE_TTL_MS;

/** 캐시 최대 크기 — CACHE_CONFIG에서 참조 */
const CACHE_MAX_SIZE = CACHE_CONFIG.CLASSIFICATION_CACHE_MAX_SIZE;

/** warm-queries.json을 타입 안전하게 로드 */
const warmQueriesData = warmQueriesRaw as Array<{ query: string; type: QueryType; confidence: number }>;

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
// 벡터 캐시 인스턴스 (L1.5, Lazy 초기화)
// ============================================================

let vectorCache: VectorClassificationCache | null = null;
let embeddingClient: OllamaClient | null = null;

function getVectorCache(): VectorClassificationCache {
    if (!vectorCache) {
        vectorCache = new VectorClassificationCache();
    }
    return vectorCache;
}

function getEmbeddingClient(): OllamaClient {
    if (!embeddingClient) {
        embeddingClient = new OllamaClient({ model: EMBEDDING_MODEL });
    }
    return embeddingClient;
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
 *
 * @param query - 분류할 사용자 쿼리
 * @param conversationContext - 이전 대화 턴 요약 (대명사/지시어 해소용, optional)
 */
async function callLLMClassifier(query: string, conversationContext?: string): Promise<RawLLMResult | null> {
    const classifier = new OllamaClient({
        model: CLASSIFIER_MODEL,
        timeout: LLM_TIMEOUTS.CLASSIFIER_TIMEOUT_MS,
    });

    // P2: 대화 이력 컨텍스트가 있으면 사용자 메시지에 포함
    const userContent = conversationContext
        ? `[Conversation context]\n${conversationContext}\n\n[Current query]\n${query}`
        : query;

    const result = await classifier.chat(
        [
            { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
        ],
        {
            temperature: CLASSIFIER_TEMPERATURE,
            num_ctx: CLASSIFIER_NUM_CTX,
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
 * 대화 이력에서 분류기에 전달할 컨텍스트 요약을 빌드합니다.
 *
 * P2 하네스 (Inform): 이전 턴 요약을 제공하여 대명사/지시어 기반 쿼리 해소
 * "그거 더 설명해줘" → 이전 턴이 코드 관련이었으면 code-agent로 분류 가능
 *
 * @param history - 대화 이력 (최신 순이 아닌 시간순)
 * @returns 요약 문자열 또는 undefined (이력 없으면)
 */
function buildConversationContext(
    history?: Array<{ role: string; content: string }>,
): string | undefined {
    if (!CONTEXTUAL_CLASSIFICATION.ENABLED || !history || history.length === 0) {
        return undefined;
    }

    const maxTurns = CONTEXTUAL_CLASSIFICATION.MAX_HISTORY_TURNS;
    const maxChars = CONTEXTUAL_CLASSIFICATION.MAX_CHARS_PER_TURN;

    // 최근 N턴만 추출 (user/assistant만, system 제외)
    const relevantTurns = history
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-maxTurns * 2); // user+assistant 쌍이므로 2배

    if (relevantTurns.length === 0) return undefined;

    const lines = relevantTurns.map(m => {
        const content = typeof m.content === 'string'
            ? m.content.substring(0, maxChars)
            : '';
        return `${m.role}: ${content}`;
    });

    return lines.join('\n');
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
 * @param history - 이전 대화 이력 (대명사/지시어 해소용, optional)
 * @returns 분류 결과 또는 null (실패 시)
 */
export async function classifyWithLLM(
    query: string,
    history?: Array<{ role: string; content: string }>,
): Promise<LLMClassificationResult | null> {
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

    // ── 1.5. L1.5 vector similarity ──
    let queryEmbedding: number[] | null = null;
    if (VECTOR_CACHE_ENABLED) {
        try {
            const client = getEmbeddingClient();
            queryEmbedding = await client.embed(query);
            const vCache = getVectorCache();
            const vectorResult = vCache.search(queryEmbedding);

            if (vectorResult) {
                logger.info(
                    `LLM 분류 벡터 캐시 히트: "${query.substring(0, 30)}..." → ${vectorResult.type} ` +
                    `(sim=${vectorResult.similarity.toFixed(3)}, confidence=${(vectorResult.confidence * 100).toFixed(0)}%)`
                );
                // L1 캐시에도 저장 (다음번엔 exact-match로 히트)
                cache.set(query, vectorResult.type, vectorResult.confidence);
                return {
                    type: vectorResult.type,
                    confidence: vectorResult.confidence,
                    source: 'cache' as const,
                };
            }
        } catch (vecError) {
            // 벡터 캐시 실패는 무시 -- LLM 분류로 진행
            logger.debug(`벡터 캐시 검색 실패 (무시): ${vecError instanceof Error ? vecError.message : vecError}`);
        }
    }

    // ── 2. LLM 분류 호출 ──
    // P2: 대화 이력 기반 분류 강화 — 이전 턴 요약을 분류기에 제공
    const conversationContext = buildConversationContext(history);

    try {
        const llmRaw = await callLLMClassifier(query, conversationContext);

        if (llmRaw) {
            cache.set(query, llmRaw.type, llmRaw.confidence);
            logger.info(
                `LLM 분류: "${query.substring(0, 30)}..." → ${llmRaw.type} ` +
                `(${(llmRaw.confidence * 100).toFixed(0)}%) [${llmRaw.evalDuration}]`
            );

            // 벡터 캐시에도 저장
            if (VECTOR_CACHE_ENABLED) {
                try {
                    if (!queryEmbedding) {
                        const client = getEmbeddingClient();
                        queryEmbedding = await client.embed(query);
                    }
                    getVectorCache().add(query, queryEmbedding, llmRaw.type, llmRaw.confidence);
                } catch (vecSaveErr) {
                    logger.debug(`벡터 캐시 저장 실패 (무시): ${vecSaveErr instanceof Error ? vecSaveErr.message : vecSaveErr}`);
                }
            }

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

// ============================================================
// P1: 분류 불일치 로깅 (Disagreement Logging)
// ============================================================

import { DISAGREEMENT_LOGGING } from '../config/runtime-limits';

/** 분류 불일치 기록 */
export interface ClassificationDisagreement {
    query: string;
    llmType: string;
    llmConfidence: number;
    regexType: string;
    regexConfidence: number;
    finalType: string;
    finalSource: 'llm' | 'cache' | 'regex';
    timestamp: string;
}

/** 불일치 통계 (모니터링용) */
const disagreementStats = { total: 0, logged: 0 };

/**
 * LLM 분류 결과와 Regex 분류 결과를 비교하여 불일치 시 로깅합니다.
 *
 * Harness Engineering 원칙 (Verify): 두 독립 분류기의 교차 검증으로
 * 분류 약점을 식별합니다.
 */
export function logDisagreementIfAny(
    query: string,
    llmType: string,
    llmConfidence: number,
    regexType: string,
    regexConfidence: number,
    finalType: string,
    finalSource: 'llm' | 'cache' | 'regex',
): void {
    if (!DISAGREEMENT_LOGGING.ENABLED) return;
    if (llmType === regexType) return;

    disagreementStats.total++;
    disagreementStats.logged++;

    const record: ClassificationDisagreement = {
        query: query.substring(0, 200),
        llmType,
        llmConfidence,
        regexType,
        regexConfidence,
        finalType,
        finalSource,
        timestamp: new Date().toISOString(),
    };

    logger.warn(
        `🔀 분류 불일치: LLM=${llmType}(${(llmConfidence * 100).toFixed(0)}%) vs Regex=${regexType}(${(regexConfidence * 100).toFixed(0)}%) → 최종=${finalType}[${finalSource}]`,
        DISAGREEMENT_LOGGING.INCLUDE_IN_METRICS ? { disagreement: record } : undefined,
    );
}

/** 불일치 통계를 반환합니다 (모니터링용) */
export function getDisagreementStats(): { total: number; logged: number } {
    return { ...disagreementStats };
}

/** 캐시 크기를 반환합니다 (모니터링/디버깅용) */
export function getClassificationCacheSize(): number {
    return getClassificationCache().size();
}

/** 캐시를 초기화합니다 (테스트용) */
export function clearClassificationCache(): void {
    getClassificationCache().clear();
}

/**
 * 특정 쿼리의 캐시 항목을 무효화합니다.
 * P3-B: 부정 피드백 시 개별 캐시 무효화용
 *
 * @param query - 무효화할 쿼리
 * @returns 무효화 성공 여부
 */
export function invalidateCacheEntry(query: string): boolean {
    return getClassificationCache().delete(query);
}

/**
 * 특정 쿼리의 캐시 항목 신뢰도를 갱신합니다.
 * P3-B: 긍정 피드백 시 캐시 신뢰도 부스트용
 *
 * @param query - 갱신할 쿼리
 * @param type - 분류 타입
 * @param confidence - 새 신뢰도
 */
export function updateCacheConfidence(query: string, type: string, confidence: number): void {
    const validTypes: readonly QueryType[] = QUERY_TYPES;
    if (validTypes.includes(type as QueryType)) {
        getClassificationCache().set(query, type as QueryType, Math.min(1.0, Math.max(0, confidence)));
    }
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
        for (const warm of warmQueriesData) {
            cache.set(warm.query, warm.type, warm.confidence);
        }
        logger.info(`캐시 워밍 완료: ${warmQueriesData.length}/${warmQueriesData.length}개`);

        // 벡터 캐시 워밍 (비동기, 실패 허용)
        if (VECTOR_CACHE_ENABLED) {
            try {
                const client = getEmbeddingClient();
                const vCache = getVectorCache();
                let vectorWarmed = 0;
                let consecutiveFailures = 0;
                for (const warm of warmQueriesData) {
                    try {
                        const embedding = await client.embed(warm.query);
                        vCache.add(warm.query, embedding, warm.type, warm.confidence);
                        vectorWarmed++;
                        consecutiveFailures = 0;
                    } catch (warmErr) {
                        consecutiveFailures++;
                        logger.debug(`벡터 캐시 워밍 개별 실패: ${warmErr instanceof Error ? warmErr.message : warmErr}`);
                        // 연속 5회 실패 시 임베딩 모델 장애로 판단하고 조기 종료
                        if (consecutiveFailures >= 5) {
                            logger.warn(`벡터 캐시 워밍 중단: 연속 ${consecutiveFailures}회 실패 — 임베딩 모델 상태를 확인하세요`);
                            break;
                        }
                    }
                }
                logger.info(`벡터 캐시 워밍 완료: ${vectorWarmed}/${warmQueriesData.length}개`);
            } catch (e) {
                logger.warn(`벡터 캐시 워밍 실패 (무시): ${e instanceof Error ? e.message : e}`);
            }
        }
    } finally {
        warmingInProgress = false;
    }

    return warmQueriesData.length;
}

/**
 * 벡터 캐시 통계를 반환합니다 (모니터링용).
 */
export function getVectorCacheStats(): { hits: number; misses: number; size: number; hitRate: number } | null {
    if (!vectorCache) return null;
    return vectorCache.getStats();
}
