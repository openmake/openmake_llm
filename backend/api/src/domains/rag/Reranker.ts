/**
 * ============================================================
 * Reranker - Cross-encoder 기반 재순위화 서비스
 * ============================================================
 *
 * RRF 융합 후보(Top-20)를 Ollama LLM 기반 cross-encoder로
 * 스코어링하여 최종 Top-K를 반환합니다.
 *
 * 전략:
 * - Ollama generate()로 query-document 쌍의 관련도를 0~10 점수로 평가
 * - 병렬 배치 처리로 지연 최소화 (M4 CPU 기준 20후보 ~50-100ms)
 * - Ollama 불가 시 graceful fallback (입력 그대로 반환)
 *
 * @module services/Reranker
 */

import { createLogger } from '../../utils/logger';
import { getClusterManager } from '../../cluster/manager';
import type { OllamaClient } from '../../ollama/client';
import type { VectorSearchResult } from '../../data/repositories/vector-repository';

const logger = createLogger('Reranker');

/** Reranker 설정 */
export interface RerankerConfig {
    /** 재순위화에 사용할 Ollama 모델 (기본: 환경변수 OMK_ENGINE_FAST 또는 gemini-3-flash-preview:cloud) */
    model?: string;
    /** 최대 동시 평가 수 (기본: 5) */
    concurrency?: number;
    /** 단일 평가 타임아웃 ms (기본: 5000) */
    timeoutMs?: number;
    /** 후보 문서 텍스트 최대 길이 (기본: 500자, 초과 시 절단) */
    maxDocChars?: number;
}

const DEFAULT_CONFIG: Required<RerankerConfig> = {
    model: process.env.OMK_ENGINE_FAST || 'gemini-3-flash-preview:cloud',
    concurrency: 5,
    timeoutMs: 5000,
    maxDocChars: 500,
};

/**
 * 관련도 점수 추출용 정규식
 * LLM 응답에서 0~10 사이의 숫자(정수 또는 소수)를 추출합니다.
 */
const SCORE_PATTERN = /\b(\d{1,2}(?:\.\d+)?)\b/;

/**
 * Cross-encoder 기반 재순위화 서비스
 *
 * 사용 흐름:
 * 1. RRF 융합 결과 (20개) → reranker.rerank(query, candidates, 5)
 * 2. 각 후보에 대해 Ollama로 관련도 점수 평가
 * 3. 점수 내림차순 정렬 후 Top-K 반환
 */
export class Reranker {
    private readonly config: Required<RerankerConfig>;

    constructor(config?: RerankerConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Ollama 클라이언트를 획득합니다.
     */
    private getClient(): OllamaClient | undefined {
        try {
            const cluster = getClusterManager();
            const bestNode = cluster.getBestNode(this.config.model);
            if (!bestNode) {
                const anyNode = cluster.getBestNode();
                if (!anyNode) return undefined;
                return cluster.createScopedClient(anyNode.id, this.config.model);
            }
            return cluster.createScopedClient(bestNode.id, this.config.model);
        } catch (error) {
            logger.error('Reranker 클라이언트 획득 실패:', error);
            return undefined;
        }
    }

    /**
     * 후보 문서를 재순위화합니다.
     *
     * @param query - 검색 쿼리
     * @param candidates - RRF 융합 결과 (재순위화 대상)
     * @param topK - 반환할 최대 결과 수 (기본: 5)
     * @returns 관련도 점수 순으로 정렬된 검색 결과
     */
    async rerank(
        query: string,
        candidates: VectorSearchResult[],
        topK: number = 5,
    ): Promise<VectorSearchResult[]> {
        if (candidates.length === 0) return [];
        if (candidates.length <= topK) {
            // 후보가 topK 이하면 재순위화 불필요 — 그대로 반환
            return candidates;
        }

        const startTime = Date.now();
        const client = this.getClient();

        if (!client) {
            logger.warn('[Reranker] Ollama 클라이언트 불가 — fallback (원본 순위 유지)');
            return candidates.slice(0, topK);
        }

        // 병렬 배치 스코어링
        const scored = await this.scoreInBatches(client, query, candidates);
        const elapsed = Date.now() - startTime;

        // 점수 내림차순 정렬 후 topK 반환
        scored.sort((a, b) => b.score - a.score);
        const result = scored.slice(0, topK).map(s => ({
            ...s.candidate,
            similarity: s.score / 10, // 0~10 → 0~1 정규화
        }));

        logger.info(
            `[Reranker] ${candidates.length}개 후보 → ${result.length}개 반환 (${elapsed}ms)`
        );

        return result;
    }

    /**
     * 동시성 제한을 두고 후보를 배치 스코어링합니다.
     */
    private async scoreInBatches(
        client: OllamaClient,
        query: string,
        candidates: VectorSearchResult[],
    ): Promise<Array<{ candidate: VectorSearchResult; score: number }>> {
        const results: Array<{ candidate: VectorSearchResult; score: number }> = [];
        const { concurrency } = this.config;

        for (let i = 0; i < candidates.length; i += concurrency) {
            const batch = candidates.slice(i, i + concurrency);
            const scores = await Promise.all(
                batch.map(candidate => this.scoreOne(client, query, candidate))
            );
            results.push(...scores);
        }

        return results;
    }

    /**
     * 단일 query-document 쌍의 관련도를 평가합니다.
     */
    private async scoreOne(
        client: OllamaClient,
        query: string,
        candidate: VectorSearchResult,
    ): Promise<{ candidate: VectorSearchResult; score: number }> {
        const docText = candidate.content.length > this.config.maxDocChars
            ? candidate.content.slice(0, this.config.maxDocChars) + '...'
            : candidate.content;

        const prompt = buildRerankPrompt(query, docText);

        try {
            const response = await Promise.race([
                client.generate(prompt, {
                    temperature: 0,
                    num_predict: 10,
                }),
                timeoutPromise(this.config.timeoutMs),
            ]);

            const score = parseScore(response.response);
            return { candidate, score };
        } catch (error) {
            logger.debug(`[Reranker] 스코어링 실패 (id=${candidate.id}): ${error}`);
            // 실패 시 중간 점수 부여 (완전 제외 방지)
            return { candidate, score: 5 };
        }
    }
}

/**
 * 재순위화 프롬프트를 생성합니다.
 *
 * 최소한의 토큰으로 0~10 점수만 응답하도록 유도합니다.
 */
function buildRerankPrompt(query: string, document: string): string {
    return `Rate the relevance of the following document to the query on a scale of 0 to 10.
Reply with ONLY a single number (0-10). No explanation.

Query: ${query}
Document: ${document}
Relevance score:`;
}

/**
 * LLM 응답에서 0~10 사이의 점수를 파싱합니다.
 *
 * @param response - LLM 텍스트 응답
 * @returns 0~10 범위의 점수 (파싱 실패 시 5)
 */
function parseScore(response: string): number {
    const trimmed = response.trim();
    const match = trimmed.match(SCORE_PATTERN);

    if (!match) {
        return 5; // 파싱 실패 시 중간값
    }

    const score = parseFloat(match[1]);
    // 범위 클램핑
    return Math.max(0, Math.min(10, score));
}

/**
 * 타임아웃 프로미스 (Promise.race용)
 */
function timeoutPromise(ms: number): Promise<never> {
    return new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Reranker timeout: ${ms}ms`)), ms)
    );
}

// 내보내기 (테스트용)
export { buildRerankPrompt, parseScore };

// 싱글톤 팩토리
let instance: Reranker | null = null;

/**
 * Reranker 싱글톤 인스턴스를 반환합니다.
 */
export function getReranker(config?: RerankerConfig): Reranker {
    if (!instance) {
        instance = new Reranker(config);
    }
    return instance;
}
