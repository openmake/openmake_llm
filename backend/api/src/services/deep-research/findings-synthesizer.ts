/**
 * Deep Research - 결과 합성 모듈
 *
 * 검색 결과를 청크로 나누어 LLM으로 합성하는 기능을 제공합니다.
 * 스크래핑 실패 시 경량 합성으로 자동 전환합니다.
 *
 * @module services/deep-research/findings-synthesizer
 */

import type { LLMClient } from '../../llm';
import type { SearchResult } from '../../mcp/web-search';
import type { ResearchConfig, SynthesisResult } from '../deep-research-types';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';
import { TRUNCATION, RESEARCH_DEFAULTS } from '../../config/runtime-limits';
import { LLM_TEMPERATURES } from '../../config/llm-parameters';
import { LLM_TIMEOUTS } from '../../config/timeouts';
import {
    deduplicateSources,
    normalizeUrl,
    chunkArray,
    extractBulletLikeFindings
} from '../deep-research-utils';
import {
    getChunkSummaryPrompt,
    getLightweightChunkSummaryPrompt,
    getMergePrompt,
    getNeedMorePrompt,
    getResearchMessage
} from '../deep-research-prompts';
import { parallelBatch } from '../../workflow/graph-engine';
import { chatWithAbortTimeout } from './chat-with-timeout';

const logger = createLogger('DeepResearch:FindingsSynthesizer');

/**
 * 소스 목록의 실질적 콘텐츠 총량을 측정합니다.
 * fullContent가 있으면 그 길이를, 없으면 snippet 길이를 합산합니다.
 */
function measureTotalContent(sources: SearchResult[]): number {
    return sources.reduce((total, source) => {
        const content = source.fullContent?.trim().length
            ? source.fullContent
            : (source.snippet || '');
        return total + content.length;
    }, 0);
}

/**
 * 검색 결과를 청크로 나눠 LLM 합성
 */
export async function synthesizeFindings(params: {
    client: LLMClient;
    config: ResearchConfig;
    topic: string;
    searchResults: SearchResult[];
    sessionId: string;
    loopNumber: number;
    abortSignal?: AbortSignal;
    throwIfAborted: () => void;
}): Promise<SynthesisResult> {
    const { client, config, topic, searchResults, sessionId, loopNumber, abortSignal, throwIfAborted } = params;

    throwIfAborted();
    const db = getUnifiedDatabase();

    if (searchResults.length === 0) {
        return { summary: getResearchMessage('noSources', config.language), keyPoints: [] };
    }

    const uniqueResults = deduplicateSources(searchResults);

    // ── 콘텐츠 충분성 평가 ──
    const totalContentChars = measureTotalContent(uniqueResults);
    const minContentThreshold = RESEARCH_DEFAULTS.MIN_CONTENT_FOR_FULL_SYNTHESIS;
    const isLightweight = totalContentChars < minContentThreshold;

    if (isLightweight) {
        logger.warn(
            `[DeepResearch] 콘텐츠 부족 (${totalContentChars}자 < ${minContentThreshold}자) → 경량 합성 전환`
        );
    }

    const chunks = chunkArray(uniqueResults, config.chunkSize);

    // 청크 요약을 병렬 실행 (LLM I/O-bound이므로 높은 병렬도 허용)
    const chunkResults = await parallelBatch(
        chunks,
        async (chunk, chunkIndex) => {
            throwIfAborted();
            const chunkContext = chunk
                .map(source => {
                    const sourceIndex = uniqueResults.findIndex(item => normalizeUrl(item.url) === normalizeUrl(source.url)) + 1;
                    const content = source.fullContent?.trim().length
                        ? source.fullContent
                        : source.snippet;
                    const compactContent = content.length > TRUNCATION.RESEARCH_CONTENT_MAX ? `${content.slice(0, TRUNCATION.RESEARCH_CONTENT_MAX)}\n...(중략)` : content;
                    return `[출처 ${sourceIndex}] ${source.title}\nURL: ${source.url}\n내용:\n${compactContent}`;
                })
                .join('\n\n');

            // 콘텐츠 충분성에 따라 프롬프트 선택
            const chunkPrompt = isLightweight
                ? getLightweightChunkSummaryPrompt(config.language, topic, chunkIndex, chunks.length, chunkContext)
                : getChunkSummaryPrompt(config.language, topic, chunkIndex, chunks.length, chunkContext);

            try {
                const response = await chatWithAbortTimeout(
                    client,
                    [{ role: 'user', content: chunkPrompt }],
                    { temperature: LLM_TEMPERATURES.RESEARCH_SYNTHESIS },
                    LLM_TIMEOUTS.SYNTHESIS_PER_CHUNK_TIMEOUT_MS,
                    abortSignal,
                );
                throwIfAborted();
                return response.content.trim();
            } catch (error) {
                throwIfAborted();  // 외부 중단이면 RESEARCH_ABORTED 전파, timeout/기타면 강등
                logger.error(`[DeepResearch] 청크 요약 실패 (${chunkIndex + 1}/${chunks.length}): ${error instanceof Error ? error.message : String(error)}`);
                return '청크 요약 실패';
            }
        },
        {
            concurrency: RESEARCH_DEFAULTS.SYNTHESIS_CONCURRENCY,
            signal: abortSignal
        }
    );

    const chunkSummaries = chunkResults.map(r => r ?? '청크 요약 실패');

    // 모든 청크가 실패했으면 합성 중단
    const allFailed = chunkSummaries.every(s => s === '청크 요약 실패');
    if (allFailed) {
        logger.error('[DeepResearch] 모든 청크 요약 실패 — 합성 중단');
        return { summary: getResearchMessage('synthesisFailed', config.language), keyPoints: [] };
    }

    // ── 계층적 Map-Reduce 병합 ──
    // 청크 요약 수가 MAP_REDUCE_THRESHOLD 초과 시 재귀적 병합 수행
    const mergedSummary = await hierarchicalMerge({
        client, config, topic, summaries: chunkSummaries,
        abortSignal, throwIfAborted, depth: 0,
    });

    const keyPoints = extractBulletLikeFindings(mergedSummary);

    throwIfAborted();  // abort 시 합성 스텝을 completed 로 오기록하지 않음
    await db.addResearchStep({
        sessionId,
        stepNumber: loopNumber * 100 + 100,
        stepType: 'synthesize',
        query: `루프 ${loopNumber} 합성${isLightweight ? ' (경량)' : ''}`,
        result: mergedSummary.slice(0, TRUNCATION.RESEARCH_SUMMARY_MAX),
        status: 'completed'
    });

    return { summary: mergedSummary, keyPoints };
}

/**
 * 계층적 Map-Reduce 병합
 *
 * 청크 요약 수가 MAP_REDUCE_THRESHOLD 이하이면 단일 병합,
 * 초과하면 요약들을 다시 그룹으로 나누어 재귀적으로 병합합니다.
 * MAX_HIERARCHY_DEPTH에 도달하면 단일 병합으로 강제 전환합니다.
 *
 * @returns 최종 병합된 요약 텍스트
 */
async function hierarchicalMerge(params: {
    client: LLMClient;
    config: ResearchConfig;
    topic: string;
    summaries: string[];
    abortSignal?: AbortSignal;
    throwIfAborted: () => void;
    depth: number;
}): Promise<string> {
    const { client, config, topic, summaries, abortSignal, throwIfAborted, depth } = params;
    const validSummaries = summaries.filter(s => s !== '청크 요약 실패');

    if (validSummaries.length === 0) {
        return getResearchMessage('synthesisFailed', config.language);
    }

    // 단일 병합 조건: 요약 수가 임계값 이하이거나 최대 깊이 도달
    if (validSummaries.length <= RESEARCH_DEFAULTS.MAP_REDUCE_THRESHOLD
        || depth >= RESEARCH_DEFAULTS.MAX_HIERARCHY_DEPTH) {

        if (depth > 0) {
            logger.info(`[DeepResearch] 계층 ${depth} 병합: ${validSummaries.length}개 요약 → 최종 병합`);
        }

        return await singleMerge({ client, config, topic, summaries: validSummaries, abortSignal, throwIfAborted });
    }

    // 재귀적 병합: 요약들을 MAP_REDUCE_THRESHOLD 크기 그룹으로 나눠 중간 병합
    const groupSize = RESEARCH_DEFAULTS.MAP_REDUCE_THRESHOLD;
    const groups = chunkArray(validSummaries, groupSize);
    logger.info(
        `[DeepResearch] 계층적 병합 시작: ${validSummaries.length}개 요약 → ${groups.length}개 그룹 (깊이 ${depth})`
    );

    const intermediateSummaries = await parallelBatch(
        groups,
        async (group) => {
            throwIfAborted();
            return await singleMerge({ client, config, topic, summaries: group, abortSignal, throwIfAborted });
        },
        { concurrency: RESEARCH_DEFAULTS.SYNTHESIS_CONCURRENCY, signal: abortSignal }
    );

    const validIntermediate = (intermediateSummaries.filter(s => s != null) as string[]);

    // 재귀: 중간 결과를 다시 병합
    return hierarchicalMerge({
        ...params,
        summaries: validIntermediate,
        depth: depth + 1,
    });
}

/**
 * 단일 수준 병합 — 요약 목록을 하나의 종합 요약으로 합성
 */
async function singleMerge(params: {
    client: LLMClient;
    config: ResearchConfig;
    topic: string;
    summaries: string[];
    abortSignal?: AbortSignal;
    throwIfAborted: () => void;
}): Promise<string> {
    const { client, config, topic, summaries, abortSignal, throwIfAborted } = params;

    const mergedPrompt = getMergePrompt(config.language, topic, summaries);

    try {
        const response = await chatWithAbortTimeout(
            client,
            [{ role: 'user', content: mergedPrompt }],
            { temperature: LLM_TEMPERATURES.RESEARCH_REPORT },
            LLM_TIMEOUTS.SYNTHESIS_MERGE_TIMEOUT_MS,
            abortSignal,
        );
        throwIfAborted();
        return response.content.trim();
    } catch (error) {
        throwIfAborted();  // 외부 중단이면 RESEARCH_ABORTED 전파, timeout/기타면 폴백
        logger.error(`[DeepResearch] 병합 실패: ${error instanceof Error ? error.message : String(error)}`);
        // 폴백: 청크 요약들을 합쳐서 반환
        const partialSummary = summaries.filter(s => s !== '청크 요약 실패').join('\n\n');
        return partialSummary || getResearchMessage('synthesisFailed', config.language);
    }
}

/**
 * 추가 정보가 필요한지 확인
 */
export async function checkNeedsMoreInfo(params: {
    client: LLMClient;
    config: ResearchConfig;
    topic: string;
    currentFindings: string[];
    sourceCount: number;
    abortSignal?: AbortSignal;
    throwIfAborted: () => void;
}): Promise<boolean> {
    const { client, config, topic, currentFindings, sourceCount, abortSignal, throwIfAborted } = params;

    throwIfAborted();
    if (sourceCount < RESEARCH_DEFAULTS.MAX_TOTAL_SOURCES * 0.6) {
        return true;
    }

    const prompt = getNeedMorePrompt(config.language, topic, currentFindings, sourceCount);

    try {
        const response = await chatWithAbortTimeout(
            client,
            [{ role: 'user', content: prompt }],
            { temperature: LLM_TEMPERATURES.RESEARCH_FACT_CHECK },
            LLM_TIMEOUTS.RESEARCH_NEED_MORE_TIMEOUT_MS,
            abortSignal,
        );
        throwIfAborted();

        return response.content.toLowerCase().includes('yes');
    } catch (error) {
        throwIfAborted();  // 외부 중단이면 RESEARCH_ABORTED 전파, timeout/기타면 폴백
        logger.error(`[DeepResearch] 추가 정보 판단 실패: ${error instanceof Error ? error.message : String(error)}`);
        return sourceCount < config.maxTotalSources;
    }
}
